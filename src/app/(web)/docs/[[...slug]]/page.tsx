import { readFile } from 'fs/promises';
import { join } from 'path';
import { notFound } from 'next/navigation';
import { DocsSidebar } from '@/components/docs/docs-sidebar';
import { DocsTOC } from '@/components/docs/docs-toc';
import { MarkdownRenderer } from '@/components/docs/markdown-renderer';
import Image from 'next/image';
import { ArrowLeft, Github, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { getBaseUrl } from '@/lib/base-url';
import { getBrandConfig } from '@/config/brands';
import { CopyForLlmButton } from '@/components/docs/copy-for-llm-button';

// Force dynamic rendering to apply brand-specific replacements at runtime
export const dynamic = 'force-dynamic';

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
  const brand = getBrandConfig();
  const { slug: slugParam } = await params;
  const slug = slugParam || [];
  const title = slug.length > 0
    ? slug[slug.length - 1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : 'Documentation';

  const baseUrl = getBaseUrl();
  const path = slug.length > 0 ? `/docs/${slug.join('/')}` : '/docs';
  const url = `${baseUrl}${path}`;
  const ogSuffix = slug.length > 0 ? `/${slug.join('/')}` : '';
  const ogImage = `${baseUrl}/api/og-image/docs${ogSuffix}`;
  const twitterImage = `${baseUrl}/api/og-image/docs${ogSuffix}`;

  return {
    title: `${title} | ${brand.name} Docs`,
    description: `${brand.name} API Documentation`,
    openGraph: {
      title: `${title} | ${brand.name} Docs`,
      description: `${brand.name} API Documentation`,
      url,
      siteName: brand.name,
      images: [{ url: ogImage, width: 1200, height: 630, alt: `${title} | ${brand.name} Docs` }],
      type: 'article'
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ${brand.name} Docs`,
      description: `${brand.name} API Documentation`,
      images: [twitterImage]
    }
  };
}

async function getMarkdownContent(slug: string[]) {
  const docsPath = join(/*turbopackIgnore: true*/ process.cwd(), 'docs');

  let filePath: string;
  if (slug.length === 0) {
    filePath = join(docsPath, 'README.md');
  } else {
    // Try direct .md file first
    filePath = join(docsPath, ...slug) + '.md';
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    return content;
  } catch {
    // If direct .md file doesn't exist, try README.md in directory
    if (slug.length > 0) {
      try {
        const readmePath = join(docsPath, ...slug, 'README.md');
        const content = await readFile(readmePath, 'utf-8');
        return content;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const brand = getBrandConfig();
  const { slug: slugParam } = await params;
  const slug = slugParam || [];
  const content = await getMarkdownContent(slug);
  if (!content) {
    notFound();
  }
  let processedContent: string = content;
  try {
    // Apply platform branding universally - replace all hardcoded portalpay references
    // with dynamic brand key and URLs based on the current brand config
    const { replacePlatformReferences } = await import('@/lib/platformBranding');
    const appUrl = brand.appUrl || process.env.NEXT_PUBLIC_APP_URL || '';
    const brandKey = brand.key || 'basaltsurge';
    console.log('[docs] Replacing with brandKey:', brandKey, 'appUrl:', appUrl);
    console.log('[docs] Content before (sample):', content.substring(0, 200));
    processedContent = replacePlatformReferences(processedContent, brandKey, brand.name, appUrl);
    console.log('[docs] Content after (sample):', processedContent.substring(0, 200));
  } catch (e) {
    console.error('[docs] Error applying brand replacement:', e);
  }

  const currentPath = slug.length === 0 ? '/docs' : `/docs/${slug.join('/')}`;
  const pageTitle = slug.length > 0
    ? slug[slug.length - 1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : 'Documentation';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="fixed top-[84px] left-0 right-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <Image src={brand.logos?.symbol || brand.logos?.app || "/ppsymbol.png"} alt={brand.name} width={32} height={32} />
              <span className="font-bold text-lg">{brand.name}</span>
            </Link>
            <div className="h-6 w-px bg-border" />
            <div className="flex items-center gap-2 text-muted-foreground">
              <BookOpen className="w-4 h-4" />
              <span className="text-sm font-medium">Documentation</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="https://apim-portalpay-prod.developer.azure-api.net"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium"
            >
              Get API Keys
            </Link>
            <Link
              href="/developers"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden md:inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Developers</span>
            </Link>
          </div>
          <a
            href="https://github.com/GenRevo89/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors hidden md:inline-flex"
          >
            <Github className="w-5 h-5" />
          </a>
        </div>
      </header>

      {/* Sidebar */}
      <DocsSidebar currentPath={currentPath} />

      {/* Main Content - centered with equal sidebar spacing */}
      <main className="pt-[204px] md:pt-[148px] transition-all duration-300">
        <div className="mx-auto max-w-7xl px-4 md:px-8 py-12 md:pl-64 xl:pr-64">
          {/* Breadcrumb */}
          {slug.length > 0 && (
            <nav className="mb-8 flex items-center gap-2 text-sm text-muted-foreground">
              <Link href="/docs" className="hover:text-foreground transition-colors">
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
                      href={`/docs/${slug.slice(0, index + 1).join('/')}`}
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

          {/* Footer */}
          <footer className="mt-16 pt-8 border-t border-border">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Image src={brand.logos?.symbol || brand.logos?.app || "/ppsymbol.png"} alt={brand.name} width={20} height={20} />
                <span>© {new Date().getFullYear()} {brand.name}. All rights reserved.</span>
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
                <Link href="/developers" className="hover:text-foreground transition-colors">
                  API Dashboard
                </Link>
              </div>
            </div>
          </footer>
        </div>
      </main>

      {/* Table of Contents */}
      <DocsTOC />
    </div>
  );
}
