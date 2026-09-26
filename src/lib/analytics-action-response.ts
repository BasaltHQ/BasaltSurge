/** Keep proxy error pages out of action output without claiming a write failed. */
export async function readAnalyticsActionResponse(response: Response, action: string): Promise<Record<string, any>> {
  const reference = response.headers.get("cf-ray") || response.headers.get("x-correlation-id");
  const unavailable = () => new Error(
    `${action} response unavailable (HTTP ${response.status}). Refresh the receipt to check its status before retrying.` +
    (reference ? ` Reference: ${reference}.` : ""),
  );
  let data: any;
  try { data = JSON.parse(await response.text()); } catch { throw unavailable(); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw unavailable();
  if (typeof data.error === "string" && /<!doctype\s+html|<html[\s>]/i.test(data.error)) throw unavailable();
  return data;
}
