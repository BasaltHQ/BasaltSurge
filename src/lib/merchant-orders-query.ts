import { createHash } from "node:crypto";

export const ORDER_SORT_FIELDS = { createdAt: "createdAt", totalUsd: "totalUsd", receiptId: "receiptId", status: "status", brand: "brandName" } as const;
export const ORDER_STATUS_GROUPS: Record<string, string[]> = {
  paid: ["paid", "checkout_success", "tx_mined", "reconciled", "recipient_validated"],
  pending: ["generated", "checkout_initialized", "link_opened", "buyer_logged_in"],
  delivered: ["delivered", "completed"],
  failed: ["failed", "tx_mismatch"],
};
const SEARCH_FIELDS = ["receiptId", "buyerWallet", "brandName", "status", "employeeId", "jurisdictionCode", "shippingAddress.name", "shippingAddress.email", "customerEmail", "stripeEmail"];
export const ORDER_LIST_FIELDS = ["id", "receiptId", "wallet", "brandKey", "totalUsd", "currency", "createdAt", "brandName", "status", "employeeId", "jurisdictionCode", "taxRate", "shippingAddress", "tracking", "tipAmount"];
export const ORDER_DETAIL_FIELDS = [...ORDER_LIST_FIELDS, "pricing", "lineItems", "taxComponents", "shippingMethod", "shippingCostUsd", "buyerWallet", "transactionHash", "detectedCardFunding", "cardFunding", "lastPolledAt", "stripeSessionStatus", "customerSessions"];

export function orderQueryError(message: string) { return Object.assign(new Error(message), { status: 400 }); }
function numberParam(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw orderQueryError(`Invalid ${name}`);
  return n;
}
export function parseOrderQuery(params: URLSearchParams) {
  const limit = numberParam(params, "limit") ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw orderQueryError("Limit must be an integer from 1 to 100");
  const sort = params.get("sort") || "createdAt";
  if (!Object.hasOwn(ORDER_SORT_FIELDS, sort)) throw orderQueryError("Invalid sort field");
  const direction = params.get("direction") || "desc";
  if (direction !== "asc" && direction !== "desc") throw orderQueryError("Invalid sort direction");
  const search = (params.get("search") || "").trim().toLowerCase();
  const status = (params.get("status") || "all").trim().toLowerCase();
  const employeeId = (params.get("employeeId") || "all").trim();
  if (search.length > 200 || status.length > 80 || employeeId.length > 200) throw orderQueryError("Filter is too long");
  const minAmount = numberParam(params, "minAmount"), maxAmount = numberParam(params, "maxAmount");
  if (minAmount !== undefined && maxAmount !== undefined && minAmount > maxAmount) throw orderQueryError("Minimum amount exceeds maximum amount");
  const shipping = params.get("shipping") === "true";
  return { limit, sort: sort as keyof typeof ORDER_SORT_FIELDS, direction, search, status, employeeId, minAmount, maxAmount, shipping };
}
export type OrderQuery = ReturnType<typeof parseOrderQuery>;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildOrderFilters(query: OrderQuery, wallet: string, brand: { clause: string; parameters: { name: string; value: any }[] }) {
  const clauses = ["c.type = 'receipt'", "c.wallet = @wallet", brand.clause];
  const parameters: { name: string; value: any }[] = [{ name: "@wallet", value: wallet }, ...brand.parameters];
  // Build both backends from the same field and status definitions.
  const mongo: any[] = [{ type: "receipt", wallet }];
  if (query.search) {
    parameters.push({ name: "@search", value: query.search });
    clauses.push(`(${SEARCH_FIELDS.map(field => `CONTAINS(LOWER(c.${field}), @search)`).join(" OR ")} OR EXISTS(SELECT VALUE item FROM item IN c.lineItems WHERE CONTAINS(LOWER(item.label), @search)))`);
    mongo.push({ $or: [...SEARCH_FIELDS, "lineItems.label"].map(field => ({ [field]: { $regex: escapeRegex(query.search), $options: "i" } })) });
  }
  if (query.status !== "all") {
    const statuses = Object.hasOwn(ORDER_STATUS_GROUPS, query.status) ? ORDER_STATUS_GROUPS[query.status] : [query.status];
    const expressions = statuses.map((value, i) => {
      parameters.push({ name: `@status${i}`, value });
      return `LOWER(c.status) = @status${i}`;
    });
    const alternatives: any[] = statuses.map(value => ({ status: { $regex: `^${escapeRegex(value)}$`, $options: "i" } }));
    const contains = query.status === "pending" ? "pending" : query.status === "refunded" ? "refund" : null;
    if (contains) {
      parameters.push({ name: "@statusContains", value: contains });
      expressions.push("CONTAINS(LOWER(c.status), @statusContains)");
      alternatives.push({ status: { $regex: contains, $options: "i" } });
    }
    clauses.push(`(${expressions.join(" OR ")})`);
    mongo.push({ $or: alternatives });
  }
  if (query.employeeId !== "all") {
    if (query.employeeId === "admin") {
      clauses.push("(c.employeeId = 'admin' OR NOT IS_DEFINED(c.employeeId) OR c.employeeId = null OR c.employeeId = '')");
      mongo.push({ $or: [{ employeeId: "admin" }, { employeeId: null }, { employeeId: "" }] });
    } else {
      clauses.push("c.employeeId = @employeeId"); parameters.push({ name: "@employeeId", value: query.employeeId });
      mongo.push({ employeeId: query.employeeId });
    }
  }
  for (const [name, sql, op] of [["minAmount", ">=", "$gte"], ["maxAmount", "<=", "$lte"]] as const) {
    if (query[name] !== undefined) {
      clauses.push(`c.totalUsd ${sql} @${name}`); parameters.push({ name: `@${name}`, value: query[name] });
      mongo.push({ totalUsd: { [op]: query[name] } });
    }
  }
  if (query.shipping) {
    clauses.push("IS_DEFINED(c.shippingAddress) AND c.shippingAddress != null");
    mongo.push({ shippingAddress: { $ne: null } });
  }
  return { where: clauses.join(" AND "), parameters, mongo };
}

export function orderQueryKey(query: OrderQuery, wallet: string, brandKey: string) {
  return createHash("sha256").update(JSON.stringify({ query, wallet, brandKey })).digest("hex");
}
export function encodeOrderCursor(value: Record<string, any>) { return Buffer.from(JSON.stringify({ v: 1, ...value })).toString("base64url"); }
export function decodeOrderCursor(raw: string | null, key: string): any | null {
  if (!raw) return null;
  try {
    if (raw.length > 24000 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const value = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (value.v !== 1 || value.key !== key || !["mongo", "cosmos"].includes(value.backend)) throw new Error();
    return value;
  } catch { throw orderQueryError("Invalid cursor for this merchant and query"); }
}
