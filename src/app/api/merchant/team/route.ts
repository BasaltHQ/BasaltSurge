import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireRole } from "@/lib/auth";
import { TeamMember } from "@/types/merchant-features";
import { randomUUID } from "node:crypto";

// GET: List team members for the authenticated merchant
export async function GET(req: NextRequest) {
    try {
        const container = await getContainer();

        const walletHeader = req.headers.get("x-wallet") || "";
        if (!walletHeader) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const merchantWallet = walletHeader.toLowerCase();

        // Strict Isolation Logic
        const envBrandKey = String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase();

        let query = "SELECT * FROM c WHERE c.type = 'merchant_team_member' AND c.merchantWallet = @wallet";
        const parameters = [{ name: "@wallet", value: merchantWallet }];

        if (envBrandKey && envBrandKey !== "portalpay" && envBrandKey !== "basaltsurge") {
            // Partner Container: Strict filter matching THIS brand
            query += " AND c.brandKey = @brandKey";
            parameters.push({ name: "@brandKey", value: envBrandKey });
        } else {
            // Platform Container: Show only Platform members (no brandKey or default brands)
            query += " AND (NOT IS_DEFINED(c.brandKey) OR c.brandKey = 'portalpay' OR c.brandKey = 'basaltsurge')";
        }

        const querySpec = { query, parameters };

        const { resources } = await container.items.query(querySpec).fetchAll();

        const sanitized = resources.map((r: any) => ({
            ...r,
            pinHash: undefined // mask it
        }));

        return NextResponse.json({ items: sanitized });
    } catch (e: any) {
        console.error("GET team failed", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// POST: Add new team member
export async function POST(req: NextRequest) {
    try {
        const container = await getContainer();
        const body = await req.json();
        const walletHeader = req.headers.get("x-wallet") || "";
        if (!walletHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const merchantWallet = walletHeader.toLowerCase();

        // Capture Brand Key from Environment (Partner Mode)
        const brandKey = String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase();

        if (!body.name || !body.pin || !body.role) {
            return NextResponse.json({ error: "Missing required fields (name, pin, role)" }, { status: 400 });
        }

        const linkedWalletRaw = String(body.linkedWallet || "").trim().toLowerCase();
        if (!linkedWalletRaw || !/^0x[a-f0-9]{40}$/i.test(linkedWalletRaw)) {
            return NextResponse.json({ error: "A valid EVM wallet address (0x...) is required for team members to authenticate and access the admin module." }, { status: 400 });
        }

        const { createHash } = await import("node:crypto");
        const pinHash = createHash("sha256").update(String(body.pin)).digest("hex");

        const newMember: TeamMember & { type: string, merchantWallet: string, merchant: string, wallet: string, brandKey?: string, linkedWallet?: string } = {
            id: randomUUID(),
            type: "merchant_team_member",
            merchant: merchantWallet,
            merchantWallet,
            wallet: merchantWallet,
            brandKey: brandKey || undefined, // Store brandKey if present
            name: body.name,
            pinHash,
            role: body.role,
            active: true,
            linkedWallet: linkedWalletRaw,
            createdAt: Math.floor(Date.now() / 1000),
            updatedAt: Math.floor(Date.now() / 1000)
        };

        await container.items.create(newMember);

        return NextResponse.json({ success: true, item: { ...newMember, pinHash: undefined } });

    } catch (e: any) {
        console.error("POST team failed", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

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

            // Access the property dynamically
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

// PATCH: Update team member
export async function PATCH(req: NextRequest) {
    try {
        const container = await getContainer();
        const body = await req.json();
        const walletHeader = req.headers.get("x-wallet") || "";
        // Note: We allow update if authorized.
        if (!walletHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const merchantWallet = walletHeader.toLowerCase();

        if (!body.id) return NextResponse.json({ error: "Missing ID" }, { status: 400 });

        // Lookup first to handle potential PK mismatch
        const found = await findDocAndPk(container, body.id);
        if (!found) return NextResponse.json({ error: "Member not found" }, { status: 404 });

        const { doc, pkValue } = found;

        // Security check: ensure the doc belongs to this merchant
        if (doc.merchantWallet !== merchantWallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        const ops = [];
        if (body.name) ops.push({ op: "set", path: "/name", value: body.name });
        if (body.role) ops.push({ op: "set", path: "/role", value: body.role });
        if (body.linkedWallet !== undefined) {
            ops.push({ op: "set", path: "/linkedWallet", value: body.linkedWallet ? String(body.linkedWallet).toLowerCase() : null });
        }

        if (body.pin) {
            const { createHash } = await import("node:crypto");
            const ph = createHash("sha256").update(String(body.pin)).digest("hex");
            ops.push({ op: "set", path: "/pinHash", value: ph });
        }

        // REMOVED: Do not try to backfill 'wallet' (Partition Key) via PATCH. 
        // Changing/Setting PK on existing doc is forbidden and causes 400 Bad Request.

        ops.push({ op: "set", path: "/updatedAt", value: Math.floor(Date.now() / 1000) });

        if (ops.length > 0) {
            // Note: If PK is undefined in doc, we pass pkValue (undefined).
            // However, patching a doc's PK value (adding 'wallet') is tricky if it moves partition.
            // Cosmos DB does not allow updating Partition Key value in place. 
            // If we are adding 'wallet' and 'wallet' IS the PK, this operation will fail if it changes the partition.
            // But if 'wallet' is missing, it is in 'undefined' partition. Adding 'wallet' = '0x...' moves it to '0x...' partition.
            // This requires Delete + Re-create.

            try {
                await container.item(body.id, pkValue).patch(ops as any);
            } catch (e: any) {
                // If patch fails (likely due to partition move or mismatch), try hard replace sequence?
                // Or just fail. 
                // Using 'replace' might be safer if we are fixing data?
                // But we can't change PK in replace either.
                // WE MUST DELETE AND RECREATE if PK changes.
                // For now, let's assume we aren't changing the PK, just updating fields.
                // If doc.wallet is missing, we WON'T push /wallet set op if it risks breaking.
                // Let's remove the backfill for now to be safe, unless we implement full migration logic.
                // But wait, if we don't backfill, we keep the broken state.
                // Let's just update other fields.
                throw e;
            }
        }

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// DELETE: Remove team member
export async function DELETE(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");
        const walletHeader = req.headers.get("x-wallet") || "";
        if (!walletHeader || !id) return NextResponse.json({ error: "Unauthorized or missing ID" }, { status: 401 });

        const container = await getContainer();
        const merchantWallet = walletHeader.toLowerCase();

        // Lookup first
        const found = await findDocAndPk(container, id);
        if (!found) return NextResponse.json({ error: "Member not found" }, { status: 404 });

        const { doc, pkValue } = found;

        if (doc.merchantWallet !== merchantWallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        try {
            await container.item(id, pkValue).delete();
        } catch (e) {
            return NextResponse.json({ error: "Failed to delete" }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
