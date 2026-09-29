const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');

function load(file, imports = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => imports[name] || require(name), console, setTimeout, clearTimeout, ...globals });
  return module.exports;
}
const branding = load('lib/admin-tour/branding.ts');
const learner = load('lib/admin-tour/learner.ts');
const catalog = load('lib/admin-tour/catalog.ts', { './branding': branding });
const stepSchema = load('lib/admin-tour/steps.ts');
const narration = load('lib/admin-tour/narration.ts');
const audio = load('lib/admin-tour/audio.ts');
const documents = load('lib/admin-tour/documents.ts', { './steps': stepSchema });
const documentServer = load('lib/admin-tour/documents.server.ts', { './documents': documents }, { process });
const docsRoot = path.resolve(root, '../docs/tour/panels');
const lessons = documents.compileTourDocuments(fs.readdirSync(docsRoot).filter(file => file.endsWith('.md')).map(file => ({ markdown: fs.readFileSync(path.join(docsRoot, file), 'utf8'), href: `/developers/docs/tour/panels/${file.slice(0, -3)}` })));
const ui = load('lib/admin-tour/interface.ts', { './spotlight': { spotlight: () => () => {} } });
const stop = (section, panel, role) => ({ id: `${section}:${panel}`, section, panel, title: panel, role });

test('all currently linked sidebar panels have authored training content', () => {
  const sidebar = fs.readFileSync(path.join(root, 'components/admin/admin-sidebar.tsx'), 'utf8');
  const keys = [...sidebar.matchAll(/key: '([^']+)' as AdminTabKey/g)].map(m => m[1]);
  for (const key of new Set(keys.filter(k => k !== 'takeTour'))) assert.ok(lessons[key], `Missing lesson: ${key}`);
  assert.ok(lessons.developers);
});

test('every published action resolves to an explicit binding in its declared TSX resource', () => {
  const cache = new Map();
  let count = 0;
  for (const [panel, lesson] of Object.entries(lessons)) {
    assert.ok(lesson.steps?.length >= 2, `${panel} needs a walkthrough, not an orientation alone`);
    for (const step of lesson.steps) for (const action of step.actions) for (const resource of [action.resource, ...(action.destination ? [action.destination] : [])]) {
      const source = resource.source;
      if (!cache.has(source)) {
        const text = fs.readFileSync(path.resolve(root, '..', source), 'utf8');
        const sf = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        assert.equal(sf.parseDiagnostics.length, 0, source);
        const targets = [];
        function visit(node) {
          if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
            const attrs = node.attributes.properties;
            const binding = attrs.find(a => a.name?.text === 'data-tour');
            if (binding) {
              const init = binding.initializer;
              let matches;
              if (ts.isStringLiteral(init)) matches = target => target === init.text;
              else if (ts.isJsxExpression(init) && ts.isTemplateExpression(init.expression)) {
                const expression = init.expression, prefix = expression.head.text;
                const suffix = expression.templateSpans.at(-1).literal.text;
                matches = target => target.startsWith(prefix) && target.endsWith(suffix) &&
                  (text.includes(`'${target.slice(prefix.length, suffix ? -suffix.length : undefined)}'`) || text.includes(`"${target.slice(prefix.length, suffix ? -suffix.length : undefined)}"`));
              }
              if (matches) targets.push({ matches, tag: node.tagName.getText(sf), active: attrs.some(a => a.name?.text === 'data-tour-active'), allowed: attrs.some(a => a.name?.text === 'data-tour-action' && a.initializer?.text === 'activate') });
            }
          }
          ts.forEachChild(node, visit);
        } visit(sf); cache.set(source, targets);
      }
      const found = cache.get(source).filter(t => t.matches(resource.target));
      assert.ok(found.length, `${panel}/${step.id}: missing ${source}#${resource.target}`);
      if (resource === action.resource && action.type === 'activate') assert.ok(found.every(t => t.tag === 'button' && t.active && t.allowed), `${panel}: view activation needs a button, explicit permission and state verification`);
      if (resource === action.destination) assert.ok(found.every(t => t.active), `${panel}/${step.id}: destination must declare active state`);
      count++;
    }
  }
  assert.ok(count > 300);
});

test('action schema rejects scripts, external paths, unknown actions and silent optional steps', () => {
  const step = { id: 'one', title: 'View', brief: 'Short explanation', extended: 'Detailed explanation', actions: [{ type: 'highlight', resource: { target: 'panel.view', source: 'src/components/Panel.tsx' } }] };
  assert.equal(stepSchema.parseTourSteps([step]).length, 1);
  for (const change of [
    { actions: [{ type: 'click', resource: step.actions[0].resource }] },
    { actions: [{ ...step.actions[0], script: 'fetch("/delete")' }] },
    { actions: [{ ...step.actions[0], resource: { target: '[onclick]', source: 'src/components/Panel.tsx' } }] },
    { actions: [{ ...step.actions[0], resource: { target: 'panel.view', source: 'src/../../secret.tsx' } }] },
    { actions: [{ ...step.actions[0], destination: step.actions[0].resource }] },
    { actions: [{ type: 'activate', resource: step.actions[0].resource, destination: { target: '[onclick]', source: 'src/components/Panel.tsx' } }, step.actions[0]] },
    { optional: true }, { mode: 'unknown' },
  ]) assert.throws(() => stepSchema.parseTourSteps([{ ...step, ...change }]));
  assert.throws(() => stepSchema.parseTourSteps([step, step]), /unique/);
  assert.equal(stepSchema.stepsForMode([step, { ...step, id: 'detail', mode: 'extended' }], 'brief').length, 1);
});

test('walkthrough clicks only explicit navigation bindings, verifies activation and cancels stale work', async () => {
  let clicked = 0, active = false, connected = true;
  const attrs = { 'data-tour-action': 'activate' };
  const button = { tagName: 'BUTTON', isConnected: true, getClientRects: () => [1], closest: () => null,
    getAttribute: name => name === 'data-tour-active' ? String(active) : attrs[name], click: () => { clicked++; active = true; } };
  const region = { ...button, tagName: 'DIV' };
  const root = { get isConnected() { return connected; }, querySelectorAll: query => query.includes('tab') ? [button] : query.includes('body') ? [region] : [] };
  const controller = new ui.TourInterface(() => root);
  const resource = target => ({ target, source: 'src/components/Panel.tsx' });
  const step = { id: 'one', title: 'Overview', brief: 'Overview', extended: 'Overview', actions: [{ type: 'activate', resource: resource('tab') }, { type: 'highlight', resource: resource('body') }] };
  assert.equal((await controller.walkthrough(step)).status, 'shown'); assert.equal(clicked, 1);
  await controller.walkthrough(step); assert.equal(clicked, 1, 'already active tabs are not toggled');
  button.disabled = true;
  assert.equal((await controller.walkthrough({ ...step, optional: 'This view is disabled for the current role.' })).status, 'unavailable');
  await assert.rejects(controller.walkthrough(step), /disabled/);
  button.disabled = false;
  delete attrs['data-tour-action']; active = false;
  await assert.rejects(controller.walkthrough(step), /not approved/); assert.equal(clicked, 1);
  const waiting = controller.walkthrough({ ...step, actions: [{ type: 'highlight', resource: resource('missing') }] });
  controller.reset(); await assert.rejects(waiting, /panel changed/);
  connected = false; await assert.rejects(controller.walkthrough(step), /panel changed/);
});

test('Plugin Studio opens the real provider workspace and completes every authored tab without mutations', async () => {
  // Render the actual panel's navigation with in-memory React state. DOM lookup
  // re-renders after each click, so unmounted catalog cards cannot falsely pass.
  for (const initial of ['catalog', 'ubereats', 'shopify']) for (const mode of ['brief', 'extended']) {
    const slots = [], clicks = []; let cursor = 0;
    const react = {
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
        return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
      useEffect() {},
    };
    const Panel = load('app/(web)/admin/panels/PlatformPluginsPanel.tsx', {
      react, 'thirdweb/react': { useActiveAccount: () => ({ address: 'synthetic' }) }, 'lucide-react': new Proxy({}, { get: (_, k) => k }),
    }, { fetch: () => { throw Error('A tour navigation must not save, deploy, publish or authorize.'); }, window: { location: { origin: 'https://example.test' } } }).default;
    function nodes(node) {
      if (!node || typeof node !== 'object') return [];
      if (Array.isArray(node)) return node.flatMap(nodes);
      if (typeof node.type === 'function') return nodes(node.type(node.props));
      return [node, ...nodes(node.props?.children)];
    }
    const find = target => {
      cursor = 0;
      return nodes(Panel()).filter(node => node.props?.['data-tour'] === target).map(node => ({
        tagName: String(node.type).toUpperCase(), isConnected: true, disabled: node.props.disabled,
        getClientRects: () => [1], closest: () => null,
        getAttribute: name => node.props[name] === undefined ? null : String(node.props[name]),
        click: () => { clicks.push(target); node.props.onClick(); },
      }));
    };
    const root = { isConnected: true, querySelectorAll: selector => find(selector.match(/data-tour="([^"]+)"/)[1]) };
    if (initial !== 'catalog') { find(`pluginStudio.open.${initial}`)[0].click(); find('pluginStudio.workspaceSection.configuration')[0].click(); }
    const runner = new ui.TourInterface(() => root);
    const steps = stepSchema.stepsForMode(lessons.pluginStudio.steps, mode);
    for (const step of steps) {
      assert.equal(step.optional, undefined, 'real prerequisites replace unavailable placeholders');
      assert.equal((await runner.walkthrough(step)).status, 'shown', `${initial}/${mode}/${step.id}`);
      assert.equal(find(step.actions.at(-1).resource.target).length, 1);
    }
    assert.equal(find('pluginStudio.workspaceSection.publish')[0].getAttribute('data-tour-active'), 'true');
    assert.equal(clicks.filter(t => t === 'pluginStudio.open.shopify').length, initial === 'shopify' ? 2 : 1, 'already open workspace is reused between steps');
    assert.ok(clicks.every(t => /pluginStudio\.(open\.|backToCatalog|viewMode\.|workspaceSection\.)/.test(t)));
    // Retrying a completed step must not re-open the card or reset the tab.
    const before = clicks.length; await runner.walkthrough(steps.at(-1)); assert.equal(clicks.length, before);
  }
});

test('navigation destinations must be explicitly approved by their source button', async () => {
  const el = { tagName: 'BUTTON', isConnected: true, getClientRects: () => [1], closest: () => null,
    getAttribute: name => name === 'data-tour-action' ? 'activate' : null, click: () => assert.fail('must not click an unapproved destination') };
  const root = { isConnected: true, querySelectorAll: selector => selector.includes('open') ? [el] : [] };
  const runner = new ui.TourInterface(() => root);
  const resource = target => ({target, source:'src/components/Panel.tsx'});
  await assert.rejects(runner.walkthrough({title:'Open',actions:[{type:'activate',resource:resource('open'),destination:resource('workspace')}]}), /not approved/);
});

test('role detection is additive and the full itinerary preserves team workspaces', () => {
  const stops = [stop('General', 'support'), stop('Shopper', 'purchases', 'shopper'), stop('Shop A', 'inventory', 'merchant'), stop('Shop B', 'inventory', 'merchant'), stop('Partner/Admin', 'branding', 'partner/admin'), stop('Platform', 'platformSettings', 'platform'), stop('Apps', 'kitchen'), stop('Manuals', 'manualShop')];
  const route = catalog.buildTour(stops);
  assert.equal(route.length, stops.length);
  assert.equal(route[0].section, 'Platform');
  assert.equal(route.filter(s => s.panel === 'inventory').length, 2);
  assert.deepEqual(Array.from(catalog.tourRoles(stops)), ['shopper', 'merchant', 'partner/admin', 'platform']);
  assert.ok(route.some(s => s.section === 'Apps'));
  assert.ok(route.some(s => s.section === 'Manuals'));
});

test('shopper-only access never gains merchant or platform stops', () => {
  const stops = [stop('Shopper', 'rewards', 'shopper'), stop('Shopper', 'profileSetup', 'shopper'), stop('General', 'takeTour')];
  assert.deepEqual(Array.from(catalog.buildTour(stops), s => s.panel), ['profileSetup', 'rewards']);
  assert.deepEqual(Array.from(catalog.tourRoles(stops)), ['shopper']);
});

const documentFixture = panel => `<!-- tour {"panel":"${panel}","order":15} -->\n\n# New Panel\n\n## Overview\n\nExplore {{panelTitle}} in {{platformName}}.\n\n## Walkthrough\n\n- Find the filters in {{sectionTitle}}.\n- Review the results.\n\n## Takeaway\n\nReturn to {{brandName}} for this task.\n`;

test('new panel documents are discovered recursively without changing a registry', async () => {
  const base = path.resolve(root, '../tmp');
  fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, 'tour-doc-test-'));
  try {
    fs.mkdirSync(path.join(directory, 'industry'));
    fs.writeFileSync(path.join(directory, 'industry', 'new-panel.md'), documentFixture('futurePanel'));
    const discovered = await documentServer.loadTourCatalog(directory);
    assert.ok(discovered.futurePanel);
    assert.equal(discovered.futurePanel.documentationHref, '/developers/docs/tour/panels/industry/new-panel');
    const route = catalog.buildTour([stop('Merchant', 'last', 'merchant'), stop('Merchant', 'futurePanel', 'merchant')], discovered);
    assert.equal(route[0].panel, 'futurePanel');
    assert.equal(catalog.buildTour([stop('Shopper', 'purchases', 'shopper')], discovered).length, 1, 'documents do not grant sidebar access');
  } finally {
    assert.ok(path.resolve(directory).startsWith(base + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('invalid, duplicate, and incomplete documents fail with useful errors', () => {
  assert.throws(() => documents.parseTourDocument('no metadata', '/guide'), /Missing/);
  assert.throws(() => documents.parseTourDocument(documentFixture('invalid/key'), '/guide'), /panel key/);
  assert.throws(() => documents.parseTourDocument(documentFixture('valid').replace('## Takeaway', '## Missing'), '/guide'), /Takeaway/);
  assert.throws(() => documents.parseTourDocument(documentFixture('valid').replace('{{platformName}}', '{{unknown}}'), '/guide'), /Unsupported tour token/);
  const item = { markdown: documentFixture('valid'), href: '/guide' };
  assert.throws(() => documents.compileTourDocuments([item, item]), /Duplicate tour panel/);
});

test('brand interpolation stays local to each session and does not mutate shared documents', () => {
  const content = documents.compileTourDocuments([{ markdown: documentFixture('futurePanel'), href: '/guide' }]);
  const current = { ...stop('Shop A', 'futurePanel', 'merchant'), title: 'Future Panel' };
  const first = branding.resolveTourBrand({ key: 'north', isPartner: true, partnerName: 'North Pay', ready: true });
  const second = branding.resolveTourBrand({ key: 'south', isPartner: true, partnerName: 'South Pay', ready: true });
  assert.equal(catalog.getLesson(current, content, first).summary, 'Explore Future Panel in North Pay.');
  assert.equal(catalog.getLesson(current, content, second).takeaway, 'Return to South Pay for this task.');
  assert.match(content.futurePanel.summary, /\{\{platformName\}\}/);
  assert.deepEqual({ ...branding.tourSessionVariables(first) }, { tour_brand_name: 'North Pay', tour_platform_name: 'North Pay', tour_learner_name: '' });
});

test('partner brand fallback never inherits a platform or another brand name', () => {
  const resolve = input => branding.resolveTourBrand({ key: 'north-pay', isPartner: true, contextKey: 'basaltsurge', contextName: 'BasaltSurge', platformName: 'Another Shop', ready: true, ...input });
  assert.equal(resolve({}).name, 'North Pay');
  assert.equal(resolve({ partnerName: 'PortalPay' }).name, 'North Pay');
  assert.equal(resolve({ partnerName: 'default' }).name, 'North Pay');
  assert.equal(resolve({ partnerName: 'North & Co.' }).name, 'North & Co.');
  assert.equal(resolve({ partnerName: 'North', ready: false }).ready, false);
  assert.equal(branding.resolveTourBrand({ key: 'basaltsurge', isPartner: false, platformName: 'BasaltSurge', ready: true }).name, 'BasaltSurge');
});

test('interface excludes credentials and rejects stale control IDs', () => {
  let clicks = 0;
  const make = (label, type) => ({ tagName: 'BUTTON', type, isConnected: true, style: {}, getClientRects: () => [1], closest: () => null, getAttribute: name => name === 'aria-label' ? label : null, click: () => clicks++, scrollIntoView() {} });
  const save = make('Save settings', 'button'), secret = make('API key', 'text');
  const root = { querySelectorAll: () => [save, secret], contains: el => el === save || el === secret };
  const controller = new ui.TourInterface(() => root);
  const controls = controller.inspect();
  assert.equal(controls.length, 1);
  controller.describe({ controlId: controls[0].id, action: 'click' });
  assert.equal(clicks, 0, 'describing an action must not execute it');
  controller.apply({ controlId: controls[0].id, action: 'click' });
  assert.equal(clicks, 1);
  assert.throws(() => controller.apply({ controlId: controls[0].id, action: 'click' }), /changed/);
  for (const label of ['Private key', 'API Token', 'Seed phrase', 'CVV']) assert.equal(ui.isSensitiveControl(label), true);
});

function harness(options = {}) {
  const slots = [], effects = [], navigated = [];
  let cursor = 0, dirty = false, clientTools, callbacks;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'Fragment',
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(slots[i], next)) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; return slots[i] || (slots[i] = { current: initial }); },
    useMemo(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((d, j) => d !== old.deps[j])) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((d, j) => d !== old[j])) { slots[i] = deps; effects.push(fn); } },
  };
  const sdk = { status: 'disconnected', isSpeaking: false, endSession: async () => {}, sendContextualUpdate() {}, sendUserMessage() {}, ...options.sdk };
  const Component = load('components/admin/TakeTheTour.tsx', { react, '@elevenlabs/react': { useConversation: options => { callbacks = options; clientTools = options.clientTools; return sdk; } }, 'lucide-react': new Proxy({}, { get: (_, k) => k }), '@/lib/admin-tour/catalog': catalog, '@/lib/admin-tour/interface': options.ui || ui,
    './TourAudioControls': { default: 'TourAudioControls', __esModule: true }, '@/lib/admin-tour/audio': { ...audio, prepareTourMicrophone: options.prepare || (async () => {}) },
    './TourWelcomeDialog': { default: 'TourWelcomeDialog', __esModule: true }, '@/lib/admin-tour/learner': learner,
    '@/lib/admin-tour/branding': branding, '@/lib/admin-tour/steps': stepSchema, '@/lib/admin-tour/narration': options.narration || narration, '@/hooks/useTourContent': { useTourContent: () => ({ lessons, error: '', retry() {} }) } }, {
    AbortController, AbortSignal, fetch: options.fetch || (() => { throw Error('Unexpected fetch'); }),
    setInterval: () => 0, clearInterval() {},
    localStorage: { getItem: () => null, setItem() {} }, window: { addEventListener() {}, removeEventListener() {} },
  }).default;
  const props = { navigation: { brand: { key: 'test', name: 'Test Partner', platformName: 'Test Partner', ready: true, isPartner: true }, stops: [stop('Shopper', 'profileSetup', 'shopper'), stop('Shopper', 'purchases', 'shopper')], navigate(id) { navigated.push(id); props.activeTab = id.split(':')[1]; return true; } }, wallet: '0x1', ready: true, activeTab: 'takeTour' };
  function render() { let tree; for (let i = 0; i < 15; i++) { cursor = 0; dirty = false; tree = Component(props); while (effects.length) effects.shift()(); if (!dirty) return tree; } throw Error('Render loop'); }
  function nodes(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.props?.children)]; }
  function text(node) { if (Array.isArray(node)) return node.map(text).join(''); return typeof node === 'object' && node ? text(node.props?.children) : String(node ?? ''); }
  function find(tree, label) { const result = nodes(tree).find(n => n.type === 'button' && text(n).includes(label)); assert.ok(result, label); return result; }
  const welcome = () => nodes(render()).find(n => n.type === 'TourWelcomeDialog')?.props;
  return { render, find, props, navigated, welcome, start(name = 'Maya') { find(render(), 'Start my tour').props.onClick(); welcome().onBegin(name); render(); }, emit(name, event) { callbacks[name]?.(event); render(); }, audio() { return nodes(render()).find(n => n.type === 'TourAudioControls').props; }, text() { return text(render()); }, call(name, params = {}) { return JSON.parse(clientTools[name](params)); } };
}

test('welcome form gates navigation; names are cleaned, personalized and scoped to the wallet', () => {
  const h = harness();
  h.find(h.render(), 'Start my tour').props.onClick();
  assert.equal(h.welcome().brand.name, 'Test Partner');
  assert.equal(h.navigated.length, 0);
  h.welcome().onBegin('  {}  '); assert.equal(h.navigated.length, 0);
  h.welcome().onCancel(); assert.equal(h.welcome(), undefined);
  h.start('  María   O’Neill  ');
  assert.equal(h.call('getTourContext').learner.preferredName, 'María O’Neill');
  assert.match(learner.tourIntroduction(h.props.navigation.brand, 'María'), /Welcome, María.*Daniel, your AI guide to Test Partner/);
  h.props.wallet = '0x2'; h.render();
  h.props.activeTab = 'takeTour';
  h.find(h.render(), 'Start my tour').props.onClick();
  assert.equal(h.welcome().initialName, '');
  h.welcome().onBegin('Sam'); h.render();
  assert.equal(h.call('getTourContext').learner.preferredName, 'Sam');
  h.props.navigation = { ...h.props.navigation, brand: { ...h.props.navigation.brand, key: 'another-partner' } }; h.render();
  h.props.activeTab = 'takeTour';
  h.find(h.render(), 'Start my tour').props.onClick();
  assert.equal(h.welcome().initialName, '');
});

test('preferred names preserve international spelling without markup or hidden direction controls', () => {
  assert.equal(learner.cleanTourName('  李 小龍  '), '李 小龍');
  assert.equal(learner.cleanTourName('E\u0301lodie-Jane'), 'Élodie-Jane');
  assert.equal(learner.cleanTourName('<Maya>\n{{\u202e}}'), 'Maya');
  assert.equal(learner.cleanTourName('a'.repeat(100)).length, 60);
});

test('microphone denial precedes usage reservation and gives actionable recovery', async () => {
  const h = harness({ prepare: async () => { throw { name: 'NotAllowedError' }; } });
  h.start();
  await h.audio().connect(false);
  assert.match(h.text(), /allow Microphone/);
  assert.equal(h.audio().connecting, false);
});

test('failed SDK startup releases audio and commits zero usage; text bypasses microphone', async () => {
  let ends = 0, prep = 0; const calls = [], starts = [];
  const h = harness({ prepare: async () => { prep++; },
    fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ signedUrl: 'wss://test', conversationToken: 'rtc-test', usageDocId: 'reservation', maxDurationSec: 1 }) }; },
    sdk: { startSession: async config => { starts.push(config); throw { name: 'NotReadableError' }; }, endSession: async () => { ends++; } },
  });
  h.start();
  await h.audio().connect(false);
  assert.equal(prep, 1); assert.equal(ends, 1);
  assert.equal(starts[0].connectionType, 'webrtc'); assert.equal(starts[0].conversationToken, 'rtc-test');
  assert.equal(calls.at(-1).body.seconds, 0);
  assert.match(h.text(), /microphone could not start/);
  await h.audio().connect(true);
  assert.equal(prep, 1); assert.equal(starts[1].connectionType, 'websocket'); assert.equal(starts[1].textOnly, true);
  assert.equal(starts[1].dynamicVariables.tour_brand_name, 'Test Partner');
  assert.equal(starts[1].dynamicVariables.tour_learner_name, 'Maya');
});

test('cancelling a pending microphone request cannot start a late voice session', async () => {
  let grant;
  const h = harness({ prepare: () => new Promise(resolve => { grant = resolve; }) });
  h.start();
  const pending = h.audio().connect(false);
  await h.audio().disconnect(); grant(); await pending;
  assert.equal(h.audio().connecting, false);
});

test('microphone preflight detects policy blocks and closes every permission-check track', async () => {
  let captures = 0, stopped = 0;
  const policy = { allowsFeature: () => false };
  const helper = load('lib/admin-tour/audio.ts', {}, { window: { isSecureContext: true }, document: { permissionsPolicy: policy }, navigator: { mediaDevices: { getUserMedia: async constraints => {
    captures++; assert.equal(constraints.video, false); assert.equal(constraints.audio.echoCancellation, true);
    return { getTracks: () => [{ stop: () => stopped++ }] };
  } } } });
  await assert.rejects(helper.prepareTourMicrophone(), { name: 'MicrophonePolicyError' }); assert.equal(captures, 0);
  policy.allowsFeature = () => true;
  await helper.prepareTourMicrophone(); assert.equal(captures, 1); assert.equal(stopped, 1);
  assert.match(helper.tourAudioError({ name: 'NotFoundError' }), /No microphone/);
  assert.match(helper.tourSessionError(403), /verified/);
});

test('admin security headers permit same-origin microphone access without enabling other routes', () => {
  const source = fs.readFileSync(path.join(root, 'proxy.ts'), 'utf8');
  const sf = ts.createSourceFile('proxy.ts', source, ts.ScriptTarget.Latest, true);
  const fn = sf.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'applySecurityHeaders');
  const code = ts.transpileModule(fn.getText(sf), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { buildCsp: () => "default-src 'self'; frame-ancestors 'self'", isMainDomainHost: () => true, URL, process: { env: {} } };
  vm.runInNewContext(code + '\nthis.apply = applySecurityHeaders;', context);
  for (const [pathname, expected] of [['/admin', 'microphone=(self)'], ['/admin/settings', 'microphone=(self)'], ['/shop/demo', 'microphone=(self)'], ['/administrator', 'microphone=()'], ['/developers', 'microphone=()']]) {
    const headers = new Map();
    context.apply({ nextUrl: { pathname, hostname: 'example.com' }, headers: new Map([['host', 'example.com']]) }, { headers });
    assert.ok(headers.get('Permissions-Policy').includes(expected), pathname);
  }
});

test('the agent cannot advance past a question break or navigate outside access', () => {
  const h = harness();
  h.start();
  assert.equal(h.navigated.length, 1);
  assert.equal(h.call('getTourContext').mode, 'brief');
  assert.equal(h.call('getTourContext').brand.name, 'Test Partner');
  assert.equal(h.call('navigateTour', { stopId: 'Platform:partners' }).error, 'That panel is not in the accessible sidebar.');
  assert.equal(h.call('navigateTour', { stopId: 'Shopper:purchases' }).status, 'awaiting_user_navigation');
  assert.equal(h.navigated.length, 1);
  assert.equal(h.call('finishSegment', { stopId: 'Shopper:purchases' }).error, 'The current panel changed. Get the current context again.');
  assert.equal(h.call('finishSegment', { stopId: 'Shopper:profileSetup' }).status, 'walkthrough_in_progress');
  h.find(h.render(), 'Skip remaining highlights').props.onClick();
  const tree = h.render();
  assert.equal(h.call('getTourContext').phase, 'questions');
  assert.equal(h.navigated.length, 1, 'finishing narration must not navigate');
  h.find(tree, 'Continue').props.onClick(); h.render();
  assert.equal(h.navigated.at(-1), 'Shopper:purchases');
});

function narrationClock() {
  let now = 0, serial = 0; const timers = new Map();
  const clock = { Date: class extends Date { static now() { return now; } },
    setTimeout(fn, delay) { timers.set(++serial, { fn, at: now + delay }); return serial; }, clearTimeout(id) { timers.delete(id); } };
  const tick = ms => { const end = now + ms; while (true) { const next = [...timers].sort((a, b) => a[1].at - b[1].at).find(([, job]) => job.at <= end); if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].fn(); } now = end; };
  return { ...load('lib/admin-tour/narration.ts', {}, clock), tick };
}

test('narration waits through sentence gaps and real playback, then leaves two seconds of breathing room', () => {
  const { TourNarration, tick } = narrationClock(); const requests = [];
  const state = { connected: true, enabled: true, textOnly: false, stopId: 'reserve', phase: 'teaching', nextStepId: 'two' };
  const queue = new TourNarration(() => state, id => requests.push(id));
  queue.prepare('reserve'); queue.response('word '.repeat(60));
  tick(4000); assert.equal(requests.length, 0, 'a transcript alone is not audio completion');
  queue.audioActivity();
  for (let i = 0; i < 24; i++) { tick(250); queue.audioActivity(); }
  tick(4000); assert.equal(requests.length, 0, 'long mid-sentence/network gap is protected by narration-length floor');
  for (let i = 0; i < 64; i++) { tick(250); queue.audioActivity(); assert.equal(requests.length, 0, 'audio still playing'); }
  tick(1999); assert.equal(requests.length, 0);
  tick(1); assert.deepEqual(requests, ['two']); tick(20000); assert.equal(requests.length, 1);
});

test('short highlights remain visible and text tours get enough time to read', () => {
  const { TourNarration, tick } = narrationClock(); let advances = 0;
  const state = { connected: true, enabled: true, textOnly: false, stopId: 'one', phase: 'teaching' };
  const queue = new TourNarration(() => state, () => advances++);
  queue.prepare('one'); queue.response('Your account settings.'); queue.audioActivity();
  tick(4999); assert.equal(advances, 0); tick(1); assert.equal(advances, 1);
  state.textOnly = true; queue.prepare('one'); tick(10000); queue.response('word '.repeat(70));
  tick(21999); assert.equal(advances, 1, 'reading time starts when the response arrives'); tick(1); assert.equal(advances, 2);
  queue.prepare('one'); queue.response('More text'); state.phase = 'questions'; tick(30000); assert.equal(advances, 2);
  state.phase = 'teaching'; queue.prepare('one'); queue.response('More text'); state.stopId = 'two'; tick(30000); assert.equal(advances, 2);
});

test('application completes all voice highlights and enables Continue without model completion tools', async () => {
  const timers = new Map(); let serial = 0; const opened = [], spoken = [];
  const coordinator = load('lib/admin-tour/narration.ts', {}, { setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id) });
  const h = harness({ narration: coordinator,
    ui: { TourInterface: class { reset() {} async walkthrough(step) { opened.push(step.id); return { status: 'shown' }; } } },
    fetch: async () => ({ ok: true, json: async () => ({ conversationToken: 'test', maxDurationSec: 600 }) }),
    sdk: { async startSession() { this.status = 'connected'; return 'test'; }, async endSession() { this.status = 'disconnected'; }, sendUserMessage(message) { spoken.push(message); } },
  });
  const flush = async () => { const jobs = [...timers.values()]; timers.clear(); jobs.forEach(fn => fn()); await new Promise(setImmediate); h.render(); };
  h.start();
  await h.audio().connect(false); h.render();
  const total = stepSchema.stepsForMode(lessons.profileSetup.steps, 'brief').length;
  assert.equal(opened.length, 1, 'first highlight opens before any model overview');
  assert.match(spoken[0], /^APP_WALKTHROUGH_STEP/);
  const firstMessage = JSON.parse(spoken[0].slice('APP_WALKTHROUGH_STEP '.length));
  assert.equal(firstMessage.learner.preferredName, 'Maya');
  assert.equal(firstMessage.introduction, learner.tourIntroduction(h.props.navigation.brand, 'Maya'));
  for (let i = 0; i < total; i++) {
    assert.equal(h.call('getTourContext').phase, 'teaching');
    assert.equal(h.call('runTourStep', { stopId: 'Shopper:profileSetup', stepId: 'invented' }).status, 'application_managed');
    assert.equal(h.call('finishSegment', { stopId: 'Shopper:profileSetup' }).status, 'walkthrough_in_progress');
    h.emit('onModeChange', { mode: 'speaking' });
    // Even a mistaken question/early completion attempt cannot strand Continue.
    h.emit('onMessage', { source: 'ai', message: 'Here is this view. Any questions?' });
    await flush(); assert.equal(opened.length, i + 1, 'never advance during speech');
    if (i === 0) {
      h.emit('onVadScore', { vadScore: 0.99 });
      assert.equal(h.call('getTourContext').walkthrough.paused, false, 'noise cannot latch a permanent pause');
      h.emit('onInterruption', {}); h.emit('onMessage', { source: 'user', message: 'What does this mean?' });
      h.emit('onModeChange', { mode: 'listening' }); await flush();
      assert.equal(opened.length, 1, 'wait for the answer to a genuine question');
      h.emit('onModeChange', { mode: 'speaking' }); h.emit('onMessage', { source: 'ai', message: 'Here is the answer.' });
    }
    h.emit('onModeChange', { mode: 'listening' });
    await flush(); assert.equal(opened.length, i + 1, 'speaker mode alone cannot end playback');
    h.emit('onAudio', 'synthetic-playback-chunk'); await flush();
  }
  assert.equal(opened.length, total);
  assert.equal(new Set(opened).size, total, 'no highlight replay loop');
  assert.equal(h.call('getTourContext').phase, 'questions');
  assert.equal(h.find(h.render(), 'Continue').props.disabled, false);
  assert.equal(spoken.filter(s => s.startsWith('APP_QUESTION_BREAK')).length, 1);
  assert.ok(spoken.filter(s => s.startsWith('APP_WALKTHROUGH_STEP')).slice(1).every(s => !JSON.parse(s.slice('APP_WALKTHROUGH_STEP '.length)).introduction), 'introduction is not repeated between highlights');
  assert.equal(h.navigated.length, 1, 'final question break never moves to another panel');
  await flush(); assert.equal(spoken.length, total + 1);
  h.find(h.render(), 'Continue').props.onClick(); h.render();
  await new Promise(resolve => setTimeout(resolve, 15)); h.render();
  assert.equal(h.call('getTourContext').current.panel, 'purchases');
  assert.equal(h.call('getTourContext').phase, 'teaching');
  assert.equal(opened.length, total + 1, 'the next panel starts after its step state resets');
  assert.match(spoken.at(-1), /^APP_WALKTHROUGH_STEP/);
  await h.audio().disconnect();
});

test('interruption and pause/resume preserve playback timing without skipping to another step', () => {
  const { TourNarration, tick } = narrationClock(); let advances = 0;
  const state = { connected: true, enabled: true, textOnly: false, stopId: 'one', phase: 'teaching' };
  const n = new TourNarration(() => state, () => advances++);
  n.prepare('one'); n.audioActivity(); tick(100); n.response('A short explanation.'); n.interrupt();
  n.audioActivity(); tick(30000); assert.equal(advances, 0, 'old audio cannot resume an interrupted turn');
  n.response('Here is your answer.'); n.audioActivity(); tick(1000);
  state.enabled = false; n.pause(); n.audioActivity(); tick(5000); assert.equal(advances, 0);
  state.enabled = true; n.audioActivity(); n.resume(); tick(1999); assert.equal(advances, 0, 'resume must not cut off current audio');
  tick(1); assert.equal(advances, 1);
  n.prepare('one'); n.response('Next view'); n.audioActivity(); n.reset(); tick(30000); assert.equal(advances, 1, 'disconnect cancels advancement');
});

test('tools stop operating when the user leaves the current panel or access changes', () => {
  const h = harness(); h.start();
  h.props.activeTab = 'support'; h.render();
  assert.match(h.call('inspectPanel').error, /navigated away/);
  h.props.ready = false; h.render();
  assert.match(h.call('navigateTour', { stopId: 'Shopper:purchases' }).error, /not active/);
});

test('tour sessions reject claimed-wallet authentication and cross-site requests before spending voice usage', async () => {
  let authed = null, upstreamCalls = 0;
  const route = load('app/api/voice/elevenlabs/signed-url/route.ts', {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200, headers: options.headers }) } },
    '@/lib/auth': { getAuthenticatedWallet: async () => authed },
    '@/lib/cosmos': { getContainer: async () => { throw Error('Should not query usage for a rejected request'); } },
    '@/lib/security': { requireCsrf() {}, rateLimitOrThrow() {}, rateKey: () => 'tour' },
  }, { process: { env: {} }, fetch: async () => { upstreamCalls++; throw Error('Unexpected upstream call'); } });
  const request = site => ({ json: async () => ({ persona: 'tour', wallet: '0xclaimed' }), headers: { get: key => key === 'x-wallet' ? '0xclaimed' : key === 'sec-fetch-site' ? site : null } });
  assert.equal((await route.POST(request('same-origin'))).status, 401);
  authed = '0xverified';
  assert.equal((await route.POST(request('cross-site'))).status, 403);
  assert.equal(upstreamCalls, 0);
});

test('authenticated tour voice receives a private WebRTC token; text retains signed WebSocket and upstream errors stay private', async () => {
  let upstreamStatus = 200; const urls = [];
  const route = load('app/api/voice/elevenlabs/signed-url/route.ts', {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200, headers: options.headers }) } },
    '@/lib/auth': { getAuthenticatedWallet: async () => '0xverified' }, '@/lib/cosmos': {},
    '@/lib/security': { requireCsrf() {}, rateLimitOrThrow() {}, rateKey: () => 'tour' },
  }, { AbortSignal, process: { env: { ELEVENLABS_API_KEY: 'server-secret', ELEVENLABS_AGENT_ID_TOUR: 'test-agent', VOICE_GATING_DISABLED: '1' } },
    fetch: async (url, init) => { urls.push(url); assert.equal(init.headers['xi-api-key'], 'server-secret'); return { ok: upstreamStatus === 200, status: upstreamStatus, json: async () => ({ token: 'private-token', signed_url: 'wss://signed-session' }), text: async () => 'sensitive upstream detail' }; },
  });
  const request = connectionType => ({ json: async () => ({ persona: 'tour', connectionType }), headers: new Map() });
  const voice = await route.POST(request('webrtc'));
  assert.equal(voice.status, 200); assert.equal(voice.body.conversationToken, 'private-token'); assert.equal(voice.body.signedUrl, undefined);
  assert.match(urls[0], /conversation\/token\?agent_id=test-agent/); assert.equal(voice.headers['Cache-Control'], 'no-store');
  const text = await route.POST(request('websocket')); assert.equal(text.body.signedUrl, 'wss://signed-session'); assert.equal(text.body.conversationToken, undefined);
  upstreamStatus = 403;
  const failed = await route.POST(request('webrtc')); assert.equal(failed.status, 502); assert.equal(failed.body.detail, undefined);
});
