import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { requireCsrf } from "@/lib/security";
import { verifyEmailIdentity, verifyDomainIdentity, verifyDomainDkim } from "@/lib/aws/ses";
import { invalidateBrandConfigCache } from "@/lib/brand-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest, ctx: { params: Promise<{ brandKey: string }> }) {
    const correlationId = crypto.randomUUID();
    let brandKey = "basaltsurge";

    try {
        const params = ctx && ctx.params ? await ctx.params : {};
        brandKey = String((params as any)?.brandKey || "basaltsurge").toLowerCase().trim();
    } catch {
        return NextResponse.json({ error: "invalid_params" }, { status: 400 });
    }

    // Authenticate: Admin only
    let caller: { wallet: string };
    try {
        const auth = await requireThirdwebAuth(req);
        const roles = Array.isArray(auth.roles) ? auth.roles : [];
        if (!roles.includes("admin")) {
            return NextResponse.json({ error: "forbidden" }, { status: 403 });
        }
        caller = { wallet: auth.wallet };
    } catch {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    try {
        requireCsrf(req);
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "invalid_csrf" }, { status: 400 });
    }

    try {
        const body = await req.json().catch(() => ({}));
        const emailOrDomain = String(body.emailOrDomain || "").trim().toLowerCase();
        const senderName = String(body.senderName || "").trim();

        if (!emailOrDomain) {
            return NextResponse.json({ error: "email_or_domain_required" }, { status: 400 });
        }

        const container = await getContainer();
        const isEmail = emailOrDomain.includes("@");

        let emailConfig: any = {};

        if (isEmail) {
            // Verify single email address
            if (!/^[^@]+@[^@]+\.[^@]+$/.test(emailOrDomain)) {
                return NextResponse.json({ error: "invalid_email_format" }, { status: 400 });
            }

            try {
                await verifyEmailIdentity(emailOrDomain);
            } catch (awsErr: any) {
                console.error("[EMAIL VERIFY] AWS verify email identity failed:", awsErr);
                // Continue using mock status or throw if needed
            }

            emailConfig = {
                senderEmail: emailOrDomain,
                senderName: senderName || undefined,
                verificationType: "email",
                verificationStatus: "Pending",
                updatedAt: Date.now(),
            };
        } else {
            // Verify domain
            if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(emailOrDomain)) {
                return NextResponse.json({ error: "invalid_domain_format" }, { status: 400 });
            }

            let verificationToken = "mock_verification_token";
            let dkimTokens: string[] = ["mock_dkim_token_1", "mock_dkim_token_2", "mock_dkim_token_3"];

            try {
                const domainRes = await verifyDomainIdentity(emailOrDomain);
                const dkimRes = await verifyDomainDkim(emailOrDomain);
                verificationToken = domainRes.VerificationToken || verificationToken;
                dkimTokens = dkimRes.DkimTokens || dkimTokens;
            } catch (awsErr: any) {
                console.error("[EMAIL VERIFY] AWS verify domain/dkim identity failed:", awsErr);
            }

            emailConfig = {
                senderEmail: `support@${emailOrDomain}`,
                senderName: senderName || undefined,
                domain: emailOrDomain,
                verificationType: "domain",
                verificationStatus: "Pending",
                verificationToken,
                dkimTokens,
                updatedAt: Date.now(),
            };
        }

        // Load existing brand config
        let doc: any = null;
        try {
            const { resource } = await container.item("brand:config", brandKey).read();
            doc = resource;
        } catch {}

        if (!doc) {
            doc = {
                id: "brand:config",
                wallet: brandKey,
                type: "brand_config",
            };
        }

        doc.email = emailConfig;
        doc.updatedAt = Date.now();

        await container.items.upsert(doc);
        invalidateBrandConfigCache(brandKey);

        return NextResponse.json({
            ok: true,
            email: emailConfig,
        });

    } catch (e: any) {
        console.error("[EMAIL VERIFY] Unexpected error:", e);
        return NextResponse.json({ error: e?.message || "server_error" }, { status: 500 });
    }
}
