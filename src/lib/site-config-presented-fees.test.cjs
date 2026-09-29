const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('server receipt configuration loads the same brand method fees and pins explicit automatic defaults', async () => {
  const wallet = '0x' + '1'.repeat(40);
  const brand = { achPresentedFeeBps: 110, cryptoPresentedFeeBps: 50 };
  const doc = { id: 'site:config:partner', type: 'site_config', wallet, splitAddress: wallet, splitConfig: { platformBps: 50, partnerBps: 0, agents: [] } };
  const mocks = {
    '@/lib/cosmos': { getContainer: async () => ({ item: id => ({ read: async () => ({ resource: id === doc.id ? doc : null }) }) }) },
    '@/config/brands': { getBrandKey: () => 'wrong-container' },
    '@/lib/env': { isPartnerContext: () => true },
    '@/lib/brand-config': {
      deriveContainerIdentityFromHostname: async () => ({ brandKey: 'partner' }),
      getBrandConfigFromCosmos: async key => { assert.equal(key, 'partner'); return { brand }; },
    },
  };
  function load(name) {
    const file = path.join(__dirname, name + '.ts');
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { module, exports: module.exports, process: { env: {} }, console,
        require: id => mocks[id] || load(id.replace(/^@\/lib\//, '').replace(/^\.\//, '')) });
    return module.exports;
  }
  const { getSiteConfigForWallet } = load('site-config');
  const { settlementRoutingFields, receiptRoutingFields } = load('payment-split-routing');
  const initial = await getSiteConfigForWallet(wallet, 'partner');
  const snapshot = settlementRoutingFields(initial);
  assert.equal(snapshot.achPresentedFeeBps, 110);
  assert.equal(snapshot.cryptoPresentedFeeBps, 50);
  brand.achPresentedFeeBps = null;
  brand.cryptoPresentedFeeBps = 0;
  const updated = await getSiteConfigForWallet(wallet, undefined, { headers: new Headers({ host: 'partner.example' }) });
  assert.equal(updated.achPresentedFeeBps, null);
  assert.equal(updated.cryptoPresentedFeeBps, 0);
  assert.equal(receiptRoutingFields({ splitRoutingSnapshot: snapshot }, updated).achPresentedFeeBps, 110);
  assert.equal(receiptRoutingFields({ splitRoutingSnapshot: { splitAddress: wallet } }, updated).cryptoPresentedFeeBps, null);
});
