import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processNotificationOutbox } from "@/lib/notifications/worker";
import { monitorNotifications } from "@/lib/notifications/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET || "";
  const supplied = req.headers.get("x-cron-secret") || "";
  if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const partner = String(process.env.CONTAINER_TYPE || process.env.NEXT_PUBLIC_CONTAINER_TYPE || "platform").toLowerCase() === "partner";
  const brandScope = partner ? process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY : undefined;
  if (partner && !brandScope) return NextResponse.json({ error: "brand_not_configured" }, { status: 503 });
  try {
    await monitorNotifications(brandScope);
    const result = await processNotificationOutbox(brandScope);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[Notifications] Worker failed", error);
    return NextResponse.json({ ok: false, error: "notification_worker_failed" }, { status: 503 });
  }
}
