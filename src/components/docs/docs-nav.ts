// Centralized documentation navigation structure
// This ensures consistency between sidebar and page navigation

export interface DocNavItem {
  title: string;
  href: string;
}

export interface DocNavSection {
  title: string;
  items: DocNavItem[];
}

export const docsNavigation: DocNavSection[] = [
  {
    title: 'Getting Started',
    items: [
      { title: 'Introduction', href: '/developers/docs' },
      { title: 'Quick Start', href: '/developers/docs/quickstart' },
      { title: 'Core Concepts', href: '/developers/docs/concepts' },
      { title: 'Authentication', href: '/developers/docs/auth' },
      { title: 'Agent Integration', href: '/developers/docs/guides/agent-integration' },
    ],
  },
  {
    title: 'API Reference',
    items: [
      { title: 'Overview', href: '/developers/docs/api' },
      { title: 'Split Contract', href: '/developers/docs/api/split' },
      { title: 'Inventory', href: '/developers/docs/api/inventory' },
      { title: 'Orders', href: '/developers/docs/api/orders' },
      { title: 'Receipts', href: '/developers/docs/api/receipts' },
      { title: 'Subscriptions', href: '/developers/docs/api/subscriptions' },
      { title: 'Shop Config', href: '/developers/docs/api/shop' },
      { title: 'Billing', href: '/developers/docs/api/billing' },
      { title: 'Tax Catalog', href: '/developers/docs/api/tax' },
      { title: 'Reserve', href: '/developers/docs/api/reserve' },
      { title: 'Users', href: '/developers/docs/api/users' },
      { title: 'GraphQL', href: '/developers/docs/api/graphql' },
      { title: 'Health', href: '/developers/docs/api/health' },
    ],
  },
  {
    title: 'Integration Guides',
    items: [
      { title: 'E-commerce', href: '/developers/docs/guides/ecommerce' },
      { title: 'Payment Gateway', href: '/developers/docs/guides/payment-gateway' },
      { title: 'Point of Sale', href: '/developers/docs/guides/pos' },
      { title: 'Shopify', href: '/developers/docs/guides/shopify' },
    ],
  },
  {
    title: 'Merchant Manual',
    items: [
      { title: 'Overview', href: '/developers/docs/merchant' },
      { title: 'Shop & Modifiers', href: '/developers/docs/merchant/shop-setup' },
      { title: 'Reserve & Offramping', href: '/developers/docs/merchant/reserve-management' },
      { title: 'Tax Management', href: '/developers/docs/merchant/tax-management' },
      { title: 'POS Terminal Use', href: '/developers/docs/merchant/terminal-use' },
      { title: 'Portal & Receipts', href: '/developers/docs/merchant/portal-receipts' },
      { title: 'Industry Apps', href: '/developers/docs/merchant/industry-packs' },
    ],
  },
  {
    title: 'Partner Manual',
    items: [
      { title: 'Overview', href: '/developers/docs/partner' },
      { title: 'Branding & Whitelabel', href: '/developers/docs/partner/branding-whitelabel' },
      { title: 'Merchant Management', href: '/developers/docs/partner/merchant-management' },
      { title: 'Touchpoint Devices', href: '/developers/docs/partner/touchpoints-devices' },
      { title: 'Splits & Immutability', href: '/developers/docs/partner/split-config' },
      { title: 'Plugins & Modules', href: '/developers/docs/partner/plugins-modules' },
    ],
  },
  {
    title: 'Resources',
    items: [
      { title: 'Examples', href: '/developers/docs/examples' },
      { title: 'Error Handling', href: '/developers/docs/errors' },
      { title: 'Rate Limits', href: '/developers/docs/limits' },
      { title: 'Pricing & Tiers', href: '/developers/docs/pricing' },
      { title: 'Changelog', href: '/developers/docs/changelog' },
    ],
  },
];

// Flatten navigation into a single ordered list for prev/next navigation
export function getFlatNavigation(): DocNavItem[] {
  return docsNavigation.flatMap(section => section.items);
}

// Get previous and next pages for a given path
export function getAdjacentPages(currentPath: string): {
  prev: DocNavItem | null;
  next: DocNavItem | null;
} {
  const flatNav = getFlatNavigation();
  const currentIndex = flatNav.findIndex(item => item.href === currentPath);

  if (currentIndex === -1) {
    return { prev: null, next: null };
  }

  return {
    prev: currentIndex > 0 ? flatNav[currentIndex - 1] : null,
    next: currentIndex < flatNav.length - 1 ? flatNav[currentIndex + 1] : null,
  };
}
