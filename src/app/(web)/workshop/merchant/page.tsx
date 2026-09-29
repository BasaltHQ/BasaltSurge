import type { Metadata } from 'next';
import WorkshopPage from '@/components/workshop/WorkshopPage';

export const metadata: Metadata = { title: 'Merchant Payment Workshop', description: 'Keep your business open for payments. Explore traditional funding, cross-chain crypto and six settlement assets on Base for daily acceptance and payment gaps.' };
export default function Page() { return <WorkshopPage audience="merchant" />; }
