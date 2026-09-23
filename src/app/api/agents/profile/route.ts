import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { v4 as uuidv4 } from "uuid";
import { getBrandKey } from "@/config/brands";
import { notifyAgentRequest } from "@/lib/notifications/events";

export const dynamic = "force-dynamic";

/**
 * Agent Profile API
 *
 * GET  — Returns agent profile (from agent_request or agent_profile doc)
 * POST — Creates/updates agent_profile for informal agents (no formal application)
 */

const hex = (s: any) => typeof s === "string" && /^0x[a-f0-9]{40}$/i.test(s);

export async function GET(req: NextRequest) {
    try {
        const wallet = (req.headers.get("x-wallet") || "").toLowerCase();
        if (!wallet || !hex(wallet)) {
            return NextResponse.json({ error: "Connect your wallet" }, { status: 401 });
        }

        const brandKey = (
            getBrandKey(req) || process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "basaltsurge"
        ).toLowerCase().trim();

        const container = await getContainer();

        // Check for agent_request first (formal agents)
        const { resources: requests } = await container.items.query({
            query: `SELECT * FROM c
                    WHERE c.type = 'agent_request'
                      AND c.wallet = @wallet
                      AND c.brandKey = @brandKey`,
            parameters: [
                { name: "@wallet", value: wallet },
                { name: "@brandKey", value: brandKey },
            ],
        }).fetchAll();

        if (requests && requests.length > 0) {
            const r = requests[0];
            return NextResponse.json({
                hasProfile: true,
                status: r.status || "approved",
                source: "agent_request",
                name: r.name,
                email: r.email,
                phone: r.phone || "",
                wallet: r.wallet,
                createdAt: r.createdAt,
            });
        }

        // Fallback: check for agent_profile (informal agents who filled out their info)
        const { resources: profiles } = await container.items.query({
            query: `SELECT * FROM c
                    WHERE c.type = 'agent_profile'
                      AND c.wallet = @wallet
                      AND c.brandKey = @brandKey`,
            parameters: [
                { name: "@wallet", value: wallet },
                { name: "@brandKey", value: brandKey },
            ],
        }).fetchAll();

        if (profiles && profiles.length > 0) {
            const p = profiles[0];
            return NextResponse.json({
                hasProfile: true,
                status: "approved", // Legacy "informal" agents default to approved
                source: "agent_profile",
                name: p.name,
                email: p.email,
                phone: p.phone || "",
                wallet: p.wallet,
                createdAt: p.createdAt,
            });
        }

        return NextResponse.json({ hasProfile: false });
    } catch (err: any) {
        console.error("[agents/profile] GET Error:", err);
        return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const wallet = (req.headers.get("x-wallet") || "").toLowerCase();
        if (!wallet || !hex(wallet)) {
            return NextResponse.json({ error: "Connect your wallet" }, { status: 401 });
        }

        const brandKey = (
            getBrandKey(req) || process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "basaltsurge"
        ).toLowerCase().trim();

        const body = await req.json();
        const { name, email, phone } = body;

        if (!name || !email) {
            return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
        }

        const container = await getContainer();

        // Check for existing profile
        const { resources: existing } = await container.items.query({
            query: `SELECT c.id FROM c
                    WHERE c.type = 'agent_profile'
                      AND c.wallet = @wallet
                      AND c.brandKey = @brandKey`,
            parameters: [
                { name: "@wallet", value: wallet },
                { name: "@brandKey", value: brandKey },
            ],
        }).fetchAll();

        if (existing && existing.length > 0) {
            // Update existing profile
            const doc = {
                ...existing[0],
                name,
                email,
                phone: phone || "",
                updatedAt: Date.now(),
            };
            await container.items.upsert(doc);
            return NextResponse.json({ success: true, updated: true });
        }

        // Create new agent_profile
        const doc = {
            id: uuidv4(),
            type: "agent_profile",
            wallet,
            brandKey,
            name,
            email,
            phone: phone || "",
            createdAt: Date.now(),
        };

        await container.items.create(doc);

        try {
            await notifyAgentRequest(doc, brandKey);
        } catch (notifErr) {
            console.warn("[agents/profile] Notification error on agent profile create:", notifErr);
        }

        return NextResponse.json({ success: true, created: true });
    } catch (err: any) {
        console.error("[agents/profile] POST Error:", err);
        return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
    }
}
