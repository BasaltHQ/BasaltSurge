"use client";

import React from "react";
import { LayoutGroup } from "framer-motion";
import { ArrowRight, Check, CheckCircle2, CreditCard, Landmark, Layers3, LockKeyhole, RotateCcw, Smartphone } from "lucide-react";
import { AccordionCard } from "@/components/checkout/accordion/AccordionCard";
import { AccordionStepHeader } from "@/components/checkout/accordion/AccordionStepHeader";
import { AccordionContent } from "@/components/checkout/accordion/AccordionContent";
import styles from "@/app/(web)/landing.module.css";

const titles = ["Contact & Account Information", "Identity Verification", "Payment Method", "Payment & Order Confirmation"];

/** Presentation-only V2 preview: shares the live accordion UI, with local demo state. */
export default function AccordionCheckoutPreview({ brandName, accentColor }: { brandName: string; accentColor: string }) {
  const [step, setStep] = React.useState(1);
  const [method, setMethod] = React.useState("Card");
  const [complete, setComplete] = React.useState(false);
  const id = React.useId();
  const activePanelRef = React.useRef<HTMLDivElement>(null);
  const previousStep = React.useRef(step);
  React.useEffect(() => {
    if (previousStep.current !== step) activePanelRef.current?.focus({ preventScroll: true });
    previousStep.current = step;
  }, [step]);
  const summaries = ["alex@example.com", "Alex Morgan · Sample details", `${method} · Demo payment`, "Order confirmed"];
  function reset() { setStep(1); setMethod("Card"); setComplete(false); }
  return (
    <div className={styles.checkout} aria-label="Interactive multi-step checkout demo">
      <div className={styles.checkoutBrand}><span className={styles.merchantSymbol} aria-hidden="true"><Layers3 size={23} strokeWidth={1.5} /></span><div><strong>{brandName}</strong><span>Checkout preview</span></div><LockKeyhole size={16} /></div>
      <div className={styles.orderTotal}><div><span>YOUR ORDER</span><strong>Everyday essentials</strong></div><div><strong>$25.00</strong><span>USD</span></div></div>
      <div className={styles.previewNotice}>Sample details only. No real payment or account required.</div>
      <div className={styles.accordionSteps}>
        <LayoutGroup id={id}>
          {titles.map((title, index) => {
            const number = index + 1;
            const active = step === number;
            const done = step > number || complete;
            return <AccordionCard key={title} isActive={active} className={styles.previewCard}>
              <AccordionStepHeader stepNumber={number} title={title} isActive={active} isCompleted={done} isLocked={complete} primaryColor={accentColor} onHeaderClick={() => setStep(number)} subtitle={done && !active ? <span className={styles.stepSummary}>{summaries[index]}</span> : undefined} />
              <AccordionContent isOpen={active} position={number < step ? -1 : number > step ? 1 : 0}>
                <div className={styles.previewBody} ref={active ? activePanelRef : undefined} tabIndex={-1} role="group" aria-label={title}>
                  {number === 1 && <><DemoField label="Email address" value="alex@example.com" /><div className={styles.fieldPair}><DemoField label="Country" value="United States" /><DemoField label="Phone number" value="(202) 555-0142" /></div><button type="button" className={styles.demoContinue} onClick={() => setStep(2)}>Continue <ArrowRight size={15} /></button></>}
                  {number === 2 && <><div className={styles.fieldPair}><DemoField label="First name" value="Alex" /><DemoField label="Last name" value="Morgan" /></div><div className={styles.identityNote}><CheckCircle2 size={21} strokeWidth={1.5} /><p>Guided verification when required.<span>This preview uses sample details.</span></p></div><button type="button" className={styles.demoContinue} onClick={() => setStep(3)}>Continue to payment <ArrowRight size={15} /></button></>}
                  {number === 3 && <><div className={styles.methodGrid} role="group" aria-label="Demo payment method">{[{ name: "Card", icon: CreditCard }, { name: "Apple Pay", icon: Smartphone }, { name: "Bank", icon: Landmark }].map(({ name, icon: Icon }) => <button type="button" key={name} aria-pressed={method === name} onClick={() => setMethod(name)}><Icon size={19} /><span>{name}</span>{method === name && <Check size={12} />}</button>)}</div><div className={styles.demoPaymentDetail}>{method === "Card" ? <><CreditCard size={19} /><span>Demo card ending in 4242</span></> : method === "Apple Pay" ? <><Smartphone size={19} /><span>Apple Pay preview</span></> : <><Landmark size={19} /><span>Sample bank account</span></>}</div><p className={styles.methodNote}>Payment options vary by provider and region.</p><button type="button" className={styles.demoContinue} onClick={() => { setComplete(true); setStep(4); }}>Simulate payment <ArrowRight size={15} /></button></>}
                  {number === 4 && <div className={styles.demoSuccess}><CheckCircle2 size={35} strokeWidth={1.5} /><strong>That’s a great checkout.</strong><p>Demo order confirmed. $25.00.</p><span>No funds were moved.</span><button type="button" onClick={reset}><RotateCcw size={13} /> Try again</button></div>}
                </div>
              </AccordionContent>
            </AccordionCard>;
          })}
        </LayoutGroup>
      </div>
      <div className={styles.checkoutBottom} aria-live="polite"><span>{complete ? "Demo complete" : `Step ${step} of 4`}</span><div aria-hidden="true">{titles.map((title, index) => <i key={title} data-complete={index < step} />)}</div><span>Powered by {brandName}</span></div>
    </div>
  );
}

function DemoField({ label, value }: { label: string; value: string }) {
  return <label className={styles.demoField}><span>{label}</span><input value={value} readOnly tabIndex={-1} aria-label={`${label} (sample)`} /></label>;
}
