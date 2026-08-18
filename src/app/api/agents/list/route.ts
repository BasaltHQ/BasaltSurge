import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { getBrandKey } from "@/config/brands";

export const dynamic = "force-dynamic";

/**
 * List Approved Agents API
 *
 * GET — Returns all approved/registered agents for this brand.
 * Used by ClientRequestsPanel and PartnerManagementPanel dropdowns to select agents when configuring splits.
 */

const hex = (s: any) => typeof s === "string" && /^0x[a-f0-9]{40}$/i.test(s);

export async function GET(req: NextRequest) {
    try {
        const adminWallet = (req.headers.get("x-wallet") || "").toLowerCase();
        if (!adminWallet || !hex(adminWallet)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const explicitBrand = req.headers.get("x-brand-key") || req.nextUrl.searchParams.get("brandKey");
        const brandKey = (explicitBrand || getBrandKey(req) || "").toLowerCase().trim();

        const container = await getContainer();

        // 1. Fetch all agent_requests for this brand to check approvals and rejections
        const { resources: allRequests } = await container.items.query({
            query: `SELECT c.wallet, c.name, c.email, c.phone, c.status, c.createdAt FROM c
                    WHERE c.type = 'agent_request'
                      AND c.brandKey = @brandKey`,
            parameters: [{ name: "@brandKey", value: brandKey }],
        }).fetchAll();

        // 2. Fetch agent_profiles for this brand
        const { resources: profiles } = await container.items.query({
            query: `SELECT c.wallet, c.name, c.email, c.phone, c.status, c.createdAt FROM c
                    WHERE c.type = 'agent_profile'
                      AND c.brandKey = @brandKey`,
            parameters: [{ name: "@brandKey", value: brandKey }],
        }).fetchAll();

        // Build set of wallets that are explicitly rejected or pending in formal requests
        const unapprovedWallets = new Set<string>();
        const approvedMap = new Map<string, { wallet: string; name: string; email: string; phone: string }>();

        for (const reqDoc of allRequests || []) {
            const w = String(reqDoc.wallet || "").toLowerCase();
            if (!hex(w)) continue;
            if (reqDoc.status === "approved") {
                approvedMap.set(w, {
                    wallet: w,
                    name: reqDoc.name || "",
                    email: reqDoc.email || "",
                    phone: reqDoc.phone || "",
                });
            } else {
                unapprovedWallets.add(w);
            }
        }

        // Include profiles only if explicitly approved and not marked as rejected/pending
        for (const p of profiles || []) {
            const w = String(p.wallet || "").toLowerCase();
            if (!hex(w)) continue;
            if (unapprovedWallets.has(w)) continue; // Excluded by formal request rejection
            if (p.status === "approved" && !approvedMap.has(w)) {
                approvedMap.set(w, {
                    wallet: w,
                    name: p.name || "",
                    email: p.email || "",
                    phone: p.phone || "",
                });
            }
        }

        const agents = Array.from(approvedMap.values()).sort((a, b) =>
            (a.name || a.wallet).localeCompare(b.name || b.wallet)
        );

        return NextResponse.json({ agents });
    } catch (err: any) {
        console.error("[agents/list] Error:", err);
        return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
    }
}

