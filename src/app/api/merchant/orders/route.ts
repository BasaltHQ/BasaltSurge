import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getContainer } from "@/lib/cosmos";
import { getMerchantBrandScope, requireMerchantPermission } from "@/lib/merchant-team-access";
import { parseCosmosSql } from "@/lib/db/sql-parser";
import { receiptCurrencyFields } from "@/lib/receipt-currency";
import { buildOrderFilters, decodeOrderCursor, encodeOrderCursor, ORDER_DETAIL_FIELDS, ORDER_LIST_FIELDS, ORDER_SORT_FIELDS, orderQueryError, orderQueryKey, parseOrderQuery } from "@/lib/merchant-orders-query";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const projection = (fields: string[]) => Object.fromEntries(fields.map(field => [field, 1]));

// Preserve BSON types in keyset cursors, including legacy numeric timestamps.
function pack(value: any): any {
  if (value instanceof ObjectId) return { type: "oid", value: value.toHexString() };
  if (value instanceof Date) return { type: "date", value: value.getTime() };
  if (value == null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return { type: "scalar", value: value ?? null };
  throw orderQueryError("Unsupported order sort value");
}
function unpack(value: any): any {
  if (value?.type === "oid" && typeof value.value === "string" && /^[a-f0-9]{24}$/.test(value.value)) return new ObjectId(value.value);
  if (value?.type === "date" && Number.isFinite(value.value) && Math.abs(value.value) <= 8640000000000000) return new Date(value.value);
  if (value?.type === "scalar" && (value.value === null || typeof value.value === "string" || (typeof value.value === "number" && Number.isFinite(value.value)))) return value.value;
  throw orderQueryError("Invalid order cursor");
}
function serialize(row: any, detail = false) {
  const result: any = {};
  for (const field of detail ? ORDER_DETAIL_FIELDS : ORDER_LIST_FIELDS) {
    if (row[field] !== undefined) result[field] = row[field] instanceof Date ? row[field].getTime() : row[field];
  }
  for (const field of ["createdAt", "lastPolledAt"]) {
    if (typeof result[field] === "string") {
      const timestamp = new Date(result[field]).getTime();
      if (Number.isFinite(timestamp)) result[field] = timestamp;
    }
  }
  if (detail) Object.assign(result, receiptCurrencyFields(result));
  return result;
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const query = parseOrderQuery(params);
    const target = req.headers.get("x-wallet") || "";
    const { merchantWallet, brandKey } = await requireMerchantPermission(req, target, "manage:orders");
    const scope = getMerchantBrandScope(req);
    const key = orderQueryKey(query, merchantWallet, brandKey);
    const cursor = decodeOrderCursor(params.get("cursor"), key);
    const receiptId = params.get("receiptId");
    if (receiptId !== null && (!receiptId.trim() || receiptId.length > 200)) throw orderQueryError("Invalid receipt ID");
    const container = await getContainer(undefined, undefined, { profile: "critical" });
    const collection = (container as any).getCollection?.();
    const brandFilter = parseCosmosSql(`SELECT * FROM c WHERE ${scope.clause}`, scope.parameters).filter;

    if (receiptId !== null) {
      // Bounded identity lookup. No checkout enrichment, logs or external calls.
      let rows: any[];
      if (collection) {
        rows = await collection.find({ $and: [{ type: "receipt", wallet: merchantWallet, receiptId }, brandFilter] }, {
          projection: projection(ORDER_DETAIL_FIELDS), readPreference: "primary", maxTimeMS: 8000, signal: req.signal,
        }).limit(2).toArray();
      } else {
        rows = (await container.items.query({
          query: `SELECT TOP 2 ${ORDER_DETAIL_FIELDS.map(field => `c.${field}`).join(", ")} FROM c WHERE c.type = 'receipt' AND c.wallet = @wallet AND c.receiptId = @receiptId AND ${scope.clause}`,
          parameters: [{ name: "@wallet", value: merchantWallet }, { name: "@receiptId", value: receiptId }, ...scope.parameters],
        }, { partitionKey: merchantWallet, abortSignal: req.signal }).fetchAll()).resources;
      }
      if (rows.length !== 1) return json({ ok: false, error: rows.length ? "Receipt identity is ambiguous. Please contact support." : "Receipt not found." }, rows.length ? 409 : 404);
      return json({ ok: true, receipt: serialize(rows[0], true) });
    }

    const filters = buildOrderFilters(query, merchantWallet, scope);
    const field = ORDER_SORT_FIELDS[query.sort];
    if (collection) {
      if (cursor && cursor.backend !== "mongo") throw orderQueryError("Cursor backend has changed; refresh orders");
      const conditions = [...filters.mongo, brandFilter];
      if (cursor) {
        const value = unpack(cursor.value), id = unpack(cursor.id);
        if (id === null) throw orderQueryError("Invalid order cursor identity");
        const op = query.direction === "asc" ? "$gt" : "$lt";
        const after: any[] = [{ [field]: value, _id: { [op]: id } }];
        if (value === null) {
          if (query.direction === "asc") after.push({ [field]: { $ne: null } });
        } else {
          after.push({ [field]: { [op]: value } });
          if (query.direction === "desc") after.push({ [field]: null });
          // Mongo range predicates are type-bracketed. Include other supported
          // BSON types in sort order so migrated/legacy timestamps aren't lost.
          const types = ["number", "string", "date"];
          const rank = value instanceof Date ? 2 : typeof value === "number" ? 0 : 1;
          for (let index = 0; index < types.length; index++) {
            if (query.direction === "asc" ? index > rank : index < rank) after.push({ [field]: { $type: types[index] } });
          }
        }
        conditions.push({ $or: after });
      }
      const direction = query.direction === "asc" ? 1 : -1;
      const rows: any[] = await collection.find({ $and: conditions }, {
        projection: projection(ORDER_LIST_FIELDS), readPreference: "primary", maxTimeMS: 8000, signal: req.signal,
      }).sort({ [field]: direction, _id: direction }).limit(query.limit + 1).toArray();
      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit), last = page.at(-1);
      const nextCursor = hasMore ? encodeOrderCursor({ key, backend: "mongo", value: pack(last[field]), id: pack(last._id) }) : null;
      return json({ ok: true, receipts: page.map(row => serialize(row)), pagination: { hasMore, nextCursor, limit: query.limit } });
    }

    if (cursor && (cursor.backend !== "cosmos" || typeof cursor.token !== "string")) throw orderQueryError("Invalid Cosmos cursor");
    const result = await container.items.query({
      query: `SELECT ${ORDER_LIST_FIELDS.map(name => `c.${name}`).join(", ")} FROM c WHERE ${filters.where} ORDER BY c.${field} ${query.direction.toUpperCase()}`,
      parameters: filters.parameters,
    }, { partitionKey: merchantWallet, maxItemCount: query.limit, continuationToken: cursor?.token, abortSignal: req.signal }).fetchNext();
    const token = result.continuationToken;
    return json({ ok: true, receipts: (result.resources || []).map(row => serialize(row)), pagination: {
      hasMore: Boolean(token), nextCursor: token ? encodeOrderCursor({ key, backend: "cosmos", token }) : null, limit: query.limit,
    } });
  } catch (error: any) {
    const status = [400, 401, 403].includes(error?.status) ? error.status : 503;
    if (status === 503) console.error("[merchant/orders] Query failed", error);
    return json({ ok: false, error: status === 503 ? "Orders could not be loaded. Please retry." : error.message }, status);
  }
}
