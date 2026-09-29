const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
function load(file, dependencies = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => dependencies[name] ?? require(name) });
  return module.exports;
}
const content = load('./content.ts');
const routing = load('../../lib/routing.ts');

test('phone rear camera aims at the QR through rotated parent and hand transforms', async () => {
  const THREE = await import('three');
  const { aimCameraAtQr } = load('./store-scan.ts', { three: THREE });
  for (const turn of [Math.PI, -.4, 1.2]) {
    const person = new THREE.Group(); person.position.set(.75, .1, -6.5); person.rotation.y = turn;
    const hand = new THREE.Group(); hand.position.set(-.302, 1.417, .485); person.add(hand);
    const phone = new THREE.Group(); hand.add(phone);
    const lens = new THREE.Object3D(); lens.position.set(-.027, .063, .009); phone.add(lens);
    const target = new THREE.Vector3(1.1, 1.74, -7.644);
    const lensPosition = aimCameraAtQr(phone, lens, target);
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(lens.getWorldQuaternion(new THREE.Quaternion()));
    const targetDirection = target.clone().sub(lensPosition).normalize();
    assert.ok(axis.dot(targetDirection) > .99999, 'Rear lens must point at the QR, not beside it');
    assert.ok(lensPosition.distanceTo(target) > .2, 'Phone stays in front of the terminal');
  }
});

test('workshop routes cannot be interpreted as merchant vanity slugs', () => {
  for (const route of ['/workshop', '/workshop/partner', '/workshop/merchant']) {
    assert.equal(routing.isCandidateSlug(route), null);
    assert.equal(routing.isWorkshopPath(route), true);
  }
  assert.equal(routing.isWorkshopPath('/workshop-cafe'), false);
  assert.equal(routing.isCandidateSlug('/workshop-cafe'), 'workshop-cafe');
  assert.equal(routing.isWorkshopPath('/admin'), false);
});

test('independent editions keep the shared payment story and only their own audience chapter', () => {
  const full = Array.from(content.chaptersFor('all'), item => item.id);
  assert.equal(new Set(full).size, full.length);
  assert.ok(full.includes('partner') && full.includes('merchant'));
  assert.equal(full[1], 'store-tour');
  for (const audience of ['partner', 'merchant']) {
    const ids = Array.from(content.chaptersFor(audience), item => item.id);
    assert.ok(ids.includes(audience));
    assert.ok(!ids.includes(audience === 'partner' ? 'merchant' : 'partner'));
    assert.equal(ids.includes('store-tour'), audience === 'merchant');
    assert.equal(ids[0], 'opening'); assert.equal(ids.at(-1), 'next');
    assert.ok(ids.includes('onramp') && ids.includes('crypto') && ids.includes('opportunity') && ids.includes('relationship'));
    assert.ok(ids.indexOf('onramp') < ids.indexOf('verification'));
    assert.ok(ids.indexOf('verification') < ids.indexOf('continuity'));
    assert.ok(ids.indexOf('continuity') < ids.indexOf(audience));
  }
});

test('the workshop brief preserves the selected business gap, brand, audience and pilot', () => {
  const brief = content.workshopBrief('merchant', 1, 'A counter or kiosk workflow', 'North Pay');
  assert.match(brief, /^North Pay/);
  assert.match(brief, /Audience: For merchants/);
  assert.match(brief, /Priority: Disconnected tools/);
  assert.match(brief, /Pilot surface: A counter or kiosk workflow/);
  assert.match(brief, /Keep your order, confirmed payment and receipt connected/);
  assert.doesNotMatch(brief, /Priority: Processor disruption/);
  assert.match(brief, /Leg 1: Stripe onramp verification/);
  assert.match(brief, /Leg 2: separate merchant settlement/);
  assert.match(brief, /support escalation contact/);
  assert.match(brief, /Settlement choices: USDC, USDT, cbBTC, cbXRP, SOL, ETH/);
});

test('example merchant splits conserve funds and reject invalid allocations', () => {
  for (const [partner, agent] of [[150, 50], [100, 25], [200, 75], [0, 0], [500, 300]]) {
    const split = Array.from(content.illustrateSplit(partner, agent));
    assert.equal(split.reduce((sum, item) => sum + item.bps, 0), 10000);
    assert.equal(split.reduce((sum, item) => sum + item.amount, 0), 1000);
    assert.equal(split.find(item => item.label === 'Merchant').amount, (10000 - partner - agent - 50) / 10);
  }
  for (const input of [[-1, 0], [9950, 100], [1.5, 50], [NaN, 0]]) assert.throws(() => content.illustrateSplit(...input));
});
