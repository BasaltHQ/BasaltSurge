import { NextRequest, NextResponse } from "next/server";
// [DEBUG] Force Rebuild: 2026-01-25 10:22 PM
import { getContainer } from "@/lib/cosmos";
import { renderToStream } from "@react-pdf/renderer";
import { EndOfDayPDF } from "@/components/reports/EndOfDayPDF";
import { LedgerPDF } from "@/components/reports/LedgerPDF";
import JSZip from "jszip";
import React from "react";
import sharp from "sharp";

const BLOCKED_URL_PART = "a311dcf8";
const LEGACY_LOGO = "cblogod.png";

function sanitizeShopTheme(theme: any) {
    if (!theme) return theme;
    const t = { ...theme };
    if (t.brandLogoUrl && (t.brandLogoUrl.includes(BLOCKED_URL_PART) || t.brandLogoUrl.includes(LEGACY_LOGO))) {
        t.brandLogoUrl = "/BasaltSurgeWideD.png";
    }
    if (t.brandFaviconUrl && (t.brandFaviconUrl.includes(BLOCKED_URL_PART) || t.brandFaviconUrl.includes(LEGACY_LOGO))) {
        t.brandFaviconUrl = "/Surge.png";
    }
    return t;
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);

        // Params
        const type = searchParams.get("type") || "z-report"; // z-report, x-report, employee, hourly, ledger
        const format = searchParams.get("format") || "json"; // json, zip
        const rawStart = Number(searchParams.get("start"));
        const isAllTime = rawStart === 0; // "all time" sends start=0
        const startTs = rawStart || Math.floor(new Date(2025, 9, 1).getTime() / 1000); // fallback: Oct 1, 2025
        const endTs = Number(searchParams.get("end")) || Math.floor(Date.now() / 1000);

        // Auth Context
        const sessionId = searchParams.get("sessionId"); // Terminal Access
        // Optional: Filter by specific employee
        const filterEmployeeId = searchParams.get("employeeId"); // Employee filter
        // Allow fallback to query params for direct PDF/Link access
        const adminWallet = req.headers.get("x-linked-wallet") || searchParams.get("linkedWallet");
        const targetMerchantWallet = req.headers.get("x-wallet") || searchParams.get("wallet");

        console.log("[ReportsAPI] Debug Params:", {
            url: req.url,
            searchParams: searchParams.toString(),
            adminWalletHeader: req.headers.get("x-linked-wallet"),
            adminWalletParam: searchParams.get("linkedWallet"),
            finalAdminWallet: adminWallet
        });

        if (!searchParams.has("start") || !searchParams.has("end") || !targetMerchantWallet) {
            return NextResponse.json({ error: "Missing required params (start, end, wallet)" }, { status: 400 });
        }

        const container = await getContainer();
        const w = String(targetMerchantWallet).toLowerCase();

        // Enforce Partner Isolation
        const ct = String(process.env.NEXT_PUBLIC_CONTAINER_TYPE || process.env.CONTAINER_TYPE || "platform").toLowerCase();
        const branding = {
            key: String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase()
        };

        if (ct === "partner") {
            if (!branding.key) {
                console.error("[Reports] Partner container missing BRAND_KEY");
                return NextResponse.json({ error: "Configuration error" }, { status: 500 });
            }

            // Verify merchant belongs to this brand using multi-source resolution:
            // Priority: site_config.brandKey > split_index.brandKey > shop_config.theme.brandKey
            const [{ resources: siteConfigs }, { resources: shopConfigs }, { resources: splitConfigs }] = await Promise.all([
                container.items.query({
                    query: "SELECT c.brandKey FROM c WHERE c.type = 'site_config' AND c.wallet = @w",
                    parameters: [{ name: "@w", value: w }]
                }).fetchAll(),
                container.items.query({
                    query: "SELECT c.theme.brandKey AS brandKey FROM c WHERE c.type = 'shop_config' AND c.wallet = @w",
                    parameters: [{ name: "@w", value: w }]
                }).fetchAll(),
                container.items.query({
                    query: "SELECT c.brandKey FROM c WHERE c.type = 'split_index' AND c.merchantWallet = @w",
                    parameters: [{ name: "@w", value: w }]
                }).fetchAll(),
            ]);

            // 3-pass resolution: site_config > split_index > shop_config
            const merchantBrand = String(
                siteConfigs?.[0]?.brandKey || splitConfigs?.[0]?.brandKey || shopConfigs?.[0]?.brandKey || ""
            ).toLowerCase();

            // Normalize: platform brands (portalpay/basaltsurge) are equivalent
            const isPlatformBrandKey = (k: string) => !k || k === "portalpay" || k === "basaltsurge";
            const brandMatches = isPlatformBrandKey(branding.key)
                ? isPlatformBrandKey(merchantBrand)
                : merchantBrand === branding.key;

            if (!brandMatches) {
                console.warn(`[Reports] Blocked cross-brand access: Merchant ${merchantBrand || "(none)"} trying to access report on ${branding.key}`);
                return NextResponse.json({ error: "Unauthorized for this brand" }, { status: 403 });
            }
        }

        // --- AUTHENTICATION ---
        let authorized = false;
        let staffName = "Admin";

        if (sessionId) {
            // 1. Terminal Session Authentication
            const sessionQuery = {
                query: "SELECT * FROM c WHERE c.id = @id AND c.type = 'terminal_session'",
                parameters: [{ name: "@id", value: sessionId }]
            };
            const { resources: sessions } = await container.items.query(sessionQuery).fetchAll();
            const session = sessions[0];

            if (session && session.merchantWallet === w) {
                const role = String(session.role || "").toLowerCase();
                if (role === "manager" || role === "keyholder") {
                    authorized = true;
                    staffName = session.staffName || "Staff";
                }
            } else {
                console.warn("[ReportsAPI] Invalid Session:", sessionId, session ? "Mismatch Wallet" : "Not Found");
            }
        } else if (adminWallet) {
            // 2. Admin Authentication (Multi-Org Linked Wallet)
            const requestWallet = String(adminWallet).toLowerCase();

            console.log(`[ReportsAPI] Admin Auth Check: Requesting=${requestWallet} Target=${w}`);

            // A. Owner Bypass: If the requesting wallet IS the merchant wallet, allow access.
            if (requestWallet === w) {
                authorized = true;
                staffName = "Owner";
                console.log("[ReportsAPI] Owner Bypass Granted");
            } else {
                // B. Platform/Partner Admin Bypass: Check if the requesting wallet is a recognized admin
                const ownerEnv = String(process.env.NEXT_PUBLIC_OWNER_WALLET || "").toLowerCase();
                const platformEnv = String(process.env.NEXT_PUBLIC_PLATFORM_WALLET || "").toLowerCase();
                const adminList = String(process.env.ADMIN_WALLETS || "")
                    .split(",")
                    .map((s) => s.trim().toLowerCase())
                    .filter(Boolean);

                if (requestWallet === ownerEnv || requestWallet === platformEnv || adminList.includes(requestWallet)) {
                    authorized = true;
                    staffName = "Platform Admin";
                    console.log("[ReportsAPI] Platform Admin Access Granted via Env");
                } else {
                    // Check resolveAdminRole for partner admins or platform admins in DB
                    try {
                        const [{ resources: siteConfigs }, { resources: shopConfigs }, { resources: splitConfigs }] = await Promise.all([
                            container.items.query({
                                query: "SELECT c.brandKey FROM c WHERE c.type = 'site_config' AND c.wallet = @w",
                                parameters: [{ name: "@w", value: w }]
                            }).fetchAll(),
                            container.items.query({
                                query: "SELECT c.theme.brandKey AS brandKey FROM c WHERE c.type = 'shop_config' AND c.wallet = @w",
                                parameters: [{ name: "@w", value: w }]
                            }).fetchAll(),
                            container.items.query({
                                query: "SELECT c.brandKey FROM c WHERE c.type = 'split_index' AND c.merchantWallet = @w",
                                parameters: [{ name: "@w", value: w }]
                            }).fetchAll(),
                        ]);

                        const merchantBrand = String(
                            siteConfigs?.[0]?.brandKey || splitConfigs?.[0]?.brandKey || shopConfigs?.[0]?.brandKey || ""
                        ).toLowerCase();

                        const { resolveAdminRole } = await import("@/lib/authz-server");
                        const role = await resolveAdminRole(requestWallet, merchantBrand || undefined);
                        if (role && (role.startsWith("partner_") || role.startsWith("platform_"))) {
                            authorized = true;
                            staffName = role.includes("partner") ? "Partner Admin" : "Platform Admin";
                            console.log(`[ReportsAPI] DB Admin Access Granted: ${role} on brand: ${merchantBrand}`);
                        }
                    } catch (err) {
                        console.error("[ReportsAPI] DB Admin check failed:", err);
                    }
                }

                if (!authorized) {
                    // C. Manager Delegated Access
                    const memberQuery = {
                        query: "SELECT * FROM c WHERE c.merchantWallet = @mw AND c.type = 'merchant_team_member' AND c.linkedWallet = @lw AND (c.role = 'manager' OR c.role = 'owner')",
                        parameters: [
                            { name: "@mw", value: w },
                            { name: "@lw", value: requestWallet }
                        ]
                    };
                    const { resources: members } = await container.items.query(memberQuery).fetchAll();
                    if (members.length > 0) {
                        authorized = true;
                        staffName = members[0].name;
                        console.log("[ReportsAPI] Manager/Team Access Granted");
                    } else {
                        console.warn("[ReportsAPI] Team Member Not Found for:", requestWallet);
                    }
                }
            }
        } else {
            console.warn("[ReportsAPI] No Auth Provided (Missing x-linked-wallet or session)");
        }

        if (!authorized) {
            console.error("[ReportsAPI] Unauthorized Access Attempt", { targetMerchantWallet, adminWallet, sessionId });
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        // --- DATA AGGREGATION ---

        // ... Data Fetching ...

        // (Skipping large data fetching block for Replace call)

        // ... (Skipping to Response) ...

        // This tool call only replaces the Auth Block. I will do Format replacement separately.


        // --- DATA AGGREGATION ---

        // Base Receipt Query
        // NOTE: Receipts use `wallet` field, NOT `merchantWallet`
        let receiptsQueryString = `
            SELECT c.id, c.totalUsd, c.tipAmount, c.currency, c.paymentMethod, c.createdAt, 
                   c.employeeId, c.staffId, c.employeeName, c.servedBy, c.sessionId, c.sessionStartTime
            FROM c 
            WHERE c.type = 'receipt' 
            AND c.wallet = @w 
            AND LOWER(c.status) IN ('paid', 'checkout_success', 'confirmed', 'tx_mined', 'reconciled', 'settled', 'completed')
        `;
        const receiptsParams: { name: string; value: any }[] = [
            { name: "@w", value: w },
        ];

        // Only apply time bounds for non-all-time queries
        if (!isAllTime) {
            receiptsQueryString += ` AND c.createdAt >= @startDate AND c.createdAt <= @endDate`;
            receiptsParams.push(
                { name: "@startDate", value: new Date(startTs * 1000) },
                { name: "@endDate", value: new Date(endTs * 1000) }
            );
        }

        // Optional employee filter
        if (filterEmployeeId) {
            receiptsQueryString += ` AND (c.employeeId = @empId OR c.staffId = @empId)`;
            receiptsParams.push({ name: "@empId", value: filterEmployeeId });
        }

        const { resources: receipts } = await container.items.query({
            query: receiptsQueryString,
            parameters: receiptsParams
        }).fetchAll();

        // Calculate Stats
        const totalSales = receipts.reduce((acc: number, r: any) => acc + (r.totalUsd || 0), 0);
        const totalTips = receipts.reduce((acc: number, r: any) => acc + (r.tipAmount || 0), 0);
        const transactionCount = receipts.length;
        const averageOrderValue = transactionCount > 0 ? totalSales / transactionCount : 0;
        const net = totalSales - 0; // Refunds not yet tracked fully?

        // Payment Methods Breakdown
        const methodMap = new Map<string, number>();
        for (const r of receipts) {
            const m = r.paymentMethod || r.currency || "Unknown";
            const val = r.totalUsd || 0;
            methodMap.set(m, (methodMap.get(m) || 0) + val);
        }
        const paymentMethods = Array.from(methodMap.entries()).map(([method, total]) => ({ method, total }));

        // Specialized Data based on Type
        let detailedData: any = {};

        if (type === "employee" || type === "z-report") {
            // Track per-employee stats including sessions
            const empMap = new Map<string, {
                sales: number,
                tips: number,
                count: number,
                name: string,
                sessions: Set<string>,
                firstSale: number,
                lastSale: number
            }>();

            for (const r of receipts) {
                const eid = r.employeeId || r.staffId || "Unknown";
                const ename = r.employeeName || r.servedBy || "";
                if (!empMap.has(eid)) {
                    empMap.set(eid, {
                        sales: 0,
                        tips: 0,
                        count: 0,
                        name: ename,
                        sessions: new Set(),
                        firstSale: r.createdAt || Date.now(),
                        lastSale: r.createdAt || Date.now()
                    });
                }
                const e = empMap.get(eid)!;
                e.sales += (r.totalUsd || 0);
                e.tips += (r.tipAmount || 0);
                e.count += 1;
                if (r.sessionId) e.sessions.add(r.sessionId);
                if (!e.name && ename) e.name = ename;
                if (r.createdAt && r.createdAt < e.firstSale) e.firstSale = r.createdAt;
                if (r.createdAt && r.createdAt > e.lastSale) e.lastSale = r.createdAt;
            }

            detailedData.employees = Array.from(empMap.entries()).map(([id, stats]) => ({
                id,
                name: stats.name || id,
                sales: stats.sales,
                tips: stats.tips,
                count: stats.count,
                aov: stats.count > 0 ? stats.sales / stats.count : 0,
                sessionCount: stats.sessions.size,
                activeHours: Math.round((stats.lastSale - stats.firstSale) / (1000 * 60 * 60) * 10) / 10 // hours with 1 decimal
            }));
        } else if (type === "hourly") {
            const hourMap = new Array(24).fill(0);
            for (const r of receipts) {
                const d = new Date(r.createdAt || 0);
                const h = d.getHours(); // This uses Server Time (UTC probably), client might need local adjust.
                // Ideally we use local offset passed in params, but for now simplistic UTC mapping 
                hourMap[h] += (r.totalUsd || 0);
            }
            detailedData.hourly = hourMap.map((amount, hour) => ({ hour, amount }));
        }

        // Include Sessions for End of Day Reports with brandKey filtering
        if (type === "z-report" || type === "x-report") {
            // Build session query with optional brandKey filter
            let sessionsQueryString = `SELECT * FROM c WHERE c.type = 'terminal_session' AND c.merchantWallet = @w AND c.startTime >= @start AND c.startTime <= @end`;
            const sessionsParams: { name: string; value: any }[] = [
                { name: "@w", value: w },
                { name: "@start", value: startTs },
                { name: "@end", value: endTs }
            ];

            // Add brandKey filter for partner containers
            if (ct === "partner" && branding.key) {
                sessionsQueryString += ` AND c.brandKey = @bk`;
                sessionsParams.push({ name: "@bk", value: branding.key });
            }

            // Optional employee filter for sessions
            if (filterEmployeeId) {
                sessionsQueryString += ` AND c.staffId = @staffId`;
                sessionsParams.push({ name: "@staffId", value: filterEmployeeId });
            }

            sessionsQueryString += ` ORDER BY c.startTime DESC`;

            const { resources: sess } = await container.items.query({
                query: sessionsQueryString,
                parameters: sessionsParams
            }).fetchAll();

            // Backfill orphaned sessions: sessions without endTime get endTime = next session's startTime - 1
            // Group sessions by staffId, sort by startTime ascending, then backfill
            const sessionsByStaff = new Map<string, any[]>();
            for (const s of sess) {
                const staffId = s.staffId || "unknown";
                if (!sessionsByStaff.has(staffId)) sessionsByStaff.set(staffId, []);
                sessionsByStaff.get(staffId)!.push(s);
            }

            // Process each staff's sessions
            const backfillOps: Promise<any>[] = [];
            for (const [staffId, staffSessions] of sessionsByStaff) {
                // Sort by startTime ascending (oldest first)
                staffSessions.sort((a, b) => a.startTime - b.startTime);

                for (let i = 0; i < staffSessions.length - 1; i++) {
                    const current = staffSessions[i];
                    const next = staffSessions[i + 1];

                    // If current session has no endTime and there's a subsequent session
                    if (!current.endTime && next.startTime) {
                        const inferredEndTime = next.startTime - 1;
                        current.endTime = inferredEndTime; // Update in-memory for response

                        // Persist to database (fire and forget for performance)
                        backfillOps.push(
                            container.item(current.id, w).patch([
                                { op: "set", path: "/endTime", value: inferredEndTime }
                            ]).catch((e: any) => console.warn(`[Reports] Failed to backfill session ${current.id}:`, e.message))
                        );
                    }
                }
            }

            // Wait for backfill operations to complete (optional, can be fire-and-forget)
            if (backfillOps.length > 0) {
                await Promise.allSettled(backfillOps);
            }

            // Build a map of sessionId -> { totalSales, totalTips } from receipts
            // Normalize to lowercase for consistent matching
            const sessionSalesMap = new Map<string, { sales: number; tips: number }>();
            for (const r of receipts) {
                if (r.sessionId) {
                    const normalizedId = String(r.sessionId).toLowerCase();
                    const current = sessionSalesMap.get(normalizedId) || { sales: 0, tips: 0 };
                    current.sales += (r.totalUsd || 0);
                    current.tips += (r.tipAmount || 0);
                    sessionSalesMap.set(normalizedId, current);
                }
            }

            detailedData.sessions = sess.map((s: any) => {
                // Calculate duration in minutes
                const duration = s.endTime
                    ? Math.round((s.endTime - s.startTime) / 60)
                    : Math.round((Math.floor(Date.now() / 1000) - s.startTime) / 60);

                // Get aggregated sales from receipts with this sessionId (normalized to lowercase)
                const normalizedSessionId = String(s.id || "").toLowerCase();
                const sessionStats = sessionSalesMap.get(normalizedSessionId) || { sales: 0, tips: 0 };

                return {
                    id: s.id,
                    staffId: s.staffId,
                    staffName: s.staffName,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    duration, // minutes
                    durationFormatted: `${Math.floor(duration / 60)}h ${duration % 60}m`,
                    totalSales: sessionStats.sales,
                    totalTips: sessionStats.tips,
                    isActive: !s.endTime,
                    brandKey: s.brandKey
                };
            });
        }

        // Enrich Employee Names
        if (detailedData.employees) {
            const ids = detailedData.employees.map((e: any) => e.id).filter((id: string) => id !== "Unknown");
            if (ids.length > 0) {
                // Fetch names for IDs
                const nameQuery = {
                    query: `SELECT c.id, c.name FROM c WHERE c.type = 'merchant_team_member' AND c.merchantWallet = @w AND ARRAY_CONTAINS(@ids, c.id)`,
                    parameters: [{ name: "@w", value: w }, { name: "@ids", value: ids }]
                };
                const { resources: members } = await container.items.query(nameQuery).fetchAll();
                const nameMap: Record<string, string> = {};
                members.forEach((m: any) => nameMap[m.id] = m.name);

                detailedData.employees = detailedData.employees.map((e: any) => ({
                    ...e,
                    name: nameMap[e.id] || e.id
                }));
            }
        }

        // --- SPLIT INDEX / ON-CHAIN TRANSACTION DATA ---
        // Only for "all time" queries: provide split_index totals and on-chain tx details
        let splitIndex: any = null;
        let splitTransactions: any[] = [];

        if (isAllTime) {
            try {
                // Fetch the comprehensive split_index document (now includes per-tx details)
                const { resources: splitIdxRes } = await container.items.query({
                    query: "SELECT * FROM c WHERE c.type = 'split_index' AND c.merchantWallet = @w",
                    parameters: [{ name: "@w", value: w }]
                }).fetchAll();

                if (splitIdxRes.length > 0) {
                    splitIndex = splitIdxRes[0];

                    // Use embedded transactions array if available (post-enhancement)
                    if (Array.isArray(splitIndex.transactions) && splitIndex.transactions.length > 0) {
                        splitTransactions = splitIndex.transactions;
                    }
                }

                // Fallback: if split_index doesn't have embedded transactions
                // (backward compat for pre-enhancement indexed data)
                if (splitTransactions.length === 0) {
                    const { resources: splitTxRes } = await container.items.query({
                        query: "SELECT c.hash, c.token, c.value, c.timestamp, c.txType, c.releaseType, c.from, c.to, c.blockNumber FROM c WHERE c.type = 'split_transaction' AND c.merchantWallet = @w ORDER BY c.timestamp DESC",
                        parameters: [{ name: "@w", value: w }]
                    }).fetchAll();
                    splitTransactions = splitTxRes || [];
                }
            } catch (e) {
                console.warn("[ReportsAPI] Failed to fetch split data:", e);
            }
        }

        const reportData = {
            meta: {
                type,
                generatedBy: staffName,
                date: new Date(startTs * 1000).toISOString(),
                range: { start: startTs, end: endTs }
            },
            summary: {
                totalSales: isAllTime && splitIndex && receipts.length === 0 ? splitIndex.totalVolumeUsd : totalSales,
                totalTips,
                transactionCount: isAllTime && splitIndex && receipts.length === 0 ? splitIndex.transactionCount : transactionCount,
                averageOrderValue,
                net,
                merchantEarned: isAllTime ? (splitIndex?.merchantEarnedUsd || 0) : 0,
                platformFee: isAllTime ? (splitIndex?.platformFeeUsd || 0) : 0,
            },
            paymentMethods,
            ...detailedData,
            splitIndex: isAllTime ? (splitIndex || null) : null,
            splitTransactions: isAllTime ? splitTransactions.map((tx: any) => ({
                hash: tx.hash,
                token: tx.token,
                value: tx.value,
                valueUsd: tx.valueUsd || null,
                timestamp: tx.timestamp,
                txType: tx.txType || tx.type,
                from: tx.from,
                to: tx.to,
                blockNumber: tx.blockNumber,
                releaseType: tx.releaseType || null,
            })) : [],
            receipts: receipts.map((r: any) => ({
                id: r.id,
                totalUsd: r.totalUsd,
                currency: r.currency,
                paymentMethod: r.paymentMethod,
                createdAt: r.createdAt,
                employeeId: r.employeeId
            }))
        };

        // --- RESPONSE FORMAT ---

        console.log(`[ReportsAPI] Auth Success: ${staffName} accessing ${w}`);

        if (format === "json") {
            return NextResponse.json(reportData);
        } else if (format === "zip" || format === "pdf") {
            // --- MERCHANT BRANDING RESOLUTION ---
            // Multi-source: query param override > site_config > shop_config > fallback
            const merchantNameOverride = searchParams.get("merchantName");

            const configQuery = {
                query: "SELECT * FROM c WHERE LOWER(c.wallet) = @w AND c.type = 'shop_config'",
                parameters: [{ name: "@w", value: w }]
            };
            const { resources: configs } = await container.items.query(configQuery).fetchAll();
            let config = configs[0];

            // Also try site_config for display name (more reliable for partner-onboarded merchants)
            let siteDisplayName = "";
            try {
                const { resources: siteConfigs } = await container.items.query({
                    query: "SELECT c.displayName, c.shopName, c.name FROM c WHERE c.type = 'site_config' AND c.wallet = @w",
                    parameters: [{ name: "@w", value: w }]
                }).fetchAll();
                if (siteConfigs?.[0]) {
                    siteDisplayName = siteConfigs[0].displayName || siteConfigs[0].shopName || siteConfigs[0].name || "";
                }
            } catch (e) {
                console.warn("[ReportsAPI] site_config lookup failed:", e);
            }

            if (!config) {
                config = { name: "Merchant", theme: {} };
            }
            if (!config.theme) config.theme = {};

            // Resolve brand name: query param > site_config > shop_config > fallback
            const resolvedBrandName = merchantNameOverride || siteDisplayName || config.name || "Merchant";

            if (config.theme) config.theme = sanitizeShopTheme(config.theme);

            // FIX: Ensure Logo is Absolute URL for PDF Renderer (server-side needs host)
            if (config.theme?.brandLogoUrl && config.theme.brandLogoUrl.startsWith("/")) {
                const origin = req.nextUrl.origin;
                config.theme.brandLogoUrl = `${origin}${config.theme.brandLogoUrl}`;
            }

            // FIX: Convert WebP to PNG using Sharp (React-PDF doesn't support WebP)
            if (config.theme?.brandLogoUrl) {
                try {
                    const logoUrl = config.theme.brandLogoUrl;
                    const response = await fetch(logoUrl);
                    if (response.ok) {
                        const arrayBuffer = await response.arrayBuffer();
                        const buffer = Buffer.from(arrayBuffer);

                        // Convert to PNG using sharp
                        const pngBuffer = await sharp(buffer).png().toBuffer();
                        const base64Info = pngBuffer.toString('base64');
                        config.theme.brandLogoUrl = `data:image/png;base64,${base64Info}`;
                        console.log(`[ReportsAPI] Transcoded Logo to PNG (${Math.round(pngBuffer.length / 1024)}KB)`);
                    }
                } catch (e) {
                    console.warn("[ReportsAPI] Logo transcoding failed:", e);
                    // Fallback to text (undefined logo) or original (might fail)
                    // If transcoding fails, react-pdf might still crash on original webp, so safer to unset
                    if (config.theme.brandLogoUrl.endsWith(".webp")) {
                        config.theme.brandLogoUrl = undefined;
                    }
                }
            }

            console.log(`[ReportsAPI] PDF Branding: Name='${resolvedBrandName}' (override=${merchantNameOverride || 'none'}, site=${siteDisplayName || 'none'}, shop=${config.name || 'none'}) Logo='${config.theme?.brandLogoUrl ? 'Present (DataURI)' : 'None'}' Color='${config.theme?.primaryColor}'`);

            const reportTitleMap: Record<string, string> = {
                "z-report": "End of Day Report (Z)",
                "x-report": "Snapshot Report (X)",
                "employee": "Employee Performance Report",
                "hourly": "Hourly Sales Report",
                "ledger": "Transaction Ledger"
            };

            // PDF — use LedgerPDF for ledger type, EndOfDayPDF for everything else
            let pdfStream;
            if (type === "ledger") {
                const dateRangeStr = isAllTime
                    ? "All Time"
                    : `${new Date(startTs * 1000).toLocaleDateString()} — ${new Date(endTs * 1000).toLocaleDateString()}`;

                // Fetch multi-token USD prices for on-chain value conversion
                let tokenPrices: Record<string, number> = {};
                try {
                    const { fetchEthUsd, fetchBtcUsd, fetchXrpUsd, fetchSolUsd } = await import("@/lib/eth");
                    const [ethUsd, btcUsd, xrpUsd, solUsd] = await Promise.all([
                        fetchEthUsd(), fetchBtcUsd(), fetchXrpUsd(), fetchSolUsd()
                    ]);
                    tokenPrices = {
                        ETH: ethUsd, WETH: ethUsd,
                        BTC: btcUsd, cbBTC: btcUsd, WBTC: btcUsd,
                        XRP: xrpUsd, cbXRP: xrpUsd,
                        SOL: solUsd,
                        USDC: 1, USDT: 1, DAI: 1, USD: 1,
                    };
                } catch (e) {
                    console.warn("[ReportsAPI] Token price fetch failed:", e);
                }

                // Map split transactions with USD conversion
                const enrichedSplitTx = splitTransactions.map((tx: any) => {
                    const rawValue = Number(tx.value || 0);
                    let valueUsd = Number(tx.valueUsd || 0);
                    // If no pre-indexed USD value, convert using live prices
                    if (!valueUsd && rawValue > 0 && tx.token) {
                        const price = tokenPrices[tx.token] || tokenPrices[tx.token?.toUpperCase()] || 0;
                        valueUsd = rawValue * price;
                    }
                    return {
                        hash: tx.hash,
                        token: tx.token,
                        value: rawValue,
                        valueUsd,
                        timestamp: tx.timestamp,
                        txType: tx.txType || tx.type,
                        releaseType: tx.releaseType || null,
                    };
                });

                pdfStream = await renderToStream(
                    <LedgerPDF
                        brandName={resolvedBrandName}
                        brandColor={config.theme?.primaryColor || config.theme?.brandColor}
                        date={new Date().toLocaleDateString()}
                        dateRange={dateRangeStr}
                        generatedBy={staffName}
                        receipts={receipts.map((r: any) => ({
                            id: r.id,
                            totalUsd: r.totalUsd || 0,
                            currency: r.currency,
                            paymentMethod: r.paymentMethod,
                            createdAt: r.createdAt,
                        }))}
                        splitTransactions={enrichedSplitTx}
                    />
                );
            } else {
                pdfStream = await renderToStream(
                    <EndOfDayPDF
                        brandName={resolvedBrandName}
                        logoUrl={config.theme?.brandLogoUrl}
                        brandColor={config.theme?.primaryColor || config.theme?.brandColor}
                        date={new Date(startTs * 1000).toLocaleDateString()}
                        generatedBy={staffName}
                        reportTitle={reportTitleMap[type] || "Report"}
                        stats={{
                            totalSales,
                            totalTips,
                            transactionCount,
                            averageOrderValue
                        }}
                        paymentMethods={paymentMethods}
                        employees={detailedData.employees}
                        hourly={detailedData.hourly}
                        showPayments={type === "z-report" || type === "x-report"}
                        showEmployeeStats={type === "z-report" || type === "x-report" || type === "employee"}
                        showHourlyStats={type === "z-report" || type === "x-report" || type === "hourly"}
                    />
                );
            }

            // Stream to Buffer
            const chunks: Uint8Array[] = [];
            for await (const chunk of pdfStream) chunks.push(chunk as Uint8Array);
            const pdfBuffer = Buffer.concat(chunks);

            if (format === "pdf") {
                return new NextResponse(new Blob([pdfBuffer]), {
                    headers: {
                        "Content-Type": "application/pdf",
                        "Content-Disposition": `attachment; filename="${type}-report-${startTs}.pdf"`
                    }
                });
            }

            // CSV
            let csv = "";

            if (type === "employee" && detailedData.employees) {
                const header = "EmployeeID,Sales,Tips,Orders,AvgOrder\n";
                const rows = detailedData.employees.map((e: any) =>
                    `${e.id},${e.sales},${e.tips},${e.count},${e.aov}`
                ).join("\n");
                csv = header + rows;
            } else if (type === "hourly" && detailedData.hourly) {
                const header = "Hour,SalesAmount\n";
                const rows = detailedData.hourly.map((h: any) =>
                    `${h.hour}:00,${h.amount}`
                ).join("\n");
                csv = header + rows;
            } else if (type === "ledger") {
                // Ledger CSV: all transactions unified
                const csvHeader = "#,Date,Type,Method,AmountUSD,Reference\n";
                const allEntries: any[] = [];
                for (const r of receipts) {
                    const isCash = String(r.paymentMethod || '').toLowerCase() === 'cash';
                    allEntries.push({
                        date: r.createdAt ? new Date(r.createdAt).toISOString() : '',
                        type: isCash ? 'Cash' : 'Receipt',
                        method: isCash ? 'Cash' : (r.paymentMethod || r.currency || 'Crypto'),
                        amount: r.totalUsd || 0,
                        ref: r.id || '',
                        sortKey: r.createdAt || 0,
                    });
                }
                for (const tx of splitTransactions) {
                    allEntries.push({
                        date: tx.timestamp ? new Date(tx.timestamp).toISOString() : '',
                        type: 'On-Chain',
                        method: tx.token || 'Token',
                        amount: tx.valueUsd || Number(tx.value || 0),
                        ref: tx.hash || '',
                        sortKey: tx.timestamp ? new Date(tx.timestamp).getTime() : 0,
                    });
                }
                allEntries.sort((a: any, b: any) => b.sortKey - a.sortKey);
                const csvRows = allEntries.map((e: any, i: number) => `${i + 1},${e.date},${e.type},${e.method},${e.amount},${e.ref}`);
                csv = csvHeader + csvRows.join("\n");
            } else {
                // Default Z/X Report (Receipt Dump)
                const rows = receipts.map((r: any) => {
                    return `${r.currency},${r.paymentMethod || 'Unknown'},${r.totalUsd},${r.employeeId || ''},${new Date(r.createdAt || 0).toISOString()}`;
                });
                csv = "Currency,Method,AmountUSD,EmployeeID,Date\n" + rows.join("\n");
            }

            // Zip
            const zip = new JSZip();
            zip.file(`${type}_report.pdf`, pdfBuffer);
            zip.file(`${type}_data.csv`, csv);

            const zipData = await zip.generateAsync({ type: "uint8array" });

            return new NextResponse(new Blob([zipData as any]), {
                headers: {
                    "Content-Type": "application/zip",
                    "Content-Disposition": `attachment; filename="${type}-report-${startTs}.zip"`
                }
            });
        }

        return NextResponse.json({ error: "Invalid format" }, { status: 400 });

    } catch (e: any) {
        console.error("Report API Error", e);
        return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
    }
}
