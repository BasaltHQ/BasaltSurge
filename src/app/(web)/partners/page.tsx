"use client";

import React, { useMemo, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { ExitIntentModal } from "@/components/landing/ExitIntentModal";
import ImageUploadField from "@/components/forms/ImageUploadField";
import {
  CheckCircle,
  Users,
  Shield,
  Zap,
  LineChart,
  Cog,
  Building2,
  ArrowRight,
  ArrowLeft,
  Info,
  Rocket,
  Calculator,
  Sparkles,
  ChevronDown,
  Check,
  DollarSign,
  Smartphone,
  Server,
  CreditCard,
  TrendingDown,
  Settings2,
  FileText,
} from "lucide-react";

type FormData = {
  brandKey: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  appUrl: string;
  partnerFeeBps: number;
  platformFeeRequestBps: number;
  partnerWallet: string;
  colors: { primary: string; accent: string };
  logos: { app: string; favicon: string; symbol: string };
  meta: { ogTitle: string; ogDescription: string };
  notes: string;
};

type Package = "base" | "mobile";
type FinancingTerm = 3 | 6 | 9 | 12;

const WIZARD_STEPS = [
  { id: "package", title: "Choose Package", desc: "Select your container setup" },
  { id: "identity", title: "Brand Identity", desc: "Company and contact information" },
  { id: "branding", title: "Branding Assets", desc: "Colors, logos, and metadata" },
  { id: "technical", title: "Technical Setup", desc: "Wallet and app configuration" },
  { id: "fees", title: "Fee Structure", desc: "Partner and platform fees" },
  { id: "review", title: "Review & Submit", desc: "Confirm your application" },
];

export default function PartnersPage() {
  const { theme } = useTheme();

  // Application mode
  const [mode, setMode] = useState<"wizard" | "advanced">("wizard");
  const [currentStep, setCurrentStep] = useState(0);

  // Pricing calculator state
  const [selectedPackage, setSelectedPackage] = useState<Package>("base");
  const [useFinancing, setUseFinancing] = useState(false);
  const [financingTerm, setFinancingTerm] = useState<FinancingTerm>(3);

  // Form state
  const [form, setForm] = useState<FormData>({
    brandKey: "",
    companyName: "",
    contactName: "",
    contactEmail: "",
    appUrl: "",
    partnerFeeBps: 0,
    platformFeeRequestBps: 25,
    partnerWallet: "",
    colors: { primary: "#0ea5e9", accent: "#22c55e" },
    logos: { app: "", favicon: "", symbol: "" },
    meta: { ogTitle: "", ogDescription: "" },
    notes: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ id?: string; brandKey?: string } | null>(null);

  const pricing = useMemo(() => ({
    base: { setup: 14950, name: "Base Container" },
    mobile: { setup: 20995, name: "Container + Mobile App" },
    monthly: 2195,
    platformFeeBps: 50,
    minRequestBps: 25,
    financing: {
      3: { apr: 0, label: "3 months (0% APR)" },
      6: { apr: 6, label: "6 months (6% APR)" },
      9: { apr: 8, label: "9 months (8% APR)" },
      12: { apr: 10, label: "12 months (10% APR)" },
    },
    discountTiers: [
      { minVolume: 0, maxVolume: 878999, fee: 2195, percent: 100 },
      { minVolume: 879000, maxVolume: 1316999, fee: 1646, percent: 75 },
      { minVolume: 1317000, maxVolume: 1755999, fee: 1098, percent: 50 },
      { minVolume: 1756000, maxVolume: 2194999, fee: 549, percent: 25 },
      { minVolume: 2195000, maxVolume: Infinity, fee: 0, percent: 0 },
    ],
  }), []);

  // Calculate pricing based on selections
  const calculatedPricing = useMemo(() => {
    const setupFee = pricing[selectedPackage].setup;
    const downPayment = setupFee / 2;
    const financedAmount = setupFee / 2;
    const apr = pricing.financing[financingTerm].apr;
    const financeCharge = financedAmount * (apr / 100) * (financingTerm / 12);
    const totalFinanced = financedAmount + financeCharge;
    const monthlyFinancing = totalFinanced / financingTerm;
    const totalDueAtSigning = useFinancing ? downPayment + pricing.monthly : setupFee + pricing.monthly;
    const year1Total = useFinancing
      ? downPayment + totalFinanced + (pricing.monthly * 12)
      : setupFee + (pricing.monthly * 12);

    return {
      setupFee,
      downPayment,
      financedAmount,
      financeCharge,
      totalFinanced,
      monthlyFinancing,
      totalDueAtSigning,
      year1Total,
    };
  }, [selectedPackage, useFinancing, financingTerm, pricing]);

  function isValidHexColor(s: string): boolean { return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test((s || "").trim()); }
  function isValidUrl(s: string): boolean { try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; } }
  function isHexAddress(s: string): boolean { return /^0x[a-fA-F0-9]{40}$/.test((s || "").trim()); }
  function clampBps(v: any): number | undefined { const n = Number(v); if (!Number.isFinite(n)) return undefined; return Math.max(0, Math.min(10000, Math.floor(n))); }

  function validateStep(step: number): string | null {
    switch (step) {
      case 1: // Identity
        if (!form.brandKey.trim()) return "Brand key is required";
        if (!form.companyName.trim()) return "Company name is required";
        if (!form.contactName.trim()) return "Contact name is required";
        if (!form.contactEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) return "Valid email is required";
        return null;
      case 2: // Branding
        if (!form.colors.primary || !isValidHexColor(form.colors.primary)) return "Valid primary color required";
        if (!form.colors.accent || !isValidHexColor(form.colors.accent)) return "Valid accent color required";
        if (!form.logos.app) return "App logo is required";
        if (!form.logos.favicon) return "Favicon is required";
        if (!form.logos.symbol) return "Symbol/mark is required";
        if (!form.meta.ogTitle.trim()) return "OG title is required";
        if (!form.meta.ogDescription.trim()) return "OG description is required";
        return null;
      case 3: // Technical
        if (!form.appUrl || !isValidUrl(form.appUrl)) return "Valid app URL required";
        if (!form.partnerWallet || !isHexAddress(form.partnerWallet)) return "Valid wallet address required";
        return null;
      case 4: // Fees
        const pf = clampBps(form.partnerFeeBps);
        const platReq = clampBps(form.platformFeeRequestBps);
        if (typeof pf !== "number") return "Partner fee is required";
        if (typeof platReq !== "number" || platReq < 25 || platReq > 50) return "Platform fee must be 25-50 bps";
        return null;
      default:
        return null;
    }
  }

  function nextStep() {
    const err = validateStep(currentStep);
    if (err) { setError(err); return; }
    setError("");
    setCurrentStep(Math.min(currentStep + 1, WIZARD_STEPS.length - 1));
  }

  function prevStep() {
    setError("");
    setCurrentStep(Math.max(currentStep - 1, 0));
  }

  async function submit() {
    try {
      setLoading(true);
      setError("");
      // Validate all steps
      for (let i = 1; i <= 4; i++) {
        const err = validateStep(i);
        if (err) { setError(err); return; }
      }
      if (!form.notes.trim()) { setError("Please add notes about your deployment"); return; }

      const payload = {
        ...form,
        brandKey: form.brandKey.trim().toLowerCase(),
        selectedPackage,
        useFinancing,
        financingTerm: useFinancing ? financingTerm : null,
        pricing: calculatedPricing,
      };

      const r = await fetch("/api/partners/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error || !j?.id) { setError(j?.error || "Submission failed"); return; }
      setSuccess({ id: j.id, brandKey: j?.brandKey });
    } catch (e: any) {
      setError(e?.message || "Submission failed");
    } finally {
      setLoading(false);
    }
  }

  function scrollToForm() { document.getElementById("partner-application")?.scrollIntoView({ behavior: "smooth", block: "start" }); }

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden pt-[120px] md:pt-[140px] pb-12 md:pb-16 px-4">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/15 via-transparent to-green-500/10" />
        <div className="absolute inset-0 opacity-50" style={{ backgroundImage: `radial-gradient(circle at 20% 50%, ${theme?.primaryColor || "#0ea5e9"}22 0%, transparent 50%), radial-gradient(circle at 80% 50%, #22c55e22 0%, transparent 50%)` }} />
        <div className="relative max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 md:px-4 md:py-1.5 rounded-full border bg-background/90 backdrop-blur mb-4 md:mb-6">
            <Sparkles className="h-3.5 w-3.5 md:h-4 md:w-4 text-primary" />
            <span className="text-xs md:text-sm font-medium">Partner Program</span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-tight">
            Launch Your Brand on
            <span className="bg-gradient-to-r from-primary to-green-500 bg-clip-text text-transparent block sm:inline"> BasaltSurge</span>
          </h1>
          <p className="mt-4 md:mt-6 text-base md:text-lg lg:text-xl text-muted-foreground max-w-2xl mx-auto px-2">
            Get a dedicated whitelabel container with full-stack crypto commerce: shops, receipts, QR terminals, and complete branding control.
          </p>
          <div className="mt-6 md:mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <button onClick={scrollToForm} className="w-full sm:w-auto px-5 py-2.5 md:px-6 md:py-3 rounded-lg bg-primary text-primary-foreground font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 transition text-sm md:text-base">
              <Rocket className="h-4 w-4 md:h-5 md:w-5" /> Start Application
            </button>
            <a href="#pricing" className="w-full sm:w-auto px-5 py-2.5 md:px-6 md:py-3 rounded-lg border font-semibold inline-flex items-center justify-center gap-2 hover:bg-foreground/5 transition text-sm md:text-base">
              <Calculator className="h-4 w-4 md:h-5 md:w-5" /> Calculate Pricing
            </a>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-10 md:py-16 px-4 bg-gradient-to-b from-background to-muted/30">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-8 md:mb-12">
            <h2 className="text-2xl md:text-3xl font-bold">Everything You Need to Succeed</h2>
            <p className="mt-2 md:mt-3 text-sm md:text-base text-muted-foreground">Your dedicated container comes packed with powerful features</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-6">
            {[
              { icon: Building2, title: "Dedicated Container", desc: "Isolated runtime with your brand identity" },
              { icon: Shield, title: "On-Chain Settlement", desc: "Automatic split payouts on blockchain" },
              { icon: Zap, title: "Full Commerce Stack", desc: "Shops, terminals, receipts & loyalty" },
              { icon: LineChart, title: "Real-Time Analytics", desc: "Reserve metrics and reporting" },
              { icon: Cog, title: "Complete Branding", desc: "Colors, logos, metadata—everywhere" },
              { icon: Users, title: "Merchant Management", desc: "Admin tools for your merchants" },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="group rounded-xl md:rounded-2xl border bg-background p-4 md:p-6 hover:border-primary/50 hover:shadow-lg transition-all">
                <div className="h-10 w-10 md:h-12 md:w-12 rounded-lg md:rounded-xl bg-primary/10 grid place-items-center group-hover:bg-primary/20 transition">
                  <Icon className="h-5 w-5 md:h-6 md:w-6 text-primary" />
                </div>
                <h3 className="mt-3 md:mt-4 text-sm md:text-lg font-semibold leading-tight">{title}</h3>
                <p className="mt-1 md:mt-2 text-xs md:text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Interactive Pricing Calculator */}
      <section id="pricing" className="py-10 md:py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-8 md:mb-12">
            <h2 className="text-2xl md:text-3xl font-bold">Transparent Pricing</h2>
            <p className="mt-2 md:mt-3 text-sm md:text-base text-muted-foreground">Choose your package and see your costs instantly</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
            {/* Package Selection */}
            <div className="space-y-3 md:space-y-4">
              <h3 className="text-base md:text-lg font-semibold flex items-center gap-2"><Server className="h-4 w-4 md:h-5 md:w-5" /> Select Package</h3>

              {/* Base Package */}
              <button
                onClick={() => setSelectedPackage("base")}
                className={`w-full p-4 md:p-6 rounded-xl md:rounded-2xl border-2 text-left transition-all ${selectedPackage === "base" ? "border-primary bg-primary/5 shadow-lg" : "border-muted hover:border-primary/30"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-base md:text-lg">Base Container</div>
                    <div className="text-2xl md:text-3xl font-bold mt-1 md:mt-2">${pricing.base.setup.toLocaleString()}</div>
                    <div className="text-xs md:text-sm text-muted-foreground">one-time setup</div>
                  </div>
                  {selectedPackage === "base" && <div className="h-7 w-7 md:h-8 md:w-8 rounded-full bg-primary grid place-items-center flex-shrink-0"><Check className="h-4 w-4 md:h-5 md:w-5 text-white" /></div>}
                </div>
                <ul className="mt-3 md:mt-4 space-y-1.5 md:space-y-2 text-xs md:text-sm">
                  <li className="flex items-center gap-2"><CheckCircle className="h-3.5 w-3.5 md:h-4 md:w-4 text-green-600 flex-shrink-0" /> Container provisioning & CI/CD</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-3.5 w-3.5 md:h-4 md:w-4 text-green-600 flex-shrink-0" /> Full branding customization</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-3.5 w-3.5 md:h-4 md:w-4 text-green-600 flex-shrink-0" /> Split validation & binding</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-3.5 w-3.5 md:h-4 md:w-4 text-green-600 flex-shrink-0" /> 3 hours/month support</li>
                </ul>
              </button>

              {/* Mobile Package */}
              <button
                onClick={() => setSelectedPackage("mobile")}
                className={`w-full p-4 md:p-6 rounded-xl md:rounded-2xl border-2 text-left transition-all ${selectedPackage === "mobile" ? "border-primary bg-primary/5 shadow-lg" : "border-muted hover:border-primary/30"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-base md:text-lg flex flex-wrap items-center gap-2">
                      <span>Container + Mobile App</span>
                      <span className="px-2 py-0.5 rounded-full bg-gradient-to-r from-primary to-green-500 text-white text-[10px] md:text-xs">POPULAR</span>
                    </div>
                    <div className="text-2xl md:text-3xl font-bold mt-1 md:mt-2">${pricing.mobile.setup.toLocaleString()}</div>
                    <div className="text-xs md:text-sm text-muted-foreground">one-time setup</div>
                  </div>
                  {selectedPackage === "mobile" && <div className="h-7 w-7 md:h-8 md:w-8 rounded-full bg-primary grid place-items-center flex-shrink-0"><Check className="h-4 w-4 md:h-5 md:w-5 text-white" /></div>}
                </div>
                <ul className="mt-3 md:mt-4 space-y-1.5 md:space-y-2 text-xs md:text-sm">
                  <li className="flex items-center gap-2"><CheckCircle className="h-3.5 w-3.5 md:h-4 md:w-4 text-green-600 flex-shrink-0" /> Everything in Base</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-3.5 w-3.5 md:h-4 md:w-4 text-green-600 flex-shrink-0" /> White-labeled Android app</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-3.5 w-3.5 md:h-4 md:w-4 text-green-600 flex-shrink-0" /> White-labeled iOS app</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-3.5 w-3.5 md:h-4 md:w-4 text-green-600 flex-shrink-0" /> MDM/Enterprise deployment</li>
                </ul>
              </button>

              {/* Financing Toggle */}
              <div className="p-3 md:p-4 rounded-xl border bg-muted/30">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={useFinancing} onChange={(e) => setUseFinancing(e.target.checked)} className="h-5 w-5 rounded border-2 accent-primary flex-shrink-0" />
                  <div>
                    <div className="font-medium text-sm md:text-base">Enable 50% Down Financing</div>
                    <div className="text-xs md:text-sm text-muted-foreground">Pay half now, finance the rest</div>
                  </div>
                </label>

                {useFinancing && (
                  <div className="mt-4 space-y-3">
                    <div className="text-xs md:text-sm font-medium">Select Term</div>
                    <div className="grid grid-cols-2 gap-2">
                      {([3, 6, 9, 12] as FinancingTerm[]).map((term) => (
                        <button
                          key={term}
                          onClick={() => setFinancingTerm(term)}
                          className={`p-2.5 md:p-3 rounded-lg border text-xs md:text-sm transition ${financingTerm === term ? "border-primary bg-primary/10 font-medium" : "hover:border-primary/30"}`}
                        >
                          {pricing.financing[term].label}
                          {term === 3 && <span className="block text-green-600 text-[10px] md:text-xs mt-0.5 md:mt-1">Best Value</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Price Summary */}
            <div className="lg:sticky lg:top-24 h-fit">
              <div className="rounded-xl md:rounded-2xl border-2 border-primary bg-gradient-to-br from-primary/5 to-transparent p-4 md:p-6">
                <h3 className="text-base md:text-lg font-semibold flex items-center gap-2"><Calculator className="h-4 w-4 md:h-5 md:w-5" /> Your Investment</h3>

                <div className="mt-4 md:mt-6 space-y-3 md:space-y-4">
                  <div className="flex justify-between items-center py-2 md:py-3 border-b text-sm md:text-base">
                    <span className="text-muted-foreground text-xs md:text-sm">Setup Fee</span>
                    <span className="font-semibold">${calculatedPricing.setupFee.toLocaleString()}</span>
                  </div>

                  {useFinancing && (
                    <>
                      <div className="flex justify-between items-center py-1.5 md:py-2 text-xs md:text-sm">
                        <span className="text-muted-foreground">Down Payment (50%)</span>
                        <span className="font-semibold">${calculatedPricing.downPayment.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center py-1.5 md:py-2 text-xs md:text-sm">
                        <span className="text-muted-foreground">Financed Amount</span>
                        <span>${calculatedPricing.financedAmount.toLocaleString()}</span>
                      </div>
                      {calculatedPricing.financeCharge > 0 && (
                        <div className="flex justify-between items-center py-1.5 md:py-2 text-xs md:text-sm">
                          <span className="text-muted-foreground">Finance Charge ({pricing.financing[financingTerm].apr}% APR)</span>
                          <span>${calculatedPricing.financeCharge.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center py-1.5 md:py-2 text-primary text-xs md:text-sm">
                        <span>Monthly Financing</span>
                        <span className="font-bold">${calculatedPricing.monthlyFinancing.toFixed(2)}/mo × {financingTerm}</span>
                      </div>
                    </>
                  )}

                  <div className="flex justify-between items-center py-2 md:py-3 border-t border-b text-xs md:text-sm">
                    <span className="text-muted-foreground">Monthly Subscription</span>
                    <span className="font-semibold">${pricing.monthly.toLocaleString()}/mo</span>
                  </div>

                  <div className="rounded-lg md:rounded-xl bg-primary/10 p-3 md:p-4">
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-sm md:text-base">Total Due at Signing</span>
                      <span className="text-xl md:text-2xl font-bold text-primary">${calculatedPricing.totalDueAtSigning.toLocaleString()}</span>
                    </div>
                    <div className="text-[10px] md:text-xs text-muted-foreground mt-1">
                      {useFinancing ? `Down payment + first month` : `Full setup + first month`}
                    </div>
                  </div>

                  <div className="flex justify-between items-center py-1.5 md:py-2 text-xs md:text-sm">
                    <span className="text-muted-foreground">Year 1 Total</span>
                    <span className="font-medium">${calculatedPricing.year1Total.toLocaleString()}</span>
                  </div>
                </div>

                <button onClick={scrollToForm} className="mt-4 md:mt-6 w-full py-2.5 md:py-3 rounded-lg bg-primary text-primary-foreground font-semibold hover:opacity-90 transition text-sm md:text-base">
                  Start Application →
                </button>
              </div>

              {/* Revenue Discounts */}
              <div className="mt-4 md:mt-6 rounded-xl border p-3 md:p-4">
                <h4 className="font-medium flex items-center gap-2 text-sm md:text-base"><TrendingDown className="h-4 w-4 text-green-600" /> Revenue-Based Discounts</h4>
                <p className="text-xs md:text-sm text-muted-foreground mt-1">Monthly subscription reduces with volume!</p>
                <div className="mt-2 md:mt-3 space-y-1">
                  {pricing.discountTiers.slice(0, 3).map((tier, i) => (
                    <div key={i} className="flex justify-between text-xs md:text-sm">
                      <span className="text-muted-foreground">{tier.maxVolume === Infinity ? `$${tier.minVolume.toLocaleString()}+` : `$${(tier.minVolume / 1000).toFixed(0)}k – $${(tier.maxVolume / 1000).toFixed(0)}k`}</span>
                      <span className={tier.fee === 0 ? "text-green-600 font-medium" : ""}>${tier.fee.toLocaleString()}/mo</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs md:text-sm font-medium text-green-600">
                    <span>$2.2M+ volume</span>
                    <span>$0/mo</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Application Section */}
      <section id="partner-application" className="py-10 md:py-16 px-4 bg-gradient-to-b from-muted/30 to-background">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-6 md:mb-8">
            <h2 className="text-2xl md:text-3xl font-bold">Partner Application</h2>
            <p className="mt-2 md:mt-3 text-sm md:text-base text-muted-foreground">Complete your application to get started</p>
          </div>

          {/* Mode Toggle */}
          <div className="flex items-center justify-center gap-2 md:gap-4 mb-6 md:mb-8">
            <button onClick={() => setMode("wizard")} className={`px-3 py-2 md:px-4 md:py-2 rounded-lg font-medium transition text-sm md:text-base ${mode === "wizard" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}>
              <Sparkles className="h-3.5 w-3.5 md:h-4 md:w-4 inline mr-1.5 md:mr-2" />Wizard
            </button>
            <button onClick={() => setMode("advanced")} className={`px-3 py-2 md:px-4 md:py-2 rounded-lg font-medium transition text-sm md:text-base ${mode === "advanced" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}>
              <Settings2 className="h-3.5 w-3.5 md:h-4 md:w-4 inline mr-1.5 md:mr-2" />Advanced
            </button>
          </div>

          {success ? (
            <div className="rounded-2xl border-2 border-green-500 bg-green-500/10 p-8 text-center">
              <CheckCircle className="h-16 w-16 text-green-600 mx-auto" />
              <h3 className="mt-4 text-2xl font-bold text-green-700">Application Submitted!</h3>
              <p className="mt-2 text-muted-foreground">Application ID: <span className="font-mono">{success.id}</span></p>
              {success.brandKey && <p className="text-muted-foreground">Brand: <span className="font-mono">{success.brandKey}</span></p>}
              <p className="mt-4 text-sm text-muted-foreground">Our team will review your application and reach out within 1-3 business days.</p>
            </div>
          ) : mode === "wizard" ? (
            <WizardMode
              steps={WIZARD_STEPS}
              currentStep={currentStep}
              form={form}
              setForm={setForm}
              selectedPackage={selectedPackage}
              useFinancing={useFinancing}
              financingTerm={financingTerm}
              calculatedPricing={calculatedPricing}
              pricing={pricing}
              error={error}
              loading={loading}
              onNext={nextStep}
              onPrev={prevStep}
              onSubmit={submit}
            />
          ) : (
            <AdvancedMode
              form={form}
              setForm={setForm}
              selectedPackage={selectedPackage}
              useFinancing={useFinancing}
              financingTerm={financingTerm}
              calculatedPricing={calculatedPricing}
              pricing={pricing}
              error={error}
              loading={loading}
              onSubmit={submit}
            />
          )}
        </div>
      </section>

      {/* FAQ */}
      <section className="py-10 md:py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-xl md:text-2xl font-bold text-center mb-6 md:mb-8">Frequently Asked Questions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            {[
              { q: "What is a whitelabel container?", a: "A dedicated runtime for your brand with isolated configuration, branding, and admin access." },
              { q: "Can we modify the platform fee?", a: "Yes, you can request a reduction. Approval depends on volume commitments." },
              { q: "How long does provisioning take?", a: "Typically 1-3 weeks after contract execution and asset delivery." },
              { q: "Is financing available?", a: "Yes! Pay 50% upfront and finance the rest over 3-12 months. 0% APR available for 3-month terms." },
            ].map(({ q, a }) => (
              <div key={q} className="rounded-lg md:rounded-xl border p-3 md:p-4">
                <h4 className="font-semibold text-sm md:text-base">{q}</h4>
                <p className="mt-1.5 md:mt-2 text-xs md:text-sm text-muted-foreground">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Exit-Intent Email Capture */}
      <ExitIntentModal accentColor={theme?.primaryColor} />
    </div>
  );
}

/* ============ WIZARD MODE ============ */
function WizardMode({ steps, currentStep, form, setForm, selectedPackage, useFinancing, financingTerm, calculatedPricing, pricing, error, loading, onNext, onPrev, onSubmit }: any) {
  return (
    <div className="rounded-xl md:rounded-2xl border bg-background overflow-hidden">
      {/* Progress Bar */}
      <div className="p-3 md:p-4 border-b bg-muted/30">
        {/* Mobile: Simple step indicator */}
        <div className="md:hidden flex items-center justify-center gap-1.5 mb-2">
          {steps.map((_: any, i: number) => (
            <div key={i} className={`h-2 rounded-full transition-all ${i === currentStep ? "w-6 bg-primary" : i < currentStep ? "w-2 bg-green-600" : "w-2 bg-muted"}`} />
          ))}
        </div>
        {/* Desktop: Full step indicators - uses flex-1 for lines to fill available space */}
        <div className="hidden md:flex items-center justify-center mb-2 max-w-xl mx-auto">
          {steps.map((step: any, i: number) => (
            <React.Fragment key={step.id}>
              {/* Step circle */}
              <div className={`h-8 w-8 rounded-full grid place-items-center text-sm font-medium transition flex-shrink-0 ${i < currentStep ? "bg-green-600 text-white" : i === currentStep ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                {i < currentStep ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              {/* Connecting line (not after last step) */}
              {i < steps.length - 1 && (
                <div className={`h-1 flex-1 min-w-4 max-w-12 transition-colors ${i < currentStep ? "bg-green-600" : "bg-muted"}`} />
              )}
            </React.Fragment>
          ))}
        </div>
        <div className="text-center">
          <div className="text-sm md:text-base font-semibold">Step {currentStep + 1}: {steps[currentStep].title}</div>
          <div className="text-xs md:text-sm text-muted-foreground">{steps[currentStep].desc}</div>
        </div>
      </div>

      {/* Step Content */}
      <div className="p-6">
        {error && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 text-sm">{error}</div>}

        {currentStep === 0 && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl border bg-primary/5">
              <div className="font-medium">Selected Package</div>
              <div className="text-2xl font-bold mt-1">{pricing[selectedPackage].name}</div>
              <div className="text-muted-foreground">${calculatedPricing.setupFee.toLocaleString()} setup + ${pricing.monthly.toLocaleString()}/mo</div>
              {useFinancing && <div className="mt-2 text-sm text-primary">Financing: ${calculatedPricing.downPayment.toLocaleString()} down, ${calculatedPricing.monthlyFinancing.toFixed(2)}/mo × {financingTerm}</div>}
            </div>
            <p className="text-sm text-muted-foreground">Your package selection from above will be included. Click Next to continue with your application.</p>
          </div>
        )}

        {currentStep === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground mb-4">Enter your company information. The brand key will become your container identifier (e.g., "acme" → acme.basaltsurge.com).</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Brand Key (slug) *</label>
                <input className="mt-1 w-full h-10 px-3 border rounded-lg bg-background font-mono" placeholder="acme" value={form.brandKey} onChange={(e) => setForm((p: any) => ({ ...p, brandKey: e.target.value }))} />
                <p className="text-xs text-muted-foreground mt-1">Lowercase, no spaces. This becomes your URL.</p>
              </div>
              <div>
                <label className="text-sm font-medium">Company Name *</label>
                <input className="mt-1 w-full h-10 px-3 border rounded-lg bg-background" placeholder="Acme Payments Inc." value={form.companyName} onChange={(e) => setForm((p: any) => ({ ...p, companyName: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">Contact Name *</label>
                <input className="mt-1 w-full h-10 px-3 border rounded-lg bg-background" placeholder="Jane Doe" value={form.contactName} onChange={(e) => setForm((p: any) => ({ ...p, contactName: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">Contact Email *</label>
                <input type="email" className="mt-1 w-full h-10 px-3 border rounded-lg bg-background" placeholder="jane@acme.com" value={form.contactEmail} onChange={(e) => setForm((p: any) => ({ ...p, contactEmail: e.target.value }))} />
              </div>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground mb-4">Upload your brand assets. These will appear across your container's UI.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Primary Color *</label>
                <div className="mt-1 flex items-center gap-2">
                  <input type="color" className="h-10 w-14 p-1 border rounded-lg" value={form.colors.primary} onChange={(e) => setForm((p: any) => ({ ...p, colors: { ...p.colors, primary: e.target.value } }))} />
                  <input className="flex-1 h-10 px-3 border rounded-lg bg-background font-mono" value={form.colors.primary} onChange={(e) => setForm((p: any) => ({ ...p, colors: { ...p.colors, primary: e.target.value } }))} />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Accent Color *</label>
                <div className="mt-1 flex items-center gap-2">
                  <input type="color" className="h-10 w-14 p-1 border rounded-lg" value={form.colors.accent} onChange={(e) => setForm((p: any) => ({ ...p, colors: { ...p.colors, accent: e.target.value } }))} />
                  <input className="flex-1 h-10 px-3 border rounded-lg bg-background font-mono" value={form.colors.accent} onChange={(e) => setForm((p: any) => ({ ...p, colors: { ...p.colors, accent: e.target.value } }))} />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <ImageUploadField label="App Logo *" value={form.logos.app} onChange={(v) => setForm((p: any) => ({ ...p, logos: { ...p.logos, app: typeof v === "string" ? v : v[0] || "" } }))} target="partner_logo_app" guidance="Transparent PNG, 512×512+ recommended" previewSize={80} />
              <ImageUploadField label="Favicon *" value={form.logos.favicon} onChange={(v) => setForm((p: any) => ({ ...p, logos: { ...p.logos, favicon: typeof v === "string" ? v : v[0] || "" } }))} target="partner_logo_favicon" guidance="Square PNG, 32×32 or 64×64" previewSize={48} />
              <ImageUploadField label="Symbol / Mark *" value={form.logos.symbol} onChange={(v) => setForm((p: any) => ({ ...p, logos: { ...p.logos, symbol: typeof v === "string" ? v : v[0] || "" } }))} target="partner_logo_symbol" guidance="Square PNG, transparent background" previewSize={64} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">OG Title *</label>
                <input className="mt-1 w-full h-10 px-3 border rounded-lg bg-background" placeholder="Acme Pay" value={form.meta.ogTitle} onChange={(e) => setForm((p: any) => ({ ...p, meta: { ...p.meta, ogTitle: e.target.value } }))} />
                <p className="text-xs text-muted-foreground mt-1">Appears in social shares and browser tabs</p>
              </div>
              <div>
                <label className="text-sm font-medium">OG Description *</label>
                <input className="mt-1 w-full h-10 px-3 border rounded-lg bg-background" placeholder="Secure crypto commerce for your business" value={form.meta.ogDescription} onChange={(e) => setForm((p: any) => ({ ...p, meta: { ...p.meta, ogDescription: e.target.value } }))} />
              </div>
            </div>
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground mb-4">Configure your container's technical settings.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">App URL *</label>
                <input className="mt-1 w-full h-10 px-3 border rounded-lg bg-background" placeholder="https://pay.acme.com" value={form.appUrl} onChange={(e) => setForm((p: any) => ({ ...p, appUrl: e.target.value }))} />
                <p className="text-xs text-muted-foreground mt-1">Your custom domain or subdomain</p>
              </div>
              <div>
                <label className="text-sm font-medium">Partner Wallet *</label>
                <input className="mt-1 w-full h-10 px-3 border rounded-lg bg-background font-mono" placeholder="0x..." value={form.partnerWallet} onChange={(e) => setForm((p: any) => ({ ...p, partnerWallet: e.target.value }))} />
                <p className="text-xs text-muted-foreground mt-1">Base network address for partner fee receipts</p>
              </div>
            </div>
          </div>
        )}

        {currentStep === 4 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground mb-4">Configure your fee structure. Platform fee is 0.5% (50 bps) by default.</p>
            <div className="p-4 rounded-xl border bg-muted/30 mb-4">
              <div className="flex items-start gap-2">
                <Info className="h-5 w-5 text-primary mt-0.5" />
                <div className="text-sm">
                  <p><b>Platform fee</b> (0.5%) goes to BasaltSurge. You can request a reduction to 0.25% (subject to approval).</p>
                  <p className="mt-1"><b>Partner fee</b> is your share from each transaction, paid to your wallet.</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Partner Fee (bps) *</label>
                <input type="number" min={0} max={500} className="mt-1 w-full h-10 px-3 border rounded-lg bg-background" placeholder="25" value={form.partnerFeeBps || ""} onChange={(e) => setForm((p: any) => ({ ...p, partnerFeeBps: e.target.value === "" ? 0 : Number(e.target.value) }))} />
                <p className="text-xs text-muted-foreground mt-1">Your fee in basis points (25 = 0.25%)</p>
              </div>
              <div>
                <label className="text-sm font-medium">Platform Fee Request (bps) *</label>
                <input type="number" min={25} max={50} className="mt-1 w-full h-10 px-3 border rounded-lg bg-background" placeholder="50" value={form.platformFeeRequestBps || ""} onChange={(e) => setForm((p: any) => ({ ...p, platformFeeRequestBps: e.target.value === "" ? 25 : Number(e.target.value) }))} />
                <p className="text-xs text-muted-foreground mt-1">25-50 bps (reductions subject to approval)</p>
              </div>
            </div>
          </div>
        )}

        {currentStep === 5 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground mb-4">Review your application and add any notes.</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="p-3 rounded-lg bg-muted/30"><span className="text-muted-foreground">Package:</span> <b>{pricing[selectedPackage].name}</b></div>
              <div className="p-3 rounded-lg bg-muted/30"><span className="text-muted-foreground">Setup:</span> <b>${calculatedPricing.setupFee.toLocaleString()}</b></div>
              <div className="p-3 rounded-lg bg-muted/30"><span className="text-muted-foreground">Brand:</span> <b>{form.brandKey || "—"}</b></div>
              <div className="p-3 rounded-lg bg-muted/30"><span className="text-muted-foreground">Company:</span> <b>{form.companyName || "—"}</b></div>
              <div className="p-3 rounded-lg bg-muted/30"><span className="text-muted-foreground">Contact:</span> <b>{form.contactEmail || "—"}</b></div>
              <div className="p-3 rounded-lg bg-muted/30"><span className="text-muted-foreground">Partner Fee:</span> <b>{form.partnerFeeBps} bps</b></div>
            </div>
            <div>
              <label className="text-sm font-medium">Notes *</label>
              <textarea className="mt-1 w-full h-24 px-3 py-2 border rounded-lg bg-background" placeholder="Tell us about your deployment timeline, target market, integration needs..." value={form.notes} onChange={(e) => setForm((p: any) => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="p-4 border-t bg-muted/30 flex items-center justify-between">
        <button onClick={onPrev} disabled={currentStep === 0} className="px-4 py-2 rounded-lg border font-medium disabled:opacity-50 hover:bg-foreground/5 transition inline-flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        {currentStep < steps.length - 1 ? (
          <button onClick={onNext} className="px-6 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition inline-flex items-center gap-2">
            Next <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button onClick={onSubmit} disabled={loading} className="px-6 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 transition inline-flex items-center gap-2">
            {loading ? "Submitting..." : "Submit Application"} <Check className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ============ ADVANCED MODE ============ */
function AdvancedMode({ form, setForm, selectedPackage, useFinancing, financingTerm, calculatedPricing, pricing, error, loading, onSubmit }: any) {
  return (
    <div className="rounded-2xl border bg-background p-6 space-y-6">
      {error && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 text-sm">{error}</div>}

      {/* Package Summary */}
      <div className="p-4 rounded-xl border bg-primary/5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Selected Package</div>
            <div className="font-bold text-lg">{pricing[selectedPackage].name}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">${calculatedPricing.totalDueAtSigning.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">due at signing</div>
          </div>
        </div>
      </div>

      {/* Brand Identity */}
      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Building2 className="h-5 w-5" /> Brand Identity</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="text-sm font-medium">Brand Key *</label><input className="mt-1 w-full h-10 px-3 border rounded-lg bg-background font-mono" placeholder="acme" value={form.brandKey} onChange={(e) => setForm((p: any) => ({ ...p, brandKey: e.target.value }))} /></div>
          <div><label className="text-sm font-medium">Company Name *</label><input className="mt-1 w-full h-10 px-3 border rounded-lg bg-background" placeholder="Acme Inc." value={form.companyName} onChange={(e) => setForm((p: any) => ({ ...p, companyName: e.target.value }))} /></div>
          <div><label className="text-sm font-medium">Contact Name *</label><input className="mt-1 w-full h-10 px-3 border rounded-lg bg-background" placeholder="Jane Doe" value={form.contactName} onChange={(e) => setForm((p: any) => ({ ...p, contactName: e.target.value }))} /></div>
          <div><label className="text-sm font-medium">Contact Email *</label><input type="email" className="mt-1 w-full h-10 px-3 border rounded-lg bg-background" placeholder="jane@acme.com" value={form.contactEmail} onChange={(e) => setForm((p: any) => ({ ...p, contactEmail: e.target.value }))} /></div>
        </div>
      </div>

      {/* Branding */}
      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Cog className="h-5 w-5" /> Branding</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div><label className="text-sm font-medium">Primary Color *</label><div className="mt-1 flex items-center gap-2"><input type="color" className="h-10 w-14 p-1 border rounded-lg" value={form.colors.primary} onChange={(e) => setForm((p: any) => ({ ...p, colors: { ...p.colors, primary: e.target.value } }))} /><input className="flex-1 h-10 px-3 border rounded-lg bg-background font-mono" value={form.colors.primary} onChange={(e) => setForm((p: any) => ({ ...p, colors: { ...p.colors, primary: e.target.value } }))} /></div></div>
          <div><label className="text-sm font-medium">Accent Color *</label><div className="mt-1 flex items-center gap-2"><input type="color" className="h-10 w-14 p-1 border rounded-lg" value={form.colors.accent} onChange={(e) => setForm((p: any) => ({ ...p, colors: { ...p.colors, accent: e.target.value } }))} /><input className="flex-1 h-10 px-3 border rounded-lg bg-background font-mono" value={form.colors.accent} onChange={(e) => setForm((p: any) => ({ ...p, colors: { ...p.colors, accent: e.target.value } }))} /></div></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <ImageUploadField label="App Logo *" value={form.logos.app} onChange={(v) => setForm((p: any) => ({ ...p, logos: { ...p.logos, app: typeof v === "string" ? v : v[0] || "" } }))} target="partner_logo_app" guidance="Transparent PNG" previewSize={80} />
          <ImageUploadField label="Favicon *" value={form.logos.favicon} onChange={(v) => setForm((p: any) => ({ ...p, logos: { ...p.logos, favicon: typeof v === "string" ? v : v[0] || "" } }))} target="partner_logo_favicon" guidance="Square PNG" previewSize={48} />
          <ImageUploadField label="Symbol *" value={form.logos.symbol} onChange={(v) => setForm((p: any) => ({ ...p, logos: { ...p.logos, symbol: typeof v === "string" ? v : v[0] || "" } }))} target="partner_logo_symbol" guidance="Square PNG" previewSize={64} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="text-sm font-medium">OG Title *</label><input className="mt-1 w-full h-10 px-3 border rounded-lg bg-background" placeholder="Acme Pay" value={form.meta.ogTitle} onChange={(e) => setForm((p: any) => ({ ...p, meta: { ...p.meta, ogTitle: e.target.value } }))} /></div>
          <div><label className="text-sm font-medium">OG Description *</label><input className="mt-1 w-full h-10 px-3 border rounded-lg bg-background" placeholder="Secure payments" value={form.meta.ogDescription} onChange={(e) => setForm((p: any) => ({ ...p, meta: { ...p.meta, ogDescription: e.target.value } }))} /></div>
        </div>
      </div>

      {/* Technical */}
      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Server className="h-5 w-5" /> Technical</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="text-sm font-medium">App URL *</label><input className="mt-1 w-full h-10 px-3 border rounded-lg bg-background" placeholder="https://pay.acme.com" value={form.appUrl} onChange={(e) => setForm((p: any) => ({ ...p, appUrl: e.target.value }))} /></div>
          <div><label className="text-sm font-medium">Partner Wallet *</label><input className="mt-1 w-full h-10 px-3 border rounded-lg bg-background font-mono" placeholder="0x..." value={form.partnerWallet} onChange={(e) => setForm((p: any) => ({ ...p, partnerWallet: e.target.value }))} /></div>
        </div>
      </div>

      {/* Fees */}
      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2"><DollarSign className="h-5 w-5" /> Fees</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="text-sm font-medium">Partner Fee (bps) *</label><input type="number" className="mt-1 w-full h-10 px-3 border rounded-lg bg-background" placeholder="25" value={form.partnerFeeBps || ""} onChange={(e) => setForm((p: any) => ({ ...p, partnerFeeBps: e.target.value === "" ? 0 : Number(e.target.value) }))} /></div>
          <div><label className="text-sm font-medium">Platform Fee Request (bps) *</label><input type="number" min={25} max={50} className="mt-1 w-full h-10 px-3 border rounded-lg bg-background" placeholder="50" value={form.platformFeeRequestBps || ""} onChange={(e) => setForm((p: any) => ({ ...p, platformFeeRequestBps: e.target.value === "" ? 25 : Number(e.target.value) }))} /></div>
        </div>
      </div>

      {/* Notes */}
      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2"><FileText className="h-5 w-5" /> Notes</h3>
        <textarea className="w-full h-24 px-3 py-2 border rounded-lg bg-background" placeholder="Tell us about your deployment timeline, target market, integration needs..." value={form.notes} onChange={(e) => setForm((p: any) => ({ ...p, notes: e.target.value }))} />
      </div>

      {/* Submit */}
      <div className="flex justify-end">
        <button onClick={onSubmit} disabled={loading} className="px-8 py-3 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 transition inline-flex items-center gap-2">
          {loading ? "Submitting..." : "Submit Application"} <Check className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
