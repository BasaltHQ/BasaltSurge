"use client";

import { useEffect, useRef } from 'react';
import { Network, Store, Users } from 'lucide-react';

import scene from './workshop-scenes.module.css';

export function PartnerNetwork({ brandName, compact = false }: { brandName: string; compact?: boolean }) {
  const brandLabel = useRef<HTMLElement>(null);
  useEffect(() => {
    const label = brandLabel.current;
    if (!label) return;
    let disposed = false;
    const fit = () => {
      if (disposed) return;
      label.style.fontSize = '21px';
      if (label.scrollWidth > label.clientWidth) {
        label.style.fontSize = `${Math.floor(21 * label.clientWidth / label.scrollWidth * 10) / 10}px`;
      }
    };
    fit();
    const observer = new ResizeObserver(fit); observer.observe(label.parentElement!);
    void document.fonts.ready.then(fit);
    return () => { disposed = true; observer.disconnect(); };
  }, [brandName]);
  return <figure className={`${scene.partnerNetwork} ${compact ? scene.compactNetwork : ''}`} data-scene="partner" aria-label="Your white-label merchant network">
    <div className={scene.networkViewport} aria-hidden="true"><div className={scene.networkWorld}>
      <div className={scene.networkFloor} />
      <svg className={scene.networkLinks} viewBox="0 0 440 420"><path d="M220 210 L65 80 M220 210 L345 60 M220 210 L395 230 M220 210 L320 365 M220 210 L80 340 M220 210 L35 195" /></svg>
      <div className={scene.brandTower}><div className={scene.towerTop}><Network size={40} strokeWidth={1} /></div><div className={scene.towerFace}><span>YOUR PLATFORM</span><strong ref={brandLabel}>{brandName}</strong><small>WHITE-LABEL INFRASTRUCTURE</small></div><div className={scene.towerSide} /></div>
      {['MERCHANT A', 'MERCHANT B', 'MERCHANT C', 'YOUR AGENTS', 'MERCHANT D', 'MERCHANT E'].map((name, index) => <div key={name} className={scene.networkNode} style={{ '--node': index } as React.CSSProperties}><div>{index === 3 ? <Users size={21} /> : <Store size={21} />}<span>{name}</span><small>{index === 3 ? 'SHARED GROWTH' : 'OWN SPLIT'}</small></div></div>)}
      <div className={scene.networkPulse} /><div className={scene.networkPulseTwo} />
    </div></div>
    <figcaption><span>THE PROVIDER OPPORTUNITY</span><h3>One brand. A growing network.</h3><p>Your merchants and agents connect to the infrastructure—with their own commercial relationships.</p></figcaption>
  </figure>;
}
