import { signLoginPayload } from "thirdweb/auth";
import type { Account, Wallet } from "thirdweb/wallets";

const AUTH_ERRORS: Record<string, string> = {
  invalid_address: "The connected wallet address is invalid. Reconnect your wallet and try again.",
  invalid_chain_id: "The wallet network is invalid. Reconnect your wallet and try again.",
  server_admin_key_missing: "Wallet sign-in is not configured on this site. Please contact support.",
  invalid_signature: "The signature could not be verified. Check your wallet account and network, then try again.",
};

async function readAuthResponse(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(AUTH_ERRORS[data?.error] || `${fallback} (HTTP ${response.status}). Please try again.`);
  }
  return data;
}

/** Sign with the connected account on its own chain, including contract wallets. */
export async function loginWithWallet(account: Account, wallet: Wallet) {
  const chainId = wallet.getChain()?.id;
  if (!chainId || wallet.getAccount()?.address.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("Your wallet connection changed. Reconnect your wallet and try again.");
  }
  const params = new URLSearchParams({ address: account.address, chainId: String(chainId) });
  const data = await readAuthResponse(
    await fetch(`/api/auth/payload?${params}`, { cache: "no-store" }),
    "Could not prepare the sign-in message",
  );
  if (!data?.payload) throw new Error("Could not prepare the sign-in message. Please try again.");

  // The user can change accounts or networks while the payload is in flight.
  if (wallet.getChain()?.id !== chainId || wallet.getAccount()?.address.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("Your wallet account or network changed. Please try signing in again.");
  }
  const signed = await signLoginPayload({ payload: data.payload, account });
  await readAuthResponse(
    await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signed),
    }),
    "Could not complete wallet sign-in",
  );
}
