"use client";

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, Check, ChevronDown, Coffee, Layers3, LockKeyhole, Moon, Palette, Pause, Play, ShoppingBag, Sparkles } from 'lucide-react';
import { THEME_REGISTRY } from '@/lib/themes/registry';
import styles from './theme-studio-demo.module.css';

// Coordinated examples: a structural preset plus separately configured brand colors and font.
const looks = [
  { preset: 'modern', label: 'Modern blue', detail: 'Clean geometry. A bright, confident brand.', font: 'Arial, sans-serif', fontLabel: 'System sans', color: '#3b82f6', secondary: '#6366f1' },
  { preset: 'elegant', label: 'Champagne atelier', detail: 'Warm gold. Refined type. The same checkout.', font: 'Georgia, serif', fontLabel: 'Georgia', color: '#c9a84c', secondary: '#b08d3e' },
  { preset: 'bold', label: 'Electric studio', detail: 'Vivid cyan. Crisp edges. Your own identity.', font: 'Arial, sans-serif', fontLabel: 'System sans', color: '#22d3ee', secondary: '#a78bfa' },
];

export default function ThemeStudioDemo({ brandName, motionPaused }: { brandName: string; motionPaused: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(true);
  const look = looks[selected];
  const theme = THEME_REGISTRY[look.preset];
  const playing = !paused && !motionPaused && !reducedMotion;

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const preference = () => setReducedMotion(media.matches);
    const visibility = () => setPageVisible(!document.hidden);
    preference(); visibility();
    media.addEventListener('change', preference);
    document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.2 });
    if (root.current) observer.observe(root.current);
    return () => { observer.disconnect(); media.removeEventListener('change', preference); document.removeEventListener('visibilitychange', visibility); };
  }, []);

  useEffect(() => {
    if (!playing || !visible || !pageVisible) return;
    const timer = window.setInterval(() => setSelected(value => (value + 1) % looks.length), 6500);
    return () => window.clearInterval(timer);
  }, [playing, visible, pageVisible]);

  const variables = {
    '--demo-accent': look.color, '--demo-secondary': look.secondary,
    '--demo-bg': theme.primaryBg, '--demo-surface': theme.surfaceBg,
    '--demo-text': theme.textPrimary, '--demo-muted': theme.textSecondary,
    '--demo-border': theme.borderColor, '--demo-radius': theme.borderRadius,
    '--demo-font': look.font, '--demo-button-text': theme.textOnPrimary,
    '--demo-button-radius': theme.buttonStyle === 'pill' ? '999px' : theme.buttonStyle === 'sharp' ? '2px' : '8px',
  } as CSSProperties;

  return <div ref={root} className={styles.studio} style={variables} role="region" aria-label="Interactive brand and checkout studio">
    <div className={styles.header}><span><Palette size={18} /><strong>Portal Theme Playground</strong></span><span className={styles.demoBadge}><span /> Live demo</span></div>
    <div className={styles.workspace}>
      <aside className={styles.controls} aria-label="Demo theme settings">
        <div className={styles.mode}><Moon size={13} /> Dark appearance <Check size={12} /></div>
        <div className={styles.settingTitle}>Theme preset <ChevronDown size={12} /></div>
        <div className={styles.presets} role="group" aria-label="Choose demo theme">{looks.map((item, index) => <button type="button" key={item.preset} aria-pressed={selected === index} onClick={() => { setSelected(index); setPaused(true); }}><i style={{ background: item.color }} />{THEME_REGISTRY[item.preset].name}{selected === index && <Check size={12} />}</button>)}</div>
        <div className={styles.settingTitle}>Brand colors <ChevronDown size={12} /></div>
        {[['Primary', look.color], ['Secondary', look.secondary]].map(([label, color]) => <div key={label} className={styles.colorField}><i style={{ background: color }} /><div><span>{label}</span><code>{color.toUpperCase()}</code></div></div>)}
        <div className={styles.settingTitle}>Typography <ChevronDown size={12} /></div>
        <div className={styles.fontField}><span style={{ fontFamily: look.font }}>Aa</span>{look.fontLabel}</div>
        <div className={styles.settingTitle}>Borders & effects <ChevronDown size={12} /></div>
        <div className={styles.settingValue}><span>Corner radius</span><strong>{theme.borderRadius}</strong></div>
        <div className={styles.settingValue}><span>Button shape</span><strong>{theme.buttonStyle}</strong></div>
        <p className={styles.settingsHint}>Presets, colors and typography work together to make the experience yours.</p>
      </aside>
      <div className={styles.preview}>
        <div className={styles.browserBar}><span className={styles.dots}><i /><i /><i /></span><span><LockKeyhole size={11} /> portal / preview</span><span className={styles.layoutBadge}>Compact</span></div>
        <div className={styles.previewCanvas}>
          <div className={styles.checkout} aria-label="Sample branded checkout">
            <div className={styles.checkoutBrand}><Layers3 size={24} /><strong>{brandName}</strong><LockKeyhole size={14} /></div>
            <div className={styles.order}>
              <div className={styles.orderHeading}><strong>Order Preview</strong><span>DEMO ORDER</span></div>
              <div className={styles.currency}><span>USD — US Dollar</span><ChevronDown size={13} /></div>
              <div className={styles.product}><span><ShoppingBag size={21} /></span><div>Everyday tote<small>QTY 1</small></div><strong>$48.00</strong></div>
              <div className={styles.product}><span><Coffee size={21} /></span><div>House coffee<small>QTY 1</small></div><strong>$16.00</strong></div>
              <div className={styles.summary}><div><span>Subtotal</span><span>$64.00</span></div><div><span>Tax · sample 8%</span><span>$5.12</span></div></div>
              <div className={styles.total}><span>Total (USD)</span><strong>$69.12</strong></div>
              <div className={styles.network}><span>Settlement network</span><span><i /> Base</span></div>
              <div className={styles.payPreview}>Continue to payment <ArrowRight size={15} /></div>
              <div className={styles.secure}><LockKeyhole size={10} /> Branded checkout · sample order</div>
            </div>
          </div>
          <div className={styles.previewCaption}><Sparkles size={15} /><span>One payment experience.<br /><strong>Your brand, all the way through.</strong></span></div>
        </div>
      </div>
    </div>
    <div className={styles.footer}>
      <div className={styles.currentLook}><span>0{selected + 1} / 03</span><div><strong>{look.label}</strong><p>{look.detail}</p></div></div>
      <button type="button" className={styles.playback} aria-label={playing ? 'Pause theme demo' : 'Play theme demo'} disabled={motionPaused || reducedMotion} onClick={() => setPaused(value => !value)}>{playing ? <Pause size={14} /> : <Play size={14} />}{motionPaused || reducedMotion ? 'Motion paused' : playing ? 'Auto tour' : 'Resume tour'}</button>
    </div>
  </div>;
}
