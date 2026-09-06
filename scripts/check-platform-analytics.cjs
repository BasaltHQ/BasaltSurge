const ts = require("typescript");

// Check the analytics dependency graph independently of unrelated application pages.
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const roots = [
  "src/app/(web)/admin/panels/PlatformAnalyticsPanel.tsx",
  "src/app/api/platform/analytics/route.ts",
  "src/app/api/platform/safe-value/route.ts",
  "src/app/api/platform/stripe-audit/route.ts",
];
const program = ts.createProgram(roots, { ...parsed.options, noEmit: true, incremental: false });
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  }));
  process.exitCode = 1;
} else {
  console.log("Platform analytics and its dependency graph typecheck passed.");
}
