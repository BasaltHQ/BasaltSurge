"use client";

import { useBrand } from '@/contexts/BrandContext';
import WorkshopPresentation from './WorkshopPresentation';
import type { WorkshopAudience } from './content';

export default function WorkshopPage({ audience }: { audience: WorkshopAudience }) {
  const brand = useBrand();
  return <WorkshopPresentation audience={audience} brandName={brand.name} />;
}
