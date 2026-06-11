import { cookies } from "next/headers";
import { createAuth } from "thirdweb/auth";
import { privateKeyToAccount } from "thirdweb/wallets";
import type { NextRequest } from "next/server";
import { serverClient as client, chain } from "@/lib/thirdweb/server";

const AUTH_COOKIE = "cb_auth_token";

function getDomainFromRequest(req?: NextRequest): string {
	try {
		// First, get the actual request host (important for partner containers)
		const forwarded = req?.headers?.get("x-forwarded-host") || "";
		const firstForwarded = forwarded.split(",")[0].trim();
		let requestHost = firstForwarded || req?.headers?.get("host") || "";

		// Normalize localhost variations
		if (requestHost) {
			requestHost = requestHost.replace(/^127\.0\.0\.1/, "localhost");
		}

		// For custom domains and partner containers, ALWAYS use the request host if available.
		// This ensure JWTs are issued/verified with the correct domain for EACH brand site.
		// Previously restricted to .azurewebsites.net or .azurefd.net, now widened for Plesk/VPS migration.
		if (requestHost && !/^localhost(:\d+)?$/.test(requestHost) && !/^[\d.]+(:?\d+)?$/.test(requestHost)) {
			return requestHost;
		}

		// Fallback: for the main platform's canonical URL or local development
		const envUrl = process.env.NEXT_PUBLIC_APP_URL || "";
		if (envUrl) {
			try {
				const u = new URL(envUrl);
				let envHost = (u.host || "").replace(/^127\.0\.0\.1/, "localhost");
				if (envHost) return envHost;
			} catch { }
		}

		// Extreme fallback: use the request host as is
		if (requestHost) {
			return requestHost;
		}

		return requestHost || "localhost:3000";
	} catch {
		return "localhost:3000";
	}
}

function getAdminAccount() {
	const pk = process.env.THIRDWEB_ADMIN_PRIVATE_KEY || process.env.ADMIN_PRIVATE_KEY || "";
	if (!pk) throw new Error("THIRDWEB_ADMIN_PRIVATE_KEY not set");
	const normalized = pk.startsWith("0x") ? pk : ("0x" + pk);
	return privateKeyToAccount({ client, privateKey: normalized as `0x${string}` });
}

export function getAuth(req?: NextRequest) {
	const auth = createAuth({
		domain: getDomainFromRequest(req),
		client,
		adminAccount: getAdminAccount(),
		login: {
			statement: "By signing, you agree to use this Web3-native, permissionless payment service. You acknowledge: (1) All transactions are trustless and executed via smart contracts without intermediaries; (2) You maintain full custody and responsibility for your wallet and private keys; (3) Cryptocurrency transactions are irreversible and final; (4) You are at least 18 years old and comply with all applicable laws; (5) This signature authenticates your wallet, costs no gas, and initiates no blockchain transaction; (6) You accept all risks associated with cryptocurrency transactions including price volatility and network fees.",
			payloadExpirationTimeSeconds: 5 * 60,
		},
		jwt: {
			expirationTimeSeconds: 60 * 60 * 24, // 24h
		},
	});
	return auth;
}

export async function getAuthenticatedWallet(req?: NextRequest): Promise<string | null> {
	try {
		const cookieStore = await cookies();
		let token = cookieStore.get(AUTH_COOKIE)?.value;

		// Support BasaltHQ Portal SSO only for the platform container
		if (!token && process.env.CONTAINER_TYPE === "platform") {
			token = cookieStore.get("thirdweb_auth_token")?.value;
		}

		if (!token) return null;

		// Try Thirdweb JWT verification first
		try {
			const auth = getAuth(req);
			const res = await auth.verifyJWT({ jwt: token });
			if (res.valid) {
				// Expect address in payload.address per our login route. Fall back to sub/address.
				let candidate: string | undefined = undefined;
				const p: any = (res as any).parsedJWT || {};
				candidate = p?.payload?.address || p?.sub || p?.address || p?.payload?.sub;
				if (candidate && /^0x[a-fA-F0-9]{40}$/.test(candidate)) {
					return candidate.toLowerCase();
				}
			}
		} catch {
			// Thirdweb verification failed, try custom auto-login JWT
		}

		// Fallback: Verify custom auto-login JWT for embedded wallets
		if (typeof token === "string" && token.split(".").length === 3) {
			try {
				const parts = token.split(".");
				const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));

				// Check if it's our auto-login token
				if (payload?.iss === "portalpay") {
					// Verify signature
					const { createHash, createHmac } = await import("crypto");
					const secret = process.env.THIRDWEB_ADMIN_PRIVATE_KEY || process.env.JWT_SECRET || "";
					const secretHash = createHash('sha256').update(secret).digest();

					const expectedSignature = createHmac('sha256', secretHash)
						.update(`${parts[0]}.${parts[1]}`)
						.digest('base64url');

					if (expectedSignature === parts[2]) {
						// Check expiration
						const now = Math.floor(Date.now() / 1000);
						if (payload.exp && payload.exp > now) {
							const address = payload?.address || payload?.sub || payload?.payload?.address;
							if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
								return address.toLowerCase();
							}
						}
					}
				}
			} catch { }
		}

		return null;
	} catch {
		return null;
	}
}

export async function requireAuthenticatedWallet(): Promise<string> {
	const w = await getAuthenticatedWallet();
	if (!w) throw new Error("unauthorized");
	return w;
}

export function isOwnerWallet(addr: string | null | undefined): boolean {
	const owner = (process.env.NEXT_PUBLIC_OWNER_WALLET || "").toLowerCase();
	const a = String(addr || "").toLowerCase();
	return !!owner && owner === a;
}

export function setAuthCookie(resp: Response, jwt: string) {
	try {
		// Prefer NextResponse cookies in route handlers, but fall back if not available
		// This helper is kept minimal: callers should use NextResponse.cookies.set where possible
		// Left as placeholder for future shared logic.
	} catch { }
}

function getAdminWallets(): string[] {
	const env = String(process.env.ADMIN_WALLETS || "").toLowerCase();
	const arr = env.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
	return arr.filter((a) => /^0x[a-f0-9]{40}$/.test(a));
}

export function isAdminWallet(addr: string | null | undefined): boolean {
	const a = String(addr || "").toLowerCase();
	return getAdminWallets().includes(a);
}

export async function requireThirdwebAuth(req?: NextRequest): Promise<{ wallet: string; roles: string[] }> {
	const cookieStore = await cookies();
	let token = cookieStore.get(AUTH_COOKIE)?.value;

	// Support BasaltHQ Portal SSO only for the platform container
	if (!token && process.env.CONTAINER_TYPE === "platform") {
		token = cookieStore.get("thirdweb_auth_token")?.value;
	}

	if (!token) throw new Error("unauthorized");

	// Try Thirdweb JWT verification first
	try {
		const auth = getAuth(req);
		const res = await auth.verifyJWT({ jwt: token });
		if (res.valid) {
			// Extract address and any role claims from the JWT payload
			const p: any = (res as any).parsedJWT || {};
			const address = (p?.payload?.address || p?.sub || p?.address || p?.payload?.sub) as string | undefined;
			const wallet = String(address || "").toLowerCase();

			if (/^0x[a-f0-9]{40}$/.test(wallet)) {
				const roles = Array.isArray(p?.payload?.roles)
					? p.payload.roles.map((r: any) => String(r)).filter(Boolean)
					: [];

				// Elevate to admin if wallet is configured in server-only ADMIN_WALLETS
				if (isAdminWallet(wallet) && !roles.includes("admin")) roles.push("admin");

				// Query Cosmos DB for database-configured roles to dynamically elevate roles array
				try {
					const { resolveAdminRole } = await import("@/lib/authz-server");
					let brandKey = "";
					if (req) {
						brandKey = req.headers.get("x-brand-key") || "";
					}
					if (!brandKey) {
						brandKey = String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase();
					}
					const dbRole = await resolveAdminRole(wallet, brandKey || undefined);
					if (dbRole) {
						if (!roles.includes("admin")) {
							roles.push("admin");
						}
						if ((dbRole === "platform_super_admin" || dbRole === "partner_owner") && !roles.includes("superadmin")) {
							roles.push("superadmin");
						}
						if (!roles.includes(dbRole)) {
							roles.push(dbRole);
						}
					}
				} catch (dbErr) {
					console.error("[requireThirdwebAuth] failed to resolve db role:", dbErr);
				}

				return { wallet, roles };
			}
		}
	} catch {
		// Thirdweb verification failed, try custom auto-login JWT
	}

	// Fallback: Verify custom auto-login JWT for embedded wallets
	if (typeof token === "string" && token.split(".").length === 3) {
		try {
			const parts = token.split(".");
			const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));

			// Check if it's our auto-login token
			if (payload?.iss === "portalpay") {
				// Verify signature
				const { createHash, createHmac } = await import("crypto");
				const secret = process.env.THIRDWEB_ADMIN_PRIVATE_KEY || process.env.JWT_SECRET || "";
				const secretHash = createHash('sha256').update(secret).digest();

				const expectedSignature = createHmac('sha256', secretHash)
					.update(`${parts[0]}.${parts[1]}`)
					.digest('base64url');

				if (expectedSignature === parts[2]) {
					// Check expiration
					const now = Math.floor(Date.now() / 1000);
					if (payload.exp && payload.exp > now) {
						const address = payload?.address || payload?.sub || payload?.payload?.address;
						if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
							const wallet = address.toLowerCase();
							const roles: string[] = []; // Auto-login tokens don't have roles

							// Elevate to admin if wallet is configured in server-only ADMIN_WALLETS
							if (isAdminWallet(wallet) && !roles.includes("admin")) roles.push("admin");

							// Query Cosmos DB for database-configured roles to dynamically elevate roles array
							try {
								const { resolveAdminRole } = await import("@/lib/authz-server");
								let brandKey = "";
								if (req) {
									brandKey = req.headers.get("x-brand-key") || "";
								}
								if (!brandKey) {
									brandKey = String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase();
								}
								const dbRole = await resolveAdminRole(wallet, brandKey || undefined);
								if (dbRole) {
									if (!roles.includes("admin")) {
										roles.push("admin");
									}
									if ((dbRole === "platform_super_admin" || dbRole === "partner_owner") && !roles.includes("superadmin")) {
										roles.push("superadmin");
									}
									if (!roles.includes(dbRole)) {
										roles.push(dbRole);
									}
								}
							} catch (dbErr) {
								console.error("[requireThirdwebAuth Fallback] failed to resolve db role:", dbErr);
							}

							return { wallet, roles };
						}
					}
				}
			}
		} catch { }
	}

	throw new Error("unauthorized");
}

export async function requireRole(req: NextRequest, role: string): Promise<{ wallet: string; roles: string[] }> {
	const caller = await requireThirdwebAuth(req);
	if (!caller.roles.includes(role)) throw new Error("forbidden");
	return caller;
}

export function assertOwnershipOrAdmin(callerWallet: string, targetWallet: string, isAdmin: boolean): void {
	const cw = String(callerWallet || "").toLowerCase();
	const tw = String(targetWallet || "").toLowerCase();
	if (isAdmin) return;
	if (!cw || !tw || cw !== tw) throw new Error("forbidden");
}

export const AUTH = {
	COOKIE: AUTH_COOKIE,
};
