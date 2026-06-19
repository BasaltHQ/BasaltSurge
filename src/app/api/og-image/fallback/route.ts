import { NextRequest } from 'next/server';
import { ImageResponse } from 'next/og';
import React from 'react';
import { getBrandConfig } from '@/config/brands';

export const runtime = 'nodejs';
export const alt = 'Social Image';
export const contentType = 'image/png';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return { r, g, b };
}
function rgba(hex: string, a = 1): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
function buildMeshSvg(colors: string[], width = 1200, height = 630): string {
  const [c1, c2, c3] = colors.length >= 3 ? colors : [...colors, ...colors, colors[0]];
  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="grad1" cx="20%" cy="30%" r="50%">
          <stop offset="0%" style="stop-color:${c1};stop-opacity:0.9" />
          <stop offset="100%" style="stop-color:${c1};stop-opacity:0" />
        </radialGradient>
        <radialGradient id="grad2" cx="80%" cy="70%" r="50%">
          <stop offset="0%" style="stop-color:${c2};stop-opacity:0.85" />
          <stop offset="100%" style="stop-color:${c2};stop-opacity:0" />
        </radialGradient>
        <radialGradient id="grad3" cx="50%" cy="50%" r="60%">
          <stop offset="0%" style="stop-color:${c3};stop-opacity:0.7" />
          <stop offset="100%" style="stop-color:${c3};stop-opacity:0" />
        </radialGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#grad1)" />
      <rect width="${width}" height="${height}" fill="url(#grad2)" />
      <rect width="${width}" height="${height}" fill="url(#grad3)" />
    </svg>
  `;
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const titleParam = searchParams.get('title') || '';
  const brandParam = searchParams.get('brand') || '';
  const descParam = searchParams.get('desc') || '';

  // Retrieve host identity dynamically
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const { deriveContainerIdentityFromHostname, getBrandConfigFromCosmos } = require('@/lib/brand-config');

  let brand = getBrandConfig(); // static fallback
  try {
    const identity = await deriveContainerIdentityFromHostname(host);
    if (identity?.brandKey) {
      const { brand: dbBrand } = await getBrandConfigFromCosmos(identity.brandKey);
      if (dbBrand) brand = dbBrand;
    }
  } catch (e) {
    console.error('Fallback OG image brand detection failed:', e);
  }

  const primary = (brand?.colors?.primary as string) || '#0ea5e9';
  const accent = (brand?.colors?.accent as string) || '#3b82f6';
  const symbolPath = (brand?.logos?.symbol || brand?.logos?.app || '/ppsymbol.png') as string;
  const symbolUrl = /^https?:\/\//i.test(symbolPath) ? symbolPath : `${origin}${symbolPath}`;

  const width = 1200;
  const height = 630;

  // Mesh background as SVG image
  const meshSvg = buildMeshSvg([rgba(primary, 1), rgba(accent, 0.9), rgba(primary, 0.7)], width, height);
  const meshUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(meshSvg)}`;

  const title = (titleParam || brandParam || brand?.name || '').trim();
  const subtitle = (descParam || 'Modern crypto commerce: payments • receipts • analytics').trim();
  const showSubtitle = subtitle.length > 0 && subtitle.toLowerCase() !== title.toLowerCase();

  // Design constants
  const fg = '#ffffff';
  const titleStyle: React.CSSProperties = {
    fontSize: 68,
    fontWeight: 900,
    letterSpacing: -0.5,
    textShadow: '2px 2px 12px rgba(0,0,0,0.45)',
    lineHeight: 1.12,
  };
  const subtitleStyle: React.CSSProperties = {
    marginTop: 14,
    fontSize: 26,
    fontWeight: 500,
    opacity: 0.95,
    textShadow: '1px 1px 8px rgba(0,0,0,0.35)',
  };

  const root = React.createElement(
    'div',
    {
      style: {
        width: `${width}px`,
        height: `${height}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '80px',
        background: `linear-gradient(135deg, ${rgba(primary, 0.18)} 0%, ${rgba(primary, 0.95)} 100%)`,
        color: fg,
        position: 'relative',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
      } as React.CSSProperties,
    },
    [
      // Mesh layer
      React.createElement('img', {
        key: 'mesh',
        src: meshUrl,
        width,
        height,
        style: { position: 'absolute', inset: 0, objectFit: 'cover', opacity: 1 } as React.CSSProperties,
      } as any),
      // Subtle diagonal grain overlay
      React.createElement('div', {
        key: 'grain',
        style: {
          position: 'absolute',
          inset: 0,
          background:
            `linear-gradient(135deg, ${rgba('#000000', 0.08)} 0%, transparent 100%)`,
          mixBlendMode: 'overlay',
        } as React.CSSProperties,
      }),
      // Watermark (brand symbol) oversized and faint
      React.createElement('img', {
        key: 'wm',
        src: symbolUrl,
        width: 820,
        height: 820,
        style: {
          position: 'absolute',
          top: -160,
          left: 140,
          opacity: 0.06,
          filter: 'drop-shadow(0 8px 32px rgba(0,0,0,0.25))',
          objectFit: 'contain',
        } as React.CSSProperties,
      } as any),
      // Corner brand symbol
      React.createElement('img', {
        key: 'sym',
        src: symbolUrl,
        width: 96,
        height: 96,
        style: { position: 'absolute', top: 40, right: 40, objectFit: 'contain', filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.35))' } as React.CSSProperties,
      } as any),
      // Title block
      React.createElement(
        'div',
        { key: 'title', style: titleStyle },
        title
      ),
      // Subtitle (only if different)
      showSubtitle
        ? React.createElement('div', { key: 'subtitle', style: subtitleStyle }, subtitle)
        : null,
    ]
  );

  return new ImageResponse(root as any, { width, height });
}
