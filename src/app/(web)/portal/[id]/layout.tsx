import type { ReactNode } from 'react';
import { PortalBuildGuard } from '@/components/checkout/PortalBuildGuard';

// Explicitly exclude portal HTML/RSC from the server Full Route Cache.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function PortalLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PortalBuildGuard key={id}>{children}</PortalBuildGuard>;
}
