import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { join } from 'path';
import { readFile } from 'fs/promises';
import {
  createMeshGradient,
  escapeForSvg,
  wrapTextToLines,
  OG_LAYOUT,
  TEXT_SHADOWS,
} from '@/lib/og-image-utils';
import { loadPPSymbol, loadPublicImageBuffer } from '@/lib/og-asset-loader';
import { getBrandConfig } from '@/config/brands';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getDocMarkdown(slugParts: string[]) {
  const docsPath = join(/*turbopackIgnore: true*/ process.cwd(), 'docs');
  // Try direct .md path
  const directPath = join(docsPath, ...slugParts) + '.md';
  try {
    const content = await readFile(directPath, 'utf-8');
    return content;
  } catch {
    // Try README.md in directory
    try {
      const readmePath = join(docsPath, ...slugParts, 'README.md');
      const content = await readFile(readmePath, 'utf-8');
      return content;
    } catch {
      return null;
    }
  }
}

function toTitleFromSlug(slugParts: string[]) {
  if (!slugParts || slugParts.length === 0) return 'Documentation';
  const last = slugParts[slugParts.length - 1];
  return last
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function extractSummary(markdown?: string | null) {
  if (!markdown) return 'PortalPay API Documentation';
  // Heuristic: use the first non-empty line that isn't a heading marker
  const lines = markdown.split('\n');
  for (const ln of lines) {
    const trimmed = ln.trim();
    if (trimmed.length === 0) continue;
    // Skip top-level title line that starts with # and empty subsequent
    if (trimmed.startsWith('#')) continue;
    // Truncate to ~160 chars
    const summary = trimmed.replace(/\s+/g, ' ').slice(0, 160);
    return summary || 'PortalPay API Documentation';
  }
  return 'PortalPay API Documentation';
}

/**
 * Docs OG image generator (generative per page slug)
 * Visual style: mesh gradient background, top-right logo, left hero title + subtitle.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug?: string[] }> }
) {
  const brand = getBrandConfig();
  try {
    const { slug: slugParam } = await params;
    const slugParts = slugParam || [];

    const title = toTitleFromSlug(slugParts);
    const markdown = await getDocMarkdown(slugParts);
    let summary = extractSummary(markdown);
    if (!summary || summary === 'PortalPay API Documentation') {
      summary = `${brand.name} API Documentation`;
    }

    // Mesh gradient background (palette aligned with developers)
    const colors = ['#0b1f3f', '#06b6d4', '#8b5cf6'];
    const backgroundSvg = createMeshGradient(colors);
    let imageBuffer = await sharp(Buffer.from(backgroundSvg)).resize(1200, 630).png().toBuffer();

    // Watermark overlay (subtle texture)
    const watermarkBuf = await loadPublicImageBuffer('watermark.png');
    if (watermarkBuf) {
      imageBuffer = await sharp(imageBuffer)
        .composite([{ input: watermarkBuf, top: 0, left: 0 }])
        .png()
        .toBuffer();
    }

    // PortalPay symbol (top-right)
    const ppSymbolOverlay: Buffer | null = await loadPPSymbol(OG_LAYOUT.ppSymbol.size);

    // Left pane copy
    const eyebrowText = `${String(brand.name || '').toUpperCase()} DOCS`;
    const heroText = title;
    const subtitleText = summary;
    const leftX = 64;
    const maxTextWidth = 720; // docs usually need wider text block

    const titleFontSize = 76;
    const titleLines = wrapTextToLines(heroText, maxTextWidth, titleFontSize, 2);
    const descFontSize = 24;
    const descLines = wrapTextToLines(subtitleText, maxTextWidth, descFontSize, 3);

    const titleStartY = 270;
    const descStartY = titleStartY + (titleLines.length - 1) * 70 + 110;

    const titleLinesSvg = titleLines
      .map(
        (ln, idx) =>
          `<text x="${leftX}" y="${titleStartY + idx * 70}" font-family="Arial, sans-serif" font-size="${titleFontSize}" font-weight="900" fill="#FFFFFF" style="text-shadow: 3px 3px 12px rgba(0,0,0,0.55);">${escapeForSvg(
            ln
          )}</text>`
      )
      .join('\n');

    const descLinesSvg = descLines
      .map(
        (ln, idx) =>
          `<text x="${leftX}" y="${descStartY + idx * 30}" font-family="Arial, sans-serif" font-size="${descFontSize}" fill="rgba(255,255,255,0.92)" style="text-shadow: ${TEXT_SHADOWS.desc};">${escapeForSvg(
            ln
          )}</text>`
      )
      .join('\n');

    const textSvg = `
      <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        <!-- Eyebrow -->
        <text x="${leftX}" y="190" font-family="Arial, sans-serif" font-size="18" font-weight="800" fill="rgba(255,255,255,0.88)" letter-spacing="1.2">
          ${escapeForSvg(eyebrowText)}
        </text>

        <!-- Title -->
        ${titleLinesSvg}

        <!-- Summary -->
        ${descLinesSvg}

        <!-- Bottom branding -->
        <text x="${leftX}" y="${OG_LAYOUT.brandingY}" font-family="Arial, sans-serif" font-size="12" font-weight="600" fill="rgba(255,255,255,0.88)" letter-spacing="1.5">
          ${escapeForSvg(`POWERED BY ${String(brand.name || '').toUpperCase()}`)}
        </text>
      </svg>
    `;

    const composites: any[] = [{ input: Buffer.from(textSvg), top: 0, left: 0 }];

    if (ppSymbolOverlay) {
      composites.push({ input: ppSymbolOverlay, top: OG_LAYOUT.ppSymbol.y, left: OG_LAYOUT.ppSymbol.x });
    }

    const finalJpeg = await sharp(imageBuffer).composite(composites).jpeg({ quality: 90 }).toBuffer();

    return new NextResponse(new Uint8Array(finalJpeg), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    });
  } catch (error) {
    console.error('OG image generation error (docs):', error);
    const fallbackSvg = `
      <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#0b1f3f;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#06b6d4;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="1200" height="630" fill="url(#grad)" />
        <text x="600" y="320" font-family="Arial, sans-serif" font-size="56" font-weight="bold" fill="white" text-anchor="middle">
          ${escapeForSvg(`${brand.name} Docs`)}
        </text>
        <text x="600" y="380" font-family="Arial, sans-serif" font-size="24" fill="rgba(255,255,255,0.9)" text-anchor="middle">
          API Reference, Guides & Examples
        </text>
      </svg>
    `;
    const fb = await sharp(Buffer.from(fallbackSvg)).resize(1200, 630).jpeg({ quality: 85 }).toBuffer();
    return new NextResponse(new Uint8Array(fb), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    });
  }
}
