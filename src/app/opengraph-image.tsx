import { generateBasaltOG } from '@/lib/og-template';

import { loadBasaltDefaults } from '@/lib/og-asset-loader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // Allow headers() access for multi-tenant branding
export const alt = 'Web3 Native Commerce & Payments';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
    let explicitBrandConfig = null;
    try {
        // Derive brand from hostname just like layout.tsx
        const { headers } = require('next/headers');
        const headersList = await headers();
        const host = headersList.get('x-forwarded-host') || headersList.get('host') || '';

        const { deriveContainerIdentityFromHostname } = require('@/lib/brand-config');
        const identity = await deriveContainerIdentityFromHostname(host);

        if (identity?.brandKey) {
            const { getBrandConfigFromCosmos } = require('@/lib/brand-config');
            const { brand } = await getBrandConfigFromCosmos(identity.brandKey);
            if (brand) explicitBrandConfig = brand;
        }
    } catch (e) {
        console.error('OG Image brand detection failed:', e);
    }

    const {
        bgBase64,
        blurredBgBase64,
        medallionBase64,
        shieldBase64,
        logoBase64,
        brand
    } = await loadBasaltDefaults(explicitBrandConfig); // Inject derived brand config

    const primaryColor = brand.colors.primary || '#35ff7c';
    const isBasalt = String(brand.key).toLowerCase() === 'basaltsurge';

    const titleLine1 = isBasalt ? 'THE PAYMENTS' : (brand.name || 'WEB3 NATIVE').toUpperCase();
    const titleLine2 = isBasalt ? 'REVOLUTION' : 'PAYMENTS';
    const titleLine3 = isBasalt ? 'IS HERE' : '& COMMERCE';

    const tagline1 = isBasalt ? 'x402 · UCP · USDC' : 'The future of';
    const tagline2 = isBasalt ? 'ETH · cbBTC · Base' : 'digital payments.';

    return await generateBasaltOG({
        bgImage: bgBase64,
        blurredBgImage: blurredBgBase64,
        medallionImage: medallionBase64,
        // Only show corner shield for Basalt
        cornerShieldImage: shieldBase64,
        primaryColor: primaryColor,
        // Show logo at bottom if partner, otherwise just consistent style
        poweredByImage: logoBase64,

        leftWing: (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', gap: 0 }}>
                <div style={{ display: 'flex', fontSize: 16, color: 'rgba(255,255,255,0.9)', fontWeight: 600, letterSpacing: '0.1em', marginBottom: 2 }}>{titleLine1}</div>
                <div style={{ display: 'flex', fontSize: 30, color: primaryColor, fontWeight: 800, letterSpacing: '0.05em', lineHeight: 1.1, textTransform: 'uppercase' }}>{titleLine2}</div>
                <div style={{ display: 'flex', fontSize: 16, color: 'rgba(255,255,255,0.9)', fontWeight: 600, letterSpacing: '0.1em', marginTop: 2 }}>{titleLine3}</div>
            </div>
        ),
        rightWing: (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 6 }}>
                <div style={{ display: 'flex', fontSize: 21, color: 'white', fontWeight: 700, lineHeight: 1.2 }}>
                    {tagline1}
                </div>
                <div style={{ display: 'flex', fontSize: 21, color: 'white', fontWeight: 700, lineHeight: 1.2 }}>
                    {tagline2}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                    <div style={{ display: 'flex', width: 2, height: 20, background: primaryColor }} />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', fontSize: 10, color: primaryColor, fontWeight: 700, letterSpacing: '0.15em' }}>{isBasalt ? 'AGENTIC COMMERCE' : 'POWERED BY WEB3'}</div>
                        <div style={{ display: 'flex', fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{isBasalt ? 'surge.basalthq.com' : (brand.appUrl?.replace(/^https?:\/\//, '') || 'WEB3 PAYMENTS')}</div>
                    </div>
                </div>
            </div>
        )
    });
}
