import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const disabled = String(process.env.PAY_LOGGING || "").toUpperCase() === "FALSE";
    if (disabled) {
      return NextResponse.json({ ok: true, disabled: true });
    }

    const body = await req.json();
    const { level, message, stack, receiptId, wallet, sessionId, host, userAgent, ts, type, errorId } = body;

    // Validate minimum required fields
    if (!level || !message) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Always log to server terminal/console for easy development debugging
    console.log(`[PORTAL CLIENT ${level.toUpperCase()}] ${message}`, body.meta ? JSON.stringify(body.meta) : "");

    // Only allow error logs to be saved to DB
    if (level !== "error") {
      return NextResponse.json({ ok: true, ignored: true });
    }

    // Connect to the 'portal_logs' collection (will be created automatically if not existing)
    const container = await getContainer(undefined, "portal_logs");
    const logId = crypto.randomUUID();
    const now = Date.now();

    const logEntry = {
      id: logId,
      wallet: wallet || "anonymous", // Partition key
      type: type || "portal_client_log",
      errorId: errorId || null,
      level,
      message,
      stack: stack || null,
      receiptId: receiptId || null,
      sessionId: sessionId || null,
      host: host || null,
      userAgent: userAgent || null,
      createdAt: ts || now,
      savedAt: now,
    };

    await container.items.create(logEntry);

    return NextResponse.json({ ok: true, id: logId });
  } catch (err: any) {
    console.error("[PORTAL CLIENT LOG API ERROR] Failed to store client log:", err);
    return NextResponse.json(
      { error: err?.message || "Internal logging error" },
      { status: 500 }
    );
  }
}
