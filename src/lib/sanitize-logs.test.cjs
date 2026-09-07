const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const moduleObject = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve("./sanitize-logs.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleObject, exports: moduleObject.exports, Error });
const { maskSensitiveData } = moduleObject.exports;
test("provider credentials are removed from nested records without mutating the source", () => {
  const source = { id: "cos_session", client_secret: "secret_value", nested: [{ oauthToken: "oauth_value", crypto_payment_token: "cpt_value", status: "requires_payment" }] };
  const sanitized = maskSensitiveData(source);
  assert.equal(sanitized.client_secret, "[REDACTED]");
  assert.equal(sanitized.nested[0].oauthToken, "[REDACTED]");
  assert.equal(sanitized.nested[0].crypto_payment_token, "[REDACTED]");
  assert.equal(sanitized.id, "cos_session");
  assert.equal(source.client_secret, "secret_value");
});
test("credentials in serialized logs and Error messages are redacted", () => {
  const message = 'cos_ABC123_secret_PRIVATE liwltoken_PRIVATE sk_live_PRIVATE Bearer PRIVATE {"oauthToken":"PRIVATE"} client_secret=PRIVATE';
  assert.equal(maskSensitiveData(message).includes("PRIVATE"), false);
  assert.equal(maskSensitiveData(new Error(message)).message.includes("PRIVATE"), false);
});
test("circular SDK records do not crash logging and retain masked identity numbers", () => {
  const record = { ssn: "123-45-6789" };
  record.self = record;
  const sanitized = maskSensitiveData(record);
  assert.equal(sanitized.ssn, "***-**-6789");
  assert.equal(sanitized.self, "[Circular]");
});
