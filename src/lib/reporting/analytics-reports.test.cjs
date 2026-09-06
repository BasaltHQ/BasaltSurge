const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");
const Module = require("node:module");
const ts = require("typescript");
const project = process.cwd();
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(project, "src", request.slice(2)) : request, parent, ...rest);
};
for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => {
    const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
    module._compile(result.outputText, filename);
  };
}
const pdf = require("./analytics-pdf.ts");
const { exportAnalyticsXLSX } = require("./analytics-excel.ts");
const { aggregateAnalyticsReceipts } = require("../platform-analytics-aggregation.ts");
const { getAnalyticsFailureReportData } = require("../platform-analytics-failures.ts");
const XLSX = require("xlsx-js-style");
const receipts = [
  { storageId: "store-recovered", receiptId: "receipt-recovered", brandKey: "audit", brandName: "Audit Partner", status: "paid", totalUsd: 100, createdAt: "2026-09-06T12:00:00Z", platformFee: 1, platformFeeSource: "recorded_usd", cardFunding: "credit", failureReason: "Card declined then recovered", stripeSessionId: "cos-a", email: "fixture@example.invalid", customerSessions: [] },
  { storageId: "store-rejected", receiptId: "receipt-rejected", brandKey: "audit", brandName: "Audit Partner", status: "rejected", totalUsd: 40, createdAt: "2026-09-06T13:00:00Z", failureReason: "Card declined", email: "fixture2@example.invalid", customerSessions: [] },
];
const { stats, brandStats } = aggregateAnalyticsReceipts(receipts, "America/Los_Angeles");
const reasons = getAnalyticsFailureReportData(receipts).reasonCounts;
const scope = "Definition: fixture-v1 | " + "Full context retained across report pages. ".repeat(180) + " | Search: SCOPE-END-MARKER | Failure: Card declined | TZ: America/Los_Angeles";

function pdfStreams(bytes) {
  const raw = bytes.toString("latin1");
  return [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => {
    try { return zlib.inflateSync(Buffer.from(match[1], "latin1")).toString("latin1"); } catch { return match[1]; }
  }).join("\n");
}

test("all four PDF and Excel reports generate real files and retain complete long query context", async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "analytics-report-tests-"));
  process.chdir(output);
  try {
    await pdf.exportExecutiveSummaryPDF(stats, brandStats, reasons, scope, receipts);
    await pdf.exportTransactionLedgerPDF(receipts, stats, "Fixture search", scope, "America/Los_Angeles");
    await pdf.exportBrandFinancialPDF(brandStats, stats, scope);
    await pdf.exportFailureDiagnosticsPDF(reasons, stats, receipts, scope, "America/Los_Angeles");
    for (const kind of ["executive", "ledger", "brands", "diagnostics"]) await exportAnalyticsXLSX(kind, stats, brandStats, reasons, receipts, scope, "America/Los_Angeles");
    const files = fs.readdirSync(output);
    assert.equal(files.filter(file => file.endsWith(".pdf")).length, 4);
    assert.equal(files.filter(file => file.endsWith(".xlsx")).length, 4);
    for (const file of files) {
      const bytes = fs.readFileSync(path.join(output, file));
      assert.ok(bytes.byteLength > 1000, file);
      if (file.endsWith(".pdf")) {
        assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
        const content = pdfStreams(bytes);
        assert.match(content, /SCOPE-END-MARKER/, file);
        assert.match(content, /Report scope and data definitions/, file);
        if (file.includes("failure_diagnostics")) assert.match(content, /receipt-recovered/, file);
      } else {
        const workbook = XLSX.read(bytes, { type: "buffer" });
        const cells = workbook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 })).flat().map(String).join("\n");
        assert.match(cells, /SCOPE-END-MARKER/, file);
        if (file.includes("diagnostics")) assert.match(cells, /receipt-recovered/, file);
      }
    }
  } finally {
    process.chdir(project);
    // Only this test's enumerated generated files are removed, without recursion.
    for (const file of fs.readdirSync(output)) fs.unlinkSync(path.join(output, file));
    fs.rmdirSync(output);
  }
});
