import { isIP } from "node:net";

function stripAddressDecorations(value: string): string {
  let candidate = value.trim();
  if (candidate.startsWith("[") && candidate.includes("]")) {
    candidate = candidate.slice(1, candidate.indexOf("]"));
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }
  if (candidate.toLowerCase().startsWith("::ffff:")) {
    const mapped = candidate.slice(7);
    if (isIP(mapped) === 4) candidate = mapped;
  }
  return candidate;
}

export function isPublicIpAddress(value: unknown): boolean {
  const candidate = stripAddressDecorations(String(value || ""));
  const version = isIP(candidate);
  if (!version) return false;
  if (version === 6) {
    const normalized = candidate.toLowerCase();
    return normalized !== "::" && normalized !== "::1"
      && !normalized.startsWith("fc")
      && !normalized.startsWith("fd")
      && !normalized.startsWith("fe8")
      && !normalized.startsWith("fe9")
      && !normalized.startsWith("fea")
      && !normalized.startsWith("feb")
      && !normalized.startsWith("2001:db8:");
  }

  const octets = candidate.split(".").map(Number);
  const [a, b] = octets;
  return a !== 0
    && a !== 10
    && a !== 127
    && a < 224
    && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 169 && b === 254)
    && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && b === 168)
    && !(a === 192 && b === 0 && octets[2] === 2)
    && !(a === 198 && (b === 18 || b === 19))
    && !(a === 198 && b === 51 && octets[2] === 100)
    && !(a === 203 && b === 0 && octets[2] === 113);
}

export function getPublicClientIp(headers: Headers, requestIp?: unknown): string | null {
  const forwarded = String(headers.get("x-forwarded-for") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .reverse();
  const candidates = [
    // Cloudflare and Plesk/nginx populate these automatically. Keeping the
    // resolution in code avoids requiring a per-container environment flag.
    headers.get("cf-connecting-ip"),
    headers.get("true-client-ip"),
    headers.get("x-real-ip"),
    requestIp,
    // Walk from the proxy side of the chain instead of trusting the first
    // browser-supplied X-Forwarded-For value.
    ...forwarded,
  ];
  for (const value of candidates) {
    const normalized = stripAddressDecorations(String(value || ""));
    if (isPublicIpAddress(normalized)) return normalized;
  }
  return null;
}

/** Preserve the first trustworthy address, but allow a later browser request
 * to replace loopback/private placeholders written by an internal callback. */
export function resolvePersistedClientIp(
  existingIp: unknown,
  headers: Headers,
  requestIp?: unknown,
): string | null {
  const existing = stripAddressDecorations(String(existingIp || ""));
  if (isPublicIpAddress(existing)) return existing;
  return getPublicClientIp(headers, requestIp);
}
