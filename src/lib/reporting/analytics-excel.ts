import type {
  AnalyticsBrandStat,
  AnalyticsFailureReason,
  AnalyticsReceiptItem,
  AnalyticsReportStat
} from "./analytics-pdf";
import { isAnalyticsPaidReceipt } from "@/lib/platform-analytics-metrics";

type ReportKind = "executive" | "ledger" | "brands" | "diagnostics";

interface SheetColumn {
  label: string;
  width?: number;
  format?: string;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function text(value: unknown, maxLength = 32000): string {
  const normalized = String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function reportFilename(stem: string): string {
  return `basaltsurge_${stem}_${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`;
}

async function loadXlsx() {
  const module = await import("xlsx-js-style");
  const candidate = (module as any).default || module;
  const XLSX = candidate?.utils ? candidate : (module as any);
  if (!XLSX?.utils?.aoa_to_sheet || typeof XLSX.write !== "function") {
    throw new Error("The Excel workbook engine could not be initialized.");
  }
  return XLSX;
}

function columnName(index: number): string {
  let result = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function buildSheet(
  XLSX: any,
  title: string,
  subtitle: string,
  scope: string,
  columns: SheetColumn[],
  rows: unknown[][]
) {
  const width = Math.max(1, columns.length);
  const generated = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const matrix = [
    [title],
    [subtitle],
    [`Scope: ${scope}`],
    [`Generated: ${generated}`],
    [],
    columns.map(column => column.label),
    ...(rows.length ? rows : [["No records in the selected scope"]])
  ];
  const sheet = XLSX.utils.aoa_to_sheet(matrix, { cellDates: true });
  const endColumn = columnName(width - 1);
  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: width - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: width - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: width - 1 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: width - 1 } }
  ];
  sheet["!cols"] = columns.map(column => ({ wch: column.width || 16 }));
  sheet["!rows"] = [{ hpt: 30 }, { hpt: 20 }, { hpt: 28 }, { hpt: 18 }, { hpt: 8 }, { hpt: 24 }];
  sheet["!autofilter"] = { ref: `A6:${endColumn}${Math.max(6, rows.length + 6)}` };
  sheet["!freeze"] = { xSplit: 0, ySplit: 6, topLeftCell: "A7", activePane: "bottomLeft", state: "frozen" };

  const titleCell = sheet.A1;
  if (titleCell) {
    titleCell.s = {
      fill: { fgColor: { rgb: "091122" } },
      font: { color: { rgb: "FFFFFF" }, bold: true, sz: 18 },
      alignment: { vertical: "center" }
    };
  }
  for (const address of ["A2", "A3", "A4"]) {
    const cell = sheet[address];
    if (!cell) continue;
    cell.s = {
      fill: { fgColor: { rgb: address === "A2" ? "091122" : "F1F5F9" } },
      font: { color: { rgb: address === "A2" ? "AFC2DF" : "475569" }, italic: address !== "A2", sz: address === "A2" ? 11 : 10 },
      alignment: { vertical: "center", wrapText: true }
    };
  }

  columns.forEach((column, columnIndex) => {
    const headerCell = sheet[`${columnName(columnIndex)}6`];
    if (headerCell) {
      headerCell.s = {
        fill: { fgColor: { rgb: "1E293B" } },
        font: { color: { rgb: "FFFFFF" }, bold: true, sz: 10 },
        alignment: { vertical: "center", wrapText: true },
        border: { bottom: { style: "medium", color: { rgb: "3B82F6" } } }
      };
    }

    for (let rowIndex = 0; rowIndex < Math.max(1, rows.length); rowIndex++) {
      const cell = sheet[`${columnName(columnIndex)}${rowIndex + 7}`];
      if (!cell) continue;
      cell.s = {
        fill: { fgColor: { rgb: rowIndex % 2 === 0 ? "F8FAFC" : "FFFFFF" } },
        font: { color: { rgb: "1E293B" }, sz: 9.5 },
        alignment: { vertical: "top", wrapText: true },
        border: { bottom: { style: "hair", color: { rgb: "E2E8F0" } } },
        ...(column.format ? { numFmt: column.format } : {})
      };
    }
  });
  return sheet;
}

function addSheet(XLSX: any, workbook: any, name: string, sheet: any) {
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
}

function downloadWorkbook(XLSX: any, workbook: any, filename: string) {
  const output = XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true, cellStyles: true });
  if (!output || output.byteLength < 1000) throw new Error("The generated Excel workbook was empty or incomplete.");

  if (typeof window === "undefined" || typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    XLSX.writeFile(workbook, filename, { compression: true, cellStyles: true });
    return;
  }

  const url = URL.createObjectURL(new Blob([output], { type: XLSX_MIME }));
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

function summaryRows(stats: AnalyticsReportStat | null): unknown[][] {
  const total = stats?.totalCreated || 0;
  const paid = stats?.totalPaid || 0;
  const failed = stats?.totalFailed || 0;
  const other = Math.max(0, total - paid - failed);
  return [
    ["All receipt records", total, "records", "All stored receipts in the selected scope"],
    ["Settled records", paid, "records", "Recognized completed-payment statuses"],
    ["Failed records", failed, "records", "Records explicitly marked failed"],
    ["Open / other records", other, "records", "Pending, expired, refunded, or other statuses"],
    ["Settled GMV", stats?.totalGmv || 0, "USD", "Gross value of settled records"],
    ["Platform fee revenue", stats?.totalFees || 0, "USD", "Persisted fee evidence or the contractual 50 BPS minimum"],
    ["Fee-data coverage", (stats?.feeCoveragePct ?? 100) / 100, "ratio", `${stats?.feeKnownCount || 0} settled records with known fee evidence`],
    ["Average order value", stats?.aov || 0, "USD", "Settled GMV / settled records"],
    ["Raw receipt completion", (stats?.successRate || 0) / 100, "ratio", "Paid records / all raw receipt records"],
    ["Checkout completion", (stats?.completionRate ?? stats?.trueIntegrationRate ?? 0) / 100, "ratio", "Unique paid intents / all unique checkout intents"],
    ["Resolved outcome rate", (stats?.resolvedSuccessRate ?? stats?.trueProcessRate ?? 0) / 100, "ratio", "Unique paid / (unique paid + unique failed); excludes open intents"]
  ];
}

function brandRows(brands: AnalyticsBrandStat[]): unknown[][] {
  return brands.map(brand => [
    brand.brandName || brand.brandKey,
    brand.brandKey,
    brand.total,
    brand.dedupedTotal ?? brand.total,
    brand.paid,
    brand.failed,
    Math.max(0, brand.total - brand.paid - brand.failed),
    brand.successRate / 100,
    (brand.trueSuccessRate ?? brand.successRate) / 100,
    brand.gmv,
    brand.fees,
    (brand.feeCoveragePct ?? 100) / 100,
    brand.gmv > 0 && (brand.feeCoveragePct ?? 100) === 100 ? brand.fees / brand.gmv : null
  ]);
}

function fundingRows(stats: AnalyticsReportStat | null): unknown[][] {
  const methods = stats?.cardTypes || { credit: 0, debit: 0, bank: 0, unknown: 0 };
  const total = methods.credit + methods.debit + methods.bank + methods.unknown;
  return [
    ["Credit card", methods.credit, total ? methods.credit / total : 0],
    ["Debit card", methods.debit, total ? methods.debit / total : 0],
    ["US bank account / ACH", methods.bank, total ? methods.bank / total : 0],
    ["Crypto / unclassified", methods.unknown, total ? methods.unknown / total : 0]
  ];
}

function kycProfileRows(stats: AnalyticsReportStat | null): unknown[][] {
  const kyc = stats?.kycProfile || { total: 0, preverified: 0, upgraded: 0, l0: 0, l1: 0, l2: 0, untracked: 0 };
  const row = (label: string, count: number, definition: string) => [label, count, kyc.total ? count / kyc.total : 0, definition];
  return [
    row("Pre-verified at checkout start", kyc.preverified, "Initial verified tier was L1 or L2"),
    row("Upgraded during checkout", kyc.upgraded, "KYC completion was recorded on this checkout"),
    row("Final L1", kyc.l1, "Highest recorded final verified tier"),
    row("Final L2", kyc.l2, "Highest recorded final verified tier"),
    row("Unverified / L0", kyc.l0, "Explicitly unverified or L0"),
    row("Legacy untracked", kyc.untracked, "No authoritative KYC tier was captured"),
  ];
}

function failureRows(failures: AnalyticsFailureReason[], stats: AnalyticsReportStat | null): unknown[][] {
  const failed = stats?.totalFailed || 0;
  return failures.map((failure, index) => [index + 1, failure.reason, failure.count, failed ? failure.count / failed : 0]);
}

function receiptRows(receipts: AnalyticsReceiptItem[], timeZone: string): unknown[][] {
  return receipts.map(receipt => {
    const date = receipt.createdAt ? new Date(receipt.createdAt) : null;
    const dateValue = date && !Number.isNaN(date.getTime())
      ? date.toLocaleString("en-US", { dateStyle: "short", timeStyle: "medium", timeZone })
      : "";
    const items = (receipt.lineItems || []).map(item => ({
      label: item.label || "",
      quantity: item.qty ?? item.quantity ?? 1,
      unitPriceUsd: item.priceUsd ?? 0
    }));
    return [
      receipt.storageId || "",
      receipt.receiptId || "",
      receipt.id || "",
      dateValue,
      receipt.brandName || receipt.brandKey || "",
      receipt.brandKey || "",
      receipt.merchantName || "",
      receipt.wallet || "",
      receipt.merchantWallet || "",
      receipt.buyerWallet || "",
      receipt.email || "anonymous",
      receipt.status || "unknown",
      Number(receipt.totalUsd || 0),
      !isAnalyticsPaidReceipt(receipt) || receipt.platformFeeSource === "unavailable" ? null : Number(receipt.platformFee || 0),
      isAnalyticsPaidReceipt(receipt) ? (receipt.platformFeeSource || "legacy_unspecified") : "not_applicable_unsettled",
      receipt.cardFunding || "unclassified",
      receipt.kycInitialVerifiedLevel || receipt.kycInitialLevel || "Unknown",
      receipt.kycRequiredLevel || "None",
      receipt.kycCompletedLevel || "None",
      receipt.kycVerifiedLevel || receipt.kycFinalLevel || receipt.kycLevel || "Unknown",
      receipt.kycFinalStatus || "untracked",
      receipt.kycRegion === "eu"
        ? `identifiers=${receipt.kycIdentifiersSatisfied ? "yes" : "no"}; attestation=${receipt.kycAttestationAccepted ? "yes" : "no"}`
        : "not_applicable",
      receipt.stripeSessionId || "",
      receipt.paymentId || "",
      receipt.transactionHash || "",
      receipt.failureReason || "",
      items.length,
      text(JSON.stringify(items))
    ];
  });
}

function statusRows(receipts: AnalyticsReceiptItem[]): unknown[][] {
  const counts = new Map<string, number>();
  receipts.forEach(receipt => {
    const status = String(receipt.status || "unknown").toLowerCase();
    counts.set(status, (counts.get(status) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([status, count]) => [status, count, receipts.length ? count / receipts.length : 0]);
}

const SUMMARY_COLUMNS: SheetColumn[] = [
  { label: "Metric", width: 30 }, { label: "Value", width: 20 }, { label: "Unit", width: 12 }, { label: "Definition / Caveat", width: 68 }
];
const BRAND_COLUMNS: SheetColumn[] = [
  { label: "Partner", width: 24 }, { label: "Brand Key", width: 18 }, { label: "Raw Receipts", width: 14 },
  { label: "Estimated Intents", width: 17 }, { label: "Settled", width: 12 }, { label: "Failed", width: 12 },
  { label: "Open / Other", width: 13 }, { label: "Raw Conversion", width: 15, format: "0.0%" },
  { label: "Estimated Intent Conversion", width: 22, format: "0.0%" }, { label: "Settled GMV", width: 16, format: "$#,##0.00" },
  { label: "Recorded Platform Fees", width: 21, format: "$#,##0.00" }, { label: "Fee Coverage", width: 14, format: "0.0%" },
  { label: "Effective Recorded Rate", width: 20, format: "0.00%" }
];
const TRANSACTION_COLUMNS: SheetColumn[] = [
  { label: "Storage ID", width: 28 }, { label: "Receipt ID", width: 28 }, { label: "Document ID", width: 28 },
  { label: "Created At", width: 22 }, { label: "Partner", width: 22 }, { label: "Brand Key", width: 17 },
  { label: "Merchant", width: 28 }, { label: "Receipt Wallet", width: 44 }, { label: "Merchant Wallet", width: 44 },
  { label: "Buyer Wallet", width: 44 }, { label: "Customer Email", width: 32 }, { label: "Status", width: 20 },
  { label: "Amount USD", width: 15, format: "$#,##0.00" }, { label: "Recorded Platform Fee USD", width: 23, format: "$#,##0.00" },
  { label: "Fee Evidence", width: 20 }, { label: "Funding", width: 18 },
  { label: "Initial Verified KYC", width: 19 }, { label: "Required KYC", width: 15 },
  { label: "Completed During Payment", width: 24 }, { label: "Final Verified KYC", width: 19 },
  { label: "Final KYC Status", width: 18 }, { label: "EU Compliance", width: 36 },
  { label: "Stripe Session ID", width: 34 }, { label: "Payment ID", width: 34 }, { label: "Transaction Hash", width: 68 },
  { label: "Failure Detail", width: 60 }, { label: "Line Item Count", width: 15 }, { label: "Line Items JSON", width: 80 }
];
const FAILURE_COLUMNS: SheetColumn[] = [
  { label: "Rank", width: 10 }, { label: "Recorded Failure Reason", width: 75 }, { label: "Count", width: 14 },
  { label: "Share of Failed Records", width: 22, format: "0.0%" }
];
const STATUS_COLUMNS: SheetColumn[] = [
  { label: "Stored Status", width: 28 }, { label: "Record Count", width: 16 }, { label: "Share of Scope", width: 18, format: "0.0%" }
];

function definitionRows(): unknown[][] {
  return [
    ["Raw receipt completion", "Paid receipt records divided by all receipt records. Revisions are not deduplicated."],
    ["Checkout completion", "Unique paid checkout intents divided by all unique intents, including open and unresolved checkouts."],
    ["Resolved outcome rate", "Unique paid intents divided by unique paid plus explicitly failed intents. This deliberately excludes open intents."],
    ["Intent deduplication", "Uses stable receipt, Stripe session, payment, transaction, and non-conflicting recent email/wallet evidence. IP-only and anonymous proximity never merge intents."],
    ["Settled GMV", "Gross USD value for recognized completion statuses."],
    ["Platform fee revenue", "Uses persisted amountPlatformMinor, platform-fee USD, or platform BPS when available, with a contractual 50 BPS minimum."],
    ["Fee basis coverage", "Share of paid records assigned either persisted fee evidence or the contractual floor."],
    ["No recorded failure detail", "The receipt is marked failed but no reason was found in its receipt data, status history, or retained logs."],
    ["Snapshot", "All sheets in a workbook are built from one complete, snapshot-pinned, filtered batch result."]
  ];
}

export async function exportAnalyticsXLSX(
  kind: ReportKind,
  stats: AnalyticsReportStat | null,
  brands: AnalyticsBrandStat[],
  failures: AnalyticsFailureReason[],
  receipts: AnalyticsReceiptItem[],
  scope: string,
  timeZone: string
): Promise<void> {
  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: `BasaltSurge ${kind} analytics report`,
    Subject: scope,
    Author: "BasaltSurge Platform Analytics",
    CreatedDate: new Date()
  };

  const addSummary = () => addSheet(XLSX, workbook, "Summary", buildSheet(
    XLSX, "BasaltSurge Analytics Summary", "Reconciled metrics and explicit data-quality definitions", scope,
    SUMMARY_COLUMNS, summaryRows(stats)
  ));
  const addBrands = () => addSheet(XLSX, workbook, "Partner Performance", buildSheet(
    XLSX, "Partner Performance", "Volume, conversion, and platform fee basis by resolved partner key", scope,
    BRAND_COLUMNS, brandRows(brands)
  ));
  const addFailures = () => addSheet(XLSX, workbook, "Failure Reasons", buildSheet(
    XLSX, "Failure Reasons", "Complete distribution of recorded failure details", scope,
    FAILURE_COLUMNS, failureRows(failures, stats)
  ));
  const addTransactions = (name = "Transactions", source = receipts) => addSheet(XLSX, workbook, name, buildSheet(
    XLSX, "Transaction Detail", `${source.length.toLocaleString()} complete filtered receipt records`, scope,
    TRANSACTION_COLUMNS, receiptRows(source, timeZone)
  ));
  const addStatuses = () => addSheet(XLSX, workbook, "Status Mix", buildSheet(
    XLSX, "Stored Status Distribution", "No statuses are silently reclassified in this sheet", scope,
    STATUS_COLUMNS, statusRows(receipts)
  ));
  const addDefinitions = () => addSheet(XLSX, workbook, "Definitions", buildSheet(
    XLSX, "Metric Definitions", "Calculation rules and report caveats", scope,
    [{ label: "Metric", width: 30 }, { label: "Definition", width: 100 }], definitionRows()
  ));

  if (kind === "executive") {
    addSummary();
    addBrands();
    addSheet(XLSX, workbook, "Funding Mix", buildSheet(
      XLSX, "Settled Funding Mix", "Funding classification for recognized settled records", scope,
      [{ label: "Funding Classification", width: 32 }, { label: "Settled Records", width: 18 }, { label: "Share of Settled", width: 20, format: "0.0%" }],
      fundingRows(stats)
    ));
    addSheet(XLSX, workbook, "KYC Lifecycle", buildSheet(
      XLSX, "KYC Lifecycle", "Pre-verification, checkout upgrades, and final tier by unique checkout intent", scope,
      [{ label: "KYC Measure", width: 34 }, { label: "Unique Intents", width: 18 }, { label: "Share of Intents", width: 20, format: "0.0%" }, { label: "Definition", width: 72 }],
      kycProfileRows(stats)
    ));
    addFailures();
    addTransactions();
  } else if (kind === "ledger") {
    addTransactions();
    addSummary();
    addStatuses();
  } else if (kind === "brands") {
    addBrands();
    addTransactions("Partner Transactions");
    addSummary();
  } else {
    addFailures();
    addTransactions("Failed Transactions", receipts.filter(receipt => String(receipt.status || "").toLowerCase() === "failed"));
    addStatuses();
    addSummary();
  }
  addDefinitions();

  downloadWorkbook(XLSX, workbook, reportFilename(`${kind}_analytics`));
}
