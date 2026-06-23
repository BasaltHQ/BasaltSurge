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
