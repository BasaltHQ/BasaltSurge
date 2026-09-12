export const ACCESS_STATUS_ERROR = "We couldn't verify your existing access. Please try again. You don't need to submit another application.";

export type MerchantAccessStatus = {
  wallet: string;
  authed: boolean;
  shopStatus: "none" | "approved" | "pending" | "rejected";
  blocked?: boolean;
  approved?: boolean;
  isPlatformAdmin?: boolean;
  isTeamMember?: boolean;
};

/** A public status lookup must describe the connected wallet, not a stale session. */
export function resolveAccessStatusWallet(sessionWallet: string | null, headerWallet: string | null) {
  const session = (sessionWallet || "").trim().toLowerCase();
  const requested = (headerWallet || "").trim().toLowerCase();
  const wallet = /^0x[a-f0-9]{40}$/.test(requested) ? requested : session;
  return { wallet, sessionAuthed: !!session && session === wallet };
}

export async function fetchMerchantAccessStatus(wallet: string, brandKey: string, signal?: AbortSignal): Promise<MerchantAccessStatus> {
  const response = await fetch("/api/auth/me", {
    cache: "no-store",
    headers: { "x-wallet": wallet, "x-brand-key": brandKey },
    signal,
  });
  if (!response.ok) throw new Error(ACCESS_STATUS_ERROR);
  const data = await response.json();
  if (data?.error || String(data?.wallet || "").toLowerCase() !== wallet.toLowerCase() ||
      !["none", "approved", "pending", "rejected"].includes(data?.shopStatus)) {
    throw new Error(ACCESS_STATUS_ERROR);
  }
  return data;
}
