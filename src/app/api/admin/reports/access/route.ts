import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";

// GET: Lookup merchant profiles associated with a connected wallet
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const wallet = searchParams.get("wallet");

        if (!wallet || !/^0x[a-f0-9]{40}$/i.test(wallet)) {
            return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
        }

        const linkedWallet = wallet.toLowerCase();
        const container = await getContainer();

        // Query all team members across all partitions where linkedWallet matches
        // Note: Cross-partition query. This is acceptable as number of merchant sessions for a single user is low.
        const querySpec = {
            query: "SELECT c.id, c.merchantWallet, c.role, c.name FROM c WHERE c.type = 'merchant_team_member' AND c.linkedWallet = @w AND (NOT IS_DEFINED(c.active) OR c.active = true)",
            parameters: [{ name: "@w", value: linkedWallet }]
        };

        const { resources: profiles } = await container.items.query(querySpec).fetchAll();

        // We also need to fetch the Shop Config for each profile to display the Merchant Name
        // We can do this efficiently by querying the configs for the found merchantWallets
        let enrichedProfiles = [];

        if (profiles.length > 0) {
            const uniqueMerchants = Array.from(new Set(profiles.map((p: any) => p.merchantWallet)));

            // Use ARRAY_CONTAINS for parameterized lookup (transpiler-safe)
            const configQuery = {
                query: `SELECT c.wallet, c.name, c.theme FROM c WHERE c.type = 'shop_config' AND ARRAY_CONTAINS(@wallets, c.wallet)`,
                parameters: [{ name: "@wallets", value: uniqueMerchants }],
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
