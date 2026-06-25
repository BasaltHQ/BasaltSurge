import { readFile } from 'fs/promises';
import { join } from 'path';
import { notFound, redirect } from 'next/navigation';
import { DocsSidebar } from '@/components/docs/docs-sidebar';
import { DocsTOC } from '@/components/docs/docs-toc';
import { MarkdownRenderer } from '@/components/docs/markdown-renderer';
import { getAdjacentPages } from '@/components/docs/docs-nav';
import Image from 'next/image';
import { ArrowLeft, ArrowRight, Github, BookOpen, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';
import LoginGateLink from '@/components/login-gate-link';
import { getBaseUrl } from '@/lib/base-url';
import { getBrandConfig } from '@/config/brands';
import { isPartnerContext } from '@/lib/env';
import { resolveBrandAppLogo, getDefaultBrandName, normalizeBrandName } from "@/lib/branding";
import { dePortalContent } from "@/lib/brand-content";
import { DocsSidebarProvider } from "@/contexts/DocsSidebarContext";
import { DocsContentWrapper } from "@/components/docs/docs-content-wrapper";
import { CopyForLlmButton } from '@/components/docs/copy-for-llm-button';

export async function generateStaticParams() {
  return [
    { slug: [] },
    { slug: ['auth'] },
    { slug: ['quickstart'] },
    { slug: ['concepts'] },
    { slug: ['errors'] },
    { slug: ['limits'] },
    { slug: ['changelog'] },
    { slug: ['api'] },
    { slug: ['api', 'split'] },
    { slug: ['api', 'inventory'] },
    { slug: ['api', 'orders'] },
    { slug: ['api', 'receipts'] },
    { slug: ['api', 'subscriptions'] },
    { slug: ['api', 'shop'] },
    { slug: ['examples'] },
    { slug: ['guides', 'ecommerce'] },
    { slug: ['guides', 'payment-gateway'] },
    { slug: ['guides', 'pos'] },
    { slug: ['guides', 'shopify'] },
    { slug: ['guides', 'agent-integration'] },
    { slug: ['merchant'] },
    { slug: ['merchant', 'shop-setup'] },
    { slug: ['merchant', 'reserve-management'] },
    { slug: ['merchant', 'tax-management'] },
    { slug: ['merchant', 'terminal-use'] },
    { slug: ['merchant', 'portal-receipts'] },
    { slug: ['merchant', 'industry-packs'] },
    { slug: ['partner'] },
    { slug: ['partner', 'branding-whitelabel'] },
    { slug: ['partner', 'merchant-management'] },
    { slug: ['partner', 'touchpoints-devices'] },
    { slug: ['partner', 'split-config'] },
    { slug: ['partner', 'plugins-modules'] },
  ];
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }) {
  // Resolve partner brand key from container and hydrate with live Platform Admin config
  const siteBase = getBaseUrl();
  let runtimeBrand = getBrandConfig();
  try {
    const ciRes = await fetch(`${siteBase}/api/site/container`, { cache: "no-store" });
    const ci = await ciRes.json().catch(() => ({} as any));
    const key = String(ci?.brandKey || runtimeBrand?.key || "").toLowerCase();
    runtimeBrand = getBrandConfig(key);
    const pbRes = await fetch(`${siteBase}/api/platform/brands/${encodeURIComponent(key || runtimeBrand.key)}/config`, { cache: "no-store" });
    const pb = await pbRes.json().catch(() => ({} as any));
    const b = pb?.brand || null;
    const ov = pb?.overrides || null;
    const nameOv = (typeof ov?.name === "string" && ov.name) || (typeof b?.name === "string" && b.name) || runtimeBrand.name;
    // Sanitize generic placeholders like "ledger1", "partner1", "default" in partner containers
    const isGeneric = /^ledger\d*$/i.test(nameOv) || /^partner\d*$/i.test(nameOv) || /^default$/i.test(nameOv);
    runtimeBrand = {
      ...runtimeBrand,
      name: isGeneric ? (runtimeBrand.name || "Docs") : nameOv,
      colors: (b?.colors && typeof b.colors === "object") ? b.colors : runtimeBrand.colors,
      logos: (b?.logos && typeof b.logos === "object") ? { ...runtimeBrand.logos, ...b.logos } : runtimeBrand.logos,
      appUrl: (typeof b?.appUrl === "string" && b.appUrl) ? b.appUrl : runtimeBrand.appUrl,
      meta: (b?.meta && typeof b.meta === "object") ? b.meta : runtimeBrand.meta,
    };
  } catch { }
  const { slug: slugParam } = await params;
  const slug = slugParam || [];
  const title = slug.length > 0
    ? slug[slug.length - 1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : 'Introduction';

  const baseUrl = getBaseUrl();
  const path = slug.length > 0 ? `/developers/docs/${slug.join('/')}` : '/developers/docs';
  const url = `${baseUrl}${path}`;
  const ogSuffix = slug.length > 0 ? `/${slug.join('/')}` : '';
  const ogImage = `${baseUrl}/api/og-image/docs${ogSuffix}`;
  const twitterImage = `${baseUrl}/api/og-image/docs${ogSuffix}`;

  const metaBrandKey = String((runtimeBrand as any)?.key || "").trim();
  const nm = String(runtimeBrand?.name || "").trim();
  const metaGeneric = /^ledger\d*$/i.test(nm) || /^partner\d*$/i.test(nm) || /^default$/i.test(nm);
  // Use normalizeBrandName for proper capitalization (e.g., "BasaltSurge" not "Basaltsurge")
  const displayNameMeta = (!nm || metaGeneric) ? normalizeBrandName(nm, metaBrandKey) : normalizeBrandName(nm, metaBrandKey);

  return {
    title: `${title} | ${displayNameMeta} Docs`,
    description: `${displayNameMeta} API Documentation`,
    openGraph: {
      title: `${title} | ${displayNameMeta} Docs`,
      description: `${displayNameMeta} API Documentation`,
      url,
      siteName: displayNameMeta,
      images: [{ url: ogImage, width: 1200, height: 630, alt: `${title} | ${displayNameMeta} Docs` }],
      type: 'article'
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ${displayNameMeta} Docs`,
      description: `${displayNameMeta} API Documentation`,
      images: [twitterImage]
    }
  };
}

async function getMarkdownContent(slug: string[]) {
  // Some deployment environments change the working directory; search multiple candidate roots.
  const candidateRoots = [
    join(process.cwd(), 'docs'),
    join(process.cwd(), '..', 'docs'),
    join(process.cwd(), '..', '..', 'docs'),
    join(process.cwd(), 'site', 'docs'),
    join(process.cwd(), 'wwwroot', 'docs'),
  ];

  const tryPaths = (root: string) => {
    if (slug.length === 0) {
      return [join(root, 'README.md')];
    }
    // Try direct file first, then README.md inside directory
    return [join(root, ...slug) + '.md', join(root, ...slug, 'README.md')];
  };

  // Special-case: ensure /developers/docs/api resolves to docs/api/README.md if direct file missing
  const ensureApiIndexFirst = (paths: string[]) => {
    if (slug.length === 1 && slug[0] === 'api') {
      const apiReadme = paths.find((p) => /docs[\/\\]api[\/\\]README\.md$/i.test(p));
      if (apiReadme) {
        // Place README.md first
        const rest = paths.filter((p) => p !== apiReadme);
        return [apiReadme, ...rest];
      }
    }
    return paths;
  };

  for (const root of candidateRoots) {
    const paths = ensureApiIndexFirst(tryPaths(root));
    for (const p of paths) {
      try {
        const content = await readFile(p, 'utf-8');
        if (typeof content === 'string' && content.length > 0) {
          return content;
        }
      } catch {
        // continue
      }
    }
  }

  return null;
}

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  // Resolve partner brand key from container and hydrate with live Platform Admin config
  const baseUrl = getBaseUrl();
  let brand = getBrandConfig();
  try {
    const ciRes = await fetch(`/api/site/container`, { cache: "no-store" });
    const ci = await ciRes.json().catch(() => ({} as any));
    const key = String(ci?.brandKey || brand?.key || "").toLowerCase();
    brand = getBrandConfig(key);
    const pbRes = await fetch(`/api/platform/brands/${encodeURIComponent(key || brand.key)}/config`, { cache: "no-store" });
    const pb = await pbRes.json().catch(() => ({} as any));
    const b = pb?.brand || null;
    const ov = pb?.overrides || null;
    const nameOv = (typeof ov?.name === "string" && ov.name) || (typeof b?.name === "string" && b.name) || brand.name;
    const isGeneric = /^ledger\d*$/i.test(nameOv) || /^partner\d*$/i.test(nameOv) || /^default$/i.test(nameOv);
    brand = {
      ...brand,
      name: isGeneric ? (brand.name || "Docs") : nameOv,
      colors: (b?.colors && typeof b.colors === "object") ? b.colors : brand.colors,
      logos: (b?.logos && typeof b.logos === "object") ? { ...brand.logos, ...b.logos } : brand.logos,
      appUrl: (typeof b?.appUrl === "string" && b.appUrl) ? b.appUrl : brand.appUrl,
      meta: (b?.meta && typeof b.meta === "object") ? b.meta : brand.meta,
    };
  } catch { }
  const { slug: slugParam } = await params;
  const slug = slugParam || [];

  // Render Introduction at /developers/docs (docs/README.md)
  // No redirect; default route serves docs/README.md

  const content = await getMarkdownContent(slug);

  if (!content) {
    notFound();
  }
  let processedContent: string = content;
  try {
    // Always apply platform branding to replace hardcoded portalpay/PortalPay references
    // with the current brand (basaltsurge for platform, partner brand for partner containers)
    const { replacePlatformReferences } = await import('@/lib/platformBranding');
    const appUrl = brand.appUrl || getBaseUrl();
    const brandKey = brand.key || 'basaltsurge';
    processedContent = replacePlatformReferences(processedContent, brandKey, brand.name || 'BasaltSurge', appUrl);
  } catch { }

  const currentPath = slug.length === 0 ? '/developers/docs' : `/developers/docs/${slug.join('/')}`;
  const pageTitle = slug.length > 0
    ? slug[slug.length - 1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : 'Introduction';

  // Get previous and next pages for navigation
  const { prev, next } = getAdjacentPages(currentPath);

  // Sanitize generic placeholder brand names in docs header/footer (e.g., "ledger1", "partner1", "default")
  const rawName = String(brand?.name || "").trim();
  const isGenericName = /^ledger\d*$/i.test(rawName) || /^partner\d*$/i.test(rawName) || /^default$/i.test(rawName);
  const keyForDisplay = String((brand as any)?.key || "").trim();
  // Use normalizeBrandName for proper capitalization (e.g., "BasaltSurge" not "Basaltsurge")
  const displayBrandName = (!rawName || isGenericName) ? normalizeBrandName(rawName, keyForDisplay) : normalizeBrandName(rawName, keyForDisplay);

  return (
    <div className="min-h-screen bg-background">
      {/* Header with Documentation | Dashboard tabs */}
      <header className="fixed top-[112px] left-0 right-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center">
              <Image
                src={resolveBrandAppLogo(brand?.logos?.app, brand?.key || "portalpay") || "/bssymbol.png"}
                alt={displayBrandName}
                width={160}
                height={40}
                className="object-contain h-10 w-auto max-w-[200px]"
              />
            </Link>
            <div className="h-6 w-px bg-border ml-4" />
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/developers/docs"
                className="px-3 py-2 rounded-md bg-foreground text-background transition-colors flex items-center gap-2"
              >
                <BookOpen className="w-4 h-4" />
                <span>Documentation</span>
              </Link>
              <span className="mx-1 text-muted-foreground">|</span>
              <LoginGateLink
                href="/developers/dashboard"
                className="px-3 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-2"
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>Dashboard</span>
              </LoginGateLink>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/GenRevo89/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors hidden md:inline-flex"
            >
              <Github className="w-5 h-5" />
            </a>
          </div>
        </div>
      </header>

      <DocsSidebarProvider>
        {/* Sidebar */}
        <DocsSidebar currentPath={currentPath} />

        {/* Main Content - centered with equal sidebar spacing */}
        <DocsContentWrapper>
          {/* Breadcrumb */}
          {slug.length > 0 && (
            <nav className="mb-8 flex items-center gap-2 text-sm text-muted-foreground">
              <Link href="/developers/docs" className="hover:text-foreground transition-colors">
                Docs
              </Link>
              {slug.map((part, index) => (
                <span key={index} className="flex items-center gap-2">
                  <span>/</span>
                  {index === slug.length - 1 ? (
                    <span className="text-foreground font-medium">
                      {part.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                    </span>
                  ) : (
                    <Link
                      href={`/developers/docs/${slug.slice(0, index + 1).join('/')}`}
                      className="hover:text-foreground transition-colors"
                    >
                      {part.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
          )}

          {/* Page Title */}
          <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-4">
            <div>
              <h1 className="text-4xl font-bold mb-2">{pageTitle}</h1>
            </div>
            <div className="shrink-0">
              <CopyForLlmButton content={processedContent} pageTitle={pageTitle} />
            </div>
          </div>

          {/* Content */}
          <article className="max-w-none">
            <MarkdownRenderer content={processedContent} />
          </article>

          {/* Page Navigation */}
          {(prev || next) && (
            <nav className="mt-12 pt-8 border-t border-border flex items-center justify-between gap-4">
              <div className="flex-1">
                {prev ? (
                  <Link
                    href={prev.href}
                    className="group flex items-center gap-3 p-4 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-all"
                  >
                    <ArrowLeft className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    <div className="flex flex-col items-start">
                      <span className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Previous</span>
                      <span className="font-medium group-hover:text-primary transition-colors">{prev.title}</span>
                    </div>
                  </Link>
                ) : (
                  <div className="p-4 rounded-lg border border-transparent"></div>
                )}
              </div>
              <div className="flex-1">
                {next ? (
                  <Link
                    href={next.href}
                    className="group flex items-center gap-3 p-4 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-all justify-end text-right"
                  >
                    <div className="flex flex-col items-end">
                      <span className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Next</span>
                      <span className="font-medium group-hover:text-primary transition-colors">{next.title}</span>
                    </div>
                    <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </Link>
                ) : (
                  <div className="p-4 rounded-lg border border-transparent"></div>
                )}
              </div>
            </nav>
          )}

          {/* Footer */}
          <footer className="mt-16 pt-8 border-t border-border">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Image src={brand.logos?.symbol || brand.logos?.app || "/ppsymbol.png"} alt={displayBrandName} width={20} height={20} />
                <span>© {new Date().getFullYear()} {displayBrandName}. All rights reserved.</span>
              </div>
              <div className="flex items-center gap-4">
                <a
                  href="https://github.com/GenRevo89/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  GitHub
                </a>
                <LoginGateLink href="/developers/dashboard" className="hover:text-foreground transition-colors">
                  API Dashboard
                </LoginGateLink>
              </div>
            </div>
          </footer>
        </DocsContentWrapper>
      </DocsSidebarProvider>

      {/* Table of Contents */}
      <DocsTOC />
    </div>
  );
}
