import { getReceiptPricing, snapshotReceiptPricing } from "@/lib/receipt-currency";
import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { getReceipts, updateReceiptContent, pushReceipts, ReceiptMem } from "@/lib/receipts-mem";
import { requireApimOrJwt } from "@/lib/gateway-auth";
import { requireCsrf, rateLimitOrThrow, rateKey } from "@/lib/security";
import { assertOwnershipOrAdmin } from "@/lib/auth";

export const dynamic = 'force-dynamic';

function toCents(n: number) {
    return Math.round(Number(n || 0) * 100);
}
function fromCents(c: number) {
    return Math.round(c) / 100;
}

function genReceiptId(): string {
    const baseId = Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, "0");
    return `R-${baseId}`;
}

/**
 * POST /api/receipts/[id]/split
 * Header: x-wallet
 * Body: { items: Array<{ label: string, priceUsd: number, qty: number }> }
 * 
 * Logic:
 * 1. Find source receipt.
 * 2. Verify status (not paid).
 * 3. Verify items exist in source.
 * 4. Remove items from source (decrement qty or remove line).
 * 5. Create new receipt with these items.
 * 6. Save both.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const correlationId = crypto.randomUUID();
    const p = await ctx.params;
    const id = String(p?.id || "").trim();

    if (!id) {
        return NextResponse.json({ error: "missing_id" }, { status: 400 });
    }

    try {
        const body = await req.json().catch(() => ({}));
        const splitItems = Array.isArray(body?.items) ? body.items : [];

        // Auth & Rate Limit
        let caller: any;
        try {
            caller = await requireApimOrJwt(req, ["receipts:write"]);
        } catch (e: any) {
            // For dev/demo, allow if x-wallet present, but properly should rely on auth
            // If strict auth enabled, this will throw.
            // For now, if no auth, we might fallback to public check if designed for that, 
            // but typically split requires merchant/staff auth.
            // We'll return 401 if strict.
            return NextResponse.json({ error: "unauthorized" }, { status: 401 });
        }
        const wallet = caller.wallet;

        // Load Source Receipt
        let source: any = null;
        let isCosmos = false;
        const container = await getContainer();

        try {
            const { resource } = await container.item(`receipt:${id}`, wallet).read();
            if (resource) {
                source = resource;
                isCosmos = true;
            }
        } catch { }

        if (!source) {
            // Fallback mem
            const mem = getReceipts(undefined, wallet) as ReceiptMem[];
            source = mem.find(r => r.receiptId === id);
        }

        if (!source) {
            return NextResponse.json({ error: "receipt_not_found" }, { status: 404 });
        }

        if (["paid", "completed", "archived"].includes(source.status || "")) {
            return NextResponse.json({ error: "cannot_split_settled_receipt" }, { status: 400 });
        }

        // Mode check
        const mode = body.mode || "items"; // "items" | "ratio" | "multi_ratio"

        const sourceLines = [...(source.lineItems || [])];
        const newLines: any[] = [];
        const taxRate = source.taxRate || 0;

        // Helper
        const recalc = (lines: any[], rate: number) => {
            const sub = lines.reduce((s, it) => {
                let itemCost = toCents(it.priceUsd);
                if (Array.isArray(it.modifiers)) {
                    itemCost += it.modifiers.reduce((mS: number, m: any) => mS + toCents(m.price ?? m.priceUsd ?? 0), 0);
                }
                return s + (itemCost * (it.qty || 1));
            }, 0);
            const tax = Math.round(sub * rate);
            const finalLines = [...lines];
            if (tax > 0) finalLines.push({ label: "Tax", priceUsd: fromCents(tax) });
            const tot = fromCents(sub + tax);
            return { lines: finalLines, total: tot };
        };

        if (mode === "multi_ratio") {
            const ratios = Array.isArray(body.ratios) ? body.ratios : [];
            console.log("[SplitDebug] Ratios:", ratios);
            if (ratios.length < 2) return NextResponse.json({ error: "need_at_least_2_parties" }, { status: 400 });

            const sourceBase = sourceLines.reduce((s, it) => {
                if (["Tax", "Processing Fee", "Gratuity"].includes(it.label)) return s;
                // Include modifiers
                let itemCost = toCents(it.priceUsd);
                if (Array.isArray(it.modifiers)) {
                    itemCost += it.modifiers.reduce((mS: number, m: any) => mS + toCents(m.price ?? m.priceUsd ?? 0), 0);
                }
                return s + (itemCost * (it.qty || 1));
            }, 0);

            console.log("[SplitDebug] SourceBase (Cents):", sourceBase);

            // 2. Create Transfer Out lines for others
            // totalSplitAmount is what we are distributing to others
            let distributed = 0;
            const createdReceipts: any[] = [];

            // We iterate from 1 to N-1 (since 0 is source)
            for (let i = 1; i < ratios.length; i++) {
                const ratio = ratios[i];
                if (ratio <= 0) continue;

                // calculating share based on sourceBase
                const shareInCents = Math.round(sourceBase * ratio);
                const splitAmount = fromCents(shareInCents);

                // Add Transfer Out to Source
                sourceLines.push({
                    label: `Split Part ${i + 1}/${ratios.length} (${Math.round(ratio * 100)}%) Transfer Out`,
                    priceUsd: fromCents(-shareInCents),
                    qty: 1
                });

                // Create lines for new receipt
                const newRecLines = [];
                newRecLines.push({
                    label: `Split Part ${i + 1} Transfer In`,
                    priceUsd: Math.abs(splitAmount),
                    qty: 1
                });

                const newRecData = recalc(newRecLines, taxRate);
                const newId = genReceiptId();
                const ts = Date.now();

                createdReceipts.push({
                    id: `receipt:${newId}`,
                    type: "receipt",
                    wallet,
                    receiptId: newId,
                    totalUsd: newRecData.total,
                    currency: source.currency || "USD",
                    ...(source.pricing ? { pricing: snapshotReceiptPricing(getReceiptPricing(source)!, newRecData.lines, newRecData.total) } : {}),
                    lineItems: newRecData.lines,
                    createdAt: ts,
                    brandName: source.brandName,
                    recipientWallet: source.recipientWallet,
                    status: "provisional",
                    taxRate,
                    employeeId: source.employeeId,
                    staffId: source.staffId || source.employeeId,
                    servedBy: source.servedBy || source.employeeName,
                    sessionId: source.sessionId,
                    statusHistory: [{ status: "provisional", ts }],
                    lastUpdatedAt: ts,
                    tableNumber: source.tableNumber
                });
            }

            // Update Source
            const cleanSourceLines = sourceLines.filter(it => !["Tax", "Processing Fee"].includes(it.label));
            const updatedSourceData = recalc(cleanSourceLines, taxRate);
            console.log("[SplitDebug] Source Updated Total:", updatedSourceData.total);

            const updatedSourceDoc = {
                ...source,
                lineItems: updatedSourceData.lines,
                totalUsd: updatedSourceData.total,
                lastUpdatedAt: Date.now()
            };

            if (isCosmos) {
                await container.items.upsert(updatedSourceDoc);
                for (const r of createdReceipts) {
                    await container.items.create(r);
                }
            } else {
                updateReceiptContent(id, wallet, { lineItems: updatedSourceData.lines, totalUsd: updatedSourceData.total });
                pushReceipts(createdReceipts);
            }

            return NextResponse.json({
                ok: true,
                source: { id, total: updatedSourceData.total },
                newReceipts: createdReceipts.map(r => ({ id: r.receiptId, total: r.totalUsd }))
            });
        }

        if (mode === "ratio") {
            const ratio = Number(body.ratio);
            if (!ratio || ratio <= 0 || ratio >= 1) {
                return NextResponse.json({ error: "invalid_ratio" }, { status: 400 });
            }

            // Standard single split logic (from before)
            const sourceBase = sourceLines.reduce((s, it) => {
                if (["Tax", "Processing Fee"].includes(it.label)) return s;
                return s + toCents(it.priceUsd * (it.qty || 1));
            }, 0);

            const splitBase = Math.round(sourceBase * ratio);
            const splitAmount = fromCents(splitBase);
            const label = `Split ${Math.round(ratio * 100)}%`;

            sourceLines.push({
                label: `${label} Transfer Out`,
                priceUsd: -Math.abs(splitAmount),
                qty: 1
            });
            newLines.push({
                label: `${label} Transfer In`,
                priceUsd: Math.abs(splitAmount),
                qty: 1
            });

        } else if (mode === "reset") {
            const cleanLines = sourceLines.filter(it => !it.label.includes("Transfer Out") && !it.label.includes("Transfer In") && !it.label.includes("Split Part"));
            const resetData = recalc(cleanLines, taxRate);

            const ts = Date.now();
            const updatedSourceDoc = {
                ...source,
                lineItems: resetData.lines,
                totalUsd: resetData.total,
                lastUpdatedAt: ts
            };

            if (isCosmos) {
                await container.items.upsert(updatedSourceDoc);
            } else {
                updateReceiptContent(id, wallet, { lineItems: resetData.lines, totalUsd: resetData.total });
            }

            return NextResponse.json({ ok: true, source: { id, total: resetData.total } });

        } else {
            // Mode "items"
            const splitItems = Array.isArray(body?.items) ? body.items : [];
            if (!splitItems.length) {
                return NextResponse.json({ error: "no_items_to_split" }, { status: 400 });
            }

            const findMatchIndex = (item: any) => {
                return sourceLines.findIndex(l =>
                    l.label === item.label &&
                    Math.abs(l.priceUsd - item.priceUsd) < 0.01
                );
            };

            for (const item of splitItems) {
                const idx = findMatchIndex(item);
                if (idx === -1) {
                    return NextResponse.json({ error: `item_not_found_in_source: ${item.label}` }, { status: 400 });
                }
                const sourceLine = sourceLines[idx];
                const sourceQty = sourceLine.qty || 1;
                const splitQty = item.qty || 1;

                if (splitQty > sourceQty) {
                    return NextResponse.json({ error: `insufficient_qty_for: ${item.label}` }, { status: 400 });
                }

                newLines.push({ ...sourceLine, qty: splitQty });

                if (sourceQty - splitQty <= 0) {
                    sourceLines.splice(idx, 1);
                } else {
                    sourceLines[idx] = { ...sourceLine, qty: sourceQty - splitQty };
                }
            }
        }

        // Shared Finalization (for ratio/items)
        const cleanSourceLines = sourceLines.filter(it => !["Tax", "Processing Fee"].includes(it.label));
        const cleanNewLines = newLines.filter(it => !["Tax", "Processing Fee"].includes(it.label));

        const updatedSource = recalc(cleanSourceLines, taxRate);
        const newReceiptData = recalc(cleanNewLines, taxRate);

        const ts = Date.now();
        const updatedSourceDoc = {
            ...source,
            lineItems: updatedSource.lines,
            totalUsd: updatedSource.total,
            lastUpdatedAt: ts
        };

        const newId = genReceiptId();
        const newDoc = {
            id: `receipt:${newId}`,
            type: "receipt",
            wallet,
            receiptId: newId,
            totalUsd: newReceiptData.total,
            currency: source.currency || "USD",
            ...(source.pricing ? { pricing: snapshotReceiptPricing(getReceiptPricing(source)!, newReceiptData.lines, newReceiptData.total) } : {}),
            lineItems: newReceiptData.lines,
            createdAt: ts,
            brandName: source.brandName,
            recipientWallet: source.recipientWallet,
            status: "provisional",
            taxRate,
            employeeId: source.employeeId,
            staffId: source.staffId || source.employeeId,
            servedBy: source.servedBy || source.employeeName,
            sessionId: source.sessionId,
            statusHistory: [{ status: "provisional", ts }],
            lastUpdatedAt: ts,
            tableNumber: source.tableNumber
        };

        if (isCosmos) {
            await container.items.upsert(updatedSourceDoc);
            await container.items.create(newDoc);
        } else {
            updateReceiptContent(id, wallet, { lineItems: updatedSource.lines, totalUsd: updatedSource.total });
            pushReceipts([newDoc as any]);
        }

        return NextResponse.json({
            ok: true,
            source: { id, total: updatedSource.total },
            newReceipt: { id: newId, total: newReceiptData.total }
        });

    } catch (e: any) {
        return NextResponse.json({ error: e.message || "failed" }, { status: 500 });
    }
}
