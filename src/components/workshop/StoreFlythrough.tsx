"use client";

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, Check, Package, QrCode, RotateCcw, Users } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import type { createStoreWorld } from './store-world';
import { storeCatalog as products } from './store-catalog';
import styles from './store-flythrough.module.css';

const chapters = [
  { label: 'Outside', eyebrow: '01 / ACROSS THE STREET', title: 'Your business. Part of everyday life.', text: 'Cars pass. People walk by. Cross the street and step into a store where products, customers and payments connect.' },
  { label: 'Explore', eyebrow: '02 / THE SHOPPING FLOOR', title: 'On the shelf. In your inventory.', text: 'Customers browse while your catalog keeps the business organized. Hover or tap a product marker to see its inventory record.' },
  { label: 'Checkout', eyebrow: '03 / FROM BROWSING TO BUYING', title: 'Their next stop: your counter.', text: 'One shopper brings their selection to checkout. The order becomes a payment request on your screen.' },
  { label: 'Scan & pay', eyebrow: '04 / ONE SIMPLE HANDOFF', title: 'Your screen. Their phone. Paid.', text: 'Present a payment QR at the counter. Your customer scans it, chooses a supported payment path and confirms on their phone.' },
  { label: 'Settlement', eyebrow: '05 / VALUE REACHES YOUR BUSINESS', title: 'See the payment move.', text: 'Follow value from the customer to your merchant settlement. The payment and its receipt stay connected.' },
  { label: 'Put it to work', eyebrow: '06 / BEHIND THE STOREFRONT', title: 'The sale powers what comes next.', text: 'Continue into the stockroom. Once funds are available, put them toward new inventory or your people through supported spending and payout routes.' },
] as const;
const scanSteps = [
  { label: 'Align the camera', detail: 'The rear camera faces the QR while the screen stays toward the customer.' },
  { label: 'Read the payment QR', detail: 'The camera recognizes the code and opens the payment request.' },
  { label: 'Review 64 USDC', detail: 'The customer reviews the merchant, basket and amount, then confirms.' },
  { label: 'Payment confirmed', detail: 'The phone shows confirmation. Continue to follow the merchant settlement.' },
];

export default function StoreFlythrough({ paused }: { paused: boolean }) {
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const qr = useRef<HTMLCanvasElement>(null);
  const markerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const progressBar = useRef<HTMLSpanElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [use, setUse] = useState<'inventory' | 'payroll'>('inventory');
  const fundsUse = useRef(use);
  fundsUse.current = use;
  const [scanPhase, setScanPhase] = useState(0);
  const scanReplay = useRef(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const beat = chapters[current];

  useEffect(() => {
    let disposed = false, failed = false, visible = false, initializing = false, frame = 0, previousTime = 0, active = -1, lastScanPhase = -1, position = 0;
    let world: ReturnType<typeof createStoreWorld> | undefined;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const view = stage.current!;
    const section = root.current!;
    const drawing = canvas.current!;
    function tick(time: number) {
      frame = 0;
      if (disposed || failed || !visible || !world) return;
      if (time - previousTime < 32) { frame = requestAnimationFrame(tick); return; }
      const elapsed = Math.min(100, time - previousTime || 32); previousTime = time;
      const length = Math.max(1, section.offsetHeight - view.offsetHeight);
      const target = Math.max(0, Math.min(5, -section.getBoundingClientRect().top / length * 5));
      const still = pausedRef.current || reduced.matches;
      position = still ? Math.round(target) : position + (target - position) * (1 - Math.exp(-elapsed / 110));
      if (Math.abs(position - target) < .002 && !still) position = target;
      const next = position < .86 ? 0 : Math.round(position);
      if (next !== active) { active = next; setCurrent(next); setSelected(null); }
      section.dataset.cameraProgress = position.toFixed(3);
      const { points, scanPhase: phase } = world.render(position, time, still, fundsUse.current, scanReplay.current);
      if (phase !== lastScanPhase) { lastScanPhase = phase; setScanPhase(phase); }
      markerRefs.current.forEach((button, index) => {
        if (!button) return;
        const point = points[index];
        const halfWidth = button.offsetWidth / 2;
        const labelX = Math.max(halfWidth + 12, Math.min(view.clientWidth - halfWidth - 12, point.x));
        button.style.left = `${labelX}px`; button.style.top = `${point.y}px`;
        button.style.setProperty('--marker-anchor-x', `${point.x - labelX}px`);
        button.style.visibility = next === 1 && point.visible ? 'visible' : 'hidden';
      });
      if (progressBar.current) progressBar.current.style.width = `${position / 5 * 100}%`;
      frame = requestAnimationFrame(tick);
    }
    const resize = new ResizeObserver(() => { if (world) world.resize(view.clientWidth, view.clientHeight); }); resize.observe(view);
    const observer = new IntersectionObserver(async entries => {
      visible = entries[0].isIntersecting;
      if (visible && !world && !initializing) {
        initializing = true;
        try {
          const { createStoreWorld } = await import('./store-world');
          if (disposed) return;
          world = createStoreWorld(drawing, qr.current!);
          world.resize(view.clientWidth, view.clientHeight);
          setStatus('ready');
        } catch { failed = true; if (!disposed) setStatus('fallback'); }
      }
      if (visible && world && !frame && !disposed && !failed) frame = requestAnimationFrame(tick);
    }, { rootMargin: '150px' }); observer.observe(view);
    function lost(event: Event) {
      event.preventDefault(); failed = true; cancelAnimationFrame(frame); frame = 0;
      markerRefs.current.forEach(button => { if (button) button.style.visibility = 'hidden'; });
      setStatus('fallback');
    }
    drawing.addEventListener('webglcontextlost', lost);
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); drawing.removeEventListener('webglcontextlost', lost); world?.dispose(); };
  }, []);

  function goTo(index: number) {
    const element = root.current;
    if (!element || !stage.current) return;
    if (status === 'fallback') { setCurrent(index); return; }
    const top = element.getBoundingClientRect().top + window.scrollY;
    const distance = element.offsetHeight - stage.current.offsetHeight;
    window.scrollTo({ top: top + distance * index / 5, behavior: paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }

  return <section id="store-tour" ref={root} className={`${styles.flythrough} ${status === 'fallback' ? styles.fallback : ''}`} data-store-stage={current} aria-label="Inside the store: a merchant’s day">
    <div ref={stage} className={styles.stage}>
      <canvas ref={canvas} className={styles.canvas} aria-label="3D store with customers, inventory, a QR checkout and a stockroom" role="img" />
      <QRCodeCanvas ref={qr} value="Workshop demonstration only. No payment is requested or collected." size={256} marginSize={3} className={styles.hiddenQr} />
      <div className={styles.shade} />
      <div className={styles.topline}><span><i /> A MERCHANT’S DAY</span><span>SCROLL THROUGH THE STORE <ArrowDown size={12} /></span><span>INTERACTIVE 3D / ILLUSTRATIVE WORKSPACE</span></div>
      <div className={styles.storyCopy}><span>{beat.eyebrow}</span><h2>{beat.title}</h2><p>{beat.text}</p></div>
      {status === 'loading' && <p className={styles.loading} role="status">Opening the store…</p>}
      {status === 'fallback' && <div className={styles.fallbackScene}><Package size={64} /><h3>{beat.label}</h3><p>The 3D view is unavailable on this device. Use the story controls below to follow the same journey.</p></div>}
      <div className={styles.hotspots}>{products.map((product, index) => <button type="button" ref={element => { markerRefs.current[index] = element; }} key={product.sku} className={styles.hotspot} aria-label={`Inspect ${product.name} inventory`} aria-expanded={selected === index} onPointerEnter={() => setSelected(index)} onFocus={() => setSelected(index)} onClick={() => setSelected(index)}><span><Check size={12} /> In inventory</span><strong>{product.name}</strong><i /></button>)}</div>
      {current === 1 && <aside className={styles.inventoryCard} aria-label="Sample inventory record"><div><Package size={16} /><span>CONNECTED INVENTORY</span></div><label htmlFor="tour-inventory">Explore a product<select id="tour-inventory" value={selected ?? 0} onChange={event => setSelected(Number(event.target.value))}>{products.map((product, index) => <option key={product.sku} value={index}>{product.name}</option>)}</select></label><h3>{products[selected ?? 0].name}</h3><p>{products[selected ?? 0].sku} · {products[selected ?? 0].price}</p><footer><Check size={15} /> {products[selected ?? 0].stock} in stock <span>Sample data</span></footer></aside>}
      {current === 3 && <aside className={`${styles.paymentCard} ${styles.scanCard}`} data-scan-phase={scanPhase} aria-label="QR payment demonstration"><QrCode size={22} /><span>ON YOUR CUSTOMER’S PHONE</span><div className={styles.scanSteps} aria-label={`Scan step ${scanPhase + 1} of 4`}>{scanSteps.map((step, index) => <i key={step.label} data-complete={index <= scanPhase} />)}</div><h3>{scanSteps[scanPhase].label}</h3><p aria-live="polite">{scanSteps[scanPhase].detail}</p><div><Check size={14} /> 64 USDC · example basket</div><button type="button" className={styles.replay} onClick={() => { scanReplay.current += 1; }}><RotateCcw size={12} /> Replay scan sequence</button><small>Illustrative payment. The QR contains demo text only.</small></aside>}
      {current === 4 && <aside className={styles.paymentCard}><Check size={24} /><span>MERCHANT SETTLEMENT</span><h3>A payment you can follow.</h3><p>Customer → merchant split → receipt</p><div><Check size={14} /> 64 USDC · illustrative transfer</div><small>Confirmation and release depend on the selected payment path.</small></aside>}
      {current === 5 && <aside className={styles.treasuryCard}><span>PUT AVAILABLE FUNDS TO WORK</span><div role="group" aria-label="Illustrative use of available funds"><button type="button" aria-pressed={use === 'inventory'} onClick={() => setUse('inventory')}><Package size={17} /> Restock inventory</button><button type="button" aria-pressed={use === 'payroll'} onClick={() => setUse('payroll')}><Users size={17} /> Fund payroll</button></div><h3>{use === 'inventory' ? 'Prepare for the next sale.' : 'Support the people behind it.'}</h3><p>{use === 'inventory' ? 'Pay a compatible supplier and replenish your shelves.' : 'Fund supported payroll or team payouts.'}</p><small>Illustration only. Requires available funds and a compatible supplier or payout provider.</small></aside>}
      <div className={styles.bottom}><div className={styles.sceneProgress}><span ref={progressBar} /></div><nav aria-label="Store story scenes">{chapters.map((item, index) => <button key={item.label} type="button" aria-current={current === index ? 'step' : undefined} onClick={() => goTo(index)}><span>0{index + 1}</span>{item.label}</button>)}</nav><div className={styles.sceneFooter}><span>ONE STORE. ONE CONNECTED JOURNEY.</span><button type="button" onClick={() => current === 5 ? document.getElementById('opportunity')?.scrollIntoView({ behavior: paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }) : goTo(current + 1)}>{current === 5 ? 'Continue the presentation' : 'Next scene'}<ArrowRight size={16} /></button></div></div>
    </div>
  </section>;
}
