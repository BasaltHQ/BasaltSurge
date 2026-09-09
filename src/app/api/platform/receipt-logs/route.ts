import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requirePlatformAnalyticsAccess } from "@/lib/partner-analytics-access";

export const dynamic = 'force-dynamic';

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    await requirePlatformAnalyticsAccess(req);

    const receiptId = req.nextUrl.searchParams.get("receiptId");
    if (!receiptId) {
      return privateJson({ ok: false, error: "Missing receiptId" }, 400);
    }

    const container = await getContainer(undefined, "portal_logs");
    let logs: any[] = [];

    // 2. Fetch logs for this receiptId
    if ((container as any).getCollection) {
      const collection = (container as any).getCollection();
      logs = await collection.find(
        { receiptId: receiptId },
        {
          projection: {
            receiptId: 1,
            level: 1,
            message: 1,
            createdAt: 1,
            userAgent: 1
          },
          readPreference: "secondaryPreferred"
        }
      ).sort({ createdAt: 1 }).toArray();
    } else {
      // Fallback for Cosmos DB
      const querySpec = {
        query: "SELECT c.receiptId, c.level, c.message, c.createdAt, c.userAgent FROM c WHERE c.type = 'portal_client_log' AND c.receiptId = @receiptId",
        parameters: [{ name: "@receiptId", value: receiptId }]
      };
      const { resources } = await container.items.query(querySpec).fetchAll();
      logs = resources || [];
      logs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }

    return privateJson({
      ok: true,
      logs
    });
  } catch (e: any) {
    const status = [401, 403, 503].includes(Number(e?.status)) ? Number(e.status) : 500;
    return privateJson({ ok: false, error: status === 500 ? "Receipt logs could not be loaded." : e.message }, status);
  }
}
