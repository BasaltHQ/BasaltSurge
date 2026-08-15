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

        const { resources } = await container.items.query({
            query: `SELECT * FROM c
                    WHERE c.type = 'agent_request'
                      AND c.brandKey = @brandKey
                    ORDER BY c.createdAt DESC`,
            parameters: [{ name: "@brandKey", value: brandKey }],
        }).fetchAll();

        return NextResponse.json({ requests: resources || [] });
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
        const { id, status } = body;

        if (!id || !["approved", "rejected"].includes(status)) {
            return NextResponse.json({ error: "id and status (approved/rejected) are required" }, { status: 400 });
        }

        const container = await getContainer();

        // Fetch the agent_request doc
        const { resources } = await container.items.query({
            query: `SELECT * FROM c
                    WHERE c.type = 'agent_request'
                      AND c.id = @id
                      AND c.brandKey = @brandKey`,
            parameters: [
                { name: "@id", value: id },
                { name: "@brandKey", value: brandKey },
            ],
        }).fetchAll();

        if (!resources || resources.length === 0) {
            return NextResponse.json({ error: "Agent request not found" }, { status: 404 });
        }

        const doc = {
            ...resources[0],
            status,
            reviewedBy: adminWallet,
            reviewedAt: Date.now(),
        };

        await container.items.upsert(doc);

        return NextResponse.json({ success: true, status: doc.status });
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

        const id = `agent-req-${crypto.randomUUID()}`;
        const doc = {
            id,
            type: "agent_request",
            brandKey,
            wallet: wallet.toLowerCase().trim(),
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

        if (!id) {
            try {
                const body = await req.json();
                id = body?.id;
            } catch {
                // ignore
            }
        }

        if (!id) {
            return NextResponse.json({ error: "id is required" }, { status: 400 });
        }

        const container = await getContainer();

        // 1. Fetch matching agent_request docs
        const { resources } = await container.items.query({
            query: `SELECT * FROM c
                    WHERE c.type = 'agent_request'
                      AND c.id = @id
                      AND c.brandKey = @brandKey`,
            parameters: [
                { name: "@id", value: id },
                { name: "@brandKey", value: brandKey },
            ],
        }).fetchAll();

        if (!resources || resources.length === 0) {
            return NextResponse.json({ error: "Agent request not found" }, { status: 404 });
        }

        // 2. Delete all matching agent_request records
        for (const doc of resources) {
            const pk = doc.wallet || doc.id;
            try {
                await container.item(doc.id, pk).delete();
            } catch {
                try {
                    await container.item(doc.id, doc.wallet).delete();
                } catch {
                    try {
                        await container.item(doc.id, undefined as any).delete();
                    } catch {
                        await container.item(doc.id, doc.id).delete();
                    }
                }
            }

            // 3. If there is a matching agent_profile for this wallet & brandKey, clean it up too
            if (doc.wallet) {
                try {
                    const { resources: profiles } = await container.items.query({
                        query: `SELECT * FROM c
                                WHERE c.type = 'agent_profile'
                                  AND c.wallet = @wallet
                                  AND c.brandKey = @brandKey`,
                        parameters: [
                            { name: "@wallet", value: doc.wallet.toLowerCase() },
                            { name: "@brandKey", value: brandKey },
                        ],
                    }).fetchAll();

                    for (const prof of profiles || []) {
                        try {
                            await container.item(prof.id, prof.wallet || prof.id).delete();
                        } catch {
                            try {
                                await container.item(prof.id, undefined as any).delete();
                            } catch {}
                        }
                    }
                } catch (profErr) {
                    console.warn("[admin/agent-requests] Warning deleting linked agent_profile:", profErr);
                }
            }
        }

        return NextResponse.json({ success: true, id });
    } catch (err: any) {
        console.error("[admin/agent-requests] DELETE Error:", err);
        return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
    }
}
