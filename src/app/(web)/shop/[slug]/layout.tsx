import { Metadata } from 'next';
import { getBrandConfig } from '@/config/brands';

type ShopConfig = {
  name: string;
  description?: string;
  bio?: string;
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  // 1. Resolve Brand Identity (Platform vs Partner))
  const { getContainerIdentity, getBrandConfigFromCosmos } = await import('@/lib/brand-config');
  const { brandKey } = await getContainerIdentity();

  const { brand } = await getBrandConfigFromCosmos(brandKey);

  try {
    const { slug } = await params;

    // Fetch directly from Cosmos DB (avoid self-fetch issues)
    const { getContainer } = await import('@/lib/cosmos');
    const container = await getContainer();

    // Resolve slug to wallet using Cosmos query (matches /api/shop/slug pattern)
    let wallet: string | null = null;
    let dbSlug: string | null = null;
    try {
      const { resources } = await container.items
        .query({
          // Fix: Check for both shop_config and site_config types to match data in DB
          // also allow lookup by customDomain (verified)
          query: "SELECT TOP 1 c.wallet, c.slug FROM c WHERE (c.type='shop_config' OR c.type='site_config') AND (c.slug=@slug OR (c.customDomain=@slug AND c.customDomainVerified=true))",
          parameters: [{ name: '@slug', value: slug }]
        })
        .fetchAll();

      if (resources && resources.length > 0) {
        wallet = resources[0]?.wallet || null;
        dbSlug = resources[0]?.slug || null;
      }
    } catch (err) {
      console.error('Failed to resolve shop slug:', err);
      // Don't crash, just let it fall through to not found
    }

    if (!wallet) {
      return {
        title: `Shop Not Found • ${brand.name}`,
        description: `This shop could not be found on ${brand.name}`,
      };
    }

    // Fetch shop config
    let config: ShopConfig & { theme?: { brandLogoUrl?: string; brandFaviconUrl?: string; appleTouchIconUrl?: string } } = { name: 'Shop' };
    try {
      // Try reading as site:config first (newer format)
      // Use dbSlug if available, otherwise fall back to param slug (though dbSlug should usually be present if wallet was found)
      const targetSlug = dbSlug || slug;
      try {
        const { resource } = await container.item(`site:config:${targetSlug}`, wallet).read<any>();
        if (!resource) throw new Error("Not found");
        config = mapResourceToConfig(resource);
      } catch {
        // Fallback to legacy shop:config
        const { resource } = await container.item('shop:config', wallet).read<any>();
        if (resource) {
          config = mapResourceToConfig(resource);
        }
      }
    } catch { }

    // Helper to map resource to config
    function mapResourceToConfig(resource: any) {
      return {
        name: resource.name || 'Shop',
        description: resource.description,
        bio: resource.bio,
        theme: resource.theme,
      };
    }

    const name = config.name || 'Shop';
    const description = config.description || config.bio || `Visit ${name} on ${brand.name}`;
    const truncatedDescription = description.length > 160 ? description.slice(0, 157) + '...' : description;

    // Priority: Shop Specific -> /api/favicon (Brand Dynamic)
    // We do NOT fallback to the logo for the favicon, as that causes the issue where the logo is used instead of the favicon.
    // /api/favicon will automatically serve the correct brand favicon.
    const logoRaw = config.theme?.brandLogoUrl || brand.logos.app;
    const isLogoBlocked = logoRaw && (logoRaw.includes("a311dcf8") || logoRaw.includes("cblogod.png"));
    const logo = isLogoBlocked ? "/BasaltSurgeWideD.png" : logoRaw;

    const shopFaviconRaw = config.theme?.brandFaviconUrl;
    const isFaviconBlocked = shopFaviconRaw && (shopFaviconRaw.includes("a311dcf8") || shopFaviconRaw.includes("cblogod.png"));
    const shopFavicon = isFaviconBlocked ? undefined : shopFaviconRaw;
    const faviconUrl = shopFavicon || `/api/favicon?shop=${encodeURIComponent(dbSlug || slug)}`;

    const shopApple = config.theme?.appleTouchIconUrl;
    const appleUrl = shopApple || "/apple-touch-icon.png";

    return {
      title: `${name} • ${brand.name}`,
      description: truncatedDescription,
      applicationName: brand.name,
      keywords: [brand.name, 'crypto', 'payments', 'shop', name, 'blockchain', 'commerce'],
      category: 'commerce',
      icons: {
        icon: faviconUrl,
        apple: appleUrl,
        shortcut: faviconUrl,
      },
      openGraph: {
        type: 'website',
        siteName: brand.name,
        title: `${name} • ${brand.name}`,
        description: truncatedDescription,
        images: logo ? [{ url: logo }] : undefined,
      },
      twitter: {
        card: 'summary_large_image',
        title: `${name} • ${brand.name}`,
        description: truncatedDescription,
        images: logo ? [logo] : undefined,
      },
    };
  } catch (error) {
    return {
      title: `Shop • ${brand.name}`,
      description: `Discover shops on ${brand.name} - Accept crypto payments with ease.`,
      applicationName: brand.name,
      keywords: [brand.name, 'crypto', 'payments', 'shop'],
      openGraph: {
        type: 'website',
        siteName: brand.name,
      },
      twitter: {
        card: 'summary_large_image',
      },
    };
  }
}

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        body.with-global-navbar {
          padding-top: 0 !important;
        }
        #global-hideable-navbar {
          display: none !important;
        }
      `}</style>
      {children}
    </>
  );
}
