import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getContainer } from "@/lib/cosmos";
import { requirePlatformAnalyticsAccess } from "@/lib/partner-analytics-access";
import { requireCsrf, rateLimitOrThrow, rateKey } from "@/lib/security";
import { optionalCheckoutDocument } from "@/lib/checkout-experiment-store";
import { summarizeCheckoutExperiment, type CheckoutExperiment } from "@/lib/checkout-experiment";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const validBrand = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value);
async function authorize(req: NextRequest, write = false) {
  const actor = await requirePlatformAnalyticsAccess(req);
  if (!actor.role.startsWith("platform_") || (write && !["platform_super_admin", "platform_admin"].includes(actor.role))) {
    throw Object.assign(new Error("Platform administrator access is required."), { status: 403 });
  }
  return actor;
}
function failure(error: any) {
  const rawStatus = Number(error?.status || error?.statusCode || error?.code);
  const status = rawStatus === 11000 ? 409 : rawStatus;
  if (rawStatus === 11000) return json({ error: "An experiment was created concurrently. Refresh to load it." }, 409);
  return json({ error: [400, 401, 403, 404, 409, 412, 429].includes(status) ? error.message : "The experiment could not be loaded or saved. Please retry." }, [400, 401, 403, 404, 409, 412, 429].includes(status) ? status : 503);
}
const options = (req: NextRequest) => ({ maxTimeMS: 10000, abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(15000)]) });

export async function GET(req: NextRequest) {
  try {
    await authorize(req);
    const container = await getContainer(undefined, undefined, { profile: "critical" });
    const brand = req.nextUrl.searchParams.get("brand");
    if (!brand) {
      const [configs, receipts] = await Promise.all([
        container.items.query<{ wallet: string }>({ query: "SELECT c.wallet FROM c WHERE c.type = 'brand_config'" }, options(req)).fetchAll(),
        container.items.query<string>("SELECT DISTINCT VALUE c.brandKey FROM c WHERE c.type = 'receipt' AND IS_DEFINED(c.brandKey)", options(req)).fetchAll(),
      ]);
      return json({ brands: [...new Set([...configs.resources.map(row => row.wallet), ...receipts.resources].filter(validBrand))].sort() });
    }
    if (!validBrand(brand)) return json({ error: "Select a valid partner brand." }, 400);
    const experiment = await optionalCheckoutDocument(container, "checkout:experiment", brand);
    if (!experiment) return json({ experiment: null, results: [], truncated: false });
    const { resources } = await container.items.query({
      query: "SELECT TOP 10001 c.checkoutVersion, c.checkoutAssignmentSource, c.checkoutExperimentId, c.checkoutExposedAt, c.status, c.stripePaidSessionId, c.orderTotalUsd, c.totalUsd, c.accordionStepHistory, c.checkoutStatusHistory, c.kycOccurred FROM c WHERE c.type = 'receipt' AND c.brandKey = @brand AND c.checkoutExperimentId = @experiment ORDER BY c.checkoutAssignedAt ASC",
      parameters: [{ name: "@brand", value: brand }, { name: "@experiment", value: experiment.experimentId }],
    }, options(req)).fetchAll();
    return json({ experiment: publicExperiment(experiment), results: summarizeCheckoutExperiment(resources.slice(0, 10000), experiment.experimentId), truncated: resources.length > 10000 });
  } catch (error) { return failure(error); }
}

function publicExperiment(experiment: CheckoutExperiment) {
  const { brandKey, experimentId, name, active, startedAt, updatedAt } = experiment;
  return { brandKey, experimentId, name, active, startedAt, updatedAt };
}

export async function POST(req: NextRequest) {
  try {
    const actor = await authorize(req, true);
    requireCsrf(req);
    rateLimitOrThrow(req, rateKey(req, "checkout_experiment", actor.actorWallet), 20, 60_000);
    const body = await req.json().catch(() => null);
    if (!body) return json({ error: "Invalid experiment request." }, 400);
    if (!validBrand(body.brandKey) || !["start", "pause", "resume"].includes(body.action)) return json({ error: "Select a brand and experiment action." }, 400);
    const container = await getContainer(undefined, undefined, { profile: "critical" });
    const current = await optionalCheckoutDocument(container, "checkout:experiment", body.brandKey);
    const now = Math.max(Date.now(), Number(current?.updatedAt || 0) + 1);
    if (body.action === "start") {
      if (current) return json({ error: "An experiment already exists for this brand. Resume it to keep the same cohorts." }, 409);
      const config = await optionalCheckoutDocument(container, "brand:config", body.brandKey);
      const { resources } = config ? { resources: [config] } : await container.items.query({ query: "SELECT TOP 1 c.id FROM c WHERE c.type = 'receipt' AND c.brandKey = @brand", parameters: [{ name: "@brand", value: body.brandKey }] }, options(req)).fetchAll();
      if (!resources.length) return json({ error: "Partner brand was not found in this store." }, 404);
      const experiment: CheckoutExperiment = { id: "checkout:experiment", wallet: body.brandKey, type: "checkout_experiment", brandKey: body.brandKey, experimentId: randomUUID(), name: "Checkout v1 vs v2", active: true, startedAt: now, updatedAt: now };
      // Cosmos enforces id + partition uniqueness; Mongo needs a deterministic _id.
      await container.items.create({ ...experiment, _id: `checkout:experiment:${body.brandKey}`, updatedBy: actor.actorWallet });
      return json({ experiment: publicExperiment(experiment) });
    }
    if (!current || body.experimentId !== current.experimentId || body.updatedAt !== current.updatedAt) return json({ error: "Experiment changed. Refresh before continuing." }, 409);
    const active = body.action === "resume";
    await container.item(current.id, body.brandKey).patch([
      { op: "set", path: "/active", value: active }, { op: "set", path: "/updatedAt", value: now }, { op: "set", path: "/updatedBy", value: actor.actorWallet },
    ], { matchFields: { experimentId: current.experimentId, updatedAt: current.updatedAt }, ...(current._etag ? { accessCondition: { type: "IfMatch", condition: current._etag } } : {}) } as any);
    return json({ experiment: publicExperiment({ ...current, active, updatedAt: now }) });
  } catch (error) { return failure(error); }
}
