"use client";
import React, { useEffect, useState } from "react";
import { Activity, Database, Fingerprint, Orbit, Radio, ShieldCheck } from "lucide-react";

export default function AnalyticsLoadingScreen() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return <div className="analytics-boot" role="status" aria-label="Loading platform analytics">
    <div className="analytics-boot-grid" aria-hidden="true" />
    <header><div className="analytics-eyebrow"><Radio size={14}/> PLATFORM INTELLIGENCE / INITIALIZING</div><span className="analytics-boot-clock">{elapsed.toString().padStart(2, "0")}s elapsed</span></header>
    <div className="analytics-boot-main">
      <div className="analytics-reactor" aria-hidden="true"><div className="analytics-reactor-orbit"/><div className="analytics-reactor-orbit reverse"/><svg viewBox="0 0 300 300"><circle cx="150" cy="150" r="119" fill="none" stroke="#60fbb1" strokeWidth="1" strokeDasharray="2 9"/><circle cx="150" cy="150" r="94" fill="none" stroke="#a78bfa" strokeWidth="4" strokeDasharray="160 430"/></svg><div className="analytics-reactor-core"><Activity size={40}/><span>CONNECTING</span></div></div>
      <div className="analytics-boot-copy"><div className="analytics-eyebrow">SIGNAL → INSIGHT → ACTION</div><h2>Platform<br/><span>Analytics Engine</span></h2><p>Bringing your platform into focus.</p><div className="analytics-boot-status"><span/> Loading metrics and receipt evidence</div></div>
    </div>
    <div className="analytics-boot-modules">{[{ icon: Database, title: "Receipt intelligence", detail: "Payments · brands · outcomes" },{ icon: Fingerprint, title: "Failure diagnostics", detail: "Customer journeys · error patterns" },{ icon: ShieldCheck, title: "Settlement evidence", detail: "Stripe sessions · receipt records" },{ icon: Orbit, title: "Treasury observatory", detail: "Balances · historical observations" }].map(({ icon: Icon, title, detail }) => <div key={title}><Icon size={21}/><div><strong>{title}</strong><span>{detail}</span></div></div>)}</div>
    <footer><span>PLATFORM ANALYTICS</span><div className="analytics-boot-signal" aria-hidden="true"><i/></div><span>{elapsed > 15 ? "Still waiting for the data service" : "Awaiting source data"}</span></footer>
  </div>;
}
