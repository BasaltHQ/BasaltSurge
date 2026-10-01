const ts = require("typescript");
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const program = ts.createProgram([
  "src/app/(web)/admin/panels/DataLabPanel.tsx",
  "src/app/api/platform/data-lab/route.ts",
  "src/components/admin/admin-sidebar.tsx",
], { ...parsed.options, noEmit: true, incremental: false });
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: file => file, getCurrentDirectory: () => process.cwd(), getNewLine: () => "\n" }));
  process.exitCode = 1;
} else console.log("Data Lab and its dependency graph typecheck passed.");
