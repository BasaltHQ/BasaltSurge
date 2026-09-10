import { NextRequest, NextResponse } from "next/server";
import { getAuth, AUTH } from "@/lib/auth";

/**
 * Derive cookie domain from the actual request host.
 * For localhost, IP hosts, or Azure subdomains (*.azurewebsites.net), returns undefined
 * to avoid cross-subdomain cookie sharing and set cookie for specific host only.
 * 
 * IMPORTANT: This uses the actual request host, not NEXT_PUBLIC_APP_URL, because:
 * - Partner containers may not have NEXT_PUBLIC_APP_URL set to their own domain
 * - Cookies must be set for the domain the user is actually visiting
 * - Setting domain=.ledger1.ai when user is on paynex.azurewebsites.net would fail
 */
function getCookieDomainFromRequest(req: NextRequest): string | undefined {
	// In development, always use host-only cookies to avoid localhost domain mismatch issues
	if (process.env.NODE_ENV !== "production") return undefined;

	try {
		// Get the actual request host (prefer x-forwarded-host for reverse proxies)
		const forwarded = req.headers.get("x-forwarded-host") || "";
		const firstForwarded = forwarded.split(",")[0].trim();
		const host = firstForwarded || req.headers.get("host") || "";

		// Extract hostname without port
		const hostname = host.split(":")[0].trim();

		// Don't set domain for localhost or IP addresses
		if (hostname === "localhost" || /^[\d.]+$/.test(hostname)) return undefined;

		// Don't set domain for Azure subdomains (*.azurewebsites.net, *.azurefd.net, etc.)
		// This ensures each partner container gets its own isolated cookie
		if (hostname.endsWith('.azurewebsites.net') || hostname.endsWith('.azurefd.net') || hostname.endsWith('.azure.com')) {
			return undefined;
		}

		// For custom domains like pay.ledger1.ai, set domain to .ledger1.ai for sharing
		const parts = hostname.split(".");
		if (parts.length >= 2) {
			const base = parts.slice(-2).join(".");
			return `.${base}`;
		}
	} catch { }
	return undefined;
}

export async function POST(req: NextRequest) {
	try {
		const body = await req.json().catch(() => ({}));
		const payload = body?.payload;
		const signature = body?.signature;
		if (!payload || !signature) {
			return NextResponse.json({ error: "invalid" }, { status: 400 });
		}
		const auth = getAuth(req);
		const verification = await auth.verifyPayload({ payload, signature });
		if (!verification.valid) {
			console.warn("[auth/login] Payload verification failed", { reason: verification.error, chainId: payload.chain_id });
			return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
		}
		const verifiedPayload = verification.payload;
		const addr = String(verifiedPayload?.address || "").toLowerCase();
		// Issue a JWT using the VerifiedLoginPayload from Thirdweb (preserves domain/nonce/chain, etc.)
		const jwt = await auth.generateJWT({ payload: verifiedPayload });
		const res = NextResponse.json({ ok: true });
		const cookieDomain = getCookieDomainFromRequest(req);
		const opts = {
			httpOnly: true,
			secure: process.env.NODE_ENV === 'production',
			sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
			path: '/',
			domain: cookieDomain,
			maxAge: 60 * 60 * 24,
		} as const;

		res.cookies.set(AUTH.COOKIE, jwt, opts);

		// If this is the main platform container, also set the SSO cookie for the broader BasaltHQ portal
		if (process.env.CONTAINER_TYPE === "platform") {
			res.cookies.set("thirdweb_auth_token", jwt, opts);
		}
		// Secondary cookie with wallet address for robust server reads
		if (addr) {
			res.cookies.set("cb_wallet", addr, opts);
		}
		return res;
	} catch (e: any) {
		return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
	}
}
