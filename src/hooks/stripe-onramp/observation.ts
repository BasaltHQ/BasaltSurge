
export const KYC_PROVIDER_PROPAGATION_DELAYS_MS = [3_000, 7_000] as const;

export const KYC_PENDING_AUTO_RECHECK_MS = 15_000;

export async function fetchOnrampObservation(url: string, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}
