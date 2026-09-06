const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../../..');
const merchant = '0x' + '1'.repeat(40);
const buyer = '0x' + '2'.repeat(40);
const receipt = { type:'receipt', id:'receipt:order', receiptId:'order', wallet:merchant, buyerWallet:buyer, brandKey:'brand', stripeSessionId:'cos_old', totalUsd:100, status:'pending' };
const session = { id:'cos_paid', status:'fulfillment_complete', created:100, client_secret:'never-return-me', metadata:{receiptId:'order',merchantWallet:merchant,brandKey:'brand'}, transaction_details:{source_amount:'98',destination_amount:'98',destination_currency:'usdc',destination_network:'base',wallet_address:buyer} };
class MockRequest extends Request { get nextUrl() { return new URL(this.url); } }

function harness(options={}) {
  const documents = new Map([[receipt.id, structuredClone({...receipt,...options.receipt})]]);
  const requests=[]; const reconciles=[];
  const currentSession = {...session,...options.session};
  const container={
    items:{
      query:()=>({fetchAll:async()=>({resources:options.missing ? [] : [structuredClone(documents.get(receipt.id))]})}),
      create:async d=>{documents.set(d.id,structuredClone(d));return {resource:d};},
    },
    item:id=>({read:async()=>({resource:structuredClone(documents.get(id))}),patch:async ops=>{const doc=documents.get(id);ops.forEach(op=>doc[op.path.slice(1)]=op.value);return {resource:structuredClone(doc)};}}),
  };
  const mocks={
    '@/lib/webhook-dispatch':{dispatchReceiptStatusWebhookBestEffort:async()=>({ok:true})},
    'next/server':{NextRequest:MockRequest,NextResponse:{json:(body,init)=>new Response(JSON.stringify(body),init)}},
    '@/lib/auth':{requireThirdwebAuth:async()=>{if(options.unauthorized)throw new Error('unauthorized');return {wallet:merchant,roles:options.partnerRole?['admin','partner_admin']:['admin','platform_super_admin']};}},
    '@/lib/authz':{resolveWalletRole:()=>options.partnerRole?'partner_admin':'platform_super_admin'},
    '@/lib/cosmos':{getContainer:async()=>container},
    '@/config/brands':{getBrandKey:()=> 'isolated'}, '@/lib/env':{isPartnerContext:()=>!!options.isolated},
    '@/app/api/cron/reconcile-stuck/route':{POST:async req=>{reconciles.push({url:req.url,body:await req.json()});assert.equal(documents.get(receipt.id).status,"paid","Paid status must be persisted before starting the sweep");if(options.reconcileFails)throw new Error('worker_failed'); const d=documents.get(receipt.id);d.status='paid';if(options.settled)d.transactionHash='0x'+'a'.repeat(64);return new Response(JSON.stringify({results:[{receiptId:'order',status:options.settled?'settled':'skipped',reason:options.settled?'':'balance_not_ready'}]}));}},
  };
  const modules=new Map();
  function load(file){if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    vm.runInNewContext(output,{module,exports:module.exports,require:name=>mocks[name]||(name.startsWith('@/')?load(path.join(root,name.slice(2)+'.ts')):require(name)),URL,URLSearchParams,Headers,AbortSignal,Error,process:{env:{STRIPE_API_KEY:'test'}},fetch:async url=>{requests.push(String(url));const parsed=new URL(url);const data=parsed.pathname.endsWith('/cos_old')?{id:'cos_old',status:options.oldStatus||'requires_payment'}:parsed.pathname.endsWith('/cos_paid')?currentSession:{data:[currentSession],has_more:!parsed.searchParams.has('starting_after')};return new Response(JSON.stringify(data));}},{filename:file});return module.exports;}
  const route=load(path.join(__dirname,'route.ts'));
  return {documents,requests,reconciles,get:query=>route.GET(new MockRequest('https://test.example/api/platform/stripe-audit'+(query||''))),post:()=>route.POST(new MockRequest('https://test.example/api/platform/stripe-audit',{method:'POST',headers:{cookie:'verified-by-auth-mock'},body:JSON.stringify({action:'reconcile',sessionId:'cos_paid'})}))};
}
test('scan is read-only, paginated and returns no Stripe secrets',async()=>{const h=harness();const res=await h.get('?from=10&to=200');const data=await res.json();assert.equal(res.status,200);assert.equal(data.nextCursor,'cos_paid');assert.equal(data.rows[0].finding,'session_mismatch');assert.doesNotMatch(JSON.stringify(data),/never-return-me|client_secret/);assert.equal(h.documents.size,1);assert.equal(h.reconciles.length,0);assert.match(h.requests[0],/status=fulfillment_complete/);assert.match(h.requests[0],/created%5Bgte%5D=10/);const next=await(await h.get('?cursor=cos_paid')).json();assert.equal(next.nextCursor,null);});
test('mutation rechecks Stripe, repairs binding, invokes only targeted worker and journals pending settlement honestly',async()=>{const h=harness();const res=await h.post();const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));assert.equal(data.status,'paid_settlement_pending');assert.equal(h.documents.get(receipt.id).stripeSessionId,'cos_paid');assert.equal(h.reconciles.length,1);assert.match(h.reconciles[0].url,/receiptId=order/);assert.equal([...h.documents.values()].find(d=>d.type==='stripe_audit_action').status,'paid_settlement_pending');});
test('recorded settlement is idempotently skipped',async()=>{const h=harness({receipt:{stripeSessionId:'cos_paid',transactionHash:'0x'+'a'.repeat(64),status:'paid'}});const data=await(await h.post()).json();assert.equal(data.row.finding,'settled');assert.equal(h.reconciles.length,0);});
test('a pending receipt with an existing settlement is marked paid without another transfer',async()=>{const h=harness({receipt:{stripeSessionId:'cos_paid',transactionHash:'0x'+'a'.repeat(64),status:'pending'}});const data=await(await h.post()).json();assert.equal(data.status,'settled');assert.equal(h.documents.get(receipt.id).status,'paid');assert.equal(h.reconciles.length,0);});
test('accepted competing session prevents sweep',async()=>{const h=harness({oldStatus:'fulfillment_complete'});assert.equal((await h.post()).status,502);assert.equal(h.reconciles.length,0);assert.equal(h.documents.get(receipt.id).stripeSessionId,'cos_old');});
for(const options of [{missing:true},{session:{status:'requires_payment'}},{session:{transaction_details:{...session.transaction_details,source_amount:'10'}}},{session:{metadata:{...session.metadata,brandKey:'other'}}},{session:{transaction_details:{...session.transaction_details,destination_network:'ethereum'}}}])test('ineligible session never reaches settlement: '+JSON.stringify(options),async()=>{const h=harness(options);assert.equal((await h.post()).status,409);assert.equal(h.reconciles.length,0);});
test('authentication and platform authorization apply to reads and mutations',async()=>{for(const options of [{unauthorized:true},{partnerRole:true}]){const h=harness(options);assert.ok([401,403].includes((await h.get()).status));assert.ok([401,403].includes((await h.post()).status));assert.equal(h.requests.length,0);}});
test('partner container scope cannot be widened by a brand query or execution',async()=>{const h=harness({isolated:true});assert.equal((await(await h.get('?brand=all')).json()).rows.length,0);assert.equal((await h.post()).status,403);assert.equal(h.reconciles.length,0);});
test('worker errors persist a failed audit action without reporting a successful sweep',async()=>{const h=harness({reconcileFails:true});assert.equal((await h.post()).status,502);assert.equal([...h.documents.values()].find(d=>d.type==='stripe_audit_action').status,'failed');});
