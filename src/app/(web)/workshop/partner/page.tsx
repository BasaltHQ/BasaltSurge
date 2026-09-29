import type { Metadata } from 'next';
import WorkshopPage from '@/components/workshop/WorkshopPage';

export const metadata: Metadata = { title: 'ISO & Payment Provider Workshop', description: 'Resell white-label payment infrastructure. Configure merchant-specific provider and agent shares and grow your book without maintaining the platform.' };
export default function Page() { return <WorkshopPage audience="partner" />; }
