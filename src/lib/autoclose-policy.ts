export function normalizeAutocloseBrandKey(value: unknown): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "portalpay") return "basaltsurge";
  return normalized;
}

export function parseAutocloseBrandKeys(value: unknown, maxBrands = 50): string[] {
  return Array.from(new Set(
    String(value || "")
      .split(",")
      .map((brand) => brand.trim())
      .filter(Boolean)
      .map(normalizeAutocloseBrandKey)
      .filter((brand) => /^[a-z0-9-]{2,30}$/.test(brand))
  )).slice(0, maxBrands);
}

export function isSuccessfulAutocloseRun(run: any): boolean {
  if (!run || run.type !== "autoclose_run") return false;
  if (run.status === "success") return true;
  return !run.status && Number(run.failed || 0) === 0;
}

export function needsReceiptSettlement(transactionHash: unknown): boolean {
  const value = String(transactionHash || "").trim().toLowerCase();
  return !value || value === "ecommerce_pending" || value === "ach_pending";
}

export function isSuccessfulTransactionReceipt(receipt: any): boolean {
  return receipt?.status === "success" || receipt?.status === 1 || receipt?.status === "0x1";
}

export function getTimestampMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = new Date(String(value || "")).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
