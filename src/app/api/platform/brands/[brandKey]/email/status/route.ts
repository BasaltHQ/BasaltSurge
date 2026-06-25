import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { requireCsrf } from "@/lib/security";
import { getIdentityStatus } from "@/lib/aws/ses";
import { invalidateBrandConfigCache } from "@/lib/brand-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest, ctx: { params: Promise<{ brandKey: string }> }) {
    const correlationId = crypto.randomUUID();
    let brandKey = "basaltsurge";

    try {
        const params = ctx && ctx.params ? await ctx.params : {};
        brandKey = String((params as any)?.brandKey || "basaltsurge").toLowerCase().trim();
    } catch {
        return NextResponse.json({ error: "invalid_params" }, { status: 400 });
    }

    // Authenticate: Admin only
    try {
        const auth = await requireThirdwebAuth(req);
        const roles = Array.isArray(auth.roles) ? auth.roles : [];
        if (!roles.includes("admin")) {
            return NextResponse.json({ error: "forbidden" }, { status: 403 });
        }
    } catch {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    try {
        const container = await getContainer();
        let doc: any = null;
        try {
            const { resource } = await container.item("brand:config", brandKey).read();
            doc = resource;
        } catch {}

        if (!doc || !doc.email) {
            return NextResponse.json({ error: "email_not_configured" }, { status: 404 });
        }

        const emailConfig = doc.email;
        const identity = emailConfig.domain || emailConfig.senderEmail;

        if (!identity) {
            return NextResponse.json({ error: "invalid_email_config" }, { status: 400 });
        }

        let awsVerificationStatus = "Pending";
        let awsDkimStatus = "Pending";
        let awsDkimTokens: string[] = emailConfig.dkimTokens || [];

        try {
            const status = await getIdentityStatus(identity);
            awsVerificationStatus = status.verificationStatus;
            awsDkimStatus = status.dkimStatus;
            if (status.dkimTokens && status.dkimTokens.length > 0) {
                awsDkimTokens = status.dkimTokens;
            }
        } catch (awsErr: any) {
            console.error(`[EMAIL STATUS] AWS verification poll failed for ${identity}:`, awsErr);
            // Fallback to existing database status if AWS is not reachable/configured
            awsVerificationStatus = emailConfig.verificationStatus || "Pending";
            awsDkimStatus = emailConfig.dkimStatus || "Pending";
        }

        // Determine combined status
        let combinedStatus = "Pending";
        if (emailConfig.verificationType === "email") {
            combinedStatus = awsVerificationStatus;
        } else {
            // For domains, we check both domain identity status and DKIM status
            if (awsVerificationStatus === "Success" && awsDkimStatus === "Success") {
                combinedStatus = "Success";
            } else if (awsVerificationStatus === "Failed" || awsDkimStatus === "Failed") {
                combinedStatus = "Failed";
            } else {
                combinedStatus = "Pending";
            }
        }

        // Update database
        emailConfig.verificationStatus = combinedStatus;
        emailConfig.dkimStatus = awsDkimStatus;
        emailConfig.dkimTokens = awsDkimTokens;
        emailConfig.updatedAt = Date.now();

        doc.email = emailConfig;
        doc.updatedAt = Date.now();

        await container.items.upsert(doc);
        invalidateBrandConfigCache(brandKey);

        return NextResponse.json({
            ok: true,
            email: emailConfig,
        });

    } catch (e: any) {
        console.error("[EMAIL STATUS] Unexpected error:", e);
        return NextResponse.json({ error: e?.message || "server_error" }, { status: 500 });
    }
}
