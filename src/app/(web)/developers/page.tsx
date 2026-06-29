import Link from 'next/link';
import { Code, BookOpen, Zap, Shield, Wallet, GitBranch } from 'lucide-react';
import type { Metadata } from 'next';
import { getBrandConfig } from '@/config/brands';
import { getBaseUrl } from '@/lib/base-url';

export async function generateMetadata(): Promise<Metadata> {
  const brand = getBrandConfig();
  const baseUrl = getBaseUrl();
  // Sanitize brand display: if name is missing or generic, titleize the brand key
  const rawName = String(brand.name || "").trim();
  const isGeneric = /^ledger\d*$/i.test(rawName) || /^partner\d*$/i.test(rawName) || /^default$/i.test(rawName);
  const titleizedKey = (() => { const k = String(brand.key || "").trim(); return k ? k.charAt(0).toUpperCase() + k.slice(1) : "PortalPay"; })();
  const displayName = (!rawName || isGeneric) ? titleizedKey : rawName;

  const pageTitle = `Developers | ${displayName} API Documentation`;
  const pageDescription = `Build with ${displayName}'s trustless, permissionless payment infrastructure. Complete API reference, guides, and code examples.`;
  const pageUrl = `${baseUrl}/developers`;
  const ogImageUrl = `${baseUrl}/api/og-image/developers`;
  const twitterImageUrl = ogImageUrl;

  return {
    title: pageTitle,
    description: pageDescription,
    openGraph: {
      title: pageTitle,
      description: pageDescription,
      url: pageUrl,
      siteName: displayName,
      type: 'website',
      images: [
        {
          url: ogImageUrl,
          secureUrl: ogImageUrl, // Explicit HTTPS for iOS Messages, WhatsApp, etc.
          width: 1200,
          height: 630,
          alt: `${displayName} Developers`,
          type: 'image/jpeg',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: pageTitle,
      description: pageDescription,
      images: [
        {
          url: twitterImageUrl,
          alt: `${displayName} Developers`,
        },
      ],
    },
    alternates: {
      canonical: pageUrl,
    },
  };
}

export default function DevelopersPage() {
  const brand = getBrandConfig();
  const rawName = String(brand.name || "").trim();
  const isGeneric = /^ledger\d*$/i.test(rawName) || /^partner\d*$/i.test(rawName) || /^default$/i.test(rawName);
  const titleizedKey = (() => { const k = String(brand.key || "").trim(); return k ? k.charAt(0).toUpperCase() + k.slice(1) : "PortalPay"; })();
  const displayBrandName = (!rawName || isGeneric) ? titleizedKey : rawName;
  const baseUrl = getBaseUrl();

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="border-b bg-gradient-to-b from-background to-background/50">
        <div className="max-w-5xl mx-auto px-4 py-16 md:py-24">
          <div className="text-center max-w-3xl mx-auto">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              Build with {displayBrandName}
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-8">
              Trustless, permissionless payment infrastructure for accepting cryptocurrency payments with automatic payment splitting.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/developers/docs/quickstart"
                className="px-6 py-3 bg-foreground text-background rounded-md hover:opacity-90 transition-opacity font-medium"
              >
                Quick Start Guide
              </Link>
              <Link
                href="/developers/docs/api"
                className="px-6 py-3 border rounded-md hover:bg-foreground/5 transition-colors font-medium"
              >
                API Reference
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Key Features */}
      <section className="border-b">
        <div className="max-w-5xl mx-auto px-4 py-16">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">
            Why Build with {displayBrandName}?
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="glass-pane rounded-xl border p-6">
              <Shield className="h-10 w-10 mb-4 text-[var(--primary)]" />
              <h3 className="text-lg font-semibold mb-2">Trustless & Permissionless</h3>
              <p className="text-sm text-muted-foreground">
                No intermediaries, no gatekeeping. Direct blockchain transactions with full transparency.
              </p>
            </div>
            <div className="glass-pane rounded-xl border p-6">
              <Wallet className="h-10 w-10 mb-4 text-[var(--primary)]" />
              <h3 className="text-lg font-semibold mb-2">Subscription-Based Auth</h3>
              <p className="text-sm text-muted-foreground">
                Secure APIM subscription keys linked to your wallet. Manage keys through the developer dashboard.
              </p>
            </div>
            <div className="glass-pane rounded-xl border p-6">
              <GitBranch className="h-10 w-10 mb-4 text-[var(--primary)]" />
              <h3 className="text-lg font-semibold mb-2">Automatic Splitting</h3>
              <p className="text-sm text-muted-foreground">
                Configure payment distribution via smart contracts. All splits happen on-chain.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Documentation Sections */}
      <section className="border-b">
        <div className="max-w-5xl mx-auto px-4 py-16">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">
            Documentation
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <Link href="/developers/docs/quickstart" className="glass-pane rounded-xl border p-6 hover:bg-foreground/5 transition-colors group">
              <div className="flex items-start justify-between mb-4">
                <Zap className="h-8 w-8 text-[var(--primary)]" />
                <span className="text-xs px-2 py-1 rounded-md bg-green-500/10 text-green-600 dark:text-green-400">
                  Start Here
                </span>
              </div>
              <h3 className="text-lg font-semibold mb-2 group-hover:text-[var(--primary)] transition-colors">
                Quick Start Guide
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Get up and running in 5 minutes. Make your first API call and accept your first payment.
              </p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Configure split contract</li>
                <li>• Create your first product</li>
                <li>• Generate orders</li>
                <li>• Accept payments</li>
              </ul>
            </Link>

            <Link href="/developers/docs/auth" className="glass-pane rounded-xl border p-6 hover:bg-foreground/5 transition-colors group">
              <Shield className="h-8 w-8 text-[var(--primary)] mb-4" />
              <h3 className="text-lg font-semibold mb-2 group-hover:text-[var(--primary)] transition-colors">
                Authentication & Security
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Learn how APIM subscription authentication works and critical security practices.
              </p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• APIM subscription keys</li>
                <li>• Security best practices</li>
                <li>• Gateway architecture</li>
                <li>• Incident response</li>
              </ul>
            </Link>

            <Link href="/developers/docs/api" className="glass-pane rounded-xl border p-6 hover:bg-foreground/5 transition-colors group">
              <BookOpen className="h-8 w-8 text-[var(--primary)] mb-4" />
              <h3 className="text-lg font-semibold mb-2 group-hover:text-[var(--primary)] transition-colors">
                API Reference
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Complete reference for all {displayBrandName} API endpoints with examples.
              </p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Split Contract APIs</li>
                <li>• Inventory Management</li>
                <li>• Order Generation</li>
                <li>• Receipt APIs</li>
              </ul>
            </Link>

            <Link href="/developers/docs/examples" className="glass-pane rounded-xl border p-6 hover:bg-foreground/5 transition-colors group">
              <Code className="h-8 w-8 text-[var(--primary)] mb-4" />
              <h3 className="text-lg font-semibold mb-2 group-hover:text-[var(--primary)] transition-colors">
                Code Examples
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Ready-to-use code examples in multiple languages for common workflows.
              </p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• JavaScript/TypeScript</li>
                <li>• Python</li>
                <li>• cURL commands</li>
                <li>• Complete integrations</li>
              </ul>
            </Link>
          </div>
        </div>
      </section>

      {/* Quick Example */}
      <section className="border-b bg-muted/30">
        <div className="max-w-5xl mx-auto px-4 py-16">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-8">
            Quick Example
          </h2>
          <div className="max-w-3xl mx-auto">
            <div className="glass-pane rounded-xl border p-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-medium">Create Your First Order</span>
                <span className="text-xs px-2 py-1 rounded bg-foreground/10">cURL</span>
              </div>
              <pre className="text-xs overflow-x-auto bg-foreground/5 p-4 rounded-md">
{(() => {
  const app = (baseUrl || "").replace(/^http:\/\//, "https://");
  return `# 1. Create a product
curl -X POST ${app}/api/inventory \\
  -H "Content-Type: application/json" \\
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" \\
  -d '{
    "sku": "ITEM-001",
    "name": "Sample Product",
    "priceUsd": 25.00,
    "stockQty": 100,
    "taxable": true
  }'

# 2. Generate an order
curl -X POST ${app}/api/orders \\
  -H "Content-Type: application/json" \\
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" \\
  -d '{
    "items": [{"sku": "ITEM-001", "qty": 1}],
    "jurisdictionCode": "US-CA"
  }'

# 3. Payment URL
# ${app}/pay/{receiptId}`;
})()}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* API Categories */}
      <section className="border-b">
        <div className="max-w-5xl mx-auto px-4 py-16">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">
            API Categories
          </h2>
          <div className="grid gap-4">
            <Link href="/developers/docs/api/split" className="glass-pane rounded-xl border p-4 hover:bg-foreground/5 transition-colors flex items-center justify-between group">
              <div>
                <h3 className="font-semibold mb-1 group-hover:text-[var(--primary)] transition-colors">Split Contract APIs</h3>
                <p className="text-sm text-muted-foreground">Configure payment distribution and view transactions</p>
              </div>
              <span className="text-muted-foreground">→</span>
            </Link>
            <Link href="/developers/docs/api/inventory" className="glass-pane rounded-xl border p-4 hover:bg-foreground/5 transition-colors flex items-center justify-between group">
              <div>
                <h3 className="font-semibold mb-1 group-hover:text-[var(--primary)] transition-colors">Inventory APIs</h3>
                <p className="text-sm text-muted-foreground">Manage your product catalog with full CRUD operations</p>
              </div>
              <span className="text-muted-foreground">→</span>
            </Link>
            <Link href="/developers/docs/api/orders" className="glass-pane rounded-xl border p-4 hover:bg-foreground/5 transition-colors flex items-center justify-between group">
              <div>
                <h3 className="font-semibold mb-1 group-hover:text-[var(--primary)] transition-colors">Order APIs</h3>
                <p className="text-sm text-muted-foreground">Generate receipts with tax calculation and processing fees</p>
              </div>
              <span className="text-muted-foreground">→</span>
            </Link>
            <Link href="/developers/docs/api/receipts" className="glass-pane rounded-xl border p-4 hover:bg-foreground/5 transition-colors flex items-center justify-between group">
              <div>
                <h3 className="font-semibold mb-1 group-hover:text-[var(--primary)] transition-colors">Receipt APIs</h3>
                <p className="text-sm text-muted-foreground">View transaction history and payment status</p>
              </div>
              <span className="text-muted-foreground">→</span>
            </Link>
            <Link href="/developers/docs/api/shop" className="glass-pane rounded-xl border p-4 hover:bg-foreground/5 transition-colors flex items-center justify-between group">
              <div>
                <h3 className="font-semibold mb-1 group-hover:text-[var(--primary)] transition-colors">Shop Configuration APIs</h3>
                <p className="text-sm text-muted-foreground">Customize branding, tax jurisdictions, and settings</p>
              </div>
              <span className="text-muted-foreground">→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Integration Guides */}
      <section className="border-b">
        <div className="max-w-5xl mx-auto px-4 py-16">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">
            Integration Guides
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            <Link href="/developers/docs/guides/ecommerce" className="glass-pane rounded-xl border p-6 hover:bg-foreground/5 transition-colors">
              <h3 className="text-lg font-semibold mb-2">E-commerce Integration</h3>
              <p className="text-sm text-muted-foreground">
                Complete guide for integrating {displayBrandName} into your online store
              </p>
            </Link>
            <Link href="/developers/docs/guides/payment-gateway" className="glass-pane rounded-xl border p-6 hover:bg-foreground/5 transition-colors">
              <h3 className="text-lg font-semibold mb-2">Payment Gateway</h3>
              <p className="text-sm text-muted-foreground">
                Build a custom payment gateway with {displayBrandName} infrastructure
              </p>
            </Link>
            <Link href="/developers/docs/guides/pos" className="glass-pane rounded-xl border p-6 hover:bg-foreground/5 transition-colors">
              <h3 className="text-lg font-semibold mb-2">Point of Sale</h3>
              <p className="text-sm text-muted-foreground">
                Accept in-person crypto payments with terminal integration
              </p>
            </Link>
          </div>
        </div>
      </section>

      {/* Resources */}
      <section>
        <div className="max-w-5xl mx-auto px-4 py-16">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">
            Additional Resources
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Link href="/developers/docs/errors" className="glass-pane rounded-lg border p-4 hover:bg-foreground/5 transition-colors text-center">
              <h3 className="font-semibold mb-1">Error Handling</h3>
              <p className="text-xs text-muted-foreground">Codes & debugging</p>
            </Link>
            <Link href="/developers/docs/limits" className="glass-pane rounded-lg border p-4 hover:bg-foreground/5 transition-colors text-center">
              <h3 className="font-semibold mb-1">Rate Limits</h3>
              <p className="text-xs text-muted-foreground">Quotas & limits</p>
            </Link>
            <Link href="/developers/docs/changelog" className="glass-pane rounded-lg border p-4 hover:bg-foreground/5 transition-colors text-center">
              <h3 className="font-semibold mb-1">Changelog</h3>
              <p className="text-xs text-muted-foreground">Version history</p>
            </Link>
            <a href="/public/openapi.yaml" className="glass-pane rounded-lg border p-4 hover:bg-foreground/5 transition-colors text-center">
              <h3 className="font-semibold mb-1">OpenAPI Spec</h3>
              <p className="text-xs text-muted-foreground">Machine-readable</p>
            </a>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-muted/30">
        <div className="max-w-5xl mx-auto px-4 py-16 text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            Ready to Get Started?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-2xl mx-auto">
            Follow our Quick Start Guide to make your first API call in 5 minutes.
          </p>
          <Link
            href="/developers/docs/quickstart"
            className="inline-block px-6 py-3 bg-foreground text-background rounded-md hover:opacity-90 transition-opacity font-medium"
          >
            Start Building →
          </Link>
        </div>
      </section>
    </div>
  );
}
