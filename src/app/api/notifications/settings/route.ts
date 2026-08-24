import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { resolveAdminRole } from "@/lib/authz-server";
import { getBrandKey } from "@/config/brands";

// Default settings per level
const DEFAULT_SETTINGS: Record<string, Record<string, boolean>> = {
  merchant: {
    purchase_completed: true,
    split_released: true,
    low_stock: false,
    team_pin_changed: true,
    support_ticket_reply: true,
  },
  partner: {
    merchant_signup: true,
    split_deployed: true,
    device_offline: true,
    support_ticket_created: true,
    support_ticket_reply: true,
  },
  platform: {
    partner_signup: true,
    contract_upgraded: true,
    node_error: true,
    system_status: true,
    support_ticket_created: true,
    support_ticket_reply: true,
  },
};

export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const caller = await requireThirdwebAuth(req);
    const wallet = caller.wallet.toLowerCase();

    const { searchParams } = new URL(req.url);
    const level = (searchParams.get("level") || "merchant").toLowerCase();

    if (!["merchant", "partner", "platform"].includes(level)) {
      return NextResponse.json({ error: "invalid_level" }, { status: 400 });
    }

    // Gating check for Partner & Platform configurations
    if (level === "partner" || level === "platform") {
      const role = await resolveAdminRole(wallet);
      if (!role) {
        return NextResponse.json({ error: "unauthorized" }, { status: 403 });
      }
      if (level === "platform" && !["platform_super_admin", "platform_admin"].includes(role)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 403 });
      }
    }

    const brandKey = getBrandKey(req).toLowerCase();
    const container = await getContainer();
    const docId = `notification_settings:${level}:${brandKey}:${wallet}`;

    let doc: any = null;
    try {
      const { resource } = await container.item(docId, wallet).read();
      doc = resource;
    } catch {
      // Document not found or database read failed
    }

    const responseData = {
      level,
      email: doc?.email || "",
      enabled: doc?.enabled ?? true,
      settings: {
        ...DEFAULT_SETTINGS[level],
        ...(doc?.settings || {}),
      },
    };

    return NextResponse.json(responseData, { headers: { "x-correlation-id": correlationId } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "server_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const caller = await requireThirdwebAuth(req);
    const wallet = caller.wallet.toLowerCase();

    const body = await req.json();
    const level = (body.level || "merchant").toLowerCase();
    const email = String(body.email || "").trim();
    const enabled = body.enabled ?? true;
    const incomingSettings = body.settings || {};

    if (!["merchant", "partner", "platform"].includes(level)) {
      return NextResponse.json({ error: "invalid_level" }, { status: 400 });
    }

    // Gating check for Partner & Platform configurations
    if (level === "partner" || level === "platform") {
      const role = await resolveAdminRole(wallet);
      if (!role) {
        return NextResponse.json({ error: "unauthorized" }, { status: 403 });
      }
      if (level === "platform" && !["platform_super_admin", "platform_admin"].includes(role)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 403 });
      }
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }

    const brandKey = getBrandKey(req).toLowerCase();
    const container = await getContainer();
    const docId = `notification_settings:${level}:${brandKey}:${wallet}`;

    const doc = {
      id: docId,
      type: "notification_settings",
      level,
      brandKey,
      wallet,
      email,
      enabled,
      settings: {
        ...DEFAULT_SETTINGS[level],
        ...incomingSettings,
      },
      updatedAt: new Date().toISOString(),
    };

    await container.items.upsert(doc);

    return NextResponse.json({ ok: true, doc }, { headers: { "x-correlation-id": correlationId } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "server_error" }, { status: 500 });
  }
}
