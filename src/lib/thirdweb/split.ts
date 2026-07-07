import { deploySplitContract } from "thirdweb/deploys";
import type { Account } from "thirdweb/wallets";
import { client, chain, getRecipientAddress } from "@/lib/thirdweb/client";
import { getBrandKey, getBrandConfig } from "@/config/brands";
import { buildApiUrl, buildBrandApiUrl } from "@/lib/http";

/**
 * Ensure a per-merchant Split contract is deployed and persisted.
 * - Checks existing split via /api/split/deploy GET (idempotent metadata store).
 * - If missing, deploys a Split contract using thirdweb (sponsored gas via AA wallet).
 * - Persists the deployed address via /api/split/deploy POST.
 *
 * Shares:
 *  - Merchant: 99.5% (9950 bps)
 *  - Platform: 0.5% (50 bps) -> NEXT_PUBLIC_RECIPIENT_ADDRESS
 *
 * Returns the split contract address if available or newly deployed; otherwise undefined.
 */
function isValidHexAddress(addr?: string): addr is `0x${string}` {
  try {
    return !!addr && /^0x[a-fA-F0-9]{40}$/.test(String(addr).trim());
  } catch {
    return false as any;
  }
}

export async function ensureSplitForWallet(
  account: Account | any,
  brandKeyOverride?: string,
  partnerFeeBpsOverride?: number,
  merchantWalletOverride?: string,
  extraAgents?: { wallet: string, bps: number }[],
  partnerWalletOverride?: string,
  platformFeeBpsOverride?: number,
  forceRedeploy?: boolean,
  isCreditOverride?: boolean
): Promise<string | undefined> {
  const brandKey = brandKeyOverride || getBrandKey();
  const callerWallet = account?.address || "";
  if (!callerWallet) return undefined;

  try {
    const merchant = merchantWalletOverride ? String(merchantWalletOverride).toLowerCase() : String(callerWallet).toLowerCase();

    if (!isValidHexAddress(merchant)) return undefined;

    // Fetch effective brand config (with Cosmos overrides) to get current partnerFeeBps and partnerWallet
    let brand: any;
    if (brandKey) {
      try {
        const apiUrl = buildApiUrl(`/api/platform/brands/${encodeURIComponent(brandKey as string)}/config`);
        const r = await fetch(apiUrl, { cache: 'no-store', credentials: "include" });
        const j = await r.json().catch(() => ({}));
        brand = j?.brand ? j.brand : getBrandConfig(brandKey as string);
      } catch (e) {
        console.error("[ensureSplitForWallet] Failed to fetch brand config:", e);
        brand = getBrandConfig(brandKey as string);
      }
    } else {
      brand = {};
    }

    // Agent calculation helpers
    let agents = Array.isArray(extraAgents) ? extraAgents : [];
    if (extraAgents === undefined) {
      if (Array.isArray(brand?.agents) && brand.agents.length > 0) {
        agents = brand.agents.map((a: any) => ({ wallet: a.wallet, bps: a.bps }));
      } else if (brand?.agentWallet && brand?.agentFeeBps && brand?.agentFeeBps > 0) {
        if (isValidHexAddress(brand.agentWallet)) {
          agents = [{ wallet: brand.agentWallet, bps: brand.agentFeeBps }];
        }
      }
    }
    const agentSharesBps = agents.reduce((sum, a) => sum + Math.max(0, Math.min(10000, a.bps)), 0);

    // Check if dual split is enabled and this is a credit deployment
    const { isDualSplitEnabled, getSanitizedCreditSplitBps, getEnv } = await import("@/lib/env");
    const isCredit = isCreditOverride !== undefined ? !!isCreditOverride : isDualSplitEnabled();
    const dualSplit = isDualSplitEnabled() || isCredit;

    if (!brandKey) {
      // Persist recipients (without address) for later binding and exit early
      try {
        await fetch(buildApiUrl("/api/split/deploy"), {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-wallet": merchant, "x-csrf": "1" },
          body: JSON.stringify({
            wallet: merchant,
            platformPct: 0.5,
            agents,
            isCredit
          }),
        });
      } catch { }
      return undefined;
    }

    // Check existing split config (brand-scoped)
    // SKIPPED if forceRedeploy is true
    if (!forceRedeploy) {
      try {
        const queryParams = `wallet=${encodeURIComponent(merchant)}&brandKey=${encodeURIComponent(brandKey)}${isCredit ? "&isCredit=true" : ""}`;
        const r = await fetch(buildApiUrl(`/api/split/deploy?${queryParams}`), { cache: "no-store", credentials: "include" });
        const j = await r.json().catch(() => ({}));
        const existing = String(j?.split?.address || "").toLowerCase();
        // Only return existing if valid and not misconfigured
        if (isValidHexAddress(existing)) {
          if (!j?.misconfiguredSplit?.needsRedeploy) {
            return existing;
          }
        }
      } catch {
        // continue to deploy if read failed
      }
    }

    // Resolve platform recipient from env
    let platform = String(getRecipientAddress() || "").toLowerCase();
    if (!isValidHexAddress(platform)) {
      try {
        await fetch(buildApiUrl("/api/split/deploy"), {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-wallet": merchant, "x-csrf": "1" },
          credentials: "include",
          body: JSON.stringify({
            wallet: merchant,
            platformPct: 0.5, // for metadata correctness
            brandKey,
            agents,
            isCredit
          }),
        });
      } catch { }
      return undefined;
    }

    // Resolve partner wallet: prefer override, then brand config
    const partner = partnerWalletOverride && isValidHexAddress(partnerWalletOverride)
      ? partnerWalletOverride.toLowerCase()
      : String(brand?.partnerWallet || "").toLowerCase();

    // Guard: On partner containers, NEXT_PUBLIC_RECIPIENT_ADDRESS may be set
    // to the partner wallet. If platform === partner, fall back to the
    // canonical platform treasury to prevent duplicate-payee reverts.
    const CANONICAL_PLATFORM_WALLET = "0xaCDAa0314000a1d10f3e9EF1B88e986A72AA3f6e";
    if (platform === partner && String(partner) !== "") {
      console.warn("[ensureSplitForWallet] Platform wallet collides with partner wallet, using canonical platform:", CANONICAL_PLATFORM_WALLET);
      platform = CANONICAL_PLATFORM_WALLET.toLowerCase();
    }

    let defaultPlatformBps = 50;
    let defaultPartnerBps = typeof brand?.partnerFeeBps === "number" ? brand.partnerFeeBps : 50;

    if (dualSplit) {
      if (isCredit) {
        // Debit card component
        const env = getEnv();
        defaultPlatformBps = env.PLATFORM_BPS ?? 125;
        defaultPartnerBps = typeof brand?.partnerFeeBps === "number" ? brand.partnerFeeBps : 50;
      } else {
        // Credit & Crypto component
        const creditBps = getSanitizedCreditSplitBps();
        if (creditBps) {
          defaultPlatformBps = creditBps.platform;
        } else {
          defaultPlatformBps = 150;
        }
        defaultPartnerBps = typeof brand?.partnerFeeBps === "number" ? brand.partnerFeeBps : 50;
      }
    }

    const platformBps = typeof platformFeeBpsOverride === "number"
      ? Math.max(0, Math.min(10000, platformFeeBpsOverride))
      : (dualSplit
        ? defaultPlatformBps
        : (typeof brand?.platformFeeBps === "number"
          ? Math.max(0, Math.min(10000, brand.platformFeeBps))
          : 50));
    // Platform container never has partner recipient
    const isPartner = brandKey !== "portalpay" && brandKey !== "basaltsurge";

    // Use override if provided, otherwise default/brand
    let effectivePartnerBps = isCredit ? defaultPartnerBps : brand.partnerFeeBps;
    if (dualSplit) {
      effectivePartnerBps = defaultPartnerBps;
    }
    if (typeof partnerFeeBpsOverride === "number") {
      effectivePartnerBps = partnerFeeBpsOverride;
    }

    const partnerBps = !isPartner ? 0 : (isValidHexAddress(partner) && typeof effectivePartnerBps === "number")
      ? Math.max(0, Math.min(10000 - platformBps, effectivePartnerBps))
      : 0;

    // Merchant gets remainder after Platform, Partner, and Agents
    const merchantBps = Math.max(0, 10000 - platformBps - partnerBps - agentSharesBps);

    const name = `${(typeof brand?.name === "string" && brand.name ? brand.name : "Brand")} ${isCredit ? "Credit" : "Split"} ${merchant.slice(0, 6)}`;

    // Build payees/shares arrays
    const payeeList: string[] = [merchant, platform];
    const shareList: bigint[] = [BigInt(merchantBps), BigInt(platformBps)];

    if (partnerBps > 0) {
      payeeList.push(partner);
      shareList.push(BigInt(partnerBps));
    }

    agents.forEach(a => {
      if (isValidHexAddress(a.wallet) && a.bps > 0) {
        payeeList.push(a.wallet.toLowerCase());
        shareList.push(BigInt(a.bps));
      }
    });

    const contractAddress = await deploySplitContract({
      chain,
      client,
      account,
      params: {
        name,
        payees: payeeList,
        shares: shareList,
      },
    });

    const addr = String(contractAddress || "").toLowerCase();
    if (!isValidHexAddress(addr)) {
      return undefined;
    }

    // Persist deployed address + recipients idempotently
    // Pass both merchant wallet (x-wallet) for data targeting and caller wallet (x-caller-wallet) for auth
    const callerAddr = String(callerWallet || "").toLowerCase();
    try {
      const r2 = await fetch(buildApiUrl("/api/split/deploy"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet": merchant,
          "x-caller-wallet": callerAddr,
          "x-csrf": "1",
        },
        credentials: "include",
        body: JSON.stringify({
          wallet: merchant,
          splitAddress: isCredit ? undefined : addr,
          splitAddressCredit: isCredit ? addr : undefined,
          isCredit,
          brandKey,
          agents, // Send agents to persist them in site config
          partnerWallet: partner,
          platformFeeBps: Math.floor(platformBps) // Persist the actual platform bps used in contract
        }),
      });
      // If POST failed (e.g., CSRF or auth), log and keep modal open
      if (!r2.ok) {
        const errBody = await r2.text().catch(() => "");
        console.error("[ensureSplitForWallet] Persist failed:", r2.status, errBody, { callerAddr, merchant, brandKey });
        return undefined;
      }
      await r2.json().catch(() => ({}));
      // Verify persistence + recipients after POST
      try {
        const queryParams = `wallet=${encodeURIComponent(merchant)}&brandKey=${encodeURIComponent(brandKey)}${isCredit ? "&isCredit=true" : ""}`;
        const r3 = await fetch(buildApiUrl(`/api/split/deploy?${queryParams}`), { cache: "no-store", credentials: "include" });
        const j3 = await r3.json().catch(() => ({}));
        const a3 = String(j3?.split?.address || "").toLowerCase();
        const rc3 = Array.isArray(j3?.split?.recipients) ? j3.split.recipients.length : 0;
        const partnerBrand3 = String(brandKey || "").toLowerCase() !== "portalpay" && String(brandKey || "").toLowerCase() !== "basaltsurge";
        if (!isValidHexAddress(a3)) return undefined;
        if (partnerBrand3 && rc3 > 0 && rc3 < 3) return undefined;
      } catch {
        return undefined;
      }
    } catch { }

    return addr;
  } catch (err) {
    console.error("[ensureSplitForWallet] Deployment error:", err);
    throw err; // Propagate so callers see the actual error (e.g. ProxyDeploymentFailed)
  }
}

/**
 * Fetch the live configuration from a deployed Split contract.
 * Iterates through payees until failure to reconstruct the list.
 */
export async function getSplitConfig(splitAddress: string) {
  if (!isValidHexAddress(splitAddress)) return null;

  try {
    const { getContract, readContract, resolveMethod } = await import("thirdweb");
    const contract = getContract({
      client,
      chain,
      address: splitAddress,
    });

    const payees: string[] = [];
    let index = BigInt(0);
    // Safety limit of 20 payees
    while (index < BigInt(20)) {
      try {
        const payee = await readContract({
          contract,
          method: "function payee(uint256) view returns (address)",
          params: [index],
        });
        if (!payee || payee === "0x0000000000000000000000000000000000000000") break;
        payees.push(payee.toLowerCase());
        index++;
      } catch (e) {
        break;
      }
    }

    const totalSharesRef = await readContract({
      contract,
      method: "function totalShares() view returns (uint256)",
      params: [],
    }).catch(() => BigInt(0));

    const totalShares = Number(totalSharesRef);

    const shares: { address: string; bps: number }[] = [];
    for (const p of payees) {
      const s = await readContract({
        contract,
        method: "function shares(address) view returns (uint256)",
        params: [p],
      }).catch(() => BigInt(0));
      shares.push({ address: p, bps: Number(s) });
    }

    return {
      totalShares,
      recipients: shares
    };
  } catch (e) {
    console.error("Failed to read split config:", e);
    return null;
  }
}
