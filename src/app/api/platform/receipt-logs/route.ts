import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { resolveWalletRole } from "@/lib/authz";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // 1. Authorize the caller
    const wallet = req.headers.get("x-wallet") || "";
    const role = resolveWalletRole(wallet);
    if (!role || !role.startsWith("platform_")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    const receiptId = req.nextUrl.searchParams.get("receiptId");
    if (!receiptId) {
      return NextResponse.json({ ok: false, error: "Missing receiptId" }, { status: 400 });
    }

    const container = await getContainer();
    let logs: any[] = [];

    // 2. Fetch logs for this receiptId
    if ((container as any).getCollection) {
      const collection = (container as any).getCollection();
      const db = collection.db;
      logs = await db.collection("portal_logs").find(
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

    return NextResponse.json({
      ok: true,
      logs
    });
  } catch (e: any) {
    console.error("[RECEIPT LOGS API] Error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal server error" }, { status: 500 });
  }
}
