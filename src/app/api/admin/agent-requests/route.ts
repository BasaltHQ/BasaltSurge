import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { getBrandKey } from "@/config/brands";

export const dynamic = "force-dynamic";

/**
 * Admin Agent Requests API
 *
 * GET — List all agent_request docs for this brand
 * PUT — Update status (approve/reject)
 */

const hex = (s: any) => typeof s === "string" && /^0x[a-f0-9]{40}$/i.test(s);

export async function GET(req: NextRequest) {
    try {
        const adminWallet = (req.headers.get("x-wallet") || "").toLowerCase();
        if (!adminWallet || !hex(adminWallet)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const brandKey = getBrandKey(req);
        const container = await getContainer();

        // 1. Fetch formal agent_requests
        const { resources: formalRequests } = await container.items.query({
            query: `SELECT * FROM c
                    WHERE c.type = 'agent_request'
                      AND c.brandKey = @brandKey
                    ORDER BY c.createdAt DESC`,
            parameters: [{ name: "@brandKey", value: brandKey }],
        }).fetchAll();

        // 2. Fetch informal agent_profiles (/agents profile submissions)
        const { resources: profiles } = await container.items.query({
            query: `SELECT * FROM c
                    WHERE c.type = 'agent_profile'
                      AND c.brandKey = @brandKey
                    ORDER BY c.createdAt DESC`,
            parameters: [{ name: "@brandKey", value: brandKey }],
        }).fetchAll();

        const agentMap = new Map<string, any>();

        // Process formal agent_requests first (authoritative)
        for (const req of formalRequests || []) {
            const w = String(req.wallet || "").toLowerCase();
            if (!w) continue;
            const isDirect = typeof req.notes === "string" && req.notes.toLowerCase().includes("directly added by admin");
            agentMap.set(w, {
                id: req.id,
                wallet: w,
                name: req.name || "—",
                email: req.email || "",
                phone: req.phone || "",
                notes: req.notes || "",
                status: req.status || "pending",
                createdAt: req.createdAt || 0,
                reviewedBy: req.reviewedBy,
                reviewedAt: req.reviewedAt,
                source: isDirect ? "direct" : "application",
            });
        }

        // Process informal profiles for wallets without formal applications
        for (const prof of profiles || []) {
            const w = String(prof.wallet || "").toLowerCase();
            if (!w) continue;
            if (!agentMap.has(w)) {
                agentMap.set(w, {
                    id: prof.id,
                    wallet: w,
                    name: prof.name || "—",
                    email: prof.email || "",
                    phone: prof.phone || "",
                    notes: prof.notes || "Registered via /agents profile",
                    status: prof.status || "pending",
                    createdAt: prof.createdAt || 0,
                    reviewedBy: prof.reviewedBy,
                    reviewedAt: prof.reviewedAt,
                    source: "profile",
                });
            }
        }

        const requests = Array.from(agentMap.values()).sort(
            (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
        );

        return NextResponse.json({ requests });
    } catch (err: any) {
        console.error("[admin/agent-requests] GET Error:", err);
        return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    try {
        const adminWallet = (req.headers.get("x-wallet") || "").toLowerCase();
        if (!adminWallet || !hex(adminWallet)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const brandKey = getBrandKey(req);
        const body = await req.json();
        const { id, status, wallet } = body;

        if ((!id && !wallet) || !["approved", "rejected"].includes(status)) {
            return NextResponse.json({ error: "id/wallet and status (approved/rejected) are required" }, { status: 400 });
        }

        const container = await getContainer();

        // 1. Fetch matching docs by id or wallet across both agent_request and agent_profile
        let query = `SELECT * FROM c WHERE c.brandKey = @brandKey AND (c.type = 'agent_request' OR c.type = 'agent_profile')`;
        const parameters: any[] = [{ name: "@brandKey", value: brandKey }];

        if (id) {
            query += ` AND c.id = @id`;
            parameters.push({ name: "@id", value: id });
        } else if (wallet) {
            query += ` AND c.wallet = @wallet`;
            parameters.push({ name: "@wallet", value: wallet.toLowerCase() });
        }

        const { resources } = await container.items.query({ query, parameters }).fetchAll();

        if (!resources || resources.length === 0) {
            return NextResponse.json({ error: "Agent record not found" }, { status: 404 });
        }

        const targetWallet = (resources[0].wallet || "").toLowerCase();

        // 2. Find all related records for this wallet (both agent_request and agent_profile) to sync status
        let allRelated = resources;
        if (targetWallet) {
            const { resources: related } = await container.items.query({
                query: `SELECT * FROM c
                        WHERE c.brandKey = @brandKey
                          AND c.wallet = @wallet
                          AND (c.type = 'agent_request' OR c.type = 'agent_profile')`,
                parameters: [
                    { name: "@brandKey", value: brandKey },
                    { name: "@wallet", value: targetWallet },
                ],
            }).fetchAll();
            allRelated = related || resources;
        }

        for (const doc of allRelated) {
            const updated = {
                ...doc,
                status,
                reviewedBy: adminWallet,
                reviewedAt: Date.now(),
            };
            await container.items.upsert(updated);
        }

        return NextResponse.json({ success: true, status });
    } catch (err: any) {
        console.error("[admin/agent-requests] PUT Error:", err);
        return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const adminWallet = (req.headers.get("x-wallet") || "").toLowerCase();
        if (!adminWallet || !hex(adminWallet)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const brandKey = getBrandKey(req);
        const body = await req.json();
        const { wallet, name, email, phone, notes } = body;

        if (!wallet || !hex(wallet) || !name) {
            return NextResponse.json({ error: "wallet (0x...) and name are required fields" }, { status: 400 });
        }

        const container = await getContainer();
        const normalizedWallet = wallet.toLowerCase().trim();

        const id = `agent-req-${crypto.randomUUID()}`;
        const doc = {
            id,
            type: "agent_request",
            brandKey,
            wallet: normalizedWallet,
            name: name.trim(),
            email: (email || "").trim(),
            phone: (phone || "").trim(),
            notes: (notes || "Directly added by admin").trim(),
            status: "approved",
            createdAt: Date.now(),
            reviewedBy: adminWallet,
            reviewedAt: Date.now(),
        };

        await container.items.upsert(doc);

        // Also ensure any existing agent_profile for this wallet is updated to approved
        try {
            const { resources: profiles } = await container.items.query({
                query: `SELECT * FROM c
                        WHERE c.type = 'agent_profile'
                          AND c.wallet = @wallet
                          AND c.brandKey = @brandKey`,
                parameters: [
                    { name: "@wallet", value: normalizedWallet },
                    { name: "@brandKey", value: brandKey },
                ],
            }).fetchAll();

            for (const prof of profiles || []) {
                await container.items.upsert({
                    ...prof,
                    status: "approved",
                    reviewedBy: adminWallet,
                    reviewedAt: Date.now(),
                });
            }
        } catch (profErr) {
            console.warn("[admin/agent-requests] Warning syncing linked agent_profile on POST:", profErr);
        }

        return NextResponse.json({ success: true, request: doc });
    } catch (err: any) {
        console.error("[admin/agent-requests] POST Error:", err);
        return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const adminWallet = (req.headers.get("x-wallet") || "").toLowerCase();
        if (!adminWallet || !hex(adminWallet)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const brandKey = getBrandKey(req);
        const { searchParams } = new URL(req.url);
        let id = searchParams.get("id");
        let wallet = searchParams.get("wallet");

        if (!id && !wallet) {
            try {
                const body = await req.json();
                id = body?.id;
                wallet = body?.wallet;
            } catch {
                // ignore
            }
        }

        if (!id && !wallet) {
            return NextResponse.json({ error: "id or wallet is required" }, { status: 400 });
        }

        const container = await getContainer();

        // 1. Find all target documents by id or wallet
        const walletsToClean = new Set<string>();
        if (wallet && hex(wallet)) {
            walletsToClean.add(wallet.toLowerCase());
        }

        let query = `SELECT * FROM c WHERE c.brandKey = @brandKey AND (c.type = 'agent_request' OR c.type = 'agent_profile')`;
        const parameters: any[] = [{ name: "@brandKey", value: brandKey }];

        if (id) {
            query += ` AND c.id = @id`;
            parameters.push({ name: "@id", value: id });
        }

        const { resources: initialMatches } = await container.items.query({ query, parameters }).fetchAll();

        for (const doc of initialMatches || []) {
            if (doc.wallet) walletsToClean.add(doc.wallet.toLowerCase());
        }

        // 2. Collect all agent_request and agent_profile documents for all discovered wallets
        let allDocsToDelete: any[] = [...(initialMatches || [])];

        for (const targetW of Array.from(walletsToClean)) {
            try {
                const { resources: docsForWallet } = await container.items.query({
                    query: `SELECT * FROM c
                            WHERE c.brandKey = @brandKey
                              AND c.wallet = @wallet
                              AND (c.type = 'agent_request' OR c.type = 'agent_profile')`,
                    parameters: [
                        { name: "@brandKey", value: brandKey },
                        { name: "@wallet", value: targetW },
                    ],
                }).fetchAll();

                for (const d of docsForWallet || []) {
                    if (!allDocsToDelete.some(x => x.id === d.id)) {
                        allDocsToDelete.push(d);
                    }
                }
            } catch (err) {
                console.warn("[admin/agent-requests] Warning querying wallet docs for delete:", err);
            }
        }

        if (allDocsToDelete.length === 0) {
            return NextResponse.json({ error: "Agent record not found" }, { status: 404 });
        }

        // 3. Atomically delete all matching agent_request and agent_profile records
        let deletedCount = 0;
        for (const doc of allDocsToDelete) {
            const pkCandidates = [doc.wallet, doc.id, undefined];
            let deleted = false;

            for (const pk of pkCandidates) {
                if (deleted) break;
                try {
                    await container.item(doc.id, pk as any).delete();
                    deleted = true;
                    deletedCount++;
                } catch {
                    // Try next partition key candidate
                }
            }
        }

        return NextResponse.json({ success: true, id, deletedCount });
    } catch (err: any) {
        console.error("[admin/agent-requests] DELETE Error:", err);
        return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
    }
}
