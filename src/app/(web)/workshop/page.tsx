import type { Metadata } from 'next';
import WorkshopPage from '@/components/workshop/WorkshopPage';

export const metadata: Metadata = { title: 'The Payment Workshop', description: 'White-label payment infrastructure for ISOs and providers. Persistent merchant acceptance, cross-chain crypto and configurable revenue splits.' };
export default function Page() { return <WorkshopPage audience="all" />; }
