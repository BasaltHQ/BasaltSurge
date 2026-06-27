import { ImageResponse } from 'next/og';

export const alt = 'BasaltHQ - Neuromimetic Business Architecture';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export type OGTemplateProps = {
    leftWing: React.ReactNode;
    rightWing: React.ReactNode;
    primaryColor?: string;
    // Images must be passed as Data URIs (base64) by the caller
    bgImage: string;
    blurredBgImage: string;
    medallionImage?: string;
    poweredByImage?: string; // was 'loadAsset'
    cornerShieldImage?: string;
};

/**
 * Pure template generator. 
 * Callers must load assets using og-asset-loader (Node) or other means.
 */
export async function generateBasaltOG({
    leftWing,
    rightWing,
    primaryColor = '#35ff7c',
    bgImage,
    blurredBgImage,
    medallionImage,
    poweredByImage,
    cornerShieldImage,
}: OGTemplateProps) {

    const element = (
        <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#000000',
            position: 'relative',
            fontFamily: 'Helvetica, Arial, sans-serif'
        }}>
            <img src={bgImage} width={1200} height={630} style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover',
            }} />
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)' }} />

            {/* Left Wing */}
            <div style={{
                position: 'absolute', left: 100, top: 240, width: 400, height: 160,
                borderRadius: '20px 0 0 20px', overflow: 'hidden', display: 'flex',
                flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center',
                padding: '20px 130px 20px 20px', boxShadow: 'inset 1px 1px 10px rgba(255,255,255,0.2)',
            }}>
                <img src={blurredBgImage} width={1200} height={630} style={{
                    position: 'absolute', left: -100, top: -240, width: 1200, height: 630,
                    objectFit: 'cover', transform: 'scale(1.05)',
                }} />
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
                <div style={{ position: 'absolute', inset: 0, border: '1px solid rgba(255,255,255,0.1)', borderRight: 'none', borderRadius: '20px 0 0 20px' }} />
                <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    {leftWing}
                </div>
            </div>

            {/* Right Wing */}
            <div style={{
                position: 'absolute', right: 100, top: 240, width: 400, height: 160,
                borderRadius: '0 20px 20px 0', overflow: 'hidden', display: 'flex',
                flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center',
                padding: '20px 20px 20px 130px', boxShadow: 'inset -1px 1px 10px rgba(255,255,255,0.2)',
            }}>
                <img src={blurredBgImage} width={1200} height={630} style={{
                    position: 'absolute', right: -100, top: -240, width: 1200, height: 630,
                    objectFit: 'cover', transform: 'scale(1.05)',
                }} />
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
                <div style={{ position: 'absolute', inset: 0, border: '1px solid rgba(255,255,255,0.3)', borderLeft: 'none', borderRadius: '0 20px 20px 0' }} />
                <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    {rightWing}
                </div>
            </div>

            {/* Glass Frame - Left */}
            <div style={{ position: 'absolute', left: 20, top: 40, width: 20, height: 550, display: 'flex', background: 'rgba(255,255,255,0.1)', boxShadow: 'inset 0 0 5px rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', borderTop: 'none', borderBottom: 'none', overflow: 'hidden' }}>
                <img src={blurredBgImage} width={1200} height={630} style={{ position: 'absolute', left: -20, top: -40, width: 1200, height: 630, objectFit: 'cover', transform: 'scale(1.05)' }} />
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.1)' }} />
            </div>

            {/* Glass Frame - Right */}
            <div style={{ position: 'absolute', left: 1160, top: 40, width: 20, height: 550, display: 'flex', background: 'rgba(255,255,255,0.1)', boxShadow: 'inset 0 0 5px rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', borderTop: 'none', borderBottom: 'none', overflow: 'hidden' }}>
                <img src={blurredBgImage} width={1200} height={630} style={{ position: 'absolute', left: -1160, top: -40, width: 1200, height: 630, objectFit: 'cover', transform: 'scale(1.05)' }} />
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.1)' }} />
            </div>

            {/* Glass Frame - Top */}
            <div style={{ position: 'absolute', left: 20, top: 20, width: 1160, height: 20, borderRadius: '12px 12px 0 0', display: 'flex', background: 'rgba(255,255,255,0.1)', boxShadow: 'inset 0 0 5px rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', borderBottom: 'none', overflow: 'hidden' }}>
                <img src={blurredBgImage} width={1200} height={630} style={{ position: 'absolute', left: -20, top: -20, width: 1200, height: 630, objectFit: 'cover', transform: 'scale(1.05)' }} />
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.1)' }} />
            </div>

            {/* Glass Frame - Bottom */}
            <div style={{ position: 'absolute', left: 20, top: 590, width: 1160, height: 20, borderRadius: '0 0 12px 12px', display: 'flex', background: 'rgba(255,255,255,0.1)', boxShadow: 'inset 0 0 5px rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', borderTop: 'none', overflow: 'hidden' }}>
                <img src={blurredBgImage} width={1200} height={630} style={{ position: 'absolute', left: -20, top: -590, width: 1200, height: 630, objectFit: 'cover', transform: 'scale(1.05)' }} />
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.1)' }} />
            </div>

            {/* HUD Corners */}
            <div style={{ position: 'absolute', top: 30, left: 30, width: 40, height: 40, borderTop: `4px solid ${primaryColor}`, borderLeft: `4px solid ${primaryColor}`, borderRadius: '12px 0 0 0' }} />
            <div style={{ position: 'absolute', top: 30, right: 30, width: 40, height: 40, borderTop: `4px solid ${primaryColor}`, borderRight: `4px solid ${primaryColor}`, borderRadius: '0 12px 0 0' }} />
            <div style={{ position: 'absolute', bottom: 30, left: 30, width: 40, height: 40, borderBottom: `4px solid ${primaryColor}`, borderLeft: `4px solid ${primaryColor}`, borderRadius: '0 0 0 12px' }} />
            <div style={{ position: 'absolute', bottom: 30, right: 30, width: 40, height: 40, borderBottom: `4px solid ${primaryColor}`, borderRight: `4px solid ${primaryColor}`, borderRadius: '0 0 12px 0' }} />

            {/* Center Medallion Ring (Blurred glass behind) */}
            <div style={{ position: 'absolute', left: 405, top: 120, width: 390, height: 390, borderRadius: '50%', overflow: 'hidden', display: 'flex', boxShadow: 'inset 0 0 10px rgba(255,255,255,0.3)', border: `2px solid ${primaryColor}` }}>
                <img src={blurredBgImage} width={1200} height={630} style={{ position: 'absolute', left: -405, top: -120, width: 1200, height: 630, objectFit: 'cover', transform: 'scale(1.05)' }} />
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.05)' }} />
            </div>

            {/* Center Medallion */}
            {medallionImage && (
                <div style={{ position: 'absolute', left: 425, top: 140, width: 350, height: 350, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', overflow: 'hidden' }}>
                    <img src={medallionImage} width={250} height={250} style={{
                        objectFit: 'contain',
                    }} />
                </div>
            )}

            {/* Outer glow ring around medallion */}
            <div style={{ position: 'absolute', left: 423, top: 138, width: 354, height: 354, borderRadius: '50%', border: `2px solid ${primaryColor}`, boxShadow: `0 0 20px ${primaryColor}60` }} />

            {/* Powered By Logo */}
            {poweredByImage && (
                <div style={{ position: 'absolute', top: 520, left: 0, width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.8))' }}>
                    <img src={poweredByImage} height={60} style={{ objectFit: 'contain', opacity: 1 }} />
                </div>
            )}

            {/* Corner Shield */}
            {cornerShieldImage && (
                <div style={{ position: 'absolute', top: 40, right: 40, display: 'flex' }}>
                    <img src={cornerShieldImage} width={60} height={70} style={{ objectFit: 'contain', opacity: 0.9, filter: 'drop-shadow(0 0 10px rgba(53,255,124,0.4))' }} />
                </div>
            )}
        </div>
    );

    return new ImageResponse(element, { ...size });
}
