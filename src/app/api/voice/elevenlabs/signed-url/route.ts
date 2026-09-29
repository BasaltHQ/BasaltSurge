import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedWallet } from "@/lib/auth";
import { getContainer } from "@/lib/cosmos";
import { createHash } from "crypto";
import { requireCsrf, rateLimitOrThrow, rateKey } from "@/lib/security";

export const dynamic = 'force-dynamic';

/**
 * ElevenLabs Signed URL API Route
 * 
 * Replaces the previous /api/voice/session and /api/voice/rtc/offer routes.
 * 
 * 1. Performs usage gating (daily caps, per-session budgets, anon vs auth)
 * 2. Calls ElevenLabs to get a signed URL for the specified agent
 * 3. Returns { signedUrl, maxDurationSec, usageDocId } to the client
 * 
 * Query params:
 *   - persona: "concierge" | "server" | "tour" (selects the agent ID)
 *   - connectionType: "webrtc" for tour voice, otherwise signed WebSocket URL
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({} as any));
        const authed = await getAuthenticatedWallet(req);
        const headerWallet = String(req.headers.get('x-wallet') || '').toLowerCase();
        const bodyWallet = String(body.wallet || '').toLowerCase();
        const wallet = String(authed || headerWallet || bodyWallet || '').toLowerCase();

        const persona = String(body.persona || "concierge").trim().toLowerCase();
        const useWebRTC = persona === 'tour' && body.connectionType === 'webrtc';
        if (persona === "tour") {
            // A claimed wallet in headers/body is never sufficient for admin training.
            if (!authed) return NextResponse.json({ error: "Sign in to start the tour guide." }, { status: 401 });
            if (req.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: "bad_origin" }, { status: 403 });
            requireCsrf(req);
            rateLimitOrThrow(req, rateKey(req, "admin_tour_session", authed), 10, 60 * 60 * 1000);
        }

        // ─── Resolve Agent ID ───
        const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API || process.env.ELEVENLABS_API_KEY || "";
        const AGENT_ID = persona === "tour" ? (process.env.ELEVENLABS_AGENT_ID_TOUR || "") : persona === "server"
            ? (process.env.ELEVENLABS_AGENT_ID_SERVER || "")
            : (process.env.ELEVENLABS_AGENT_ID_CONCIERGE || "");

        if (!ELEVENLABS_API_KEY) {
            return NextResponse.json({ error: persona === 'tour' ? 'tour_not_configured' : 'ElevenLabs API key not configured' }, { status: 503 });
        }
        if (!AGENT_ID) {
            return NextResponse.json({ error: persona === 'tour' ? 'tour_not_configured' : 'ElevenLabs agent ID not configured' }, { status: 503 });
        }

        // ─── Usage Gating (ported from /api/voice/session) ───
        let budgetSec = 120; // default 2 minutes
        let usageDocId = "";

        try {
            const gatingDisabled = String(process.env.VOICE_GATING_DISABLED || "").trim() === "1";
            if (gatingDisabled) {
                budgetSec = Number(process.env.VOICE_MAX_SESSION_SEC?.trim() || "") || 8 * 60 * 60;
            } else {
                const isAuthenticated = !!authed && typeof authed === "string" && authed.length > 0;
                const ip = ((req as any).ip || req.headers.get("x-forwarded-for") || "").toString().split(",")[0].trim();
                const ua = String(req.headers.get("user-agent") || "");
                const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
                const walletKey = isAuthenticated ? String(authed).toLowerCase() : `anon:${hash(`${ip}|${ua}`)}`;
                const now = Date.now();
                const day = new Date(now).toISOString().slice(0, 10);
                const container = await getContainer();

                const DAILY_CAP_AUTH = Number(process.env.VOICE_DAILY_CAP_AUTH?.trim() || "") || 8 * 60 * 60;
                const PER_SESSION_CAP_AUTH = Number(process.env.VOICE_PER_SESSION_CAP_AUTH?.trim() || "") || 4 * 60 * 60;
                const PER_SESSION_CAP_ANON = Number(process.env.VOICE_PER_SESSION_CAP_ANON?.trim() || "") || 2 * 60 * 60;

                if (isAuthenticated) {
                    const query = {
                        query: "SELECT c.seconds, c.kind FROM c WHERE c.wallet = @w AND c.type = @t AND c.day = @d AND c.finalized = true",
                        parameters: [
                            { name: "@w", value: walletKey },
                            { name: "@t", value: "usage" },
                            { name: "@d", value: day },
                        ],
                    } as { query: string; parameters: { name: string; value: string }[] };
                    const { resources } = await container.items.query(query).fetchAll();
                    let usedToday = 0;
                    for (const r of resources as any[]) {
                        const sec = Math.max(0, Number(r?.seconds || 0));
                        const kind = String(r?.kind || "");
                        const cap = kind === "auth" ? PER_SESSION_CAP_AUTH : PER_SESSION_CAP_ANON;
                        usedToday += Math.min(sec, cap);
                    }
                    const remaining = Math.max(0, DAILY_CAP_AUTH - usedToday);
                    if (remaining <= 0) {
                        return NextResponse.json(
                            { error: "limit_reached", kind: "authenticated_daily", used: usedToday, limit: DAILY_CAP_AUTH, day },
                            { status: 429 }
                        );
                    }
                    budgetSec = Math.min(remaining, PER_SESSION_CAP_AUTH);
                } else {
                    budgetSec = PER_SESSION_CAP_ANON;
                }

                // Pre-allocate usage reservation
                const usageDoc = {
                    id: `usage:${walletKey}:${now}`,
                    wallet: walletKey,
                    type: "usage",
                    seconds: budgetSec,
                    day,
                    createdAt: now,
                    kind: isAuthenticated ? "auth" : "anon",
                    finalized: false,
                };
                try {
                    await container.items.create(usageDoc as any);
                    usageDocId = usageDoc.id;
                } catch { }
            }
        } catch (e: any) {
            return NextResponse.json({ error: "limit_check_failed" }, { status: 503 });
        }

        // ─── Get Signed URL from ElevenLabs ───
        const signedUrlRes = await fetch(
            `https://api.elevenlabs.io/v1/convai/conversation/${useWebRTC ? 'token' : 'get-signed-url'}?agent_id=${encodeURIComponent(AGENT_ID)}`,
            {
                method: "GET",
                signal: AbortSignal.timeout(15000),
                cache: 'no-store',
                headers: {
                    "xi-api-key": ELEVENLABS_API_KEY,
                },
            }
        );

        if (!signedUrlRes.ok) {
            return NextResponse.json(
                { error: "elevenlabs_session_failed" },
                { status: 502 }
            );
        }

        const signedUrlData = await signedUrlRes.json();
        const signedUrl = signedUrlData?.signed_url || "";
        const conversationToken = signedUrlData?.token || '';

        if (useWebRTC ? !conversationToken : !signedUrl) {
            return NextResponse.json({ error: "elevenlabs_empty_session" }, { status: 502 });
        }

        return NextResponse.json({
            ...(useWebRTC ? { conversationToken } : { signedUrl }),
            maxDurationSec: budgetSec,
            usageDocId: usageDocId || undefined,
            agentId: AGENT_ID,
            persona,
        }, { headers: { "Cache-Control": "no-store" } });
    } catch (e: any) {
        return NextResponse.json({ error: e?.status === 429 ? "rate_limited" : e?.status === 403 ? "bad_origin" : "Voice session unavailable" }, { status: e?.status === 429 ? 429 : e?.status === 403 ? 403 : 500 });
    }
}
