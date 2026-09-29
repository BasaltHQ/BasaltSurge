export const storeCatalog = [
  { kind: 'tote', name: 'Everyday tote', sku: 'BAG-001', stock: 24, price: '48 USDC' },
  { kind: 'coffee', name: 'House coffee', sku: 'COF-012', stock: 68, price: '16 USDC' },
  { kind: 'bottle', name: 'Studio bottle', sku: 'BOT-008', stock: 36, price: '28 USDC' },
] as const;

export type StoreProductKind = typeof storeCatalog[number]['kind'];
