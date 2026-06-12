import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { requireCsrf, rateLimitOrThrow, rateKey } from '@/lib/security';
import {
  type PMSInstance,
  type PMSFolio,
  type PMSPaymentSplit,
  type CreatePaymentSplitInput,
  PERMISSIONS,
  validatePaymentSplit,
  
} from '@/lib/pms';
import {
  requireStaffSession,
  requirePermission
} from '@/lib/pms/auth';;

/**
 * Split Payment Management API
 * - POST: Create a new payment split for a folio
 * - GET: List payment splits (optional, for history)
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string  }> }
) {
  const correlationId = crypto.randomUUID();
  const { slug } = await params;
  
  try {
    // Require staff session and permission
    const session = await requireStaffSession(slug);
    requirePermission(session, PERMISSIONS.PROCESS_PAYMENT);
    
    // CSRF and rate limiting
    requireCsrf(req);
    rateLimitOrThrow(req, rateKey(req, `pms_split_create_${slug}`, slug), 30, 60 * 60 * 1000);
    
    // Get PMS instance
    const container = await getContainer();
    const { resources: instances } = await container.items
      .query({
        query: `
          SELECT * FROM c 
          WHERE c.type = 'pms_instance' 
          AND c.slug = @slug
        `,
        parameters: [{ name: '@slug', value: slug }],
      })
      .fetchAll();
    
    if (!instances || instances.length === 0) {
      return NextResponse.json(
        { error: 'PMS instance not found' },
        { status: 404, headers: { 'x-correlation-id': correlationId } }
      );
    }
    
    const instance = instances[0] as PMSInstance;
    
    // Parse request body
    const body = (await req.json().catch(() => ({}))) as CreatePaymentSplitInput;
    
    // Validate required fields
    if (!body.folioId || !body.totalAmount || !body.segments || !Array.isArray(body.segments)) {
      return NextResponse.json(
        { error: 'Folio ID, total amount, and segments array are required' },
        { status: 400, headers: { 'x-correlation-id': correlationId } }
      );
    }
    
    // Validate segments total matches folio amount
    const validation = validatePaymentSplit(body.totalAmount, body.segments);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400, headers: { 'x-correlation-id': correlationId } }
      );
    }
    
    // Get folio
    const { resources: folios } = await container.items
      .query({
        query: `
          SELECT * FROM c 
          WHERE c.type = 'pms_folio' 
          AND c.pmsSlug = @slug
          AND c.id = @folioId
        `,
        parameters: [
          { name: '@slug', value: slug },
          { name: '@folioId', value: body.folioId },
        ],
      })
      .fetchAll();
    
    if (!folios || folios.length === 0) {
      return NextResponse.json(
        { error: 'Folio not found' },
        { status: 404, headers: { 'x-correlation-id': correlationId } }
      );
    }
    
    const folio = folios[0] as PMSFolio;
    
    // Check folio status
    if (folio.status !== 'open') {
      return NextResponse.json(
        { error: 'Cannot create payment split for closed folio' },
        { status: 400, headers: { 'x-correlation-id': correlationId } }
      );
    }
    
    // Check if total matches folio balance
    if (Math.abs(body.totalAmount - folio.balance) > 0.01) {
      return NextResponse.json(
        { error: `Split total (${body.totalAmount}) does not match folio balance (${folio.balance})` },
        { status: 400, headers: { 'x-correlation-id': correlationId } }
      );
    }
    
    // Create payment split
    const now = Date.now();
    const splitId = `split_${slug}_${now}_${Math.random().toString(36).substring(7)}`;
    
    // Generate segment IDs and portal URLs for card segments
    const segments = body.segments.map((seg, index) => {
      const segmentId = `segment_${splitId}_${index}`;
      const segment: PMSPaymentSplit['segments'][0] = {
        id: segmentId,
        amount: seg.amount,
        method: seg.method,
        status: 'pending',
      };
      
      // For card payments, we'll generate a unique receipt ID that will be used for the portal
      if (seg.method === 'card') {
        const receiptId = `pms_${segmentId}`;
        segment.receiptId = receiptId;
        segment.portalUrl = `/portal/${receiptId}?recipient=${encodeURIComponent(instance.wallet)}`;
      }
      
      return segment;
    });
    
    const split: PMSPaymentSplit = {
      id: splitId,
      type: 'pms_payment_split',
      wallet: instance.wallet,
      pmsSlug: slug,
      folioId: body.folioId,
      totalAmount: body.totalAmount,
      segments,
      status: 'in_progress',
      createdBy: session.staffId,
      createdAt: now,
      updatedAt: now,
    };
    
    await container.items.upsert(split);
    
    return NextResponse.json(
      { split },
      { status: 201, headers: { 'x-correlation-id': correlationId } }
    );
  } catch (error: any) {
    console.error(`POST /api/pms/${slug}/payments/split error:`, error);
    
    if (error?.message === 'csrf_required' || error?.message === 'rate_limited') {
      return NextResponse.json(
        { error: error.message },
        { status: error?.status || 429, headers: { 'x-correlation-id': correlationId } }
      );
    }
    
    const status = error?.message === 'Staff authentication required' ? 401 
      : error?.message?.includes('Permission denied') ? 403 
      : 500;
    
    return NextResponse.json(
      { error: error?.message || 'Failed to create payment split' },
      { status, headers: { 'x-correlation-id': correlationId } }
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string  }> }
) {
  const correlationId = crypto.randomUUID();
  const { slug } = await params;
  
  try {
    // Require staff session
    const session = await requireStaffSession(slug);
    
    // Parse query parameters
    const url = new URL(req.url);
    const folioId = url.searchParams.get('folioId');
    const status = url.searchParams.get('status');
    
    // Build query
    const container = await getContainer();
    let query = `
      SELECT * FROM c 
      WHERE c.type = 'pms_payment_split' 
      AND c.pmsSlug = @slug
    `;
    
    const parameters: Array<{ name: string; value: any }> = [
      { name: '@slug', value: slug },
    ];
    
    if (folioId) {
      query += ' AND c.folioId = @folioId';
      parameters.push({ name: '@folioId', value: folioId });
    }
    
    if (status) {
      query += ' AND c.status = @status';
      parameters.push({ name: '@status', value: status });
    }
    
    query += ' ORDER BY c.createdAt DESC';
    
    const { resources: splits } = await container.items
      .query({ query, parameters })
      .fetchAll();
    
    return NextResponse.json(
      { splits: splits || [] },
      { headers: { 'x-correlation-id': correlationId } }
    );
  } catch (error: any) {
    console.error(`GET /api/pms/${slug}/payments/split error:`, error);
    
    const status = error?.message === 'Staff authentication required' ? 401 : 500;
    
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch payment splits' },
      { status, headers: { 'x-correlation-id': correlationId } }
    );
  }
}
