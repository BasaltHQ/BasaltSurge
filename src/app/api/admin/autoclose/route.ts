import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { isPlatformSuperAdmin } from "@/lib/authz";
import { getBrandKey } from "@/config/brands";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // 1. Authenticate user
    const caller = await requireThirdwebAuth(req).catch(() => null);
    if (!caller || !caller.roles.includes("admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Resolve brand context
    const brandKey = getBrandKey(req);
    if (!brandKey) {
      return NextResponse.json({ error: "No brand context found" }, { status: 500 });
    }

    const isPlatform = brandKey === "portalpay" || brandKey === "basaltsurge";

    // 3. Query the runs from Cosmos DB
    // Partition key is the SCA address: 0x6c28067a2D4F10013FbBb8534aCd76Ab43A4fF9f
    const container = await getContainer(undefined, "autoclose_runs");
    const querySpec = {
      query: `SELECT * FROM c WHERE c.type = 'autoclose_run' ORDER BY c.timestamp DESC`,
    };

    const { resources: allRuns } = await container.items.query(querySpec).fetchAll();
    const runsList = allRuns || [];

    // 4. Query pending ACH transactions
    let pendingAch: any[] = [];
    try {
      const containerEvents = await getContainer(undefined, "payportal_events");
      const achQuery = {
        query: `SELECT c.receiptId, c.wallet, c.totalUsd, c.status, c.createdAt, c.lastPolledAt, c.stripeSessionStatus, c.brandName, c.brandKey FROM c WHERE c.type = 'receipt' AND (c.status = 'paid - ach pending' OR c.status = 'ach_pending') ORDER BY c.createdAt DESC`
      };
      const { resources } = await containerEvents.items.query(achQuery).fetchAll();
      pendingAch = resources || [];
      
      // Filter by brandKey if not platform
      if (!isPlatform) {
        pendingAch = pendingAch.filter(
          (r: any) => String(r.brandKey || "").toLowerCase() === brandKey.toLowerCase()
        );
      }
    } catch (achErr) {
      console.error("[api/admin/autoclose] Failed to query pending ACH:", achErr);
    }

    // 5. Map and filter runs depending on partner or platform context
    const filteredRuns = runsList.map((run: any) => {
      if (isPlatform) {
        // Platform views see all details
        return run;
      }

      // Partner views see only distributions associated with their brandKey
      const brandDistributions = (run.distributions || []).filter(
        (d: any) => String(d.brandKey || "").toLowerCase() === brandKey.toLowerCase()
      );

      // Re-calculate statistics for the partner's merchant distributions
      const succeeded = brandDistributions.filter((d: any) => d.status === "success").length;
      const failed = brandDistributions.filter((d: any) => d.status === "failed").length;
      const processedSplits = Array.from(new Set(brandDistributions.map((d: any) => d.splitAddress))).length;

      const totals: Record<string, number> = {};
      for (const d of brandDistributions) {
        if (d.status === "success") {
          totals[d.token] = (totals[d.token] || 0) + (d.amount || 0);
        }
      }

      return {
        ...run,
        processedSplits,
        succeeded,
        failed,
        totals,
        distributions: brandDistributions,
      };
    });

    return NextResponse.json({ ok: true, runs: filteredRuns, pendingAch });
  } catch (e: any) {
    console.error("[api/admin/autoclose] GET error:", e);
    return NextResponse.json({ error: e.message || "Failed to retrieve runs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const caller = await requireThirdwebAuth(req).catch(() => null);
    if (!caller || !caller.roles.includes("admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Gate manually triggering to Platform Super Admins only
    if (!isPlatformSuperAdmin(caller.wallet)) {
      return NextResponse.json(
        { error: "Forbidden: Only platform master administrators can trigger manual runs." },
        { status: 403 }
      );
    }

    // 3. Trigger close by calling the cron endpoint internally using CRON_SECRET
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json(
        { error: "Configuration error: CRON_SECRET is not configured." },
        { status: 500 }
      );
    }

    const cronUrl = `${req.nextUrl.origin}/api/cron/autoclose`;
    console.log(`[api/admin/autoclose] Manual close trigger by ${caller.wallet}. Requesting: ${cronUrl}`);

    const res = await fetch(cronUrl, {
      method: "POST",
      headers: {
        "x-cron-secret": cronSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ manual: true }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      return NextResponse.json(
        { error: `Settlement execution failed: ${errorText}` },
        { status: res.status }
      );
    }

    const result = await res.json();
    return NextResponse.json({ ok: true, triggerResult: result });
  } catch (e: any) {
    console.error("[api/admin/autoclose] POST error:", e);
    return NextResponse.json({ error: e.message || "Failed to trigger run" }, { status: 500 });
  }
}
