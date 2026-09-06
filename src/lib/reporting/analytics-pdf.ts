// BasaltSurge analytics PDF reports. Heavy PDF libraries are loaded only when an
// administrator requests an export so the analytics panel stays lightweight.
import { isAnalyticsPaidReceipt, type AnalyticsKycProfile } from "@/lib/platform-analytics-metrics";
import { extractAnalyticsFailureReasons, getAnalyticsFailureReportData, type AnalyticsFailureReceipt } from "@/lib/platform-analytics-failures";

export interface AnalyticsReportStat {
  totalCreated: number;
  totalPaid: number;
  totalFailed: number;
  successRate: number;
  dedupedTotalCreated?: number;
  dedupedTotalPaid?: number;
  dedupedTotalFailed?: number;
  trueIntegrationRate?: number;
  trueProcessRate?: number;
  completionRate?: number;
  resolvedSuccessRate?: number;
  totalGmv: number;
  totalFees: number;
  feeKnownCount?: number;
  feeUnknownCount?: number;
  feeCoveragePct?: number;
  feeRecordedTotal?: number;
  feeModeledTotal?: number;
  aov: number;
  cardTypes: { credit: number; debit: number; bank: number; unknown: number };
  kycLevels?: { none: number; l1: number; l2: number };
  kycProfile?: AnalyticsKycProfile;
}

export interface AnalyticsBrandStat {
  brandKey: string;
  brandName: string;
  total: number;
  paid: number;
  failed: number;
  gmv: number;
  fees: number;
  successRate: number;
  dedupedTotal?: number;
  dedupedPaid?: number;
  dedupedFailed?: number;
  trueSuccessRate?: number;
  feeKnownCount?: number;
  feeUnknownCount?: number;
  feeCoveragePct?: number;
  feeRecordedTotal?: number;
  feeModeledTotal?: number;
}

export interface AnalyticsFailureReason {
  reason: string;
  count: number;
}

export interface AnalyticsReceiptItem extends AnalyticsFailureReceipt {
  storageId?: string;
  id?: string;
  receiptId: string;
  brandKey: string;
  brandName?: string;
  merchantName?: string | null;
  wallet?: string | null;
  merchantWallet?: string | null;
  buyerWallet?: string | null;
  status: string;
  totalUsd: number;
  createdAt: string;
  email: string;
  stripeSessionId?: string | null;
  paymentId?: string | null;
  transactionHash?: string | null;
  cardFunding?: string | null;
  kycLevel?: string;
  kycInitialLevel?: string | null;
  kycInitialVerifiedLevel?: string | null;
  kycRequiredLevel?: string | null;
  kycCompletedLevel?: string | null;
  kycFinalLevel?: string | null;
  kycFinalStatus?: string | null;
  kycVerifiedLevel?: string | null;
  kycRegion?: string | null;
  kycIdentifiersSatisfied?: boolean;
  kycAttestationAccepted?: boolean;
  platformFee?: number;
  platformFeeSource?: "recorded_minor" | "recorded_usd" | "recorded_bps" | "minimum_50bps" | "unavailable";
  failureReason?: string | null;
  lineItems?: Array<{ label?: string; priceUsd?: number; qty?: number; quantity?: number }>;
}

type PdfOrientation = "portrait" | "landscape";

const COLORS = {
  navy: [9, 17, 34] as [number, number, number],
  slate: [30, 41, 59] as [number, number, number],
  muted: [100, 116, 139] as [number, number, number],
  border: [221, 228, 238] as [number, number, number],
  surface: [246, 248, 252] as [number, number, number],
  blue: [59, 130, 246] as [number, number, number],
  violet: [139, 92, 246] as [number, number, number],
  emerald: [16, 185, 129] as [number, number, number],
  rose: [225, 29, 72] as [number, number, number],
  amber: [217, 119, 6] as [number, number, number]
};

function pdfText(value: unknown, maxLength = 300): string {
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

function sanitizeRows(rows: unknown[][]): string[][] {
  return rows.map(row => row.map(cell => pdfText(cell)));
}

function currency(value: number | undefined): string {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function percent(value: number | undefined): string {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatDate(value: string | undefined, timeZone: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short", timeZone });
}

function reportFilename(stem: string): string {
  return `basaltsurge_${stem}_${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;
}

let brandLogoPromise: Promise<Uint8Array | null> | null = null;

function loadBrandLogo(): Promise<Uint8Array | null> {
  if (brandLogoPromise) return brandLogoPromise;
  brandLogoPromise = (async () => {
    if (typeof window === "undefined" || typeof document === "undefined" || typeof fetch === "undefined") return null;
    try {
      const response = await fetch("/Surge.png", { cache: "force-cache" });
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.byteLength ? bytes : null;
    } catch {
      return null;
    }
  })();
  return brandLogoPromise;
}

async function createPdfDoc(orientation: PdfOrientation = "portrait") {
  const jsPDFMod = await import("jspdf");
  const autoTableMod = await import("jspdf-autotable");
  const jsPDFDefault = (jsPDFMod as any).default;
  const jsPDF = (jsPDFMod as any).jsPDF
    || (typeof jsPDFDefault === "function" ? jsPDFDefault : jsPDFDefault?.jsPDF)
    || (jsPDFMod as any)["module.exports"]?.jsPDF;
  const autoTableDefault = (autoTableMod as any).default;
  const autoTable = (autoTableMod as any).autoTable
    || (typeof autoTableDefault === "function" ? autoTableDefault : autoTableDefault?.autoTable)
    || (autoTableMod as any)["module.exports"]?.autoTable;

  if (typeof jsPDF !== "function") throw new Error("The PDF document engine could not be initialized.");
  if (typeof autoTable !== "function") throw new Error("The PDF table engine could not be initialized.");

  const doc = new jsPDF({ orientation, unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
  (doc as any).__basaltSurgeLogo = await loadBrandLogo();
  return { doc, autoTable };
}

function downloadPdf(doc: any, filename: string) {
  const bytes = doc.output("arraybuffer") as ArrayBuffer;
  if (!bytes || bytes.byteLength < 1000) throw new Error("The generated PDF was empty or incomplete.");

  if (typeof window === "undefined" || typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    doc.save(filename);
    return;
  }

  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function setMetadata(doc: any, title: string, scope: string) {
  doc.__analyticsFullScope = scope;
  doc.setProperties({
    title: pdfText(title),
    subject: pdfText(scope),
    author: "BasaltSurge Platform Analytics",
    creator: "BasaltSurge Admin",
    keywords: "BasaltSurge, analytics, audit, reporting"
  });
}

function drawHeader(
  doc: any,
  title: string,
  subtitle: string,
  scope: string,
  orientation: PdfOrientation,
  compact = false
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(...COLORS.navy);
  doc.rect(0, 0, pageWidth, 24, "F");
  doc.setFillColor(...COLORS.blue);
  doc.rect(0, 0, 2.5, 24, "F");
  doc.setFillColor(...COLORS.violet);
  doc.rect(2.5, 0, 2.5, 24, "F");
  doc.setFillColor(...COLORS.emerald);
  doc.rect(5, 0, 2.5, 24, "F");

  doc.setFillColor(255, 255, 255);
  doc.roundedRect(13, 5.5, 10, 10, 2, 2, "F");
  let renderedLogo = false;
  const brandLogo = (doc as any).__basaltSurgeLogo as Uint8Array | null | undefined;
  if (brandLogo) {
    try {
      doc.addImage(brandLogo, "PNG", 13.7, 6.2, 8.6, 8.6, "basaltsurge-logo", "FAST");
      renderedLogo = true;
    } catch {
      renderedLogo = false;
    }
  }
  if (!renderedLogo) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.navy);
    doc.text("BS", 18, 12.2, { align: "center" });
  }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(compact ? 11 : 13.5);
  doc.text(pdfText(title, 72), 28, 10.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(174, 188, 211);
  doc.text(pdfText(subtitle, 92), 28, 16.3);

  const generated = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  doc.setFontSize(7.2);
  doc.setTextColor(203, 213, 225);
  doc.text(`Generated ${generated}`, pageWidth - 13, 9.5, { align: "right" });
  doc.text("BASALTSURGE | INTERNAL", pageWidth - 13, 15.2, { align: "right" });

  doc.setFillColor(...COLORS.surface);
  doc.setDrawColor(...COLORS.border);
  doc.roundedRect(13, 28, pageWidth - 26, 10, 2, 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.8);
  doc.setTextColor(...COLORS.muted);
  doc.text("REPORT SCOPE", 17, 32.3);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.slate);
  const scopeWidth = orientation === "landscape" ? pageWidth - 55 : pageWidth - 48;
  const scopeLines = doc.splitTextToSize(pdfText(scope, 500), scopeWidth).slice(0, 2);
  doc.text(scopeLines, 39, 32.3);
  return 44;
}

function continuationHeader(doc: any, title: string, subtitle: string, scope: string, orientation: PdfOrientation) {
  return (hookData: any) => {
    if (hookData.pageNumber > 1) drawHeader(doc, title, subtitle, scope, orientation, true);
  };
}

function appendReportScope(doc: any) {
  if (!doc.__analyticsFullScope || doc.__analyticsScopeAppended) return;
  doc.__analyticsScopeAppended = true;
  const orientation: PdfOrientation = doc.internal.pageSize.getWidth() > doc.internal.pageSize.getHeight() ? "landscape" : "portrait";
  const title = "Report scope and data definitions";
  const subtitle = "Complete collection context; retained without the header preview limit";
  const newPage = () => {
    doc.addPage("a4", orientation);
    drawHeader(doc, title, subtitle, "Full report context below", orientation, true);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.slate);
    return 47;
  };
  let y = newPage();
  const fullContext = pdfText(doc.__analyticsFullScope, Number.MAX_SAFE_INTEGER);
  const paragraphs = fullContext.split(" | ");
  for (const paragraph of paragraphs) {
    const lines = doc.splitTextToSize(paragraph, doc.internal.pageSize.getWidth() - 30);
    for (const line of lines) {
      if (y > doc.internal.pageSize.getHeight() - 21) y = newPage();
      doc.text(line, 15, y);
      y += 4.7;
    }
    y += 2;
  }
}

function drawFooters(doc: any) {
  appendReportScope(doc);
  const pageCount = doc.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.25);
    doc.line(13, height - 11, width - 13, height - 11);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.muted);
    doc.text("CONFIDENTIAL | Scope and collection version appear in the report metadata", 13, height - 6.5);
    doc.text(`Page ${page} of ${pageCount}`, width - 13, height - 6.5, { align: "right" });
  }
}

function drawSectionTitle(doc: any, number: string, title: string, y: number, accent = COLORS.blue): number {
  doc.setFillColor(...accent);
  doc.roundedRect(13, y - 3.5, 6, 6, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text(number, 16, y + 0.5, { align: "center" });
  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.navy);
  doc.text(title.toUpperCase(), 22, y + 0.5);
  return y + 7;
}

function drawKpiGrid(
  doc: any,
  y: number,
  items: Array<{ label: string; value: string; note: string; color?: [number, number, number] }>,
  orientation: PdfOrientation
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const columns = orientation === "landscape" ? 3 : 3;
  const gap = 4;
  const cardWidth = (pageWidth - 26 - gap * (columns - 1)) / columns;
  const cardHeight = 22;
  items.forEach((item, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const x = 13 + col * (cardWidth + gap);
    const cardY = y + row * (cardHeight + gap);
    doc.setFillColor(250, 251, 253);
    doc.setDrawColor(...COLORS.border);
    doc.roundedRect(x, cardY, cardWidth, cardHeight, 2.3, 2.3, "FD");
    doc.setFillColor(...(item.color || COLORS.blue));
    doc.roundedRect(x, cardY, 2.2, cardHeight, 1, 1, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.muted);
    doc.text(pdfText(item.label, 34).toUpperCase(), x + 6, cardY + 6);
    doc.setFontSize(13);
    doc.setTextColor(...COLORS.navy);
    doc.text(pdfText(item.value, 24), x + 6, cardY + 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.4);
    doc.setTextColor(...COLORS.muted);
    doc.text(pdfText(item.note, 54), x + 6, cardY + 18.2);
  });
  return y + Math.ceil(items.length / columns) * (cardHeight + gap);
}

function standardTableOptions(doc: any, title: string, subtitle: string, scope: string, orientation: PdfOrientation) {
  return {
    theme: "plain",
    headStyles: { fillColor: COLORS.slate, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.5, cellPadding: 2.2 },
    bodyStyles: { textColor: COLORS.slate, fontSize: 7.4, cellPadding: 2.1 },
    alternateRowStyles: { fillColor: COLORS.surface },
    tableLineColor: COLORS.border,
    tableLineWidth: 0.15,
    margin: { top: 43, bottom: 16, left: 13, right: 13 },
    didDrawPage: continuationHeader(doc, title, subtitle, scope, orientation)
  };
}

function reportQuality(stats: AnalyticsReportStat | null, failureData?: ReturnType<typeof getAnalyticsFailureReportData>) {
  const created = stats?.totalCreated || 0;
  const paid = stats?.totalPaid || 0;
  const failed = stats?.totalFailed || 0;
  const unresolved = Math.max(0, created - paid - failed);
  const missingFailureDetail = failureData?.missingDetailCount || 0;
  const affected = failureData?.affectedReceiptCount || 0;
  const failureDetailCoverage = affected > 0 ? percent(failureData?.detailCoveragePct) : "N/A";
  const feeCoverage = paid > 0 ? (stats?.feeCoveragePct ?? ((stats?.feeKnownCount || 0) / paid) * 100) : 0;
  return { created, paid, failed, unresolved, affected, missingFailureDetail, failureDetailCoverage, feeCoverage };
}

export async function exportExecutiveSummaryPDF(
  stats: AnalyticsReportStat | null,
  brandStats: AnalyticsBrandStat[],
  failureReasons: AnalyticsFailureReason[],
  filterContext = "All Time | All Brands",
  receipts?: AnalyticsReceiptItem[]
): Promise<void> {
  const title = "Executive Analytics Brief";
  const subtitle = "Performance, conversion, and data-quality review";
  const { doc, autoTable } = await createPdfDoc("portrait");
  setMetadata(doc, title, filterContext);
  let y = drawHeader(doc, title, subtitle, filterContext, "portrait");
  const failureData = receipts ? getAnalyticsFailureReportData(receipts) : undefined;
  const reportReasons = failureData?.reasonCounts || failureReasons;
  const quality = reportQuality(stats, failureData);

  y = drawSectionTitle(doc, "1", "Executive scorecard", y);
  y = drawKpiGrid(doc, y, [
    { label: "Accepted GMV", value: currency(stats?.totalGmv), note: `${quality.paid.toLocaleString()} accepted records`, color: COLORS.emerald },
    { label: "Platform fee revenue", value: currency(stats?.totalFees), note: "Persisted evidence or 50 BPS contractual floor", color: COLORS.violet },
    { label: "Average order value", value: currency(stats?.aov), note: "Accepted GMV / accepted records", color: COLORS.blue },
    { label: "Raw receipt completion", value: percent(stats?.successRate), note: "Paid records / all raw records", color: COLORS.blue },
    { label: "Checkout completion", value: percent(stats?.completionRate ?? stats?.trueIntegrationRate), note: "Unique paid / all unique intents", color: COLORS.violet },
    { label: "Resolved outcome rate", value: percent(stats?.resolvedSuccessRate ?? stats?.trueProcessRate), note: "Excludes open and unresolved", color: COLORS.emerald }
  ], "portrait");

  y = drawSectionTitle(doc, "2", "Volume reconciliation", y + 1, COLORS.violet);
  autoTable(doc, {
    ...standardTableOptions(doc, title, subtitle, filterContext, "portrait"),
    startY: y,
    head: [["Population", "Count", "Share", "Definition"]],
    body: sanitizeRows([
      ["All receipt records", quality.created.toLocaleString(), "100.0%", "Every stored receipt in the selected scope"],
      ["Paid / accepted", quality.paid.toLocaleString(), quality.created ? percent((quality.paid / quality.created) * 100) : "0.0%", "Recognized completion statuses; not a bank settlement assertion"],
      ["Failed", quality.failed.toLocaleString(), quality.created ? percent((quality.failed / quality.created) * 100) : "0.0%", "Records explicitly marked failed"],
      ["Open / other", quality.unresolved.toLocaleString(), quality.created ? percent((quality.unresolved / quality.created) * 100) : "0.0%", "Pending, expired, refunded, or other statuses"]
    ]),
    columnStyles: { 1: { halign: "right", fontStyle: "bold" }, 2: { halign: "right" } }
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  y = drawSectionTitle(doc, "3", "Data quality and interpretation", y, COLORS.amber);
  autoTable(doc, {
    ...standardTableOptions(doc, title, subtitle, filterContext, "portrait"),
    startY: y,
    head: [["Control", "Result", "Interpretation"]],
    body: sanitizeRows([
      ["Status reconciliation", quality.created === quality.paid + quality.failed + quality.unresolved ? "PASS" : "REVIEW", `${quality.paid} accepted + ${quality.failed} failed + ${quality.unresolved} other = ${quality.created}`],
      ["Recorded fee evidence", quality.paid ? percent(quality.feeCoverage) : "N/A", `${stats?.feeKnownCount || 0} accepted records with recorded evidence; ${stats?.feeUnknownCount || 0} use the contractual model`],
      ["Fee provenance", `${currency(stats?.feeRecordedTotal)} recorded`, `${currency(stats?.feeModeledTotal)} contractual model; both contribute to platform fee revenue`],
      ["Error-detail coverage", quality.failureDetailCoverage, `${quality.missingFailureDetail.toLocaleString()} of ${quality.affected.toLocaleString()} affected receipts have no stored reason`],
      ["Intent metric", "EVIDENCE-BASED", "Stable receipt, session, payment, transaction, email, and wallet evidence; never IP-only"]
    ]),
    columnStyles: { 1: { halign: "center", fontStyle: "bold", cellWidth: 31 } }
  });

  doc.addPage();
  y = drawHeader(doc, title, "Partner and failure detail", filterContext, "portrait", true);
  y = drawSectionTitle(doc, "4", "Partner performance", y);
  const brandRows = brandStats.map(brand => [
    brand.brandName || brand.brandKey,
    brand.brandKey,
    brand.total.toLocaleString(),
    (brand.dedupedTotal ?? brand.total).toLocaleString(),
    brand.paid.toLocaleString(),
    currency(brand.gmv),
    currency(brand.fees),
    percent(brand.feeCoveragePct ?? 100),
    percent(brand.trueSuccessRate ?? brand.successRate)
  ]);
  autoTable(doc, {
    ...standardTableOptions(doc, title, subtitle, filterContext, "portrait"),
    startY: y,
    head: [["Partner", "Key", "Raw", "Est. intents", "Accepted", "GMV", "Platform fees", "Fee basis", "Est. conv."]],
    body: sanitizeRows(brandRows.length ? brandRows : [["No partner data", "-", "0", "0", "0", "$0.00", "$0.00", "100.0%", "0.0%"]]),
    styles: { fontSize: 6.5, cellPadding: 1.65, textColor: COLORS.slate },
    headStyles: { fillColor: COLORS.slate, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 6.4, cellPadding: 1.7 },
    columnStyles: {
      0: { cellWidth: 32 }, 1: { cellWidth: 25 }, 2: { halign: "right", cellWidth: 13 },
      3: { halign: "right", cellWidth: 18 }, 4: { halign: "right", cellWidth: 15 },
      5: { halign: "right", cellWidth: 22 }, 6: { halign: "right", cellWidth: 23 },
      7: { halign: "right", cellWidth: 17 }, 8: { halign: "right", cellWidth: 19 }
    }
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  if (y > 210) {
    doc.addPage();
    y = drawHeader(doc, title, "Funding and failure detail", filterContext, "portrait", true);
  }
  y = drawSectionTitle(doc, "5", "Accepted funding mix", y, COLORS.emerald);
  const methods = stats?.cardTypes || { credit: 0, debit: 0, bank: 0, unknown: 0 };
  const methodTotal = methods.credit + methods.debit + methods.bank + methods.unknown;
  autoTable(doc, {
    ...standardTableOptions(doc, title, subtitle, filterContext, "portrait"),
    startY: y,
    head: [["Funding classification", "Accepted records", "Share of accepted"]],
    body: sanitizeRows([
      ["Credit card", methods.credit.toLocaleString(), methodTotal ? percent((methods.credit / methodTotal) * 100) : "0.0%"],
      ["Debit card", methods.debit.toLocaleString(), methodTotal ? percent((methods.debit / methodTotal) * 100) : "0.0%"],
      ["US bank account / ACH", methods.bank.toLocaleString(), methodTotal ? percent((methods.bank / methodTotal) * 100) : "0.0%"],
      ["Crypto / unclassified", methods.unknown.toLocaleString(), methodTotal ? percent((methods.unknown / methodTotal) * 100) : "0.0%"]
    ]),
    columnStyles: { 1: { halign: "right", fontStyle: "bold" }, 2: { halign: "right" } }
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  if (y > 220) {
    doc.addPage();
    y = drawHeader(doc, title, "KYC lifecycle and failure detail", filterContext, "portrait", true);
  }
  y = drawSectionTitle(doc, "6", "KYC lifecycle by unique checkout intent", y, COLORS.violet);
  const kyc = stats?.kycProfile || { total: 0, preverified: 0, upgraded: 0, l0: 0, l1: 0, l2: 0, untracked: 0 };
  autoTable(doc, {
    ...standardTableOptions(doc, title, subtitle, filterContext, "portrait"),
    startY: y,
    head: [["KYC measure", "Unique intents", "Share of unique intents", "Meaning"]],
    body: sanitizeRows([
      ["Pre-verified at checkout start", kyc.preverified.toLocaleString(), kyc.total ? percent((kyc.preverified / kyc.total) * 100) : "0.0%", "Initial verified tier was L1 or L2"],
      ["Upgraded during checkout", kyc.upgraded.toLocaleString(), kyc.total ? percent((kyc.upgraded / kyc.total) * 100) : "0.0%", "KYC completion was recorded on this checkout"],
      ["Final L1", kyc.l1.toLocaleString(), kyc.total ? percent((kyc.l1 / kyc.total) * 100) : "0.0%", "Highest recorded final verified tier"],
      ["Final L2", kyc.l2.toLocaleString(), kyc.total ? percent((kyc.l2 / kyc.total) * 100) : "0.0%", "Highest recorded final verified tier"],
      ["Unverified / L0", kyc.l0.toLocaleString(), kyc.total ? percent((kyc.l0 / kyc.total) * 100) : "0.0%", "Explicitly unverified or L0"],
      ["Legacy untracked", kyc.untracked.toLocaleString(), kyc.total ? percent((kyc.untracked / kyc.total) * 100) : "0.0%", "No authoritative KYC tier was captured"]
    ]),
    columnStyles: { 1: { halign: "right", fontStyle: "bold" }, 2: { halign: "right" } }
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  if (y > 230) {
    doc.addPage();
    y = drawHeader(doc, title, "Failure detail", filterContext, "portrait", true);
  }
  y = drawSectionTitle(doc, "7", "Complete recorded failure summary", y, COLORS.rose);
  const failureRows = reportReasons.map((reason, index) => [
    index + 1,
    reason.reason,
    reason.count.toLocaleString(),
    quality.affected ? percent((reason.count / quality.affected) * 100) : "N/A"
  ]);
  autoTable(doc, {
    ...standardTableOptions(doc, title, subtitle, filterContext, "portrait"),
    startY: y,
    head: [["#", "Recorded reason (non-exclusive)", "Receipts", "Share of affected"]],
    body: sanitizeRows(failureRows.length ? failureRows : [["-", "No error signals in scope", "0", "N/A"]]),
    headStyles: { fillColor: COLORS.rose, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.5, cellPadding: 2.1 },
    columnStyles: { 0: { halign: "center", cellWidth: 10 }, 2: { halign: "right", fontStyle: "bold", cellWidth: 22 }, 3: { halign: "right", cellWidth: 27 } }
  });

  drawFooters(doc);
  downloadPdf(doc, reportFilename("executive_brief"));
}

export async function exportTransactionLedgerPDF(
  receipts: AnalyticsReceiptItem[],
  stats: AnalyticsReportStat | null,
  queryFilter = "No search query",
  scope = "All Time",
  reportTimezone = "America/Los_Angeles"
): Promise<void> {
  const title = "Transaction Audit Ledger";
  const subtitle = `${receipts.length.toLocaleString()} complete filtered records | ${queryFilter}`;
  const { doc, autoTable } = await createPdfDoc("landscape");
  setMetadata(doc, title, scope);
  drawHeader(doc, title, subtitle, scope, "landscape");

  const source = receipts.length ? receipts : [null];
  const chunkSize = 1500;
  for (let start = 0; start < source.length; start += chunkSize) {
    if (start > 0) {
      doc.addPage();
      drawHeader(doc, title, subtitle, scope, "landscape", true);
    }
    const rows = source.slice(start, start + chunkSize).map(receipt => {
      if (!receipt) return ["No matching transactions", "", "", "", "", "", "", "", "", "", "", "", ""];
      const fee = !isAnalyticsPaidReceipt(receipt) || receipt.platformFeeSource === "unavailable"
        ? "N/A"
        : currency(receipt.platformFee);
      const tx = receipt.transactionHash ? `${receipt.transactionHash.slice(0, 9)}...${receipt.transactionHash.slice(-6)}` : "-";
      const session = receipt.stripeSessionId || receipt.paymentId || "-";
      return [
        receipt.receiptId || "-",
        formatDate(receipt.createdAt, reportTimezone),
        receipt.brandName || receipt.brandKey || "-",
        receipt.merchantName || "-",
        receipt.email || "anonymous",
        currency(receipt.totalUsd),
        fee,
        isAnalyticsPaidReceipt(receipt) ? (receipt.platformFeeSource || "legacy") : "not applicable",
        String(receipt.status || "unknown").toUpperCase(),
        receipt.cardFunding || "unclassified",
        `${receipt.kycInitialVerifiedLevel || receipt.kycInitialLevel || "Unknown"} -> ${receipt.kycCompletedLevel || receipt.kycVerifiedLevel || receipt.kycFinalLevel || receipt.kycLevel || "Unknown"}`,
        pdfText(session, 28),
        extractAnalyticsFailureReasons(receipt).join(" | ") || tx
      ];
    });

    autoTable(doc, {
      ...standardTableOptions(doc, title, subtitle, scope, "landscape"),
      startY: 43,
      head: [["Receipt ID", "Date / time", "Partner", "Merchant", "Customer", "Amount", "Platform fee", "Fee evidence", "Status", "Funding", "KYC", "Session / payment", "Failure / tx reference"]],
      body: sanitizeRows(rows),
      styles: { fontSize: 5.9, cellPadding: 1.35, overflow: "linebreak", textColor: COLORS.slate },
      headStyles: { fillColor: COLORS.slate, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 6, cellPadding: 1.45 },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 24 }, 1: { cellWidth: 23 }, 2: { cellWidth: 19 },
        3: { cellWidth: 21 }, 4: { cellWidth: 29 }, 5: { halign: "right", cellWidth: 16 },
        6: { halign: "right", cellWidth: 16 }, 7: { cellWidth: 17 }, 8: { cellWidth: 18 },
        9: { cellWidth: 16 }, 10: { halign: "center", cellWidth: 9 }, 11: { cellWidth: 24 }, 12: { cellWidth: 39 }
      }
    });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  drawFooters(doc);
  downloadPdf(doc, reportFilename("transaction_ledger"));
}

export async function exportBrandFinancialPDF(
  brandStats: AnalyticsBrandStat[],
  stats: AnalyticsReportStat | null,
  scope = "All Time"
): Promise<void> {
  const title = "Partner Financial Performance";
  const subtitle = "Recorded GMV and platform-fee evidence by partner";
  const { doc, autoTable } = await createPdfDoc("landscape");
  setMetadata(doc, title, scope);
  let y = drawHeader(doc, title, subtitle, scope, "landscape");
  const quality = reportQuality(stats);

  y = drawSectionTitle(doc, "1", "Financial overview", y);
  y = drawKpiGrid(doc, y, [
    { label: "Accepted GMV", value: currency(stats?.totalGmv), note: "Gross value of recognized completion records", color: COLORS.emerald },
    { label: "Platform fee revenue", value: currency(stats?.totalFees), note: "Includes the contractual 50 BPS minimum", color: COLORS.violet },
    { label: "Recorded fee evidence", value: quality.paid ? percent(quality.feeCoverage) : "N/A", note: `${stats?.feeKnownCount || 0} recorded; ${stats?.feeUnknownCount || 0} contractual model`, color: quality.feeCoverage < 100 ? COLORS.amber : COLORS.emerald }
  ], "landscape");

  y = drawSectionTitle(doc, "2", "Partner reconciliation matrix", y + 1, COLORS.violet);
  const rows = brandStats.map(brand => [
    brand.brandName || brand.brandKey,
    brand.brandKey,
    brand.total.toLocaleString(),
    (brand.dedupedTotal ?? brand.total).toLocaleString(),
    brand.paid.toLocaleString(),
    brand.failed.toLocaleString(),
    Math.max(0, brand.total - brand.paid - brand.failed).toLocaleString(),
    percent(brand.successRate),
    percent(brand.trueSuccessRate ?? brand.successRate),
    currency(brand.gmv),
    currency(brand.fees),
    brand.paid > 0 ? percent(brand.feeCoveragePct) : "N/A",
    brand.gmv > 0 ? `${((brand.fees / brand.gmv) * 10000).toFixed(0)} BPS` : "N/A"
  ]);

  autoTable(doc, {
    ...standardTableOptions(doc, title, subtitle, scope, "landscape"),
    startY: y,
    head: [["Partner", "Key", "Raw", "Est. intents", "Accepted", "Failed", "Other", "Raw conv.", "Est. conv.", "GMV", "Platform fees", "Recorded basis", "Blended rate"]],
    body: sanitizeRows(rows.length ? rows : [["No partner data", "-", "0", "0", "0", "0", "0", "0.0%", "0.0%", "$0.00", "$0.00", "100.0%", "N/A"]]),
    styles: { fontSize: 6.4, cellPadding: 1.7, textColor: COLORS.slate },
    headStyles: { fillColor: COLORS.slate, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 6.3, cellPadding: 1.7 },
    columnStyles: {
      0: { cellWidth: 36 }, 1: { cellWidth: 22 }, 2: { halign: "right", cellWidth: 14 },
      3: { halign: "right", cellWidth: 20 }, 4: { halign: "right", cellWidth: 15 },
      5: { halign: "right", cellWidth: 14 }, 6: { halign: "right", cellWidth: 14 },
      7: { halign: "right", cellWidth: 19 }, 8: { halign: "right", cellWidth: 19 },
      9: { halign: "right", fontStyle: "bold", cellWidth: 25 },
      10: { halign: "right", fontStyle: "bold", cellWidth: 27 },
      11: { halign: "right", cellWidth: 18 }, 12: { halign: "right", cellWidth: 28 }
    }
  });

  const noteY = Math.min(doc.internal.pageSize.getHeight() - 24, (doc as any).lastAutoTable.finalY + 8);
  doc.setFillColor(255, 247, 237);
  doc.setDrawColor(253, 186, 116);
  doc.roundedRect(13, noteY, doc.internal.pageSize.getWidth() - 26, 11, 2, 2, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(124, 45, 18);
  doc.text("Platform fees use persisted fee evidence when available and never less than the contractual 50 BPS floor.", 17, noteY + 6.8);

  drawFooters(doc);
  downloadPdf(doc, reportFilename("partner_financials"));
}

export async function exportFailureDiagnosticsPDF(
  failureReasons: AnalyticsFailureReason[],
  stats: AnalyticsReportStat | null,
  receipts: AnalyticsReceiptItem[],
  scope = "All Time",
  reportTimezone = "America/Los_Angeles"
): Promise<void> {
  const title = "Failure Diagnostics";
  const subtitle = "Persisted error signals, including recovered receipts; inclusive reason counts";
  const { doc, autoTable } = await createPdfDoc("landscape");
  setMetadata(doc, title, scope);
  let y = drawHeader(doc, title, subtitle, scope, "landscape");
  const failureData = getAnalyticsFailureReportData(receipts);
  const quality = reportQuality(stats, failureData);
  const recoveredCount = failureData.receipts.filter(isAnalyticsPaidReceipt).length;

  y = drawSectionTitle(doc, "1", "Failure overview", y, COLORS.rose);
  y = drawKpiGrid(doc, y, [
    { label: "Affected receipts", value: quality.affected.toLocaleString(), note: `${quality.created.toLocaleString()} total receipts in scope`, color: COLORS.rose },
    { label: "Currently failed / rejected", value: quality.failed.toLocaleString(), note: `${recoveredCount.toLocaleString()} affected receipts now accepted`, color: COLORS.rose },
    { label: "Error-detail coverage", value: quality.failureDetailCoverage, note: `${quality.missingFailureDetail.toLocaleString()} affected receipts missing a reason`, color: quality.missingFailureDetail > 0 ? COLORS.amber : COLORS.emerald }
  ], "landscape");

  y = drawSectionTitle(doc, "2", "Complete recorded failure summary", y + 1, COLORS.rose);
  const reasonRows = failureData.reasonCounts.map((reason, index) => [
    index + 1,
    reason.reason,
    reason.count.toLocaleString(),
    quality.affected ? percent((reason.count / quality.affected) * 100) : "N/A"
  ]);
  autoTable(doc, {
    ...standardTableOptions(doc, title, subtitle, scope, "landscape"),
    startY: y,
    head: [["Rank", "Recorded reason (non-exclusive)", "Receipts", "Share of affected receipts"]],
    body: sanitizeRows(reasonRows.length ? reasonRows : [["-", "No error signals in scope", "0", "N/A"]]),
    headStyles: { fillColor: COLORS.rose, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.5, cellPadding: 2.1 },
    columnStyles: { 0: { halign: "center", cellWidth: 17 }, 2: { halign: "right", fontStyle: "bold", cellWidth: 27 }, 3: { halign: "right", cellWidth: 38 } }
  });

  const failedReceipts = failureData.receipts;
  const evidenceSource = failedReceipts.length ? failedReceipts : [null];
  const chunkSize = 1500;
  for (let start = 0; start < evidenceSource.length; start += chunkSize) {
    doc.addPage();
    drawHeader(doc, title, `${failedReceipts.length.toLocaleString()} affected receipts, regardless of current outcome`, scope, "landscape", true);
    const rows = evidenceSource.slice(start, start + chunkSize).map(receipt => {
      if (!receipt) return ["No affected receipts", "", "", "", "", "", "", ""];
      return [
        receipt.receiptId || "-",
        formatDate(receipt.createdAt, reportTimezone),
        receipt.brandName || receipt.brandKey || "-",
        receipt.merchantName || "-",
        receipt.email || "anonymous",
        currency(receipt.totalUsd),
        `${receipt.status || "unknown"} / ${receipt.cardFunding || "unclassified"}`,
        extractAnalyticsFailureReasons(receipt).join(" | ")
      ];
    });
    autoTable(doc, {
      ...standardTableOptions(doc, title, subtitle, scope, "landscape"),
      startY: 43,
      head: [["Receipt ID", "Date / time", "Partner", "Merchant", "Customer", "Amount", "Status / funding", "All recorded error signals"]],
      body: sanitizeRows(rows),
      styles: { fontSize: 6.5, cellPadding: 1.65, overflow: "linebreak", textColor: COLORS.slate },
      headStyles: { fillColor: COLORS.slate, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 6.6, cellPadding: 1.8 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 31 }, 1: { cellWidth: 26 }, 2: { cellWidth: 25 }, 3: { cellWidth: 30 }, 4: { cellWidth: 42 }, 5: { halign: "right", cellWidth: 18 }, 6: { cellWidth: 20 } }
    });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  drawFooters(doc);
  downloadPdf(doc, reportFilename("failure_diagnostics"));
}
