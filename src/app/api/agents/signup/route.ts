import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { v4 as uuidv4 } from "uuid";
import { getBrandKey } from "@/config/brands";
import { notifyAgentRequest } from "@/lib/notifications/events";

export const dynamic = "force-dynamic";

/**
 * Agent Sign-Up API
 *
 * POST — Create an agent_request (status: pending)
 * GET  — Check application status for the connected wallet
 */

const hex = (s: any) => typeof s === "string" && /^0x[a-f0-9]{40}$/i.test(s);

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
        const { name, email, phone, notes } = body;

        if (!name || !email) {
            return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
        }

        const container = await getContainer();

        // Check for existing application
        const { resources: existing } = await container.items.query({
            query: `SELECT c.id, c.status FROM c
                    WHERE c.type = 'agent_request'
                      AND c.wallet = @wallet
                      AND c.brandKey = @brandKey`,
            parameters: [
                { name: "@wallet", value: wallet },
                { name: "@brandKey", value: brandKey },
            ],
        }).fetchAll();

        if (existing && existing.length > 0) {
            const current = existing[0];
            if (current.status === "rejected") {
                // Allow re-application by updating the existing doc
                const doc = {
                    ...current,
                    name,
                    email,
                    phone: phone || "",
                    notes: notes || "",
                    status: "pending",
                    updatedAt: Date.now(),
                };
                await container.items.upsert(doc);

                try {
                    await notifyAgentRequest({ ...doc, isResubmission: true }, brandKey);
                } catch (notifErr) {
                    console.warn("[agents/signup] Notification error on resubmission:", notifErr);
                }

                return NextResponse.json({ status: "resubmitted", id: current.id });
            }
            return NextResponse.json({
                error: `You already have a ${current.status} application`,
                status: current.status,
                id: current.id,
            }, { status: 409 });
        }

        // Create new agent_request
        const doc = {
            id: uuidv4(),
            type: "agent_request",
            wallet,
            brandKey,
            name,
            email,
            phone: phone || "",
            notes: notes || "",
            status: "pending",
            createdAt: Date.now(),
        };

        await container.items.create(doc);

        try {
            await notifyAgentRequest(doc, brandKey);
        } catch (notifErr) {
            console.warn("[agents/signup] Notification error on signup:", notifErr);
        }

        return NextResponse.json({ status: "pending", id: doc.id });
    } catch (err: any) {
        console.error("[agents/signup] Error:", err);
        return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
    }
}

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

        const { resources } = await container.items.query({
            query: `SELECT * FROM c
                    WHERE c.type = 'agent_request'
                      AND c.wallet = @wallet
                      AND c.brandKey = @brandKey`,
            parameters: [
                { name: "@wallet", value: wallet },
                { name: "@brandKey", value: brandKey },
            ],
        }).fetchAll();

        if (!resources || resources.length === 0) {
            return NextResponse.json({ exists: false });
        }

        const app = resources[0];
        return NextResponse.json({
            exists: true,
            status: app.status,
            id: app.id,
            name: app.name,
            email: app.email,
            phone: app.phone,
            createdAt: app.createdAt,
        });
    } catch (err: any) {
        console.error("[agents/signup] GET Error:", err);
        return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
    }
}
