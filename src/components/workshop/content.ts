export type WorkshopAudience = 'all' | 'partner' | 'merchant';
export type ChapterId = 'opening' | 'store-tour' | 'opportunity' | 'onramp' | 'crypto' | 'verification' | 'continuity' | 'infrastructure' | 'partner' | 'merchant' | 'relationship' | 'next';

export const audiences = [
  { id: 'all', label: 'Full workshop', href: '/workshop' },
  { id: 'partner', label: 'For partners', href: '/workshop/partner' },
  { id: 'merchant', label: 'For merchants', href: '/workshop/merchant' },
] as const;

export const chapters: { id: ChapterId; label: string; audience?: WorkshopAudience; question: string; demo: string; bridge: string }[] = [
  { id: 'opening', label: 'The business case', question: 'What does losing payment access cost this business?', demo: 'Set the agenda: understand the two-leg payment, the checks behind it, and the operating model for growth.', bridge: 'Start with the disruption the merchant experiences.' },
  { id: 'store-tour', label: 'Inside the store', audience: 'merchant', question: 'Where would this connected journey help your business most?', demo: 'Scroll or use the six scene controls to fly from the storefront to inventory, checkout, a safe demonstration QR, merchant settlement and the stockroom. Product markers expose sample inventory. Restock and payroll are illustrative uses of available funds, not executed payments.', bridge: 'Now explore the payment infrastructure that supports this business day.' },
  { id: 'opportunity', label: 'Processor disruption', question: 'What happened the last time you had to replace a processor?', demo: 'Choose the closest business problem. Establish the industry, customer countries, order value and current payment setup.', bridge: 'Here is how the money actually moves.' },
  { id: 'onramp', label: 'The two-leg payment', question: 'Can you explain the difference between wallet funding and a completed merchant payment?', demo: 'Read the two legs left to right. Walk through all four stages. Stripe is merchant of record for the crypto purchase; the merchant sale settles separately. Explain the quote and fees before a live demo.', bridge: 'The separation works alongside verification and eligibility checks.' },
  { id: 'crypto', label: '17,000+ tokens → Base', question: 'Which assets do your customers hold, and what would you like to receive?', demo: 'Choose an example source asset and all six merchant settlement assets. Explain the bridge and conversion, the Base destination, and that a supported live quote determines availability and fees.', bridge: 'Both payment paths connect to your merchant settlement configuration.' },
  { id: 'verification', label: 'KYC & AML controls', question: 'Which products, customer locations and verification requirements apply to this business?', demo: 'Identify Stripe’s onramp KYC and sanctions responsibilities, the platform controls and the merchant onboarding review. Do not equate technical payment capability with approval for a restricted industry.', bridge: 'Controls address risk. Transaction recovery addresses interruptions.' },
  { id: 'continuity', label: 'Payment continuity', question: 'If funding completes but settlement is delayed, how does your team know what to do?', demo: 'Explain the separate funding and settlement states, recorded transaction hashes and guarded retries. Distinguish service availability from payment approval and completion rates. Quote availability only from an approved SLA or measured report.', bridge: 'This is the infrastructure a partner does not have to build alone.' },
  { id: 'infrastructure', label: 'Who runs what', question: 'Who would otherwise deploy, maintain and support this stack?', demo: 'Explore the layers, then compare partner responsibilities with platform operations. Agree service scope, escalation and support coverage in the rollout plan.', bridge: 'With the operating foundation in place, focus on the merchant relationship.' },
  { id: 'partner', label: 'White label & splits', audience: 'partner', question: 'How would you structure revenue for your first three merchant accounts?', demo: 'Show the white-label checkout and interactive merchant split examples. Change the ISO and agent shares, then switch accounts to show independent configurations. Distinguish allocation at settlement from release to wallets.', bridge: 'Your merchants get the same payment foundation through your brand.' },
  { id: 'merchant', label: 'Run a real sale', audience: 'merchant', question: 'Which selling channel should we use for the first end-to-end transaction?', demo: 'Switch between the storefront and touchpoints screenshots. Explain order creation, customer funding, settlement confirmation and reconciliation. Confirm enabled modules.', bridge: 'The agent turns the architecture into a working business process.' },
  { id: 'relationship', label: 'Your launch & growth', question: 'What would make this a successful launch for your business?', demo: 'Explain what the buyer receives during setup, the first payment and ongoing growth. Keep facilitation instructions in these optional notes, not the presentation copy.', bridge: 'Choose your first payment workflow and settlement setup.' },
  { id: 'next', label: 'Plan the first launch', question: 'Which merchant and transaction will prove the fit?', demo: 'Copy the brief, agree industry and regional eligibility, fees, support responsibilities, a first transaction and a review date. Nothing is submitted by this page.', bridge: 'Schedule the working session.' },
];

export const gaps = [
  { id: 'acceptance', label: 'Processor disruption', number: '01', title: 'Your business needs to keep taking payments.', description: 'Keep a payment foundation ready when another provider leaves a gap. Traditional funding and direct crypto acceptance give your customers different ways to pay, connected to your existing selling workflow.', capability: 'Two-leg payment flow + eligibility review', proof: 'Keep a supported payment path ready for daily sales and interruptions in your existing setup.', question: 'What did the last payment interruption cost in sales, time and customer trust?' },
  { id: 'operations', label: 'Disconnected tools', number: '02', title: 'Your customer pays. Your team sees the result.', description: 'Connect your order, payment state and receipt. Give your team a clear view of what has settled and what still needs attention, without matching disconnected records by hand.', capability: 'Catalog, touchpoints, orders and reporting', proof: 'Keep your order, confirmed payment and receipt connected.', question: 'Who checks whether an order is funded, settled and ready to fulfill?' },
  { id: 'identity', label: 'Building a book', number: '03', title: 'Your brand. Your accounts. Your commercial model.', description: 'As an ISO or payment provider, resell the infrastructure under your own identity. Configure splits for individual merchant accounts, include your agents and grow your book while we maintain the platform.', capability: 'White-label infrastructure + per-merchant splits', proof: 'Build your white-label book with merchant-specific provider and agent shares.', question: 'What commercial model would you offer your first three merchant accounts?' },
  { id: 'retention', label: 'Cross-chain acceptance', number: '04', title: 'More ways to pay. Your choice of what to receive.', description: 'Accept supported crypto from 17,000+ tokens across 90+ blockchains. Receive USDC, USDT, cbBTC, cbXRP, SOL or ETH on Base, with bridging and conversion built into the payment path.', capability: 'Cross-chain crypto + six settlement choices', proof: 'Let customers pay with supported assets they hold while you receive your chosen asset on Base.', question: 'What do your customers hold, and which asset would you prefer to receive?' },
] as const;

export const layers = [
  { label: 'Your branded experience', short: 'Your brand', icon: 'brand', title: 'Customers recognize your business.', text: 'Use your identity, colors and checkout experience. Build a consistent front door for selling and serving the people who choose your business.', tags: ['Branding', 'Storefront', 'Checkout'] },
  { label: 'Merchant operations', short: 'Your business', icon: 'operations', title: 'Give the team tools to operate.', text: 'Configure the catalog, selling touchpoints, team access and reporting around the merchant’s workflow. Connect the sale to the people who support it.', tags: ['Inventory', 'Orders', 'Team access'] },
  { label: 'Managed payment infrastructure', short: 'Our infrastructure', icon: 'payments', title: 'Use the stack without running the stack.', text: 'The platform connects onramp funding, transaction tracking, settlement routing and receipts. Platform operations maintain the shared software and infrastructure behind that experience.', tags: ['Funding', 'Settlement', 'Platform operations'] },
] as const;

export const paymentStages = [
  { label: 'Create the sale', title: 'Start with an order and a clear quote.', text: 'The merchant creates the sale. An eligible customer sees the funding quote and applicable fees, then chooses a supported card or bank funding method. An order alone is not a completed payment.', tag: 'BEFORE FUNDING', outcome: 'Order and funding quote ready' },
  { label: 'Fund the wallet', title: 'Leg 1: the customer purchases USDC.', text: 'Stripe handles the fiat-to-crypto purchase and its required verification. The integration requests USDC on Base for the destination wallet. This is the funding transaction, with Stripe as its merchant of record.', tag: 'LEG 1 / FIAT → USDC', outcome: 'Onramp fulfillment confirmed' },
  { label: 'Settle the sale', title: 'Leg 2: USDC pays the merchant.', text: 'After confirmed funding, the platform coordinates a separate transfer to the configured merchant settlement destination. It uses the amount delivered for this session and the configured routing for merchant, partner and agent allocations.', tag: 'LEG 2 / USDC → SETTLEMENT', outcome: 'Settlement transaction submitted and tracked' },
  { label: 'Confirm & reconcile', title: 'Close the sale with a transaction record.', text: 'The receipt connects the funding session with the settlement transaction. The team follows the payment state through confirmation and reconciliation. If settlement is still pending, funding success alone does not mean the sale has settled.', tag: 'AFTER SETTLEMENT', outcome: 'Confirmed payment connected to the receipt' },
] as const;

export function chaptersFor(audience: WorkshopAudience) {
  return chapters.filter(chapter => !chapter.audience || audience === 'all' || chapter.audience === audience);
}

export const settlementTokens = ['USDC', 'USDT', 'cbBTC', 'cbXRP', 'SOL', 'ETH'] as const;

/** Presentation-only allocation: basis points conserve the 1,000 USDC example. */
export function illustrateSplit(partnerBps: number, agentBps: number) {
  const platformBps = 50;
  if (![partnerBps, agentBps].every(value => Number.isInteger(value) && value >= 0) || partnerBps + agentBps + platformBps > 10000) throw new Error('Invalid example split');
  return [
    { label: 'Merchant', bps: 10000 - partnerBps - agentBps - platformBps },
    { label: 'Your ISO / provider', bps: partnerBps },
    { label: 'Your agent', bps: agentBps },
    { label: 'Platform', bps: platformBps },
  ].map(item => ({ ...item, amount: item.bps / 10 }));
}

export function workshopBrief(audience: WorkshopAudience, gapIndex: number, pilot: string, brand: string) {
  const gap = gaps[gapIndex] || gaps[0];
  return `${brand} — workshop brief\n\nAudience: ${audiences.find(item => item.id === audience)?.label}\nPriority: ${gap.label}\nDiscovery question: ${gap.question}\nProposed capability: ${gap.capability}\nPilot surface: ${pilot}\nYour payment objective: ${gap.proof}\n\nPayment walkthrough:\n1. Create the order and explain the funding quote and fees.\n2. Leg 1: Stripe onramp verification and USDC funding on Base.\n3. Leg 2: separate merchant settlement with configured routing.\n4. Confirm the transaction and reconcile the receipt.\n\nCrypto payment path:\nCustomer’s supported asset → cross-chain bridge and conversion → selected asset on Base → configured merchant split and receipt.\nSettlement choices: USDC, USDT, cbBTC, cbXRP, SOL, ETH.\n\nYour launch setup:\n- Merchant products, industry, customer regions and applicable approvals\n- Named onboarding owner and support escalation contact\n- Merchant-specific provider and agent shares, payment fees and release settings\n- One measurable success criterion and a first reconciled sale\n- Applicable service scope and documented availability commitment\n- Date for a pilot review\n\nNext step: configure your payment paths, settlement assets and first merchant account.\n`;
}
