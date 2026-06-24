import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getContainer } from "@/lib/cosmos";
import { createApiKeyDoc, rotateApiKey, updateApiKeyStatus, decryptApiKey } from "@/lib/apim/keys";
import { ApiKeyPlan } from "@/lib/apim/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/merchants/[wallet]/api-keys
 * Returns all API keys (both active and inactive) for a specific merchant.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ wallet: string }> }) {
    try {
        const caller = await requireRole(req, "admin");
        const { wallet } = await props.params;
        if (!wallet) {
            return NextResponse.json({ error: "Missing wallet" }, { status: 400 });
        }

        const container = await getContainer();
        const query = "SELECT * FROM c WHERE c.type = 'api_key' AND c.wallet = @wallet";
        const { resources: keys } = await container.items.query({
            query,
            parameters: [{ name: "@wallet", value: wallet.toLowerCase() }]
        }).fetchAll();

        const safeKeys = keys.map((k: any) => ({
            ...k,
            keyHash: undefined,
            maskedKey: k.prefix + "•".repeat(24),
        }));

        return NextResponse.json({ ok: true, keys: safeKeys });
    } catch (e: any) {
        return NextResponse.json({ error: e.message || "Unauthorized" }, { status: 401 });
    }
}

/**
 * POST /api/admin/merchants/[wallet]/api-keys
 * Performs actions on a merchant's API keys (create, rotate, revoke, activate, reveal).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ wallet: string }> }) {
    try {
        const caller = await requireRole(req, "admin");
        const { wallet } = await props.params;
        if (!wallet) {
            return NextResponse.json({ error: "Missing wallet" }, { status: 400 });
        }

        const body = await req.json();
        const { action, keyId, label, plan, scopes, brandKey } = body;

        if (!action) {
            return NextResponse.json({ error: "Missing action" }, { status: 400 });
        }

        const container = await getContainer();

        if (action === "create") {
            const defaultScopes = [
                "receipts:read", "receipts:write",
                "orders:read", "orders:create",
                "inventory:read", "inventory:write",
                "split:read", "split:write", "shop:read"
            ];
            const selectedPlan: ApiKeyPlan = plan || "starter";
            const selectedScopes = scopes || defaultScopes;
            
            const { apiKey, doc } = await createApiKeyDoc(
                wallet,
                label || "Admin Issued Key",
                selectedPlan,
                selectedScopes,
                brandKey
            );

            return NextResponse.json({
                ok: true,
                apiKey,
                key: { ...doc, keyHash: undefined }
            });
        }

        // All other actions require a keyId
        if (!keyId) {
            return NextResponse.json({ error: "Missing keyId" }, { status: 400 });
        }

        // Verify key belongs to target wallet
        const query = "SELECT * FROM c WHERE c.type = 'api_key' AND c.id = @id AND c.wallet = @wallet";
        const { resources } = await container.items.query({
            query,
            parameters: [
                { name: "@id", value: keyId },
                { name: "@wallet", value: wallet.toLowerCase() }
            ]
        }).fetchAll();

        const doc = resources[0];
        if (!doc) {
            return NextResponse.json({ error: "API Key not found" }, { status: 404 });
        }

        if (action === "rotate") {
            const newKey = await rotateApiKey(keyId);
            if (!newKey) {
                return NextResponse.json({ error: "Failed to rotate key" }, { status: 500 });
            }
            return NextResponse.json({ ok: true, apiKey: newKey });
        }

        if (action === "revoke") {
            await updateApiKeyStatus(keyId, false);
            return NextResponse.json({ ok: true });
        }

        if (action === "activate") {
            await updateApiKeyStatus(keyId, true);
            return NextResponse.json({ ok: true });
        }

        if (action === "reveal") {
            if (!doc.encryptedKey) {
                return NextResponse.json({ error: "This key does not support reveal (please rotate to encrypt)" }, { status: 400 });
            }
            const rawKey = decryptApiKey(doc.encryptedKey);
            if (!rawKey) {
                return NextResponse.json({ error: "Failed to decrypt key" }, { status: 500 });
            }
            return NextResponse.json({ ok: true, apiKey: rawKey });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    } catch (e: any) {
        return NextResponse.json({ error: e.message || "Failed to process request" }, { status: 500 });
    }
}
