const ts = require('typescript');
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const program = ts.createProgram([
  'src/app/(web)/portal/[id]/page.tsx',
  'src/app/(web)/admin/panels/DataLabPanel.tsx',
  'src/app/api/platform/data-lab/checkout-experiment/route.ts',
  'src/app/api/receipts/[id]/checkout/route.ts',
  'src/app/api/receipts/[id]/route.ts',
  'src/app/api/receipts/route.ts',
  'src/app/api/receipts/terminal/route.ts',
  'src/app/api/orders/route.ts',
], { ...parsed.options, noEmit: true, incremental: false });
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: file => file, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }));
console.log(`Checkout experiment dependency graph: ${diagnostics.length} diagnostics.`);
process.exitCode = diagnostics.length ? 1 : 0;
