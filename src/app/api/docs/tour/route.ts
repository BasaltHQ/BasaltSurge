import { NextResponse } from 'next/server';
import { loadTourCatalog } from '@/lib/admin-tour/documents.server';

export const dynamic = 'force-dynamic';

// These are published documentation, not account data or navigation permissions.
export async function GET() {
  try {
    return NextResponse.json({ lessons: await loadTourCatalog() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[tour-docs]', error instanceof Error ? error.message : 'Failed to load guides');
    return NextResponse.json({ error: 'Tour documentation is unavailable.' }, { status: 503 });
  }
}
