import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { createHash, randomUUID } from "node:crypto";

// Helper to find doc and its partition key. Caches the PK path for performance.
let cachedPkPath: string | null = null;

async function findDocAndPk(container: any, id: string) {
    const querySpec = {
        query: "SELECT * FROM c WHERE c.id = @id",
        parameters: [{ name: "@id", value: id }]
    };
    const { resources } = await container.items.query(querySpec).fetchAll();
    if (!resources || resources.length === 0) return null;
    const doc = resources[0];

    // Try to use cached PK path first (Optimized for "flawless" performance)
    if (cachedPkPath) {
        return { doc, pkValue: doc[cachedPkPath] };
    }

    // Dynamically resolve Partition Key definition to be 100% sure
    try {
        const { resource: containerDef } = await container.read();
        const pkPaths = containerDef?.partitionKey?.paths;
        if (pkPaths && pkPaths.length > 0) {
            // Usually "/wallet" or "/brandKey". Strip leading slash.
            const pkPath = pkPaths[0].substring(1);
            cachedPkPath = pkPath; // CACHE IT
            const pkValue = doc[pkPath];
            return { doc, pkValue };
        }
    } catch (e) {
        console.error("Failed to read container PK def", e);
    }

    // Fallback Heuristics
    const pkValue = doc.wallet || doc.merchant || doc.merchantWallet || doc.brandKey;
    return { doc, pkValue };
}

export async function GET(req: NextRequest) {
    try {
        const merchantWallet = req.headers.get("x-wallet");
        if (!merchantWallet) {
            return NextResponse.json({ error: "Wallet required" }, { status: 401 });
        }

        const container = await getContainer();
        const w = String(merchantWallet).trim().toLowerCase();

        // Enforce Partner Isolation
        const envBrandKey = String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase();

        // Build Query with strict isolation
        let query = "SELECT * FROM c WHERE c.type = 'merchant_team_member' AND c.merchantWallet = @w";
        const parameters = [{ name: "@w", value: w }];

        if (envBrandKey && envBrandKey !== "portalpay" && envBrandKey !== "basaltsurge") {
            // Partner Mode: Filter by THIS brand
            query += " AND c.brandKey = @brandKey";
            parameters.push({ name: "@brandKey", value: envBrandKey });
        } else {
            // Platform Mode: Only show Platform members (no brand or default)
            query += " AND (NOT IS_DEFINED(c.brandKey) OR c.brandKey = 'portalpay' OR c.brandKey = 'basaltsurge')";
        }

        const querySpec = { query, parameters };
        const { resources: members } = await container.items.query(querySpec).fetchAll();

        const sanitized = members.map((r: any) => ({
            ...r,
            pinHash: undefined // mask it
        }));

        return NextResponse.json({ members: sanitized });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const merchantWallet = req.headers.get("x-wallet");
        if (!merchantWallet) {
            return NextResponse.json({ error: "Wallet required" }, { status: 401 });
        }

        const body = await req.json();
        const { name, role, pin } = body;

        if (!name || !pin) {
            return NextResponse.json({ error: "Name and PIN required" }, { status: 400 });
        }

        const container = await getContainer();
        const w = String(merchantWallet).trim().toLowerCase();
        const pinHash = createHash("sha256").update(String(pin)).digest("hex");

        // Use Env Brand Key (Partner Mode)
        const brandKey = String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase();

        const newMember = {
            id: randomUUID(),
            type: "merchant_team_member",
            merchantWallet: w,
            wallet: w, // Ensure PK present
            brandKey: brandKey || undefined,
            name,
            role: role || "staff",
            pinHash,
            createdAt: Math.floor(Date.now() / 1000)
        };

        await container.items.create(newMember);

        return NextResponse.json({ success: true, member: { ...newMember, pinHash: undefined } });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const merchantWallet = req.headers.get("x-wallet");
        if (!merchantWallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await req.json();
        if (!body.id) return NextResponse.json({ error: "ID required" }, { status: 400 });

        const container = await getContainer();
        const w = String(merchantWallet).trim().toLowerCase();

        // Robust Lookup
        const found = await findDocAndPk(container, body.id);
        if (!found) return NextResponse.json({ error: "Member not found" }, { status: 404 });
        const { doc, pkValue } = found;

        if (doc.merchantWallet !== w) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        // Apply Updates
        const ops = [];
        if (body.name) ops.push({ op: "set", path: "/name", value: body.name });
        if (body.role) ops.push({ op: "set", path: "/role", value: body.role });
        if (body.pin) {
            const ph = createHash("sha256").update(String(body.pin)).digest("hex");
            ops.push({ op: "set", path: "/pinHash", value: ph });
        }
        ops.push({ op: "set", path: "/updatedAt", value: Math.floor(Date.now() / 1000) });

        if (ops.length > 0) {
            await container.item(body.id, pkValue).patch(ops as any);
            if (body.pin && ops.some(op => op.path === "/pinHash" && op.value !== doc.pinHash)) {
                const { notifyPinChanged } = await import("@/lib/notifications/events");
                const { getBrandKey } = await import("@/config/brands");
                await notifyPinChanged(doc, w, getBrandKey(req), randomUUID());
            }
        }

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const merchantWallet = req.headers.get("x-wallet");
        if (!merchantWallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await req.json();
        if (!body.id) return NextResponse.json({ error: "ID required" }, { status: 400 });

        const container = await getContainer();
        const w = String(merchantWallet).trim().toLowerCase();

        // Robust Lookup
        const found = await findDocAndPk(container, body.id);
        if (!found) return NextResponse.json({ error: "Member not found" }, { status: 404 });
        const { doc, pkValue } = found;

        if (doc.merchantWallet !== w) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        await container.item(body.id, pkValue).delete();

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
