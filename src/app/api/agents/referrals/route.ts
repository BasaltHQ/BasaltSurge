import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/referrals
 *
 * Returns all client_request documents where the calling agent's wallet
 * appears in splitConfig.agents[].wallet. This gives agents visibility
 * into the status of merchants they referred via their unique link.
 *
 * Auth: x-wallet header = agent's connected wallet.
 */

const hex = (s: any) => typeof s === "string" && /^0x[a-f0-9]{40}$/i.test(s);

export async function GET(req: NextRequest) {
    try {
        const agentWallet = (req.headers.get("x-wallet") || "").toLowerCase();
        if (!agentWallet || !hex(agentWallet)) {
            return NextResponse.json({ error: "Connect your wallet" }, { status: 401 });
        }

        const brandKey = String(
            process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || ""
        ).toLowerCase();

        const container = await getContainer();

        // Query client_request docs where this agent wallet appears in splitConfig.agents or splitConfigCredit.agents
        const { resources: requests } = await container.items.query({
            query: `SELECT c.id, c.wallet, c.shopName, c.legalBusinessName, c.businessType,
                           c.status, c.createdAt, c.reviewedAt, c.reviewedBy,
                           c.splitConfig, c.splitConfigCredit, c.brandKey, c.slug, c.logoUrl, c.primaryColor
                    FROM c
                    WHERE c.type = 'client_request'
                      AND (
                        (IS_DEFINED(c.splitConfig.agents) AND ARRAY_CONTAINS(c.splitConfig.agents, {"wallet": @agentWallet}, true))
                        OR
                        (IS_DEFINED(c.splitConfigCredit.agents) AND ARRAY_CONTAINS(c.splitConfigCredit.agents, {"wallet": @agentWallet}, true))
                      )
                    ORDER BY c.createdAt DESC`,
            parameters: [{ name: "@agentWallet", value: agentWallet }],
        }).fetchAll();

        // Filter to this brand's requests (if on a partner container)
        let filtered = requests || [];
        if (brandKey && brandKey !== "portalpay" && brandKey !== "basaltsurge") {
            filtered = filtered.filter((r: any) =>
                !r.brandKey || r.brandKey.toLowerCase() === brandKey
            );
        }

        // Extract this agent's BPS from each request's splitConfig or splitConfigCredit
        const referrals = filtered.map((r: any) => {
            const agents: { wallet: string; bps: number }[] = r.splitConfig?.agents || [];
            const agentsCredit: { wallet: string; bps: number }[] = r.splitConfigCredit?.agents || [];
            
            const myEntry = agents.find((a) => String(a.wallet || "").toLowerCase() === agentWallet)
                            || agentsCredit.find((a) => String(a.wallet || "").toLowerCase() === agentWallet);

            // Normalize createdAt
            let createdAt = r.createdAt;
            if (typeof createdAt === "object" && createdAt?.$date) {
                createdAt = new Date(createdAt.$date).getTime();
            } else if (typeof createdAt === "string") {
                createdAt = new Date(createdAt).getTime();
            }

            let reviewedAt = r.reviewedAt;
            if (typeof reviewedAt === "object" && reviewedAt?.$date) {
                reviewedAt = new Date(reviewedAt.$date).getTime();
            } else if (typeof reviewedAt === "string") {
                reviewedAt = new Date(reviewedAt).getTime();
            }

            return {
                id: r.id,
                merchantWallet: r.wallet,
                shopName: r.shopName || "Unnamed",
                legalBusinessName: r.legalBusinessName || undefined,
                businessType: r.businessType || undefined,
                status: r.status || "pending",
                agentBps: myEntry?.bps || 0,
                slug: r.slug || undefined,
                logoUrl: r.logoUrl || undefined,
                primaryColor: r.primaryColor || undefined,
                createdAt: typeof createdAt === "number" ? createdAt : Date.now(),
                reviewedAt: typeof reviewedAt === "number" ? reviewedAt : undefined,
            };
        });

        // Summary
        const summary = {
            total: referrals.length,
            pending: referrals.filter((r: any) => r.status === "pending").length,
            approved: referrals.filter((r: any) => r.status === "approved").length,
            rejected: referrals.filter((r: any) => r.status === "rejected").length,
        };

        return NextResponse.json({ ok: true, referrals, summary });
    } catch (err: any) {
        console.error("[agents/referrals] Error:", err);
        return NextResponse.json(
            { error: err?.message || "Internal server error" },
            { status: 500 }
        );
    }
}
