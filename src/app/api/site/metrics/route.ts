import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";

function isValidHexAddress(addr?: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(String(addr || "").trim());
}

export async function GET(_req: NextRequest) {
  try {
    const c = await getContainer();
    const now = Date.now();
    const since24h = now - 24 * 60 * 60 * 1000;
    const since7d = now - 7 * 24 * 60 * 60 * 1000;
    // Optional time-range filtering via query param ?range=24h|7d|30d|all or ?sinceMs=epoch_ms
    const url = new URL(_req.url);
    const rangeParam = url.searchParams.get("range") || "";
    const sinceMsParam = url.searchParams.get("sinceMs");
    let sinceRange = 0;
    if (sinceMsParam && Number.isFinite(Number(sinceMsParam))) {
      sinceRange = Number(sinceMsParam);
    } else {
      switch ((rangeParam || "").toLowerCase()) {
        case "24h":
          sinceRange = now - 24 * 60 * 60 * 1000;
          break;
        case "7d":
          sinceRange = since7d;
          break;
        case "30d":
          sinceRange = now - 30 * 24 * 60 * 60 * 1000;
          break;
        case "all":
        default:
          sinceRange = 0;
      }
    }
    // Total users
    let totalUsers = 0;
    try {
      const qU = { query: "SELECT VALUE COUNT(1) FROM c WHERE c.type='user'", parameters: [] } as any;
      const { resources } = await c.items.query(qU).fetchAll();
      totalUsers = Number((resources && resources[0]) || 0);
    } catch { }

    // Session summaries → count and sum (all-time)
    let sessionsCount = 0;
    let sessionsTotalSeconds = 0;
    try {
      const qCnt = { query: "SELECT VALUE COUNT(1) FROM c WHERE c.type='session_summary'", parameters: [] } as any;
      const qSum = { query: "SELECT VALUE SUM(c.durationSeconds) FROM c WHERE c.type='session_summary'", parameters: [] } as any;
      const [{ resources: rc }, { resources: rs }] = await Promise.all([
        c.items.query(qCnt).fetchAll(),
        c.items.query(qSum).fetchAll(),
      ]);
      sessionsCount = Number((rc && rc[0]) || 0);
      sessionsTotalSeconds = Number((rs && rs[0]) || 0);
    } catch { }

    // Total session time from usage events (all-time) — simple aggregation of all usage seconds
    let totalSecondsAllTimeUsageEvents = 0;
    try {
      const qUsage = { query: "SELECT VALUE SUM(c.seconds) FROM c WHERE c.type='usage'", parameters: [] } as any;
      const { resources } = await c.items.query(qUsage).fetchAll();
      totalSecondsAllTimeUsageEvents = Number((resources && resources[0]) || 0);
    } catch { }

    // Historical total session time from user aggregates (all-time)
    let totalSecondsAllTime = 0;
    try {
      const qUserUsed = { query: "SELECT VALUE SUM(c.usedSeconds) FROM c WHERE c.type='user' AND IS_DEFINED(c.usedSeconds)", parameters: [] } as any;
      const { resources } = await c.items.query(qUserUsed).fetchAll();
      totalSecondsAllTime = Number((resources && resources[0]) || 0);
    } catch { }

    // Live now: active users and total live seconds across currently live sessions
    let activeNowCount = 0;
    let totalLiveSecondsNow = 0;
    try {
      const cutoff = now - 120_000; // last heartbeat within 2 minutes counts as live
      const qLive = { query: "SELECT c.liveSince, c.lastHeartbeat FROM c WHERE c.type='user' AND c.live = true AND c.spacePublic = true AND c.lastHeartbeat > @cutoff", parameters: [{ name: "@cutoff", value: cutoff }] } as any;
      const { resources } = await c.items.query(qLive).fetchAll();
      activeNowCount = (resources || []).length;
      for (const u of (resources || [])) {
        const ls = Number(u?.liveSince || 0);
        if (Number.isFinite(ls) && ls > 0 && ls <= now) totalLiveSecondsNow += Math.max(0, Math.floor((now - ls) / 1000));
      }
    } catch { }

    // Top domain / language / platform / topic: prefer session summaries; fallback to user.metrics
    let topDomain = '';
    let topLanguage = '';
    let topPlatform = '';
    let topTopic = '';
    try {
      const qSummaries = { query: "SELECT c.domain, c.languages, c.platform, c.topics FROM c WHERE c.type='session_summary'", parameters: [] } as any;
      const { resources } = await c.items.query(qSummaries).fetchAll();
      const domainCounts: Record<string, number> = {};
      const langCounts: Record<string, number> = {};
      const platformCounts: Record<string, number> = {};
      const topicCounts: Record<string, number> = {};
      for (const r of (resources || [])) {
        const dom = typeof (r?.domain) === 'string' ? String(r.domain).trim() : '';
        if (dom && !/^(auto)$/i.test(dom)) domainCounts[dom] = (domainCounts[dom] || 0) + 1;
        const langs: string[] = Array.isArray(r?.languages) ? (r.languages as string[]) : [];
        for (const l of langs) {
          const lv = String(l || '').trim();
          if (lv) langCounts[lv] = (langCounts[lv] || 0) + 1;
        }
        const plat = typeof (r?.platform) === 'string' ? String(r.platform).trim() : '';
        if (plat) platformCounts[plat] = (platformCounts[plat] || 0) + 1;
        const topicsArr: string[] = Array.isArray(r?.topics) ? (r.topics as string[]) : [];
        for (const t of topicsArr) {
          const tv = String(t || '').trim();
          if (tv && tv.length >= 2) topicCounts[tv] = (topicCounts[tv] || 0) + 1;
        }
      }
      topDomain = Object.entries(domainCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      topLanguage = Object.entries(langCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      topPlatform = Object.entries(platformCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      topTopic = Object.entries(topicCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      // Fallback if no session summaries yet
      if (!topDomain || !topLanguage) {
        try {
          const qM = { query: "SELECT c.metrics FROM c WHERE c.type='user' AND IS_DEFINED(c.metrics)", parameters: [] } as any;
          const { resources: res2 } = await c.items.query(qM).fetchAll();
          const domainCounts2: Record<string, number> = {};
          const langCounts2: Record<string, number> = {};
          for (const r2 of (res2 || [])) {
            const m = (r2?.metrics || {}) as any;
            for (const [k, v] of Object.entries(m.domains || {})) domainCounts2[k] = (domainCounts2[k] || 0) + Number(v || 0);
            for (const [k, v] of Object.entries(m.languages || {})) langCounts2[k] = (langCounts2[k] || 0) + Number(v || 0);
          }
          if (!topDomain) topDomain = Object.entries(domainCounts2).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
          if (!topLanguage) topLanguage = Object.entries(langCounts2).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
        } catch { }
      }
    } catch { }

    // 24h sessions
    let sessionsCount24h = 0;
    let sessionsSeconds24h = 0;
    try {
      const qCnt24 = { query: "SELECT VALUE COUNT(1) FROM c WHERE c.type='session_summary' AND c.ts > @since", parameters: [{ name: "@since", value: since24h }] } as any;
      const qSum24 = { query: "SELECT VALUE SUM(c.durationSeconds) FROM c WHERE c.type='session_summary' AND c.ts > @since", parameters: [{ name: "@since", value: since24h }] } as any;
      const [{ resources: rc24 }, { resources: rs24 }] = await Promise.all([
        c.items.query(qCnt24).fetchAll(),
        c.items.query(qSum24).fetchAll(),
      ]);
      sessionsCount24h = Number((rc24 && rc24[0]) || 0);
      sessionsSeconds24h = Number((rs24 && rs24[0]) || 0);
    } catch { }

    // Range-filtered sessions (if requested)
    let sessionsCountRange = 0;
    let sessionsSecondsRange = 0;
    let averageSecondsRange = 0;
    try {
      if (sinceRange > 0) {
        const qCntR = { query: "SELECT VALUE COUNT(1) FROM c WHERE c.type='session_summary' AND c.ts > @since", parameters: [{ name: "@since", value: sinceRange }] } as any;
        const qSumR = { query: "SELECT VALUE SUM(c.durationSeconds) FROM c WHERE c.type='session_summary' AND c.ts > @since", parameters: [{ name: "@since", value: sinceRange }] } as any;
        const [{ resources: rcR }, { resources: rsR }] = await Promise.all([
          c.items.query(qCntR).fetchAll(),
          c.items.query(qSumR).fetchAll(),
        ]);
        sessionsCountRange = Number((rcR && rcR[0]) || 0);
        sessionsSecondsRange = Number((rsR && rsR[0]) || 0);
        averageSecondsRange = sessionsCountRange > 0 ? Math.floor(sessionsSecondsRange / sessionsCountRange) : 0;
      } else {
        sessionsCountRange = sessionsCount;
        sessionsSecondsRange = sessionsTotalSeconds;
        // Avoid referencing averageSeconds before it's declared; compute inline
        averageSecondsRange = sessionsCountRange > 0 ? Math.floor(sessionsSecondsRange / sessionsCountRange) : 0;
      }
    } catch { }
    // XP and Purchased totals (all-time)
    let xpTotal = 0;
    let purchasedSecondsTotal = 0;
    try {
      const qXp = { query: "SELECT VALUE SUM(c.xp) FROM c WHERE c.type='user' AND IS_DEFINED(c.xp)", parameters: [] } as any;
      const qPurch = { query: "SELECT VALUE SUM(c.purchasedSeconds) FROM c WHERE c.type='user' AND IS_DEFINED(c.purchasedSeconds)", parameters: [] } as any;
      const [{ resources: rx }, { resources: rp }] = await Promise.all([
        c.items.query(qXp).fetchAll(),
        c.items.query(qPurch).fetchAll(),
      ]);
      xpTotal = Number((rx && rx[0]) || 0);
      purchasedSecondsTotal = Number((rp && rp[0]) || 0);
    } catch { }

    // Percentiles (last 7 days)
    let p50Seconds7d = 0;
    let p95Seconds7d = 0;
    try {
      const qDur7 = { query: "SELECT VALUE c.durationSeconds FROM c WHERE c.type='session_summary' AND c.ts > @since", parameters: [{ name: "@since", value: since7d }] } as any;
      const { resources: ds } = await c.items.query(qDur7).fetchAll();
      const arr = Array.isArray(ds) ? (ds as number[]).map(n => Number(n || 0)).filter(n => Number.isFinite(n) && n > 0) : [];
      if (arr.length > 0) {
        arr.sort((a, b) => a - b);
        const q50 = 0.5 * (arr.length - 1);
        const q95 = 0.95 * (arr.length - 1);
        const interp = (q: number) => {
          const lo = Math.floor(q), hi = Math.ceil(q);
          if (lo === hi) return arr[lo];
          const f = q - lo; return arr[lo] * (1 - f) + arr[hi] * f;
        };
        p50Seconds7d = Math.round(interp(q50));
        p95Seconds7d = Math.round(interp(q95));
      }
    } catch { }

    // Receipts stats (PortalPay)
    let receiptsCount = 0;
    let receiptsTotalUsd = 0;
    let receiptsCount24h = 0;
    let receiptsTotalUsd24h = 0;
    let averageReceiptUsd = 0;
    let merchantsCount = 0;
    let topCurrency = '';
    let merchantEarnedUsdTotal = 0;

    // Resolve Brand/Container Identity logic to isolate stats
    let validWallets: Set<string> | null = null;
    let walletFilterClause = "";

    try {
      const { getContainerIdentity } = await import("@/lib/brand-config");
      const { getBrandKey } = await import("@/config/brands");

      const host = _req.headers.get("host") || url.hostname || "";
      const identity = await getContainerIdentity(host);
      let identityBrandKey = (identity.brandKey || "").toLowerCase();
      if (!identityBrandKey) {
        try { identityBrandKey = (getBrandKey(_req) || "").toLowerCase(); } catch { identityBrandKey = ""; }
      }

      if (identityBrandKey) {
        const qWallets = { query: "SELECT c.wallet, c.brandKey, c.theme FROM c WHERE c.type='site_config'", parameters: [] } as any;
        const { resources: configs } = await c.items.query(qWallets).fetchAll();

        const isPlatform = identityBrandKey === "basaltsurge" || identityBrandKey === "portalpay";
        const matchedWallets = new Set<string>();

        for (const cfg of (configs || [])) {
          const w = String(cfg?.wallet || "").toLowerCase();
          if (!w) continue;

          const bk = String(cfg?.brandKey || cfg?.theme?.brandKey || "").toLowerCase();

          if (isPlatform) {
            if (!bk || bk === "basaltsurge" || bk === "portalpay") {
              if (isValidHexAddress(w)) matchedWallets.add(w);
            }
          } else {
            if (bk === identityBrandKey) {
              if (isValidHexAddress(w)) matchedWallets.add(w);
            }
          }
        }
        validWallets = matchedWallets;

        if (validWallets.size === 0) {
          walletFilterClause = "EMPTY"; // Force 0 results if container has no merchants
        } else {
          walletFilterClause = "FILTER";
        }
      }
    } catch (e) {
      console.error("Failed to map brand wallets for metrics", e);
    }

    // Build wallet parameter list for ARRAY_CONTAINS queries
    const walletArray = validWallets ? Array.from(validWallets) : [];
    const walletParams = walletArray.length > 0 ? [{ name: "@wallets", value: walletArray }] : [];
    const hasWalletFilter = walletFilterClause === "FILTER";
    const emptyWalletFilter = walletFilterClause === "EMPTY";

    try {
      // 1. Merchant Earnings — prefer merchantEarnedUsd from split_index (actual merchant share).
      //    Sanity check: if the split_index value is unreasonably large (>10x receipt totals or >$1M
      //    when receipts are tiny), fall back to receipt-based totals. This guards against inflated
      //    split_index data from prior indexing bugs.
      if (emptyWalletFilter) {
        merchantEarnedUsdTotal = 0;
      } else if (hasWalletFilter) {
        const qEarned = { query: "SELECT VALUE SUM(c.merchantEarnedUsd) FROM c WHERE c.type='split_index' AND ARRAY_CONTAINS(@wallets, c.merchantWallet)", parameters: [...walletParams] } as any;
        const { resources: rEarned } = await c.items.query(qEarned).fetchAll();
        merchantEarnedUsdTotal = Number((rEarned && rEarned[0]) || 0);
      } else {
        const qEarned = { query: "SELECT VALUE SUM(c.merchantEarnedUsd) FROM c WHERE c.type='split_index'", parameters: [] } as any;
        const { resources: rEarned } = await c.items.query(qEarned).fetchAll();
        merchantEarnedUsdTotal = Number((rEarned && rEarned[0]) || 0);
      }

      // All-time receipts count and total USD
      if (emptyWalletFilter) {
        receiptsCount = 0;
        receiptsTotalUsd = 0;
      } else if (hasWalletFilter) {
        const qRecCnt = { query: "SELECT VALUE COUNT(1) FROM c WHERE c.type='receipt' AND c.status='paid' AND ARRAY_CONTAINS(@wallets, c.wallet)", parameters: [...walletParams] } as any;
        const qRecSum = { query: "SELECT VALUE SUM(c.totalUsd) FROM c WHERE c.type='receipt' AND c.status='paid' AND ARRAY_CONTAINS(@wallets, c.wallet)", parameters: [...walletParams] } as any;
        const [{ resources: rCnt }, { resources: rSum }] = await Promise.all([
          c.items.query(qRecCnt).fetchAll(),
          c.items.query(qRecSum).fetchAll(),
        ]);
        receiptsCount = Number((rCnt && rCnt[0]) || 0);
        receiptsTotalUsd = Number((rSum && rSum[0]) || 0);
      } else {
        const qRecCnt = { query: "SELECT VALUE COUNT(1) FROM c WHERE c.type='receipt' AND c.status='paid'", parameters: [] } as any;
        const qRecSum = { query: "SELECT VALUE SUM(c.totalUsd) FROM c WHERE c.type='receipt' AND c.status='paid'", parameters: [] } as any;
        const [{ resources: rCnt }, { resources: rSum }] = await Promise.all([
          c.items.query(qRecCnt).fetchAll(),
          c.items.query(qRecSum).fetchAll(),
        ]);
        receiptsCount = Number((rCnt && rCnt[0]) || 0);
        receiptsTotalUsd = Number((rSum && rSum[0]) || 0);
      }

      // 24h receipts count and total USD
      if (emptyWalletFilter) {
        receiptsCount24h = 0;
        receiptsTotalUsd24h = 0;
      } else if (hasWalletFilter) {
        const qRecCnt24 = { query: "SELECT VALUE COUNT(1) FROM c WHERE c.type='receipt' AND c.status='paid' AND c.createdAt > @since AND ARRAY_CONTAINS(@wallets, c.wallet)", parameters: [{ name: "@since", value: since24h }, ...walletParams] } as any;
        const qRecSum24 = { query: "SELECT VALUE SUM(c.totalUsd) FROM c WHERE c.type='receipt' AND c.status='paid' AND c.createdAt > @since AND ARRAY_CONTAINS(@wallets, c.wallet)", parameters: [{ name: "@since", value: since24h }, ...walletParams] } as any;
        const [{ resources: rCnt24 }, { resources: rSum24 }] = await Promise.all([
          c.items.query(qRecCnt24).fetchAll(),
          c.items.query(qRecSum24).fetchAll(),
        ]);
        receiptsCount24h = Number((rCnt24 && rCnt24[0]) || 0);
        receiptsTotalUsd24h = Number((rSum24 && rSum24[0]) || 0);
      } else {
        const qRecCnt24 = { query: "SELECT VALUE COUNT(1) FROM c WHERE c.type='receipt' AND c.status='paid' AND c.createdAt > @since", parameters: [{ name: "@since", value: since24h }] } as any;
        const qRecSum24 = { query: "SELECT VALUE SUM(c.totalUsd) FROM c WHERE c.type='receipt' AND c.status='paid' AND c.createdAt > @since", parameters: [{ name: "@since", value: since24h }] } as any;
        const [{ resources: rCnt24 }, { resources: rSum24 }] = await Promise.all([
          c.items.query(qRecCnt24).fetchAll(),
          c.items.query(qRecSum24).fetchAll(),
        ]);
        receiptsCount24h = Number((rCnt24 && rCnt24[0]) || 0);
        receiptsTotalUsd24h = Number((rSum24 && rSum24[0]) || 0);
      }

      // Average receipt USD
      averageReceiptUsd = receiptsCount > 0 ? Math.floor((receiptsTotalUsd * 100) / receiptsCount) / 100 : 0;

      // Sanity guard: if split_index data is unreasonably inflated (>10x receipt totals AND >$10k),
      // fall back to receipt-derived totals as the authoritative source.
      if (receiptsTotalUsd > 0 && merchantEarnedUsdTotal > receiptsTotalUsd * 10 && merchantEarnedUsdTotal > 10000) {
        merchantEarnedUsdTotal = receiptsTotalUsd;
      } else if (receiptsCount > 0 && merchantEarnedUsdTotal <= 0) {
        // If split_index returned 0 but we have receipts, use receipt totals
        merchantEarnedUsdTotal = receiptsTotalUsd;
      }

      // Merchants count by distinct wallet
      if (emptyWalletFilter) {
        merchantsCount = 0;
      } else if (hasWalletFilter) {
        const qWalletsQuery = { query: "SELECT DISTINCT VALUE c.wallet FROM c WHERE c.type='receipt' AND c.status='paid' AND ARRAY_CONTAINS(@wallets, c.wallet)", parameters: [...walletParams] } as any;
        const { resources: wRows } = await c.items.query(qWalletsQuery).fetchAll();
        merchantsCount = (wRows || []).length;
      } else {
        const qWalletsQuery = { query: "SELECT DISTINCT VALUE c.wallet FROM c WHERE c.type='receipt' AND c.status='paid'", parameters: [] } as any;
        const { resources: wRows } = await c.items.query(qWalletsQuery).fetchAll();
        merchantsCount = (wRows || []).length;
      }

      // Top currency
      if (emptyWalletFilter) {
        topCurrency = '';
      } else {
        const qCurr = hasWalletFilter
          ? { query: "SELECT VALUE c.currency FROM c WHERE c.type='receipt' AND c.status='paid' AND IS_DEFINED(c.currency) AND ARRAY_CONTAINS(@wallets, c.wallet)", parameters: [...walletParams] } as any
          : { query: "SELECT VALUE c.currency FROM c WHERE c.type='receipt' AND c.status='paid' AND IS_DEFINED(c.currency)", parameters: [] } as any;
        const { resources: currRows } = await c.items.query(qCurr).fetchAll();
        const currCounts: Record<string, number> = {};
        for (const row of (currRows || [])) {
          const cur = String(row || "").trim().toUpperCase();
          if (cur) currCounts[cur] = (currCounts[cur] || 0) + 1;
        }
        topCurrency = Object.entries(currCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      }
    } catch { }

    const averageSeconds = sessionsCount > 0 ? Math.floor(sessionsTotalSeconds / sessionsCount) : 0;
    const averageSeconds24h = sessionsCount24h > 0 ? Math.floor(sessionsSeconds24h / sessionsCount24h) : 0;
    // Canonical total session time: sum of usage events representing actual session increments
    const totalSeconds = totalSecondsAllTimeUsageEvents;
    return NextResponse.json({ metrics: { totalUsers, totalSeconds, totalSecondsAllTime, totalSummarizedSecondsAllTime: sessionsTotalSeconds, activeNowCount, totalLiveSecondsNow, topDomain, topLanguage, topPlatform, topTopic, sessionsCount, averageSeconds, sessionsCount24h, averageSeconds24h, sessionsCountRange, sessionsSecondsRange, averageSecondsRange, xpTotal, purchasedSecondsTotal, p50Seconds7d, p95Seconds7d, receiptsCount, receiptsTotalUsd, receiptsCount24h, receiptsTotalUsd24h, averageReceiptUsd, merchantsCount, topCurrency, merchantEarnedUsdTotal } });
  } catch (e: any) {
    return NextResponse.json({ metrics: { totalUsers: 0, totalSeconds: 0, topDomain: '', topLanguage: '', sessionsCount: 0, averageSeconds: 0, merchantEarnedUsdTotal: 0 }, degraded: true, reason: e?.message || 'cosmos_unavailable' });
  }
}
