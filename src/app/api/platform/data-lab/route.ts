import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requirePlatformAnalyticsAccess } from "@/lib/partner-analytics-access";
import { compileLabQuery, inferLabFields, redactLabValue } from "@/lib/data-lab";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const queryOptions = (req: NextRequest) => ({ maxTimeMS: 10000, abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(15000)]) });
async function authorize(req: NextRequest) {
  const actor = await requirePlatformAnalyticsAccess(req);
  if (!actor.role.startsWith("platform_")) throw Object.assign(new Error("Platform access is required."), { status: 403 });
}
function failure(error: unknown) {
  const status = Number((error as { status?: number })?.status);
  return json({ error: status === 401 ? "Sign in to your platform administrator account." : status === 403 ? "Platform analytics access is required." : "The data store could not complete this request. Retry or narrow your query." }, status === 401 || status === 403 ? status : 503);
}

export async function GET(req: NextRequest) {
  try {
    await authorize(req);
    const container = await getContainer(undefined, undefined, { profile: "analytics" });
    const schema = req.nextUrl.searchParams.get("schema");
    if (schema) {
      if (!/^[a-zA-Z0-9_:-]{1,120}$/.test(schema)) return json({ error: "Invalid schema name." }, 400);
      const { resources } = await container.items.query<Record<string, unknown>>({ query: "SELECT TOP 50 * FROM c WHERE c.type = @schema", parameters: [{ name: "@schema", value: schema }] }, queryOptions(req)).fetchAll();
      return json({ schema: { name: schema, fields: inferLabFields(resources), sampled: resources.length } });
    }
    const { resources } = await container.items.query<unknown>("SELECT DISTINCT VALUE c.type FROM c WHERE IS_DEFINED(c.type)", queryOptions(req)).fetchAll();
    const schemas = resources.filter((name): name is string => typeof name === "string" && /^[a-zA-Z0-9_:-]{1,120}$/.test(name)).sort();
    return json({ schemas, source: "Platform document store" });
  } catch (error) { return failure(error); }
}

export async function POST(req: NextRequest) {
  try {
    await authorize(req);
    if (Number(req.headers.get("content-length")) > 16000) return json({ error: "Query is too large." }, 413);
    let compiled: ReturnType<typeof compileLabQuery>;
    try {
      const body = await req.json();
      if (typeof body.query !== "string") throw new Error("Provide a query.");
      compiled = compileLabQuery(body.query);
    } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid query." }, 400); }
    const start = Date.now();
    const container = await getContainer(undefined, undefined, { profile: "analytics" });
    const result = await container.items.query<Record<string, unknown>>({ query: compiled.query, parameters: compiled.parameters }, queryOptions(req)).fetchAll();
    return json({ rows: result.resources.map(row => redactLabValue(row)), elapsedMs: Date.now() - start, limit: compiled.limit, schema: compiled.schema, requestCharge: result.requestCharge || 0 });
  } catch (error) { return failure(error); }
}
