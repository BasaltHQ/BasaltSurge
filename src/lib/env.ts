/**
 * Typed environment loader and container context helpers.
 * No external dependencies; designed for both server and client-safe reads.
 *
 * Partner containers require strict envs. When missing, fail-fast on server startup.
 */

export type ContainerType = 'platform' | 'partner';

export type EdgeRoutingMode = 'afd' | 'apim-direct';

export interface EnvConfig {
  CONTAINER_TYPE: ContainerType;
  BRAND_KEY?: string;
  NEXT_PUBLIC_OWNER_WALLET?: string;
  ADMIN_WALLETS: string[];
  NEXT_PUBLIC_PLATFORM_WALLET?: string;
  NEXT_PUBLIC_RECIPIENT_ADDRESS?: string;
  PLATFORM_SPLIT_BPS?: number;
  PLATFORM_BPS?: number;
  PARTNER_SPLIT_BPS?: number;
  EDGE_ROUTING_MODE: EdgeRoutingMode;
  AFD_CHANGE_LOCKED: boolean;
  AUTHZ_FALLBACK_ENABLED: boolean;
  DUAL_SPLIT_CONFIG: boolean;
  CREDIT_SPLIT_AGENT_BPS?: number;
  CREDIT_SPLIT_PLATFORM_BPS?: number;
}

/**
 * Coerce string (possibly empty/undefined) to a trimmed value or undefined.
 */
function coerceStr(v: any): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s.length ? s : undefined;
}

function coerceNum(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse a CSV string into an array of trimmed non-empty strings.
 */
function parseCsv(v: any): string[] {
  if (typeof v !== 'string') return [];
  return v
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Normalize an Ethereum address to lowercase 0x form for comparisons.
 * Returns undefined if input isn't a plausible hex address.
 */
function normalizeHexAddress(addr?: string): string | undefined {
  try {
    const s = String(addr || '').trim().toLowerCase();
    return /^0x[a-f0-9]{40}$/.test(s) ? s : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Clamp basis points (0..10000).
 */
function clampBps(n?: number): number | undefined {
  if (!Number.isFinite(n as number)) return undefined;
  const x = Math.max(0, Math.min(10000, Number(n)));
  return Math.floor(x);
}

/**
 * Read and type environment values. Defaults are conservative.
 */
export function getEnv(): EnvConfig {
  const containerTypeRaw = (process.env.CONTAINER_TYPE || '').trim().toLowerCase();
  const containerType: ContainerType = containerTypeRaw === 'partner' ? 'partner' : 'platform';

  const BRAND_KEY = coerceStr(process.env.BRAND_KEY) || "BasaltSurge";

  const NEXT_PUBLIC_OWNER_WALLET = normalizeHexAddress(process.env.NEXT_PUBLIC_OWNER_WALLET);

  const ADMIN_WALLETS = parseCsv(process.env.ADMIN_WALLETS).map(normalizeHexAddress).filter(Boolean) as string[];

  const NEXT_PUBLIC_PLATFORM_WALLET = normalizeHexAddress(process.env.NEXT_PUBLIC_PLATFORM_WALLET);

  const NEXT_PUBLIC_RECIPIENT_ADDRESS = normalizeHexAddress(process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS);

  const PLATFORM_SPLIT_BPS = clampBps(coerceNum(process.env.PLATFORM_SPLIT_BPS));
  const PLATFORM_BPS = clampBps(coerceNum(process.env.PLATFORM_BPS || process.env.NEXT_PUBLIC_PLATFORM_BPS));
  const PARTNER_SPLIT_BPS = clampBps(coerceNum(process.env.PARTNER_SPLIT_BPS));

  const DUAL_SPLIT_CONFIG = String(process.env.DUAL_SPLIT_CONFIG || process.env.NEXT_PUBLIC_DUAL_SPLIT_CONFIG || '').trim().toLowerCase() === 'true';
  const CREDIT_SPLIT_AGENT_BPS = clampBps(coerceNum(process.env.CREDIT_SPLIT_AGENT_BPS || process.env.NEXT_PUBLIC_CREDIT_SPLIT_AGENT_BPS));
  const CREDIT_SPLIT_PLATFORM_BPS = clampBps(coerceNum(process.env.CREDIT_SPLIT_PLATFORM_BPS || process.env.NEXT_PUBLIC_CREDIT_SPLIT_PLATFORM_BPS));

  // Fallback toggles and routing mode
  const EDGE_ROUTING_MODE: EdgeRoutingMode =
    (process.env.EDGE_ROUTING_MODE || '').trim().toLowerCase() === 'apim-direct' ? 'apim-direct' : 'afd';

  const AFD_CHANGE_LOCKED = String(process.env.AFD_CHANGE_LOCKED || '').trim().toLowerCase() === 'true';
  const AUTHZ_FALLBACK_ENABLED = String(process.env.AUTHZ_FALLBACK_ENABLED || '').trim().toLowerCase() === 'true';

  return {
    CONTAINER_TYPE: containerType,
    BRAND_KEY,
    NEXT_PUBLIC_OWNER_WALLET,
    ADMIN_WALLETS,
    NEXT_PUBLIC_PLATFORM_WALLET,
    NEXT_PUBLIC_RECIPIENT_ADDRESS,
    PLATFORM_SPLIT_BPS,
    PLATFORM_BPS,
    PARTNER_SPLIT_BPS,
    EDGE_ROUTING_MODE,
    AFD_CHANGE_LOCKED,
    AUTHZ_FALLBACK_ENABLED,
    DUAL_SPLIT_CONFIG,
    CREDIT_SPLIT_AGENT_BPS,
    CREDIT_SPLIT_PLATFORM_BPS,
  };
}

export const isPlatformContext = (): boolean => getEnv().CONTAINER_TYPE === 'platform';
export const isPartnerContext = (): boolean => getEnv().CONTAINER_TYPE === 'partner';

/**
 * Client-safe version of isPartnerContext that reads from NEXT_PUBLIC_CONTAINER_TYPE.
 * Use this in client components where process.env is not fully available.
 */
export const isPartnerContextClient = (): boolean => {
  if (typeof window === 'undefined') {
    // On server, fall back to server env
    return isPartnerContext();
  }
  // On client, read from NEXT_PUBLIC_ prefixed env
  const containerType = (process.env.NEXT_PUBLIC_CONTAINER_TYPE || '').trim().toLowerCase();
  return containerType === 'partner';
};

export const isAfdMode = (): boolean => getEnv().EDGE_ROUTING_MODE === 'afd';
export const isApimDirectMode = (): boolean => getEnv().EDGE_ROUTING_MODE === 'apim-direct';
export const isAfdLocked = (): boolean => !!getEnv().AFD_CHANGE_LOCKED;
export const isAuthZFallbackEnabled = (): boolean => !!getEnv().AUTHZ_FALLBACK_ENABLED;

/**
 * Fallback is required when:
 * - explicit AUTHZ_FALLBACK_ENABLED=true, or
 * - EDGE_ROUTING_MODE='apim-direct'
 */
export const requiresAuthZFallback = (): boolean =>
  isAuthZFallbackEnabled() || isApimDirectMode();

/**
 * Validate partner-required envs; return list of missing keys.
 */
export function validatePartnerEnv(): string[] {
  const env = getEnv();
  if (env.CONTAINER_TYPE !== 'partner') return [];

  const missing: string[] = [];
  if (!env.BRAND_KEY) missing.push('BRAND_KEY');
  if (!env.NEXT_PUBLIC_OWNER_WALLET) missing.push('NEXT_PUBLIC_OWNER_WALLET');
  if (!env.NEXT_PUBLIC_PLATFORM_WALLET) missing.push('NEXT_PUBLIC_PLATFORM_WALLET');
  if (!env.NEXT_PUBLIC_RECIPIENT_ADDRESS) missing.push('NEXT_PUBLIC_RECIPIENT_ADDRESS');

  return missing;
}

/**
 * Fail-fast in partner context when required envs are missing.
 * Throws an error listing missing keys; callers can surface a 500 page.
 */
export function failIfMissingPartnerEnv(): void {
  const missing = validatePartnerEnv();
  if (missing.length) {
    const msg = `Missing required env(s) for partner container: ${missing.join(', ')}`;
    // Log loudly for server operators; Next.js will surface stack traces in server logs.
    try {
      // eslint-disable-next-line no-console
      console.error(msg);
    } catch { }
    throw new Error(msg);
  }
}

/**
 * Utility to check split BPS coherence. Returns a sanitized tuple or undefined if invalid.
 * Ensures platform + partner <= 10000; merchant remainder is computed by the caller as (10000 - sum).
 */
export function getSanitizedSplitBps(): { platform: number; partner: number } | undefined {
  const env = getEnv();
  const p = clampBps(env.PLATFORM_BPS ?? env.PLATFORM_SPLIT_BPS ?? 50); // prioritize PLATFORM_BPS
  const q = clampBps(env.PARTNER_SPLIT_BPS ?? 0);
  const sum = Math.max(0, (p ?? 0)) + Math.max(0, (q ?? 0));
  if (sum > 10000) return undefined;
  return { platform: p ?? 50, partner: q ?? 0 };
}

export const isDualSplitEnabled = (): boolean => {
  if (typeof window !== 'undefined') {
    const cookies = window.document.cookie || "";
    if (cookies.includes("pp_sandbox_split_mode=dual")) return true;
    if (cookies.includes("pp_sandbox_split_mode=single")) return false;
  }
  return !!getEnv().DUAL_SPLIT_CONFIG;
};

export function getSanitizedCreditSplitBps(): { platform: number; agent: number } | undefined {
  const env = getEnv();
  const p = clampBps(env.CREDIT_SPLIT_PLATFORM_BPS ?? env.PLATFORM_BPS ?? 150);
  const q = clampBps(env.CREDIT_SPLIT_AGENT_BPS ?? 0);
  const sum = Math.max(0, (p ?? 0)) + Math.max(0, (q ?? 0));
  if (sum > 10000) return undefined;
  return { platform: p ?? 150, agent: q ?? 0 };
}

/**
 * Utility to check if a wallet has partner admin privileges in partner context.
 * Partner admin list includes NEXT_PUBLIC_OWNER_WALLET and ADMIN_WALLETS entries.
 */
export function isPartnerAdminWallet(wallet?: string): boolean {
  const w = normalizeHexAddress(wallet);
  if (!w) return false;
  const env = getEnv();
  if (normalizeHexAddress(env.NEXT_PUBLIC_OWNER_WALLET) === w) return true;
  return (env.ADMIN_WALLETS || []).some(a => a === w);
}

/**
 * Utility to check if a wallet is the platform superadmin (owner wallet in platform context).
 */
export function isPlatformSuperAdminWallet(wallet?: string): boolean {
  const w = normalizeHexAddress(wallet);
  if (!w) return false;
  const env = getEnv();
  const owner = normalizeHexAddress(env.NEXT_PUBLIC_OWNER_WALLET);
  return !!owner && owner === w;
}
