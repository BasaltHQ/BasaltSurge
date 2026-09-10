import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { getMerchantBrandScope, readMerchantTeamProfiles } from "@/lib/merchant-team-access";

export const dynamic = "force-dynamic";

// GET: Lookup merchant profiles associated with a connected wallet
export async function GET(req: NextRequest) {
    let actorWallet: string;
    try {
        actorWallet = String((await requireThirdwebAuth(req)).wallet || "").toLowerCase();
        if (!/^0x[a-f0-9]{40}$/.test(actorWallet)) throw new Error("unauthorized");
    } catch {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    try {
        const { searchParams } = new URL(req.url);
        const wallet = searchParams.get("wallet");

        if (!wallet || !/^0x[a-f0-9]{40}$/i.test(wallet)) {
            return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
        }

        const linkedWallet = wallet.toLowerCase();
        if (linkedWallet !== actorWallet) {
            return NextResponse.json({ error: "forbidden" }, { status: 403 });
        }
        const container = await getContainer(undefined, undefined, { profile: "critical" });
        const scope = getMerchantBrandScope(req);

        const profiles = await readMerchantTeamProfiles(req, actorWallet);

        // We also need to fetch the Shop Config for each profile to display the Merchant Name
        // We can do this efficiently by querying the configs for the found merchantWallets
        let enrichedProfiles = [];

        if (profiles.length > 0) {
            const uniqueMerchants = Array.from(new Set(profiles.map((p: any) => p.merchantWallet)));

            // Use ARRAY_CONTAINS for parameterized lookup (transpiler-safe)
            const configQuery = {
                query: `SELECT c.wallet, c.name, c.theme FROM c WHERE c.type = 'shop_config' AND ARRAY_CONTAINS(@wallets, c.wallet) AND ${scope.clause}`,
                parameters: [{ name: "@wallets", value: uniqueMerchants }, ...scope.parameters],
            };
            const { resources: configs } = await container.items.query(configQuery).fetchAll();

            const configMap = new Map();
            configs.forEach((c: any) => configMap.set(c.wallet, c));

            enrichedProfiles = profiles.map((p: any) => {
                const conf = configMap.get(p.merchantWallet);
                return {
                    ...p,
                    merchantName: conf?.name || "Unknown Merchant",
                    logo: conf?.theme?.brandLogoUrl
                };
            });
        }

        return NextResponse.json({ profiles: enrichedProfiles });

    } catch (e: any) {
        console.error("Profile lookup failed", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
