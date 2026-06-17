import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireRole } from "@/lib/auth";
import crypto from "node:crypto";
import { SystemUpdate } from "@/types/updates";

export async function GET(req: NextRequest) {
    try {
        const caller = await requireRole(req, "admin");
        const container = await getContainer();

        const url = new URL(req.url);
        const brandKey = url.searchParams.get("brandKey");
        const isPlatform = !brandKey || brandKey.toLowerCase() === "basaltsurge";

        let query = "SELECT * FROM c WHERE c.wallet = 'system' AND c.type='system_update'";
        const parameters: any[] = [];

        // If not platform, only show 'ALL' targeted updates, or updates specifically for this partner
        if (!isPlatform && brandKey) {
            query += " AND (c.target = 'ALL' OR c.partnerId = @brandKey)";
            parameters.push({ name: "@brandKey", value: brandKey });
        }

        query += " ORDER BY c.createdAt DESC";

        const { resources } = await container.items.query({ query, parameters }).fetchAll();

        return NextResponse.json({ ok: true, updates: resources });
    } catch (e: any) {
        console.error("Failed to fetch system updates", e);
        return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const caller = await requireRole(req, "admin");
        // Only platform admins should post updates
        const url = new URL(req.url);
        const brandKey = url.searchParams.get("brandKey");
        const isPlatform = !brandKey || brandKey.toLowerCase() === "basaltsurge";

        if (!isPlatform) {
            return NextResponse.json({ error: "Unauthorized. Only Platform can post updates." }, { status: 403 });
        }

        const body = await req.json();
        const container = await getContainer();

        const update: any = {
            id: body.id || crypto.randomUUID(),
            type: "system_update",
            wallet: "system",
            title: body.title,
            content: body.content,
            category: body.category || 'ANNOUNCEMENT',
            target: body.target || 'ALL',
            partnerId: body.partnerId || '',
            status: body.status || 'DRAFT',
            createdAt: body.createdAt || Date.now(),
            updatedAt: Date.now()
        };

        await container.items.upsert(update);

        return NextResponse.json({ ok: true, update });
    } catch (e: any) {
        console.error("Failed to save system update", e);
        return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const caller = await requireRole(req, "admin");
        
        const url = new URL(req.url);
        const brandKey = url.searchParams.get("brandKey");
        const isPlatform = !brandKey || brandKey.toLowerCase() === "basaltsurge";

        if (!isPlatform) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 403 });
        }

        const id = url.searchParams.get("id");
        if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

        const container = await getContainer();
        await container.item(id, "system").delete();

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        console.error("Failed to delete system update", e);
        return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
    }
}
