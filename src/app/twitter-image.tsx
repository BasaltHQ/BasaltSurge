import { generateBasaltOG } from '@/lib/og-template';
import { loadBasaltDefaults } from '@/lib/og-asset-loader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // Allow headers() access for multi-tenant branding
export const alt = 'Web3 Native Commerce & Payments';
export const size = { width: 2400, height: 1260 };
export const contentType = 'image/png';

export default async function Image() {
    let explicitBrandConfig = null;
    try {
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
        console.error('Twitter Image brand detection failed:', e);
    }

    const {
        bgBase64,
        blurredBgBase64,
        medallionBase64,
        shieldBase64,
        logoBase64,
        brand
    } = await loadBasaltDefaults(explicitBrandConfig);

    const primaryColor = brand.colors.primary || '#35ff7c';
    const isBasalt = String(brand.key).toLowerCase() === 'basaltsurge';

    // Condensed for Twitter
    const titleLine1 = isBasalt ? 'WEB3 NATIVE' : (brand.name || 'WEB3').toUpperCase();
    const titleLine2 = isBasalt ? 'ECOMMERCE' : 'PAYMENTS';
    const titleLine3 = isBasalt ? '& PAYMENTS' : '';

    return await generateBasaltOG({
        bgImage: bgBase64,
        blurredBgImage: blurredBgBase64,
        medallionImage: medallionBase64,
        cornerShieldImage: shieldBase64,
        primaryColor: primaryColor,
        poweredByImage: logoBase64,

        leftWing: (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0 }}>
                <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.9)', fontWeight: 600, letterSpacing: '0.1em', marginBottom: 2 }}>{titleLine1}</div>
                <div style={{ fontSize: 30, color: primaryColor, fontWeight: 800, letterSpacing: '0.05em', lineHeight: 1.1, textTransform: 'uppercase' }}>{titleLine2}</div>
                {titleLine3 && <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.9)', fontWeight: 600, letterSpacing: '0.1em', marginTop: 2 }}>{titleLine3}</div>}
            </div>
        ),
        rightWing: (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                <div style={{ fontSize: 21, color: 'white', fontWeight: 700, lineHeight: 1.2 }}>
                    {isBasalt ? 'Forging the future' : 'The future of'}
                </div>
                <div style={{ fontSize: 21, color: 'white', fontWeight: 700, lineHeight: 1.2 }}>
                    {isBasalt ? 'of payments.' : 'digital commerce.'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                    <div style={{ width: 2, height: 20, background: primaryColor }} />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: 10, color: primaryColor, fontWeight: 700, letterSpacing: '0.15em' }}>{isBasalt ? 'BASALTSURGE' : 'POWERED BY'}</div>
                    </div>
                </div>
            </div>
        )
    });
}
