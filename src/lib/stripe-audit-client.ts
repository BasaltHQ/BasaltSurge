export type StripeAuditProgress = {
  ok: boolean; runId?: string; status?: string; error?: string; row?: any;
  details?: Array<{ status: string; reason?: string }>;
};

export async function readStripeAuditResponse(response: Response): Promise<any> {
  let data: any;
  try { data = JSON.parse(await response.text()); }
  catch {
    const detail = response.redirected ? "a redirect" : [502, 503, 504].includes(response.status) ? "a gateway/server error" : "a non-JSON server response";
    throw new Error(`Received ${detail} (HTTP ${response.status}). The sweep outcome is unknown. Check run status or inspect the receipt before retrying.`);
  }
  if (!data || typeof data !== "object" || typeof data.ok !== "boolean") throw new Error(`Invalid audit response (HTTP ${response.status}). Check the receipt before retrying.`);
  if (!data.ok && typeof data.requestId === "string" && typeof data.stage === "string") {
    data.error = `${data.error || "Audit request failed"} (stage: ${data.stage}; request: ${data.requestId})`;
  }
  return data;
}

/** Only GET polling is repeated. A lost POST response must never resubmit a sweep. */
export async function monitorStripeAuditRun(runId: string, options: {
  fetcher?: typeof fetch; wait?: (ms: number) => Promise<void>;
  onProgress: (data: StripeAuditProgress) => void; stopped?: () => boolean; maxPolls?: number;
}): Promise<StripeAuditProgress> {
  const fetcher = options.fetcher || fetch;
  const wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < (options.maxPolls ?? 200); attempt++) {
    if (options.stopped?.()) return { ok: true, runId, status: "unknown", error: "Status monitoring paused. The server run may still be active; check its status before retrying." };
    const response = await fetcher(`/api/platform/stripe-audit?runId=${encodeURIComponent(runId)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const data = await readStripeAuditResponse(response);
    if (!response.ok || !data.ok) throw new Error(data.error || `Audit status unavailable (HTTP ${response.status}).`);
    options.onProgress(data);
    if (!["queued", "running"].includes(data.status)) return data;
    await wait(3000);
  }
  return { ok: true, runId, status: "unknown", error: "The run has not reported completion yet. It may still be processing. Check run status before retrying." };
}
