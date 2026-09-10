"use client";

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import React from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, Code2, Globe2, Layers3, Pause, Play, ShieldCheck, Wallet, Zap } from "lucide-react";
import { useBrand } from "@/contexts/BrandContext";
import { useTheme } from "@/contexts/ThemeContext";
import { isPlatformBrand, normalizeBrandName } from "@/lib/branding";
import { cachedFetch } from "@/lib/client-api-cache";
import { SignupButton } from "@/components/landing/SignupButton";
import ContactFormSection from "@/components/landing/ContactFormSection";
import AccordionCheckoutPreview from "@/components/landing/AccordionCheckoutPreview";
import styles from "./get-started.module.css";

const overviewVideo = "https://engram1.blob.core.windows.net/portalpay/Videos/PortalPay25LQ.mp4";
const SignupWizard = dynamic(() => import("@/components/signup-wizard").then(module => module.SignupWizard), { ssr: false });
const capabilities = [
  { icon: Wallet, title: "A checkout that feels familiar.", description: "A guided payment experience that helps customers move from contact details to confirmation, one clear step at a time.", label: "DESIGNED FOR YOUR CUSTOMERS" },
  { icon: Zap, title: "Built on better payment rails.", description: "Accept digital assets and settle on Base. Put blockchain payments to work in the everyday flow of your business.", label: "POWERED BY CRYPTO" },
  { icon: Layers3, title: "Your brand. Every step.", description: "Bring your logo, colors, and identity into checkout. Keep the experience consistent from your storefront to the receipt.", label: "MADE TO FEEL LIKE YOU" },
];

export default function GetStartedPage() {
  const brand = useBrand();
  const { theme } = useTheme();
  const [identity, setIdentity] = React.useState({ brandKey: brand.key, containerType: "" });
  const heroVideoRef = React.useRef<HTMLVideoElement>(null);
  const [videoPaused, setVideoPaused] = React.useState(false);
  const [localSignupOpen, setLocalSignupOpen] = React.useState(false);
  React.useEffect(() => {
    // Some partner hosts hide the global navbar, which normally owns this event.
    const openWithoutNavbar = () => {
      if (!document.getElementById("global-hideable-navbar")) setLocalSignupOpen(true);
    };
    window.addEventListener("pp:wizard:open", openWithoutNavbar);
    return () => window.removeEventListener("pp:wizard:open", openWithoutNavbar);
  }, []);
  React.useEffect(() => {
    let cancelled = false;
    const root = document.documentElement;
    setIdentity({ brandKey: root.getAttribute("data-pp-brand-key") || brand.key, containerType: root.getAttribute("data-pp-container-type") || "" });
    cachedFetch("/api/site/container", { cache: "no-store" })
      .then((value: { brandKey?: string; containerType?: string }) => {
        if (!cancelled) setIdentity(previous => ({ brandKey: value.brandKey || previous.brandKey, containerType: value.containerType || previous.containerType }));
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [brand.key]);

  const brandKey = identity.brandKey || brand.key;
  const isPartner = identity.containerType.toLowerCase() === "partner" || !isPlatformBrand(brandKey);
  const rawName = theme.brandName?.trim();
  const genericName = !rawName || /^(ledger\d*|partner\d*|default)$/i.test(rawName) || (isPartner && /^(portalpay|basaltsurge)$/i.test(rawName));
  const brandName = normalizeBrandName(genericName ? brand.name : rawName, brandKey);
  const accent = isPartner ? (theme.primaryColor || brand.colors.primary) : "#ff8157";
  const pageStyle = { "--landing-accent": accent } as React.CSSProperties;
  const questions = [
    { question: "Do my customers need to know how crypto works?", answer: "The checkout guides customers through each step. Supported card and bank payment options can offer a familiar way to pay, while customers with a supported wallet can use crypto. Available methods depend on the checkout configuration, provider, and region." },
    { question: "Can I use it online and in person?", answer: "Yes. Use a branded checkout for your online store, share a payment link, or let customers scan a QR code at your counter. The platform also includes a terminal experience for in-person payments." },
    { question: "Can I keep my own branding?", answer: "Yes. Customize your logo, colors, and checkout appearance so the payment experience feels like a natural part of your business." },
    { question: "How do I connect it to my business?", answer: "Start with merchant onboarding to configure your business and settlement details. Use the available commerce integrations or the developer API to connect payments, orders, and receipts to your workflow." },
  ];

  return (
    <main className={styles.page} style={pageStyle}>
      <section className={styles.hero} aria-labelledby="landing-title">
        {!isPartner && <>
          <div className={styles.heroMedia} aria-hidden="true">
            <video ref={heroVideoRef} autoPlay muted loop playsInline poster="/bsurgebg.png" tabIndex={-1} onPlay={() => setVideoPaused(false)} onPause={() => setVideoPaused(true)}>
              <source src={overviewVideo} type="video/mp4" />
              <source src="/SurgeHeader.mp4" type="video/mp4" />
            </video>
          </div>
          <button type="button" className={styles.videoToggle} aria-label={videoPaused ? "Play background video" : "Pause background video"} onClick={() => {
            const video = heroVideoRef.current;
            if (!video) return;
            if (video.paused) void video.play().catch(() => setVideoPaused(true));
            else video.pause();
          }}>{videoPaused ? <Play size={14} /> : <Pause size={14} />}</button>
        </>}
        <div className={styles.heroGrid} aria-hidden="true" />
        <div className={`${styles.container} ${styles.heroLayout}`}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}><span className={styles.statusDot} /> THE NEXT CHAPTER OF PAYMENTS</div>
            <h1 id="landing-title">A better way<br />to <span>get paid.</span></h1>
            <p className={styles.heroDescription}>Crypto-powered payments.<br /> A remarkably simple checkout.</p>
            <p className={styles.heroDetail}>{brandName} brings payments, onchain settlement, and your brand into one seamless experience. Built for business. Designed for people.</p>
            <div className={styles.actions}>
              <SignupButton className={styles.primaryButton}>Start accepting payments <ArrowUpRight size={18} /></SignupButton>
              <a className={styles.textButton} href="#how-it-works"><ArrowDown size={16} /> Explore the experience</a>
            </div>
            <div className={styles.heroNotes}><span><Check size={14} /> Online & in person</span><span><Check size={14} /> Your brand, built in</span></div>
          </div>
          <div className={styles.productStage}>
            <div className={styles.stageLabel}><span>THE CHECKOUT EXPERIENCE</span><span className={styles.demoBadge}>INTERACTIVE DEMO</span></div>
            <AccordionCheckoutPreview brandName={brandName} accentColor={accent} />
            <div className={styles.stageCaption}><span className={styles.statusDot} /> Familiar on the surface. Powerful underneath.</div>
          </div>
        </div>
        <div className={`${styles.container} ${styles.railStrip}`}>
          <p>Modern payment rails.<br /><strong>Real-world possibilities.</strong></p>
          <div><span className={styles.baseMark} /> Base <small>SETTLEMENT NETWORK</small></div>
          <div><Globe2 size={23} /> Borderless <small>DIGITAL COMMERCE</small></div>
          <div><ShieldCheck size={23} /> Onchain <small>VERIFIABLE PAYMENTS</small></div>
        </div>
        <div className={styles.scrollPrompt}>
          <a href="#platform" className={styles.scrollCue}>
            <span>Scroll to explore</span>
            <span className={styles.scrollTrack} aria-hidden="true"><span /></span>
            <ChevronDown size={16} aria-hidden="true" />
          </a>
        </div>
      </section>

      <section className={`${styles.container} ${styles.section}`} id="platform" aria-labelledby="platform-title">
        <div className={styles.sectionHeading}>
          <div><div className={styles.eyebrow}>LESS FRICTION. MORE POSSIBILITY.</div><h2 id="platform-title">Great payments should<br />feel effortless.</h2></div>
          <p>Give customers a clear path to payment.<br />Give your business the tools to move forward.</p>
        </div>
        <div className={styles.capabilities}>
          {capabilities.map(({ icon: Icon, title, description, label }, index) => <article className={styles.capability} key={title}>
            <div className={styles.capabilityTop}><Icon size={26} strokeWidth={1.5} /><span>0{index + 1}</span></div>
            <div className={styles.smallLabel}>{label}</div><h3>{title}</h3><p>{description}</p>
          </article>)}
        </div>
      </section>

      <section className={`${styles.container} ${styles.section}`} id="how-it-works" aria-labelledby="workflow-title">
        <div className={styles.workflow}>
          <div className={styles.workflowIntro}><div className={styles.eyebrow}>FROM FIRST CLICK TO CONFIRMATION</div><h2 id="workflow-title">Every step.<br />Considered.</h2><p>A guided checkout keeps the next action clear. Your customers stay in the flow, and you stay focused on your business.</p><a className={styles.textButton} href="#landing-title">Try the checkout above <ArrowUpRight size={17} /></a></div>
          <ol className={styles.steps}>
            {[
              ["Connect with your customer", "A simple contact step brings the details together for checkout and receipts."],
              ["Guide the details", "Identity information is collected when required by the payment provider and selected payment method."],
              ["Make payment feel familiar", "Clear payment options help customers choose how they want to pay."],
              ["Close the loop", "Payment and order confirmation give customers a clear finish to their checkout."],
            ].map(([title, detail], index) => <li key={title}><span className={styles.stepNumber}>0{index + 1}</span><div><h3>{title}</h3><p>{detail}</p></div></li>)}
          </ol>
        </div>
      </section>

      <section className={styles.businessSection} aria-labelledby="business-title">
        <div className={styles.container}>
          <div className={styles.sectionHeading}><div><div className={styles.eyebrow}>ONE PLATFORM. YOUR WAY OF WORKING.</div><h2 id="business-title">Built for your next move.</h2></div><p>At the counter, in your store, or inside your own product. Make better payments part of your business.</p></div>
          <div className={styles.businessGrid}>
            <article className={styles.businessCard}><div className={styles.businessVisual} aria-hidden="true"><div className={styles.receiptIllustration}><span>YOUR BUSINESS</span><strong>Ready when<br />they are.</strong><div className={styles.receiptLine} /><span>PAYMENT LINK <ArrowUpRight size={15} /></span></div><span className={styles.visualTag}><Check size={13} /> Online & in person</span></div><div className={styles.businessBody}><h3>Wherever you do business.</h3><p>Payment links, QR checkout, and commerce integrations. Meet customers wherever the sale happens.</p><Link href="/terminal" className={styles.textButton}>Explore the terminal <ArrowUpRight size={17} /></Link></div></article>
            <article className={styles.businessCard}><div className={`${styles.businessVisual} ${styles.routingVisual}`} aria-hidden="true"><div className={styles.routeNode}><Wallet size={21} /><span>Payment received</span></div><div className={styles.routeConnector} /><div className={styles.routeDestinations}><span>Merchant</span><span>Partner</span></div><span className={styles.visualTag}><Layers3 size={13} /> Programmable revenue</span></div><div className={styles.businessBody}><h3>More control behind the scenes.</h3><p>Configure revenue splits, track activity, and connect your systems with APIs for orders, inventory, and receipts.</p><Link href="/developers" className={styles.textButton}>Explore the developer tools <ArrowUpRight size={17} /></Link></div></article>
          </div>
          {!isPartner && <div className={styles.partnerBanner}><div className={styles.partnerIcon}><Code2 size={26} /></div><div><span className={styles.smallLabel}>FOR PLATFORMS & PAYMENT PARTNERS</span><h3>Your brand. Our payment infrastructure.</h3><p>Build your own branded payment business with the partner program.</p></div><Link href="/partners" className={styles.secondaryButton}>Become a partner <ArrowUpRight size={17} /></Link></div>}
        </div>
      </section>

      <section className={`${styles.container} ${styles.section} ${styles.faq}`} aria-labelledby="faq-title">
        <div><div className={styles.eyebrow}>A LITTLE MORE CLARITY</div><h2 id="faq-title">Good questions.<br />Straight answers.</h2><Link href="/faq" className={styles.textButton}>Visit the help center <ArrowUpRight size={17} /></Link></div>
        <div className={styles.faqList}>{questions.map(({ question, answer }) => <details key={question}><summary>{question}<ChevronDown size={18} /></summary><p>{answer}</p></details>)}</div>
      </section>

      <section className={styles.finalSection} aria-labelledby="start-title"><div className={styles.container}><div className={styles.eyebrow}>YOUR NEXT CHAPTER STARTS HERE</div><h2 id="start-title">Better payments.<br /><span>More possibilities.</span></h2><p>Bring the {brandName} experience to your business.</p><div className={styles.actions}><SignupButton className={styles.primaryButton}>Start accepting payments <ArrowUpRight size={18} /></SignupButton><Link href="/pricing" className={styles.textButton}>Explore pricing <ArrowRight size={17} /></Link></div>
        {!isPartner && <details className={styles.contactDisclosure}><summary>Prefer to talk with our team? <ChevronDown size={16} /></summary><div className={styles.contactForm}><ContactFormSection /></div></details>}
      </div></section>
      <footer className={`${styles.container} ${styles.footer}`}>
        <Link href="/" className={styles.footerBrand}>
          {!isPartner && <Image src="/Surge.png" alt="" width={40} height={40} className={styles.footerSymbol} />}
          <span className={styles.footerBrandCopy}>
            {isPartner ? brandName : <span className={styles.footerWordmark}><span>BASALT</span><strong>SURGE</strong></span>}
            <span className={styles.footerTagline}>Payments for what comes next.</span>
          </span>
        </Link>
        <nav aria-label="Footer navigation"><Link href="/developers">Developers</Link><Link href="/support">Support</Link><Link href="/legal/privacy">Privacy</Link><Link href="/legal/terms">Terms</Link></nav>
        <span>© {new Date().getFullYear()} {brandName}</span>
      </footer>
      {localSignupOpen && <SignupWizard isOpen onClose={() => setLocalSignupOpen(false)} onComplete={() => setLocalSignupOpen(false)} />}
    </main>
  );
}
