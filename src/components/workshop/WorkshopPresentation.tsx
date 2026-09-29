"use client";

/* eslint-disable @next/next/no-img-element */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, Copy, CreditCard, Expand, Layers3, Maximize2, MessageSquare, Network, Pause, Play, ScanLine, ShieldCheck, Store, Users, Wallet, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { audiences, chaptersFor, gaps, layers, paymentStages, workshopBrief, type ChapterId, type WorkshopAudience } from './content';
import { CryptoExplorer, SplitExplorer } from './WorkshopExplorers';
import { PartnerNetwork } from './WorkshopScenes';
import StoreFlythrough from './StoreFlythrough';
import ThemeStudioDemo from './ThemeStudioDemo';
import styles from './workshop.module.css';

const screenshots = {
  operations: { src: '/screenshot_admin.png', title: 'Choose your selling touchpoint.', label: 'Merchant touchpoints', alt: 'Product screenshot of the admin touchpoints catalog showing Kiosk, Terminal and Handheld selling tools.' },
  storefront: { src: '/screenshot_storefront.png', title: 'Build the customer’s order.', label: 'Merchant storefront', alt: 'Product screenshot of a sample merchant storefront with product categories, product cards and a cart.' },
};
type ScreenshotKey = keyof typeof screenshots;

export default function WorkshopPresentation({ audience, brandName }: { audience: WorkshopAudience; brandName: string }) {
  const route = useMemo(() => chaptersFor(audience), [audience]);

  const [motionPaused, setMotionPaused] = useState(false);
  const [active, setActive] = useState(0);
  const [notes, setNotes] = useState(false);
  const [layer, setLayer] = useState(0);
  const [gap, setGap] = useState(audience === 'partner' ? 2 : 0);
  const [payment, setPayment] = useState(0);
  const [merchantView, setMerchantView] = useState<ScreenshotKey>('operations');
  const [screenshot, setScreenshot] = useState<ScreenshotKey | null>(null);
  const [pilot, setPilot] = useState(audience === 'partner' ? 'A branded merchant launch' : 'An online storefront');
  const [copyStatus, setCopyStatus] = useState('');
  const [copyFallback, setCopyFallback] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const lightboxTrigger = useRef<HTMLButtonElement | null>(null);
  const chapter = route[active] || route[0];
  const selectedGap = gaps[gap];

  const goTo = useCallback((id: ChapterId) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    window.history.replaceState(null, '', `#${id}`);
  }, []);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.4;
      let current = 0;
      route.forEach((item, index) => { if ((document.getElementById(item.id)?.getBoundingClientRect().top ?? Infinity) <= line) current = index; });
      setActive(current);
    };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update(); window.addEventListener('scroll', scroll, { passive: true }); window.addEventListener('resize', scroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', scroll); window.removeEventListener('resize', scroll); };
  }, [route]);

  useEffect(() => {
    const change = () => setFullscreen(!!document.fullscreenElement);
    setFullscreenAvailable(!!document.fullscreenEnabled);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (screenshot || event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement)?.closest('input,select,textarea,button,a,[contenteditable="true"],[role="dialog"]')) return;
      if (['ArrowRight', 'PageDown'].includes(event.key)) { event.preventDefault(); goTo(route[Math.min(active + 1, route.length - 1)].id); }
      if (['ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); goTo(route[Math.max(active - 1, 0)].id); }
      if (event.key.toLowerCase() === 'n') setNotes(value => !value);
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [active, route, screenshot, goTo]);

  async function toggleFullscreen() {
    setFullscreenError('');
    try {
      // Fullscreen the document so normal page scrolling and portalled dialogs remain available.
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setFullscreenError('Fullscreen is unavailable here. Your browser’s fullscreen shortcut can also be used.'); }
  }

  function openScreenshot(key: ScreenshotKey, trigger: HTMLButtonElement) {
    lightboxTrigger.current = trigger; setScreenshot(key);
  }

  const screenshotButton = (key: ScreenshotKey, className = '') => <button type="button" className={`${styles.screen} ${className}`} onClick={event => openScreenshot(key, event.currentTarget)} aria-label={`Enlarge ${screenshots[key].label} screenshot`}>
    <span className={styles.screenBar}><span className={styles.windowDots}><i /><i /><i /></span><span>{screenshots[key].label}</span><Expand size={14} /></span>
    <img src={screenshots[key].src} alt={screenshots[key].alt} loading="lazy" decoding="async" width={key === 'storefront' ? 400 : 1024} height={key === 'storefront' ? 1024 : 532} />
    <span className={styles.screenCaption}>Product screenshot · sample workspace <ArrowUpRight size={14} /></span>
  </button>;

  return <main className={`${styles.workshop} ${audience === 'merchant' ? styles.merchantCinemaEdition : audience === 'partner' ? styles.partnerEdition : styles.combinedEdition}`} data-workshop-motion={motionPaused ? 'paused' : 'playing'} aria-label={`${brandName} ${audience === 'all' ? 'payment' : audience} workshop`}>
    <a href="#opportunity" className={styles.skip}>Skip introduction</a>
    <div className={styles.progress} aria-hidden="true"><span style={{ width: `${(active + 1) / route.length * 100}%` }} /></div>


    <section id="opening" className={`${styles.chapter} ${styles.hero}`} aria-labelledby="opening-title">
      <div className={styles.heroIdentity}><span className={styles.brandMark}><Layers3 size={21} /> {brandName}</span><span className={styles.edition}>THE PAYMENT PLATFORM / {audience === 'all' ? 'PARTNERS + MERCHANTS' : audience.toUpperCase() + ' EDITION'}</span></div>
      <div className={styles.heroGrid}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span /> PAYMENTS. CONTINUITY. GROWTH.</p>
          <h1 id="opening-title">{audience === 'partner' ? <>Your payment brand.<br /><em>Our infrastructure.</em></> : audience === 'merchant' ? <>Keep your business<br /><em>open for payments.</em></> : <>More ways to pay.<br /><em>More room to grow.</em></>}</h1>
          <p className={styles.heroLead}>{audience === 'partner' ? 'For ISOs and payment providers: resell a complete payment platform under your own brand. Set the economics for each merchant, reward your agents and grow your book without maintaining the infrastructure.' : audience === 'merchant' ? 'A lasting payment foundation for your business—and another way forward when your existing process leaves a gap. Accept familiar funding methods or crypto from across chains, and receive the asset you choose.' : 'White-label payment infrastructure for ISOs and providers. Persistent payment options for merchants. Connect traditional funding and cross-chain crypto to a settlement model built around your business.'}</p>
          <button type="button" className={styles.primaryButton} onClick={() => goTo(audience === 'partner' ? 'partner' : 'store-tour')}>{audience === 'partner' ? 'Explore your brand and revenue splits' : audience === 'merchant' ? 'Step inside the store' : 'Fly through a merchant’s day'} <ArrowDown size={18} /></button>
          <nav className={styles.audienceLinks} aria-label="Workshop editions">{audiences.map(item => <a key={item.id} href={item.href} aria-current={audience === item.id ? 'page' : undefined}>{item.label}<ArrowUpRight size={12} /></a>)}</nav>
          {audience === 'merchant' && <div className={styles.storyActs}><span>01 / YOUR CUSTOMER</span><ArrowRight size={15} /><span>02 / THEIR PAYMENT</span><ArrowRight size={15} /><span>03 / YOUR NEXT SALE</span></div>}
          {audience === 'partner' && <div className={styles.storyActs}><span>01 / YOUR BRAND</span><ArrowRight size={15} /><span>02 / YOUR MERCHANTS</span><ArrowRight size={15} /><span>03 / YOUR REVENUE</span></div>}
        </div>{audience !== 'merchant' && <PartnerNetwork brandName={brandName} />}
      </div>
      <nav className={styles.agenda} aria-label="Workshop roadmap">{[{ id: 'onramp', title: 'Traditional funding', text: 'Stripe onramp → merchant settlement.' }, { id: 'crypto', title: 'Cross-chain crypto', text: '17,000+ tokens → your chosen asset.' }, { id: audience === 'merchant' ? 'merchant' : 'partner', title: audience === 'merchant' ? 'Your payment continuity' : 'Your brand. Your splits.', text: audience === 'merchant' ? 'A foundation for daily sales and payment gaps.' : 'Your merchants, agents and commercial model.' }].map((item, index) => <button type="button" key={item.id} onClick={() => goTo(item.id as ChapterId)}><span>0{index + 1}</span><div><strong>{item.title}</strong><p>{item.text}</p></div><ArrowRight size={17} /></button>)}</nav>
    </section>

    {audience !== 'partner' && <StoreFlythrough paused={motionPaused} />}

    <section id="opportunity" className={`${styles.chapter} ${styles.gapChapter}`} aria-labelledby="gap-title">
      <p className={styles.eyebrow}>THE BUSINESS PROBLEM / START HERE</p>
      <div className={styles.sectionHead}><h2 id="gap-title">Changing processors<br /><em>shouldn’t be the plan.</em></h2><p>Your industry should not define the limits of your ambition. When a processor change, a missing payment method or a customer’s location creates a gap, you need another way to keep taking payments.</p></div>
      <div className={styles.gapChoices} role="group" aria-label="Choose your business gap">{gaps.map((item, index) => <button type="button" key={item.id} aria-pressed={gap === index} onClick={() => { setGap(index); setCopyStatus(''); }}><span>{item.number}</span>{item.label}<ArrowUpRight size={18} /></button>)}</div>
      <div className={styles.gapDetail} aria-live="polite"><span className={styles.giantNumber}>{selectedGap.number}</span><div><span className={styles.microLabel}>THE PROBLEM TO SOLVE</span><h3>{selectedGap.title}</h3><p>{selectedGap.description}</p><div className={styles.capability}><Check size={17} />{selectedGap.capability}</div></div><blockquote><span>YOUR BUSINESS PRIORITY</span><p>{selectedGap.question}</p><MessageSquare size={25} strokeWidth={1} /></blockquote></div>
      <div className={styles.takeaway}><strong>Our starting point</strong><p>Separate the customer’s purchase of digital funds from the merchant’s settlement, then connect both steps through a traceable payment journey.</p><button type="button" onClick={() => goTo('onramp')}>Follow the money <ArrowRight size={16} /></button></div>
    </section>

    <section id="onramp" className={`${styles.chapter} ${styles.paymentChapter}`} aria-labelledby="payment-title">
      <div className={styles.stripeBadge}><CreditCard size={15} /> STRIPE ONRAMP × {brandName.toUpperCase()}</div>
      <div className={styles.sectionHead}><h2 id="payment-title">One purchase journey.<br /><em>Two transaction legs.</em></h2><p>The customer first buys USDC through Stripe. A separate USDC transaction then settles the merchant sale. Each leg has its own purpose and completion state.</p></div>
      <div className={styles.twoLegs}>
        <article><span className={styles.microLabel}>LEG 1 / CUSTOMER FUNDING</span><h3>Traditional money → USDC</h3><div className={styles.moneyPath}><span><CreditCard />Customer’s supported<br />card or bank account</span><ArrowRight /><span><Wallet />Customer wallet<br /><strong>USDC on Base</strong></span></div><p><strong>Stripe’s role:</strong> facilitate the crypto purchase, perform the required onramp verification and deliver the purchased USDC.</p><footer>COMPLETE WHEN: onramp funding is fulfilled</footer></article>
        <article><span className={styles.microLabel}>LEG 2 / MERCHANT PAYMENT</span><h3>USDC → merchant settlement</h3><div className={styles.moneyPath}><span><Wallet />Funded customer<br />wallet</span><ArrowRight /><span><Store />Configured merchant<br /><strong>settlement destination</strong></span></div><p><strong>{brandName}’s role:</strong> coordinate the separate payment, configured fee routing and the receipt that connects the sale.</p><footer>COMPLETE WHEN: settlement is confirmed</footer></article>
      </div>
      <div className={styles.flowGate}><ShieldCheck size={22} /><p><strong>The handoff matters.</strong> The platform checks funding and the delivered amount before settlement. “Wallet funded” and “merchant paid” are distinct states.</p></div>
      <div className={styles.architectureReason}><span>WHY TWO LEGS?</span><h3>A different way to accept the merchant payment.</h3><p>You receive an onchain payment instead of a direct card charge for the goods. Customer funding and merchant settlement have separate roles, connected by one receipt. As a provider, you can offer that same payment foundation across your white-label merchant book.</p></div>
      <div className={styles.walkthroughHeading}><h3>How your customer’s payment reaches you</h3><span>Follow the funding, settlement and receipt for one sale.</span></div>
      <div className={styles.paymentRail} role="group" aria-label="Explore the payment journey">{paymentStages.map((stage, index) => <React.Fragment key={stage.label}><button type="button" onClick={() => setPayment(index)} aria-pressed={payment === index} className={payment === index ? styles.paymentActive : ''}><span className={styles.railIcon}>{index === 0 ? <Store /> : index === 1 ? <CreditCard /> : index === 2 ? <Wallet /> : <Check />}</span><small>0{index + 1} / {index === 1 ? 'LEG 1' : index === 2 ? 'LEG 2' : index === 0 ? 'ORDER' : 'RECEIPT'}</small><strong>{stage.label}</strong></button>{index < 3 && <span className={`${styles.connector} ${payment > index ? styles.connectorLit : ''}`} aria-hidden="true"><i /></span>}</React.Fragment>)}</div>
      <div className={styles.paymentDetail} aria-live="polite"><div><p className={styles.eyebrow}>{paymentStages[payment].tag}</p><h3>{paymentStages[payment].title}</h3></div><div className={styles.stageExplanation}><p>{paymentStages[payment].text}</p><span><Check size={15} />{paymentStages[payment].outcome}</span></div><button type="button" className={styles.roundButton} aria-label={payment === 3 ? 'Restart payment journey' : 'Next payment stage'} onClick={() => setPayment((payment + 1) % paymentStages.length)}><ArrowRight size={21} /></button></div>
      <div className={styles.example}><span>ILLUSTRATIVE FLOW</span><p>For an order requiring <strong>100 USDC</strong>, the customer reviews the fiat quote and onramp fees to acquire those funds. Leg 1 delivers the USDC; leg 2 routes the payment under the configured split. Merchant proceeds depend on the agreed fees. This is a process example, not a price quote.</p></div>
      <p className={styles.paymentNote}>Payment methods, eligibility, fees and timing vary by customer, region and setup. Stripe is merchant of record for the onramp purchase; that does not make Stripe the seller of the merchant’s goods. <a href="https://docs.stripe.com/crypto/onramp" target="_blank" rel="noopener noreferrer">How Stripe onramp works <ArrowUpRight size={12} /></a></p>
    </section>

    <section id="crypto" className={`${styles.chapter} ${styles.cryptoChapter}`} aria-labelledby="crypto-title">
      <p className={styles.eyebrow}>CRYPTO-TO-CRYPTO / THEIR ASSET, YOUR CHOICE</p>
      <div className={styles.sectionHead}><h2 id="crypto-title">They pay across chains.<br /><em>You receive on Base.</em></h2><p>Your customer’s token and blockchain do not have to match the asset you want to receive. Bridge and convert supported crypto payments into your chosen settlement asset on Base.</p></div>
      <div className={styles.coverageStats}><div><strong>17,000+</strong><span>tokens in the supported payment universe</span></div><div><strong>90+</strong><span>blockchains for customer payments</span></div><div><strong>6</strong><span>merchant settlement asset choices</span></div></div>
      <CryptoExplorer />
      <div className={styles.benefits}><article><span>01 / CUSTOMER CHOICE</span><h3>Meet the funds where they are.</h3><p>Your customer selects a supported asset from their wallet. The checkout provides the available route, quote and transaction steps.</p></article><article><span>02 / MERCHANT CHOICE</span><h3>Receive the asset you want.</h3><p>Choose USDC, USDT, cbBTC, cbXRP, SOL or ETH. Supported cross-chain payments are routed into that asset on Base, rather than leaving you to manage every source token.</p></article><article><span>03 / ONE SETTLEMENT MODEL</span><h3>Keep the same commercial logic.</h3><p>The destination payment connects to the merchant’s configured split and receipt. Your acceptance can reach across chains while your settlement stays organized.</p></article></div>
      <p className={styles.sourceLine}>Crypto payments use supported bridge routes. The Stripe onramp described in the previous section is a separate path for customers starting with traditional money.</p>
    </section>

    <section id="verification" className={`${styles.chapter} ${styles.controlsChapter}`} aria-labelledby="verification-title">
      <p className={styles.eyebrow}>KNOW YOUR CUSTOMER / ANTI-MONEY LAUNDERING</p>
      <div className={styles.sectionHead}><h2 id="verification-title">Verification is part<br /><em>of the payment.</em></h2><p>A clear division of responsibilities puts identity checks, transaction controls and merchant eligibility into the process from the beginning.</p></div>
      <div className={styles.controlGrid}>
        <article><ShieldCheck /><span>01 / THE ONRAMP</span><h3>Verify the buyer.</h3><p>Stripe handles the onramp’s KYC requirements and sanctions screening. Customers complete the required checks for their transaction; additional information may be needed before funding proceeds.</p><footer>Customer identity + funding requirements</footer></article>
        <article><ScanLine /><span>02 / THE PLATFORM</span><h3>Track the payment.</h3><p>The integration handles verification states, including wallet ownership where required. It links the funding session to the receipt and records settlement activity so the team can follow both legs.</p><footer>Verification states + transaction traceability</footer></article>
        <article><Users /><span>03 / THE LAUNCH PLAN</span><h3>A setup for your business.</h3><p>Your onboarding brings your products, customer locations and payment needs into one supported setup. You get a clear view of the available payment paths and the requirements for your business.</p><footer>Merchant eligibility + onboarding ownership</footer></article>
      </div>
      <div className={styles.takeaway}><strong>For higher-risk businesses</strong><p>Build around your business across industries, including higher-risk sectors that face payment disruption. Traditional funding and direct crypto give you different payment paths; availability remains subject to applicable law, provider requirements and supported routes.</p></div>
      <p className={styles.sourceLine}>Reference: <a href="https://docs.stripe.com/crypto/onramp" target="_blank" rel="noopener noreferrer">Stripe onramp responsibilities</a> · <a href="https://stripe.com/legal/restricted-businesses" target="_blank" rel="noopener noreferrer">Industry and use restrictions</a></p>
    </section>

    <section id="continuity" className={`${styles.chapter} ${styles.foundation}`} aria-labelledby="continuity-title">
      <p className={styles.eyebrow}>PAYMENT CONTINUITY / BUILT TO STAY PART OF YOUR BUSINESS</p>
      <div className={styles.sectionHead}><h2 id="continuity-title">When a payment gap opens,<br /><em>keep a way forward.</em></h2><p>A processor interruption should not force you to rethink your whole business. Keep a connected payment foundation ready for daily trading, changing customer needs and the moments your existing setup falls short.</p></div>
      <div className={styles.benefits}><article><span>01 / EVERYDAY ACCEPTANCE</span><h3>Make it your daily solution.</h3><p>Bring traditional funding and crypto payments into the way you already sell. Keep the checkout, settlement and receipt connected across your enabled selling channels.</p></article><article><span>02 / FILL A PAYMENT GAP</span><h3>Add another way to pay.</h3><p>Use the platform alongside your current provider. Give customers a supported alternative when your existing payment method is unavailable or does not fit what they hold.</p></article><article><span>03 / KEEP THE FOUNDATION</span><h3>Grow without starting over.</h3><p>Keep your brand, catalog and operating workflow as you add payment options or selling channels. Your team has one place to follow the payment and its outcome.</p></article></div>
      <div className={styles.recoveryGrid}><div className={styles.recoveryStory}><span className={styles.microLabel}>PERSISTENCE BEHIND THE EXPERIENCE</span><h3>A pending payment<br />doesn’t become a blind spot.</h3><p>Your receipt links the funding result and settlement attempt. If confirmation is delayed, the platform tracks the transaction and checks for an existing transfer before retrying.</p><div className={styles.statusTrail}><span><Check size={16} />Funding recorded</span><ArrowRight size={18} /><span>Settlement tracked</span><ArrowRight size={18} /><span>Receipt reconciled</span></div></div><div className={styles.continuityPromise}><h3>Your industry.<br />Your customers.<br />A payment path that fits.</h3><p>From everyday commerce to higher-risk sectors, the goal is the same: a persistent way to accept value and keep serving customers. We configure the supported paths around your business and markets.</p><p className={styles.paymentNote}>Individual payment methods and industries remain subject to applicable law, provider approval and route availability.</p></div></div>
    </section>

    <section id="infrastructure" className={`${styles.chapter} ${styles.foundation}`} aria-labelledby="foundation-title">
      <p className={styles.eyebrow}>THE OPERATING MODEL / WHO DOES WHAT</p>
      <div className={styles.foundationGrid}><div><h2 id="foundation-title">Run your business.<br /><em>We run the infrastructure.</em></h2><p className={styles.lead}>{audience === 'merchant' ? 'Your team should be serving customers and running the business. The platform team maintains the shared software, payment integrations and infrastructure behind your selling experience.' : 'Your team should be acquiring and supporting merchants. The platform team maintains the shared software, payment integrations and infrastructure behind the experience.'}</p><div className={styles.layerChoices} role="group" aria-label="Explore infrastructure layers">{layers.map((item, index) => <button key={item.label} type="button" aria-pressed={layer === index} onClick={() => setLayer(index)}><span>0{index + 1}</span>{item.label}<ArrowRight size={16} /></button>)}</div></div><div><div className={styles.layerBlueprint} aria-hidden="true"><Network size={38} strokeWidth={1} /><span>MANAGED FOUNDATION</span><div><i />EXPERIENCE<i />OPERATIONS<i />SETTLEMENT</div></div><div className={styles.layerDetail} aria-live="polite"><h3>{layers[layer].title}</h3><p>{layers[layer].text}</p><div className={styles.tags}>{layers[layer].tags.map(tag => <span key={tag}>{tag}</span>)}</div></div></div></div>
      <div className={styles.ownershipGrid}><article><span>YOUR COMMERCIAL FOCUS</span><h3>{audience === 'merchant' ? 'Serve customers and grow sales.' : 'Build and serve your book.'}</h3><ul>{(audience === 'merchant' ? ['Choose products, prices and selling channels.', 'Train staff to guide and reconcile a payment.', 'Manage fulfillment and customer relationships.'] : ['Find merchants and qualify their needs.', 'Develop your brand and commercial proposition.', 'Lead onboarding, training and account relationships.']).map(item => <li key={item}>{item}</li>)}</ul></article><article><span>PLATFORM OPERATIONS</span><h3>Avoid building a DevOps department.</h3><ul><li>Shared application hosting and software releases.</li><li>Maintenance of the integrated payment workflow.</li><li>Infrastructure operations and technical escalation.</li></ul></article></div>
    </section>

    {audience !== 'merchant' && <section id="partner" className={`${styles.chapter} ${styles.partnerChapter}`} aria-labelledby="partner-title">
      <p className={styles.eyebrow}>FOR ISOs & PAYMENT PROVIDERS / YOUR WHITE-LABEL PLATFORM</p>
      <div className={styles.sectionHead}><h2 id="partner-title">Resell the infrastructure.<br /><em>Build your own book.</em></h2><p>Put your brand on the payment experience. Bring your merchants and agents onto a platform you can commercialize account by account, while we maintain the software and infrastructure.</p></div>
      <div className={styles.partnerShowcase}><ThemeStudioDemo brandName={brandName} motionPaused={motionPaused} /><div className={styles.annotation}><span>WHITE-LABEL CHECKOUT & BRANDING</span><p>Your identity at the front. Our payment infrastructure behind it.</p></div></div>
      <div className={styles.benefits}><article><span>01 / YOUR COMMERCIAL MODEL</span><h3>Set splits per merchant.</h3><p>Give each account its own configured merchant, provider and agent shares. Structure the relationship around that merchant’s volume, service needs and agreed terms.</p></article><article><span>02 / YOUR DISTRIBUTION NETWORK</span><h3>Include your agents.</h3><p>Include agent recipients directly in the split configuration. Their allocation is attached to the payment, alongside yours and the merchant’s, with a transaction record to reconcile.</p></article><article><span>03 / YOUR PRODUCT OFFERING</span><h3>Offer both payment paths.</h3><p>Resell the Stripe-based funding journey and cross-chain crypto acceptance under your brand. Configure supported payment-method splits for credit, debit, ACH and crypto where enabled.</p></article></div>
      <SplitExplorer />
      <div className={styles.settlementCallout}><div><span>ONCHAIN SETTLEMENT</span><h3>Instant allocation.<br /><em>Everyone’s share accounted for.</em></h3></div><p>When a payment settles into the merchant’s split contract, the configured rules allocate the merchant’s, your provider’s and your agents’ shares. Release to recipient wallets follows the configured distribution or withdrawal flow; funding and network confirmation times still apply.</p></div>
      <div className={styles.takeaway}><strong>One account does not set the whole book.</strong><p>Your merchant accounts can use different split configurations. Keep a repeatable platform and tailor the commercial setup for each relationship, within your agreed platform terms.</p></div>
    </section>}

    {audience !== 'partner' && <section id="merchant" className={`${styles.chapter} ${styles.merchantChapter}`} aria-labelledby="merchant-title">
      <p className={styles.eyebrow}>FOR MERCHANTS / EVERYDAY PAYMENTS + A WAY THROUGH THE GAPS</p>
      <div className={styles.sectionHead}><h2 id="merchant-title">A payment foundation.<br /><em>Through every chapter.</em></h2><p>Use us as your everyday payment solution or alongside an existing provider. When your payment process has a gap, keep a ready alternative connected to your storefront, staff and transaction records.</p></div>
      <div className={styles.merchantStoryIntro}><span>THE MERCHANT STORY</span><h3>Your customer arrives. Value moves. Your business keeps going.</h3></div><div className={styles.merchantGrid}><div className={styles.merchantCopy}><div className={styles.viewSwitch} role="group" aria-label="Product screenshot view"><button type="button" aria-pressed={merchantView === 'operations'} onClick={() => setMerchantView('operations')}>Operations</button><button type="button" aria-pressed={merchantView === 'storefront'} onClick={() => setMerchantView('storefront')}>Storefront</button></div><h3>{screenshots[merchantView].title}</h3><p>{merchantView === 'operations' ? 'Keep taking payments at the counter, kiosk or handheld. Your staff can see the order, follow its payment state and find the receipt in the same operating workflow.' : 'Give customers an online storefront with familiar funding and crypto payment options. They choose how to pay; you receive the supported settlement asset configured for your business.'}</p><ol className={styles.processList}><li><strong>Create the order.</strong><p>Use your catalog and selected selling channel.</p></li><li><strong>Let customers choose.</strong><p>Traditional funding or crypto, connected to your settlement.</p></li><li><strong>Check the result.</strong><p>Confirm the payment and reconcile its receipt.</p></li></ol><span className={styles.finePrint}>Available modules depend on your workspace configuration.</span></div><div className={merchantView === 'storefront' ? styles.storefrontFrame : styles.merchantScreen}>{screenshotButton(merchantView)}</div></div>
      <div className={styles.touchpointStrip}><span><Store size={18} /> Online storefront</span><span><ScanLine size={18} /> Counter & kiosk</span><span><Users size={18} /> Staff training</span><span><Check size={18} /> Reconciliation</span></div>
    </section>}

    <section id="relationship" className={`${styles.chapter} ${styles.relationship}`} aria-labelledby="relationship-title">
      <p className={styles.eyebrow}>YOUR LAUNCH / A FOUNDATION YOU CAN GROW WITH</p><h2 id="relationship-title">{audience === 'merchant' ? <>A better way to get paid.<br /><em>Support beyond setup.</em></> : <>Launch your payment offering.<br /><em>Keep building your business.</em></>}</h2><p className={styles.relationshipLead}>{audience === 'merchant' ? 'Get the payment options, settlement setup and operating support your business needs—from the first transaction through everyday use.' : 'Your team brings the market and merchant relationships. We bring the connected infrastructure and technical foundation behind your branded payment offering.'}</p>
      <div className={styles.humanGrid}><article><span className={styles.roleIcon}><Store size={26} strokeWidth={1} /></span><span className={styles.microLabel}>YOUR EXPERIENCE</span><h3>{audience === 'merchant' ? 'Ready for your customers.' : 'Recognizably your brand.'}</h3><p>{audience === 'merchant' ? 'A checkout that offers customers more ways to pay, connected to the selling channels and team workflow you use.' : 'A white-label experience for your merchants, with your identity and a clear commercial proposition across your book.'}</p></article><article><span className={styles.roleIcon}><Wallet size={26} strokeWidth={1} /></span><span className={styles.microLabel}>YOUR ECONOMICS</span><h3>{audience === 'merchant' ? 'Receive what works for you.' : 'A model for each account.'}</h3><p>{audience === 'merchant' ? 'Choose among USDC, USDT, cbBTC, cbXRP, SOL and ETH for supported crypto settlement on Base. Track your share and its receipt.' : 'Merchant-specific splits connect your provider revenue, agent compensation and merchant proceeds to each settled payment.'}</p></article><article><span className={styles.roleIcon}><Network size={26} strokeWidth={1} /></span><span className={styles.microLabel}>YOUR FOUNDATION</span><h3>Infrastructure that stays managed.</h3><p>Hosting, shared software releases, integrated payment maintenance and technical escalation stay with the platform team as your business grows.</p></article></div>
      <div className={styles.conversationLine}><span>YOUR PRIORITY</span><strong>{selectedGap.label}</strong><ArrowRight size={18} /><p>{selectedGap.proof}</p></div>
    </section>

    <section id="next" className={`${styles.chapter} ${styles.closeChapter}`} aria-labelledby="next-title">
      <p className={styles.eyebrow}>THE LAUNCH PLAN / MAKE IT CONCRETE</p><div className={styles.closeGrid}><div><h2 id="next-title">{audience === 'merchant' ? <>Your customers.<br />Your currency.<br /><em>Your next sale.</em></> : <>Your brand.<br />Your merchants.<br /><em>Your next chapter.</em></>}</h2><p className={styles.lead}>Choose the payment experience your business needs. We connect your brand, supported settlement assets and commercial setup so you can launch with a clear path to your first payment.</p><a className={styles.textLink} href={audience === 'merchant' ? '/get-started' : '/partners'} target="_blank" rel="noopener noreferrer">{audience === 'merchant' ? 'Explore merchant onboarding' : 'Explore the partner application'}<ArrowUpRight size={17} /></a></div><div className={styles.pilotCard}><span className={styles.microLabel}>YOUR WORKSHOP TAKEAWAY</span><h3>Plan the first launch.</h3><label htmlFor="workshop-gap">The business priority<select id="workshop-gap" value={gap} onChange={event => { setGap(Number(event.target.value)); setCopyStatus(''); }}>{gaps.map((item, index) => <option key={item.id} value={index}>{item.label}</option>)}</select></label><label htmlFor="workshop-pilot">The pilot surface<select id="workshop-pilot" value={pilot} onChange={event => { setPilot(event.target.value); setCopyStatus(''); }}>{['An online storefront', 'A counter or kiosk workflow', 'A branded merchant launch', 'An eligible onramp journey', 'A repeat-customer workflow'].map(item => <option key={item}>{item}</option>)}</select></label><p className={styles.pilotProof}>{selectedGap.proof}</p><div className={styles.pilotChecklist}><span><Check size={15} /> Choose your payment paths and settlement assets</span><span><Check size={15} /> Configure account splits and support</span><span><Check size={15} /> Schedule your first live payment</span></div><button type="button" className={styles.primaryButton} onClick={async () => {
        try { await navigator.clipboard.writeText(workshopBrief(audience, gap, pilot, brandName)); setCopyStatus('Workshop brief copied.'); setCopyFallback(false); }
        catch { setCopyFallback(true); setCopyStatus('Select and copy your brief below.'); }
      }}><Copy size={16} /> Copy workshop brief</button><p className={styles.copyStatus} role="status">{copyStatus || 'Your payment paths, settlement choices and launch plan.'}</p>{copyFallback && <textarea className={styles.briefFallback} aria-label="Workshop brief to copy" readOnly value={workshopBrief(audience, gap, pilot, brandName)} onFocus={event => event.target.select()} />}</div></div><div className={styles.closingBrand}><Layers3 size={22} /><span>{brandName}</span><span>PAYMENT INFRASTRUCTURE. ROOM TO BUILD.</span></div>
    </section>

    {notes && <aside className={styles.presenterNotes} aria-label="Presenter prompts"><div><span><MessageSquare size={15} /> PRESENTER PROMPTS</span><button type="button" onClick={() => setNotes(false)} aria-label="Close presenter prompts"><X size={16} /></button></div><h3>{chapter.label}</h3><p><strong>Ask</strong>{chapter.question}</p><p><strong>Show / discuss</strong>{chapter.demo}</p><p><strong>Bridge</strong>{chapter.bridge}</p><small>Visible on this screen. Hide before screen sharing if needed.</small></aside>}
    <nav className={styles.dock} aria-label="Presentation controls">
      <button type="button" className={styles.dockArrow} aria-label="Previous chapter" disabled={active === 0} onClick={() => goTo(route[active - 1].id)}><ArrowLeft size={18} /></button>
      <label className={styles.chapterSelect}><span>{String(active + 1).padStart(2, '0')} <i>/ {String(route.length).padStart(2, '0')}</i></span><select aria-label="Jump to workshop chapter" value={chapter.id} onChange={event => goTo(event.target.value as ChapterId)}>{route.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select><ChevronDown size={13} /></label>
      <button type="button" className={styles.dockArrow} aria-label="Next chapter" disabled={active === route.length - 1} onClick={() => goTo(route[active + 1].id)}><ArrowRight size={18} /></button>
      <span className={styles.dockDivider} />
      <button type="button" className={`${styles.notesButton} ${notes ? styles.notesOn : ''}`} aria-label="Toggle presenter prompts" aria-pressed={notes} title="Presenter prompts (N)" onClick={() => setNotes(!notes)}><MessageSquare size={16} /><span>Presenter</span></button>
      <button type="button" aria-label={motionPaused ? 'Resume scene motion' : 'Pause scene motion'} aria-pressed={motionPaused} title={motionPaused ? 'Resume scene motion' : 'Pause scene motion'} onClick={() => setMotionPaused(value => !value)}>{motionPaused ? <Play size={16} /> : <Pause size={16} />}</button>
      {fullscreenAvailable && <button type="button" className={styles.fullscreenButton} aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} title="Fullscreen" onClick={() => void toggleFullscreen()}><Maximize2 size={16} /></button>}
      <details className={styles.editionMenu}><summary aria-label="Switch workshop edition"><Layers3 size={16} /><span>{audience === 'all' ? 'All' : audience === 'partner' ? 'Partner' : 'Merchant'}</span></summary><div>{audiences.map(item => <a key={item.id} href={item.href} aria-current={item.id === audience ? 'page' : undefined}>{item.label}{item.id === audience ? <Check size={13} /> : <ArrowUpRight size={13} />}</a>)}</div></details>
    </nav>
    {fullscreenError && <p className={styles.fullscreenError} role="status">{fullscreenError}<button type="button" aria-label="Dismiss fullscreen message" onClick={() => setFullscreenError('')}><X size={14} /></button></p>}
    <Dialog open={screenshot !== null} onOpenChange={open => { if (!open) setScreenshot(null); }}><DialogContent className={styles.lightbox} onCloseAutoFocus={event => { event.preventDefault(); lightboxTrigger.current?.focus(); }}>
      <DialogTitle>{screenshot ? screenshots[screenshot].label : 'Product screenshot'}</DialogTitle><DialogDescription>Product screenshot from a sample workspace. Branding, configuration and displayed amounts are illustrative.</DialogDescription>{screenshot && <div className={styles.lightboxImage}><img src={screenshots[screenshot].src} alt={screenshots[screenshot].alt} /></div>}
    </DialogContent></Dialog>
  </main>;
}
