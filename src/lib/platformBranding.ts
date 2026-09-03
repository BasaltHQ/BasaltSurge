/**
 * Platform Branding Utilities
 * 
 * Provides DOM-level replacement of platform-specific identifiers
 * (portalpay, api.pay.ledger1.ai) with dynamic brand-aware values.
 */

import { getWebhookBrandProtocol } from "@/lib/webhook-branding";

/**
 * Replace all platform-specific references in content with brand-aware values.
 * 
 * Handles:
 * - API URLs like https://api.pay.ledger1.ai/portalpay → {currentOrigin}/{brandKey}
 * - Path prefixes like /portalpay → /{brandKey}
 * - Brand names like PortalPay → {brandName}
 * 
 * @param content - The content string to process
 * @param brandKey - The brand key (e.g., 'basaltsurge', 'paynex')
 * @param brandName - The display name for the brand (e.g., 'BasaltSurge', 'Paynex')
 * @param currentOrigin - The current site origin from browser (e.g., 'https://surge.basalthq.com')
 */
export function replacePlatformReferences(
    content: string,
    brandKey: string,
    brandName: string,
    currentOrigin?: string
): string {
    if (!content) return content;

    let result = content;
    const webhookProtocol = getWebhookBrandProtocol(brandKey);
    const webhookTokens = {
        signature: '__PP_WEBHOOK_SIGNATURE_HEADER__',
        event: '__PP_WEBHOOK_EVENT_HEADER__',
        delivery: '__PP_WEBHOOK_DELIVERY_HEADER__',
        idempotency: '__PP_WEBHOOK_IDEMPOTENCY_HEADER__',
        timestamp: '__PP_WEBHOOK_TIMESTAMP_HEADER__',
        userAgent: '__PP_WEBHOOK_USER_AGENT__',
    };

    // Protect protocol identifiers from the generic display-brand replacement.
    // A display name may contain spaces and is not necessarily a valid header token.
    result = result
        .replace(/X-PortalPay-Signature/gi, webhookTokens.signature)
        .replace(/X-PortalPay-Event/gi, webhookTokens.event)
        .replace(/X-PortalPay-Delivery/gi, webhookTokens.delivery)
        .replace(/X-PortalPay-Idempotency-Key/gi, webhookTokens.idempotency)
        .replace(/X-PortalPay-Timestamp/gi, webhookTokens.timestamp)
        .replace(/PortalPay-Webhook\/1\.0/gi, webhookTokens.userAgent);

    // Determine the base URL to use - prefer currentOrigin, fall back to env
    const baseUrl = currentOrigin ||
        (typeof window !== 'undefined' ? window.location.origin : '') ||
        process.env.NEXT_PUBLIC_APP_URL ||
        '';

    // Replace full API URLs (https://api.pay.ledger1.ai/portalpay → {baseUrl})
    // Each container serves its own API directly — no /{brandKey} prefix needed
    result = result.replace(
        /https?:\/\/api\.pay\.ledger1\.ai\/portalpay/gi,
        baseUrl
    );

    // Replace pay.ledger1.ai domain references
    result = result.replace(
        /https?:\/\/pay\.ledger1\.ai/gi,
        baseUrl
    );

    // Replace remaining /portalpay path prefixes (legacy docs references)
    // /portalpay/api/... → /api/...  (each container serves routes directly)
    result = result.replace(/\/portalpay(?=\/|[^a-zA-Z0-9_-]|$)/gi, '');

    // Replace hardcoded "PortalPay" in environment variables with DYNAMIC brand name
    // e.g., PORTALPAY_SUBSCRIPTION_KEY -> BASALTSURGE_SUBSCRIPTION_KEY
    const envVarPrefix = brandName.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    result = result.replace(/PORTALPAY_SUBSCRIPTION_KEY/g, `${envVarPrefix}_SUBSCRIPTION_KEY`);

    // Replace filenames or paths like "webhooks/portalpay" -> "webhooks/{brandKey}"
    result = result.replace(/webhooks\/portalpay/g, `webhooks/${brandKey}`);

    // Replace generic "PortalPay" text references (case-sensitive for proper nouns)
    // Avoid replacing if it's part of a larger word that wasn't caught above, though "PortalPay" is usually distinct.
    result = result.replace(/PortalPay/g, brandName);

    // Aggressive replacement for remaining "portalpay" tokens (e.g. "portalpay_error", "subpath: portalpay", code vars)
    // using a regex that checks ensuring it's not part of another word like "supportalpayment".
    // EXCEPTION: Do not replace "portalpay" if it is part of known hardcoded technical constants:
    // - portalpay-card-* (DEPRECATED iframe events - use gateway-card-* instead)
    // - portalpay-preferred-height (DEPRECATED iframe events - use gateway-preferred-height instead)
    // - portalpay.git (repo links)
    // NOTE: These exceptions are kept for backwards compatibility until April 30, 2026
    result = result.replace(/(?<![a-zA-Z])portalpay(?!(?:-card-|-preferred-height|\.git)|[a-zA-Z])/gi, brandKey);

    result = result
        .replaceAll(webhookTokens.signature, `${webhookProtocol.headerPrefix}-Signature`)
        .replaceAll(webhookTokens.event, `${webhookProtocol.headerPrefix}-Event`)
        .replaceAll(webhookTokens.delivery, `${webhookProtocol.headerPrefix}-Delivery`)
        .replaceAll(webhookTokens.idempotency, `${webhookProtocol.headerPrefix}-Idempotency-Key`)
        .replaceAll(webhookTokens.timestamp, `${webhookProtocol.headerPrefix}-Timestamp`)
        .replaceAll(webhookTokens.userAgent, webhookProtocol.userAgent);

    return result;
}

/**
 * Apply platform branding to a TryIt config object.
 * Modifies baseUrl to use the current origin and brand key.
 */
export function applyBrandingToTryItConfig(
    config: any,
    brandKey: string,
    currentOrigin?: string
): any {
    if (!config) return config;

    const baseUrl = currentOrigin ||
        (typeof window !== 'undefined' ? window.location.origin : '') ||
        process.env.NEXT_PUBLIC_APP_URL ||
        '';

    const result = { ...config };

    // If the config has a baseUrl with portalpay references, replace them
    if (result.baseUrl) {
        result.baseUrl = result.baseUrl
            .replace(/https?:\/\/api\.pay\.ledger1\.ai\/portalpay/gi, baseUrl)
            .replace(/https?:\/\/pay\.ledger1\.ai/gi, baseUrl)
            .replace(/https?:\/\/api\.pay\.ledger1\.ai/gi, baseUrl)
            .replace(/\/portalpay(?=\/|$)/gi, '');
    } else {
        // Set default baseUrl to current origin (each container serves its own API)
        result.baseUrl = baseUrl;
    }

    // Strip /portalpay prefix from path (each container serves routes directly at /api/*)
    if (result.path && typeof result.path === 'string') {
        result.path = result.path.replace(/^\/portalpay(?=\/|$)/i, '') || '/';
    }

    return result;
}

/**
 * Get the dynamic API path prefix for the current brand.
 * Each container serves its own API at /api/* — no brand prefix needed.
 * @deprecated No longer used; each container serves routes directly.
 */
export function getBrandApiPrefix(brandKey: string): string {
    return '';
}
