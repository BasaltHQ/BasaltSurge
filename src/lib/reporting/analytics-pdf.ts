// Professional PDF Generation Engine for Platform Analytics
// Dynamically imports jsPDF and jspdf-autotable for client-side generation

interface Stat {
  totalCreated: number;
  totalPaid: number;
  totalFailed: number;
  successRate: number;
  dedupedTotalCreated?: number;
  dedupedTotalPaid?: number;
  dedupedTotalFailed?: number;
  trueIntegrationRate?: number;
  trueProcessRate?: number;
  totalGmv: number;
  totalFees: number;
  aov: number;
  cardTypes: { credit: number; debit: number; bank: number; unknown: number };
}

interface BrandStat {
  brandKey: string;
  brandName: string;
  total: number;
  paid: number;
  failed: number;
  gmv: number;
  fees: number;
  successRate: number;
  trueSuccessRate?: number;
}

interface FailureReason {
  reason: string;
  count: number;
}

interface ReceiptItem {
  receiptId: string;
  brandKey: string;
  brandName?: string;
  merchantName?: string | null;
  status: string;
  totalUsd: number;
  createdAt: string;
  email: string;
  stripeSessionId?: string | null;
  transactionHash?: string | null;
  cardFunding?: string | null;
  kycLevel?: string;
  platformFee?: number;
  failureReason?: string | null;
}

type PdfOrientation = "portrait" | "landscape";

const PDF_COLORS = {
  ink: [226, 232, 240] as [number, number, number],
  muted: [148, 163, 184] as [number, number, number],
  panel: [15, 23, 42] as [number, number, number],
  panelAlt: [30, 41, 59] as [number, number, number],
  primary: [59, 130, 246] as [number, number, number],
  violet: [139, 92, 246] as [number, number, number],
  success: [16, 185, 129] as [number, number, number],
  danger: [225, 29, 72] as [number, number, number]
};

function pdfText(value: unknown, maxLength = 240): string {
  const text = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2022/g, "|")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

function sanitizeTableRows(rows: unknown[][]): string[][] {
  return rows.map(row => row.map(cell => pdfText(cell)));
}

function fitPdfText(doc: any, value: unknown, maxWidth: number): string {
  const text = pdfText(value, 500);
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    if (doc.getTextWidth(`${text.slice(0, midpoint)}...`) <= maxWidth) low = midpoint;
    else high = midpoint - 1;
  }
  return `${text.slice(0, low)}...`;
}

function setDocumentMetadata(doc: any, title: string, subject: string) {
  doc.setProperties({
    title: pdfText(title),
    subject: pdfText(subject),
    author: "PortalPay Platform Analytics",
    creator: "PortalPay Admin",
    keywords: "PortalPay, analytics, telemetry, audit"
  });
}

function reportFilename(stem: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `portalpay_${stem}_${timestamp}.pdf`;
}

// Helper to draw standard header banner and title
async function createPdfDoc(orientation: PdfOrientation = "portrait") {
  const jsPDFMod = await import("jspdf");
  const autoTableMod = await import("jspdf-autotable");
  const jsPDF = jsPDFMod.default || (jsPDFMod as any);
  const autoTable = autoTableMod.default || (autoTableMod as any);

  const doc = new jsPDF({ orientation, unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
  return { doc, autoTable };
}

function drawHeader(
  doc: any,
  title: string,
  subtitle: string,
  filterContext: string,
  orientation: PdfOrientation = "portrait"
) {
  const pageWidth = orientation === "landscape" ? 297 : 210;

  // Header background bar
  doc.setFillColor(...PDF_COLORS.panel);
  doc.rect(0, 0, pageWidth, 28, "F");

  // Product accent rail echoes the blue/violet/emerald admin HUD.
  doc.setFillColor(...PDF_COLORS.primary);
  doc.rect(0, 0, 3, 28, "F");
  doc.setFillColor(...PDF_COLORS.violet);
  doc.rect(3, 0, 3, 28, "F");
  doc.setFillColor(...PDF_COLORS.success);
  doc.rect(6, 0, 3, 28, "F");

  // Title & Logo mark
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("PORTALPAY", 14, 11);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text("PLATFORM TELEMETRY & ANALYTICS", 46, 11);

  // Document Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text(pdfText(title.toUpperCase(), 58), 14, 21);

  // Metadata / Timestamp on top-right
  const dateStr = new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Los_Angeles"
  });
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(203, 213, 225);
  const rightColumnWidth = orientation === "landscape" ? 205 : 124;
  doc.text(fitPdfText(doc, `Generated: ${dateStr} PT`, rightColumnWidth), pageWidth - 14, 11, { align: "right" });
  doc.text(fitPdfText(doc, `Scope: ${filterContext}`, rightColumnWidth), pageWidth - 14, 17, { align: "right" });
  doc.text(fitPdfText(doc, subtitle, rightColumnWidth), pageWidth - 14, 23, { align: "right" });

  // Thin accent line below header
  doc.setDrawColor(...PDF_COLORS.primary);
  doc.setLineWidth(0.8);
  doc.line(0, 28, pageWidth, 28);
}

function continuationHeader(
  doc: any,
  title: string,
  subtitle: string,
  filterContext: string,
  orientation: PdfOrientation
) {
  return (hookData: any) => {
    if (hookData.pageNumber > 1) drawHeader(doc, title, subtitle, filterContext, orientation);
  };
}

function drawFooters(doc: any) {
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Footer line
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.3);
    doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);

    // Footer text
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(148, 163, 184);
    doc.text("CONFIDENTIAL | PortalPay Platform Internal Report", 14, pageHeight - 7);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, pageHeight - 7, { align: "right" });
  }
}

// ─── 1. Executive Summary Report ─────────────────────────────────────────────
export async function exportExecutiveSummaryPDF(
  stats: Stat | null,
  brandStats: BrandStat[],
  failureReasons: FailureReason[],
  filterContext: string = "All Time • All Brands"
): Promise<void> {
  const { doc, autoTable } = await createPdfDoc("portrait");
  setDocumentMetadata(doc, "PortalPay Executive Analytics Summary", filterContext);
  drawHeader(doc, "Executive Analytics Summary", "Management & Operations Overview", filterContext, "portrait");

  let startY = 35;

  // 1. KPI Scorecard Summary Boxes
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("1. PLATFORM CORE PERFORMANCE METRICS", 14, startY);
  startY += 4;

  const totalGmv = stats?.totalGmv ? `$${stats.totalGmv.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00";
  const totalFees = stats?.totalFees ? `$${stats.totalFees.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00";
  const successRate = stats?.successRate !== undefined ? `${stats.successRate.toFixed(1)}%` : "0.0%";
  const trueRate = stats?.trueIntegrationRate !== undefined ? `${stats.trueIntegrationRate.toFixed(1)}%` : "N/A";
  const totalCreated = (stats?.totalCreated || 0).toLocaleString();
  const totalPaid = (stats?.totalPaid || 0).toLocaleString();
  const aov = stats?.aov ? `$${stats.aov.toFixed(2)}` : "$0.00";

  autoTable(doc, {
    startY,
    head: [["Gross Volume (GMV)", "Platform Fee Revenue", "True Intent Success", "Gross Conversion", "Total Intents", "Settled Orders", "Avg Order Value"]],
    body: sanitizeTableRows([[totalGmv, totalFees, trueRate, successRate, totalCreated, totalPaid, aov]]),
    theme: "grid",
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8,
      halign: "center"
    },
    bodyStyles: {
      fontSize: 9,
      fontStyle: "bold",
      textColor: [15, 23, 42],
      halign: "center"
    },
    margin: { top: 34, left: 14, right: 14 },
    didDrawPage: continuationHeader(doc, "Executive Analytics Summary", "Management & Operations Overview", filterContext, "portrait")
  });

  startY = (doc as any).lastAutoTable.finalY + 8;

  // 2. Brand Breakdown Table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("2. VOLUME & CONVERSION BY PARTNER BRAND", 14, startY);
  startY += 4;

  const brandRows = (brandStats || []).map(b => [
    b.brandName || b.brandKey,
    b.brandKey,
    b.total.toLocaleString(),
    b.paid.toLocaleString(),
    b.failed.toLocaleString(),
    `$${b.gmv.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `$${b.fees.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `${(b.trueSuccessRate ?? b.successRate).toFixed(1)}%`
  ]);

  autoTable(doc, {
    startY,
    head: [["Brand Name", "Slug", "Intents", "Paid", "Failed", "GMV ($)", "Platform Fees ($)", "Success Rate"]],
    body: sanitizeTableRows(brandRows.length > 0 ? brandRows : [["No brand transactions recorded.", "-", "-", "-", "-", "-", "-", "-"]]),
    theme: "striped",
    headStyles: { fillColor: [51, 65, 85], fontSize: 8 },
    styles: { fontSize: 8 },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right", fontStyle: "bold" },
      6: { halign: "right", fontStyle: "bold", textColor: [16, 185, 129] },
      7: { halign: "right" }
    },
    margin: { top: 34, left: 14, right: 14 },
    didDrawPage: continuationHeader(doc, "Executive Analytics Summary", "Management & Operations Overview", filterContext, "portrait")
  });

  startY = (doc as any).lastAutoTable.finalY + 8;

  // Check if we have enough room for payment methods & top failure reasons or add page
  if (startY > 210) {
    doc.addPage();
    drawHeader(doc, "Executive Analytics Summary", "Management & Operations Overview", filterContext, "portrait");
    startY = 35;
  }

  // 3. Payment Method & Funding Distribution
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("3. PAYMENT METHOD & FUNDING DISTRIBUTION", 14, startY);
  startY += 4;

  const cardTypes = stats?.cardTypes || { credit: 0, debit: 0, bank: 0, unknown: 0 };
  const fundingTotal = (cardTypes.credit + cardTypes.debit + cardTypes.bank + cardTypes.unknown) || 1;

  autoTable(doc, {
    startY,
    head: [["Payment Instrument", "Count", "Share of Settled Orders"]],
    body: sanitizeTableRows([
      ["Credit Cards", cardTypes.credit.toLocaleString(), `${((cardTypes.credit / fundingTotal) * 100).toFixed(1)}%`],
      ["Debit Cards", cardTypes.debit.toLocaleString(), `${((cardTypes.debit / fundingTotal) * 100).toFixed(1)}%`],
      ["US Bank Account (ACH Direct)", cardTypes.bank.toLocaleString(), `${((cardTypes.bank / fundingTotal) * 100).toFixed(1)}%`],
      ["Direct On-Chain / Other", cardTypes.unknown.toLocaleString(), `${((cardTypes.unknown / fundingTotal) * 100).toFixed(1)}%`]
    ]),
    theme: "striped",
    headStyles: { fillColor: [71, 85, 105], fontSize: 8 },
    styles: { fontSize: 8 },
    columnStyles: {
      1: { halign: "right", fontStyle: "bold" },
      2: { halign: "right" }
    },
    margin: { top: 34, left: 14, right: 14 },
    didDrawPage: continuationHeader(doc, "Executive Analytics Summary", "Management & Operations Overview", filterContext, "portrait")
  });

  startY = (doc as any).lastAutoTable.finalY + 8;

  // 4. Top Failure Reasons Table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("4. TOP TRANSACTION FAILURE REASONS & DROP-OFFS", 14, startY);
  startY += 4;

  const failureRows = (failureReasons || []).slice(0, 8).map(f => [
    f.reason,
    f.count.toLocaleString(),
    stats?.totalFailed ? `${((f.count / stats.totalFailed) * 100).toFixed(1)}%` : "N/A"
  ]);

  autoTable(doc, {
    startY,
    head: [["Failure Reason / Error Category", "Occurrences", "% of Failed Intents"]],
    body: sanitizeTableRows(failureRows.length > 0 ? failureRows : [["No failure errors recorded.", "0", "0%"]]),
    theme: "striped",
    headStyles: { fillColor: [159, 18, 57], fontSize: 8 }, // rose-900
    styles: { fontSize: 8 },
    columnStyles: {
      1: { halign: "right", fontStyle: "bold", textColor: [225, 29, 72] },
      2: { halign: "right" }
    },
    margin: { top: 34, left: 14, right: 14 },
    didDrawPage: continuationHeader(doc, "Executive Analytics Summary", "Management & Operations Overview", filterContext, "portrait")
  });

  drawFooters(doc);
  doc.save(reportFilename("executive_summary"));
}

// ─── 2. Transaction Audit Ledger PDF ─────────────────────────────────────────
export async function exportTransactionLedgerPDF(
  receipts: ReceiptItem[],
  stats: Stat | null,
  queryFilter: string = "All Current Filtered Records",
  dateRangeStr: string = "All Time",
  reportTimezone: string = "America/Los_Angeles"
): Promise<void> {
  const { doc, autoTable } = await createPdfDoc("landscape");
  const headerScope = `${dateRangeStr} | Query: ${queryFilter}`;
  const headerSubtitle = `Complete filtered snapshot | ${receipts.length.toLocaleString()} transactions`;
  setDocumentMetadata(doc, "PortalPay Transaction Audit Ledger", headerScope);
  drawHeader(
    doc,
    "Transaction Audit Ledger",
    headerSubtitle,
    headerScope,
    "landscape"
  );

  const tableHead = [[
    "Receipt ID", "Date", "Brand", "Merchant", "Customer Email", "Amount", "Fee",
    "Status", "Method", "KYC", "Stripe Session", "Tx Hash", "Notes / Error"
  ]];
  const chunkSize = 2000;
  const sourceRows = receipts.length > 0 ? receipts : [null];

  for (let chunkStart = 0; chunkStart < sourceRows.length; chunkStart += chunkSize) {
    if (chunkStart > 0) {
      doc.addPage();
      drawHeader(doc, "Transaction Audit Ledger", headerSubtitle, headerScope, "landscape");
    }
    const chunk = sourceRows.slice(chunkStart, chunkStart + chunkSize);
    const rows = chunk.map(receipt => {
      if (!receipt) return ["No matching transactions found.", "", "", "", "", "", "", "", "", "", "", "", ""];
      const date = receipt.createdAt
        ? new Date(receipt.createdAt).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short", timeZone: reportTimezone })
        : "-";
      const amount = typeof receipt.totalUsd === "number" ? `$${receipt.totalUsd.toFixed(2)}` : "$0.00";
      const fee = typeof receipt.platformFee === "number" ? `$${receipt.platformFee.toFixed(2)}` : "-";
      const transactionHash = receipt.transactionHash
        ? `${receipt.transactionHash.slice(0, 8)}...${receipt.transactionHash.slice(-6)}`
        : "-";
      const sessionId = receipt.stripeSessionId ? `${receipt.stripeSessionId.slice(0, 14)}...` : "-";
      return [
        receipt.receiptId || "-", date, receipt.brandName || receipt.brandKey || "-",
        receipt.merchantName || "-", receipt.email || "anonymous", amount, fee,
        String(receipt.status || "").toUpperCase(), receipt.cardFunding || "crypto/other",
        receipt.kycLevel || "L0", sessionId, transactionHash, receipt.failureReason || ""
      ];
    });

    autoTable(doc, {
      startY: 34,
      head: tableHead,
      body: sanitizeTableRows(rows),
      theme: "striped",
      headStyles: { fillColor: PDF_COLORS.panel, fontSize: 7, fontStyle: "bold", halign: "left" },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      styles: { fontSize: 6.5, cellPadding: 1.5, overflow: "linebreak", textColor: [30, 41, 59] },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 26 },
        1: { cellWidth: 22 },
        2: { cellWidth: 20 },
        3: { cellWidth: 22 },
        4: { cellWidth: 32 },
        5: { halign: "right", fontStyle: "bold", cellWidth: 16 },
        6: { halign: "right", textColor: PDF_COLORS.success, cellWidth: 14 },
        7: { fontStyle: "bold", cellWidth: 18 },
        8: { cellWidth: 18 },
        9: { halign: "center", cellWidth: 10 },
        10: { cellWidth: 24 },
        11: { cellWidth: 22 },
        12: { cellWidth: 25 }
      },
      margin: { top: 34, bottom: 16, left: 14, right: 14 },
      didDrawPage: continuationHeader(doc, "Transaction Audit Ledger", headerSubtitle, headerScope, "landscape")
    });

    // Yield between large table chunks so the admin UI can keep painting.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  drawFooters(doc);
  doc.save(reportFilename("transaction_ledger"));
}

// ─── 3. Brand Financial Performance & Fees PDF ──────────────────────────────
export async function exportBrandFinancialPDF(
  brandStats: BrandStat[],
  stats: Stat | null,
  dateRangeStr: string = "All Time"
): Promise<void> {
  const { doc, autoTable } = await createPdfDoc("portrait");
  setDocumentMetadata(doc, "PortalPay Brand Financial & Fee Settlement", dateRangeStr);
  drawHeader(
    doc,
    "Brand Financial & Fee Settlement",
    `Total Brands: ${brandStats.length}`,
    dateRangeStr,
    "portrait"
  );

  let startY = 35;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("1. PLATFORM AGGREGATE FINANCIAL SUMMARY", 14, startY);
  startY += 4;

  const totalGmv = stats?.totalGmv ? `$${stats.totalGmv.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00";
  const totalFees = stats?.totalFees ? `$${stats.totalFees.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00";
  const totalPaid = (stats?.totalPaid || 0).toLocaleString();
  const effectiveBps = stats?.totalGmv && stats?.totalFees ? `${((stats.totalFees / stats.totalGmv) * 10000).toFixed(0)} BPS (${((stats.totalFees / stats.totalGmv) * 100).toFixed(2)}%)` : "N/A";

  autoTable(doc, {
    startY,
    head: [["Total Platform GMV", "Gross Fee Revenue", "Settled Orders", "Effective Platform Take-Rate"]],
    body: sanitizeTableRows([[totalGmv, totalFees, totalPaid, effectiveBps]]),
    theme: "grid",
    headStyles: { fillColor: [30, 41, 59], fontSize: 8, halign: "center" },
    bodyStyles: { fontSize: 9, fontStyle: "bold", halign: "center" },
    margin: { top: 34, left: 14, right: 14 },
    didDrawPage: continuationHeader(doc, "Brand Financial & Fee Settlement", `Total Brands: ${brandStats.length}`, dateRangeStr, "portrait")
  });

  startY = (doc as any).lastAutoTable.finalY + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("2. DETAILED PARTNER BRAND FINANCIAL MATRIX", 14, startY);
  startY += 4;

  const rows = (brandStats || []).map(b => {
    const gmv = `$${b.gmv.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fees = `$${b.fees.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const netPayout = `$${Math.max(0, b.gmv - b.fees).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const effectiveBps = b.gmv > 0 ? `${((b.fees / b.gmv) * 10000).toFixed(0)} BPS` : "N/A";

    return [
      b.brandName || b.brandKey,
      b.brandKey,
      b.paid.toLocaleString(),
      gmv,
      fees,
      effectiveBps,
      netPayout,
      `${(b.trueSuccessRate ?? b.successRate).toFixed(1)}%`
    ];
  });

  autoTable(doc, {
    startY,
    head: [["Brand Name", "Slug", "Settled", "Gross Volume", "Platform Fees", "Effective BPS", "GMV Less Platform Fees", "Success Rate"]],
    body: sanitizeTableRows(rows.length > 0 ? rows : [["No brand financial data found.", "-", "-", "-", "-", "-", "-", "-"]]),
    theme: "striped",
    headStyles: { fillColor: [51, 65, 85], fontSize: 8 },
    styles: { fontSize: 8 },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right", fontStyle: "bold" },
      4: { halign: "right", fontStyle: "bold", textColor: [16, 185, 129] },
      5: { halign: "center", fontStyle: "bold", textColor: [59, 130, 246] },
      6: { halign: "right", fontStyle: "bold" },
      7: { halign: "right" }
    },
    margin: { top: 34, bottom: 16, left: 14, right: 14 },
    didDrawPage: continuationHeader(doc, "Brand Financial & Fee Settlement", `Total Brands: ${brandStats.length}`, dateRangeStr, "portrait")
  });

  drawFooters(doc);
  doc.save(reportFilename("brand_financials"));
}

// ─── 4. Failure Diagnostics & Error Matrix PDF ──────────────────────────────
export async function exportFailureDiagnosticsPDF(
  failureReasons: FailureReason[],
  stats: Stat | null,
  receipts: ReceiptItem[],
  dateRangeStr: string = "All Time",
  reportTimezone: string = "America/Los_Angeles"
): Promise<void> {
  const { doc, autoTable } = await createPdfDoc("portrait");
  const headerTitle = "Failure & Error Diagnostics Report";
  const headerSubtitle = `Total Failed Intents: ${(stats?.totalFailed || 0).toLocaleString()}`;
  setDocumentMetadata(doc, "PortalPay Failure & Error Diagnostics", dateRangeStr);
  drawHeader(
    doc,
    headerTitle,
    headerSubtitle,
    dateRangeStr,
    "portrait"
  );

  let startY = 35;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("1. ERROR OVERVIEW & DROP-OFF SUMMARY", 14, startY);
  startY += 4;

  const totalCreated = stats?.totalCreated || 0;
  const totalFailed = stats?.totalFailed || 0;
  const totalPaid = stats?.totalPaid || 0;
  const failRate = totalCreated > 0 ? `${((totalFailed / totalCreated) * 100).toFixed(1)}%` : "0.0%";

  autoTable(doc, {
    startY,
    head: [["Total Checkout Intents", "Successful Payments", "Failed Intents", "Recorded Failure Rate"]],
    body: sanitizeTableRows([[totalCreated.toLocaleString(), totalPaid.toLocaleString(), totalFailed.toLocaleString(), failRate]]),
    theme: "grid",
    headStyles: { fillColor: [159, 18, 57], fontSize: 8, halign: "center" },
    bodyStyles: { fontSize: 9, fontStyle: "bold", halign: "center" },
    margin: { top: 34, left: 14, right: 14 },
    didDrawPage: continuationHeader(doc, headerTitle, headerSubtitle, dateRangeStr, "portrait")
  });

  startY = (doc as any).lastAutoTable.finalY + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("2. ALL DOCUMENTED FAILURE REASONS", 14, startY);
  startY += 4;

  const failRows = (failureReasons || []).map((f, idx) => [
    `#${idx + 1}`,
    f.reason,
    f.count.toLocaleString(),
    totalFailed > 0 ? `${((f.count / totalFailed) * 100).toFixed(1)}%` : "0.0%"
  ]);

  autoTable(doc, {
    startY,
    head: [["Rank", "Error Description / Failure Reason", "Count", "Failure Impact (%)"]],
    body: sanitizeTableRows(failRows.length > 0 ? failRows : [["-", "No errors recorded.", "0", "0%"]]),
    theme: "striped",
    headStyles: { fillColor: [71, 85, 105], fontSize: 8 },
    styles: { fontSize: 8 },
    columnStyles: {
      0: { halign: "center", cellWidth: 14 },
      1: { fontStyle: "bold" },
      2: { halign: "right", fontStyle: "bold", textColor: [225, 29, 72], cellWidth: 24 },
      3: { halign: "right", cellWidth: 32 }
    },
    margin: { top: 34, bottom: 16, left: 14, right: 14 },
    didDrawPage: continuationHeader(doc, headerTitle, headerSubtitle, dateRangeStr, "portrait")
  });

  startY = (doc as any).lastAutoTable.finalY + 8;
  if (startY > 240) {
    doc.addPage();
    drawHeader(doc, headerTitle, headerSubtitle, dateRangeStr, "portrait");
    startY = 35;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("3. FAILED TRANSACTION EVIDENCE", 14, startY);
  startY += 4;

  const failedReceipts = receipts.filter(receipt => String(receipt.status || "").toLowerCase() === "failed");
  const evidenceRows = failedReceipts.map(receipt => [
    receipt.receiptId || "-",
    receipt.createdAt
      ? new Date(receipt.createdAt).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short", timeZone: reportTimezone })
      : "-",
    receipt.brandName || receipt.brandKey || "-",
    receipt.email || "anonymous",
    `$${Number(receipt.totalUsd || 0).toFixed(2)}`,
    receipt.failureReason || "Abandoned / Closed Portal"
  ]);

  autoTable(doc, {
    startY,
    head: [["Receipt ID", "Date", "Brand", "Customer", "Amount", "Failure Evidence"]],
    body: sanitizeTableRows(evidenceRows.length > 0
      ? evidenceRows
      : [["-", "-", "-", "-", "$0.00", "No failed transactions in this scope."]]),
    theme: "striped",
    headStyles: { fillColor: [71, 85, 105], fontSize: 7.5 },
    styles: { fontSize: 7, cellPadding: 1.5, overflow: "linebreak" },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 31 },
      1: { cellWidth: 25 },
      2: { cellWidth: 24 },
      3: { cellWidth: 37 },
      4: { halign: "right", fontStyle: "bold", cellWidth: 19 },
      5: { textColor: PDF_COLORS.danger }
    },
    margin: { top: 34, bottom: 16, left: 14, right: 14 },
    didDrawPage: continuationHeader(doc, headerTitle, headerSubtitle, dateRangeStr, "portrait")
  });

  drawFooters(doc);
  doc.save(reportFilename("failure_diagnostics"));
}
