"use client";

import React, { useState, useEffect, useRef } from "react";
import { PortalPayAccordionCheckoutV2 } from "@/components/checkout/PortalPayAccordionCheckoutV2";

export default function SampleFormsPage() {
  const [checkoutVersion, setCheckoutVersion] = useState<"v1" | "v2">("v2");
  const [simulatedTier, setSimulatedTier] = useState<"l0" | "l1" | "l2">("l0");
  const [simulatedStatus, setSimulatedStatus] = useState<"normal" | "step_up" | "doc_verify" | "verified">("normal");
  const [simulatedError, setSimulatedError] = useState<"none" | "address_error" | "payment_decline" | "kyc_rejection">("none");
  const [simulatedPath, setSimulatedPath] = useState<"normal" | "skip_kyc" | "step_up" | "doc_verify">("normal");
  const [activeTier, setActiveTier] = useState<"l0" | "l1">("l1");
  const [themeMode, setThemeMode] = useState<"dark" | "light">("dark");
  const isLightText = themeMode === "dark";
  const primaryColor = "#635BFF"; // Standard Stripe primary color

  // Form State
  const [kycFirstName, setKycFirstName] = useState("Jane");
  const [kycLastName, setKycLastName] = useState("Doe");
  const [shipEmail, setShipEmail] = useState("jane.doe@example.com");
  const [headlessEmailInput, setHeadlessEmailInput] = useState("jane.doe@example.com");
  const [headlessPhoneInput, setHeadlessPhoneInput] = useState("+1 555-019-2834");
  const [kycCountry, setKycCountry] = useState("US");
  const [kycLine1, setKycLine1] = useState("742 Evergreen Terrace");
  const [kycLine2, setKycLine2] = useState("Apt 4B");
  const [kycCity, setKycCity] = useState("Springfield");
  const [kycState, setKycState] = useState("OR");
  const [kycZip, setKycZip] = useState("97477");
  const [shippingRequired, setShippingRequired] = useState(true);
  const [kycSameAsShipping, setKycSameAsShipping] = useState(true);

  // Address Autocomplete State
  const [addressPredictions, setAddressPredictions] = useState<Array<{ placeId: string; description: string; mainText: string; secondaryText: string }>>([]);
  const [isAddressLoading, setIsAddressLoading] = useState(false);
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);
  const [isAddressVerified, setIsAddressVerified] = useState(false);
  const addressDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!kycLine1 || kycLine1.trim().length < 3 || isAddressVerified) {
      setAddressPredictions([]);
      setShowAddressDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsAddressLoading(true);
      try {
        const res = await fetch(`/api/address/autocomplete?input=${encodeURIComponent(kycLine1)}`);
        const data = await res.json();
        if (data.predictions) {
          setAddressPredictions(data.predictions);
          setShowAddressDropdown(data.predictions.length > 0);
        }
      } catch (err) {
        console.error("Autocomplete failed:", err);
      } finally {
        setIsAddressLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [kycLine1, isAddressVerified]);

  const handleSelectPrediction = async (placeId: string, description: string) => {
    setIsAddressLoading(true);
    setShowAddressDropdown(false);
    setKycLine1(description);
    try {
      const res = await fetch(`/api/address/autocomplete?placeId=${encodeURIComponent(placeId)}`);
      const data = await res.json();
      if (data && !data.error) {
        if (data.streetAddress) setKycLine1(data.streetAddress);
        if (data.apartment) setKycLine2(data.apartment);
        if (data.city) setKycCity(data.city);
        if (data.state) setKycState(data.state);
        if (data.zip) setKycZip(data.zip);
        if (data.country) setKycCountry(data.country);
        setIsAddressVerified(true);
      }
    } catch (err) {
      console.error("Failed to fetch place details:", err);
    } finally {
      setIsAddressLoading(false);
    }
  };

  // L1 Specific State
  const [isAccordionOpen, setIsAccordionOpen] = useState(false); // Default collapsed
  const [kycDobMonth, setKycDobMonth] = useState("08");
  const [kycDobDay, setKycDobDay] = useState("15");
  const [kycDobYear, setKycDobYear] = useState("1992");
  const [kycSsn, setKycSsn] = useState("123456789");
  const [showSsn, setShowSsn] = useState(false);

  return (
    <div className={`min-h-screen p-4 sm:p-8 flex flex-col items-center justify-start transition-colors duration-300 ${isLightText ? "bg-neutral-950 text-white" : "bg-gray-100 text-black"}`}>
      
      {/* Top Navigation & Controls */}
      <div className="w-full max-w-xl mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 border-b pb-4 border-white/10">
        <div>
          <h1 className="text-lg font-bold tracking-tight">PortalPay KYC Form Inspector</h1>
          <p className="text-xs opacity-60">Exact pixel-perfect render of Tier 0 & Tier 1 checkout forms</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Theme Switcher */}
          <button
            onClick={() => setThemeMode(themeMode === "dark" ? "light" : "dark")}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold shadow-sm transition-all hover:opacity-80 ${
              isLightText ? "border-white/20 bg-white/10 text-white" : "border-black/20 bg-black/10 text-black"
            }`}
          >
            {themeMode === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>
        </div>
      </div>

      {/* Checkout Engine Switcher Tabs */}
      <div className="w-full max-w-xl mb-3 grid grid-cols-2 p-1.5 rounded-2xl border bg-amber-500/10 border-amber-500/30">
        <button
          onClick={() => setCheckoutVersion("v1")}
          className={`py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
            checkoutVersion === "v1"
              ? "bg-amber-500 text-black shadow-lg"
              : "opacity-60 hover:opacity-100 text-amber-400"
          }`}
        >
          <span>V1 Classic Modal</span>
        </button>

        <button
          onClick={() => setCheckoutVersion("v2")}
          className={`py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
            checkoutVersion === "v2"
              ? "bg-amber-500 text-black shadow-lg"
              : "opacity-60 hover:opacity-100 text-amber-400"
          }`}
        >
          <span>V2 Living Accordion ⚡</span>
        </button>
      </div>

      {/* V2 Simulation Control Panel */}
      {checkoutVersion === "v2" && (
        <div className="w-full max-w-xl mb-4 p-3.5 rounded-2xl border bg-black/50 border-amber-500/30 space-y-3 text-left animate-in fade-in duration-200 shadow-xl">
          <div className="flex items-center justify-between text-[11px] font-bold text-amber-400 border-b border-amber-500/20 pb-2">
            <span>⚡ V2 END-TO-END SIMULATION & SETTINGS</span>
            <span className="text-[10px] text-zinc-400 font-mono">Full Path & Error Injection Control</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[10px] font-semibold text-zinc-400 mb-1">Target KYC Tier</label>
              <div className="grid grid-cols-3 gap-1 bg-zinc-950 p-0.5 rounded-lg border border-white/10">
                {(["l0", "l1", "l2"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSimulatedTier(t)}
                    className={`py-1 text-[10px] font-bold uppercase rounded transition-all ${
                      simulatedTier === t ? "bg-amber-500 text-black shadow" : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-zinc-400 mb-1">Flow Path Strategy</label>
              <select
                value={simulatedPath}
                onChange={(e) => setSimulatedPath(e.target.value as any)}
                className="w-full h-7 px-2 text-[10px] rounded-lg bg-zinc-950 border border-white/10 text-white font-semibold focus:outline-none focus:border-amber-400"
              >
                <option value="normal">Normal Step-by-Step Flow</option>
                <option value="skip_kyc">Skip KYC (Existing Verified User)</option>
                <option value="step_up">Force Tier Step-Up (SSN/DOB)</option>
                <option value="doc_verify">Force L2 Document Verification</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 pt-1 border-t border-white/5">
            <div>
              <label className="block text-[10px] font-semibold text-zinc-400 mb-1">Flow Mode / Status</label>
              <select
                value={simulatedStatus}
                onChange={(e) => setSimulatedStatus(e.target.value as any)}
                className="w-full h-7 px-2 text-[10px] rounded-lg bg-zinc-950 border border-white/10 text-white font-semibold focus:outline-none focus:border-amber-400"
              >
                <option value="normal">Normal Entry</option>
                <option value="step_up">Step-Up Required (SSN/DOB)</option>
                <option value="doc_verify">Doc Upload Required (L2)</option>
                <option value="verified">Fully Verified (Auto-Advance)</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-amber-400 mb-1">Inject Error Scenario</label>
              <select
                value={simulatedError}
                onChange={(e) => setSimulatedError(e.target.value as any)}
                className="w-full h-7 px-2 text-[10px] rounded-lg bg-zinc-950 border border-amber-500/40 text-amber-300 font-semibold focus:outline-none focus:border-amber-400"
              >
                <option value="none">✓ None (Success Path)</option>
                <option value="address_error">⚠️ Address Verification Failed</option>
                <option value="payment_decline">❌ Payment Authorization Declined</option>
                <option value="kyc_rejection">🚫 KYC Identity Rejection</option>
              </select>
            </div>
          </div>

          {/* Region / Jurisdiction Selector */}
          <div className="pt-1 border-t border-white/5">
            <label className="block text-[10px] font-semibold text-emerald-400 mb-1">🌍 Simulation Jurisdiction / Region</label>
            <select
              value={kycCountry}
              onChange={(e) => {
                const c = e.target.value;
                setKycCountry(c);
                if (c === "AT") {
                  setKycFirstName("Alexander");
                  setKycLastName("Mayr");
                  setKycLine1("Augasse 9");
                  setKycLine2("9a");
                  setKycCity("Wien");
                  setKycState("W");
                  setKycZip("1090");
                  setShipEmail("alexander.mayr@example.com");
                  setHeadlessPhoneInput("+43 660 1234567");
                } else if (c === "DE") {
                  setKycFirstName("Maximilian");
                  setKycLastName("Müller");
                  setKycLine1("Friedrichstraße 43");
                  setKycLine2("");
                  setKycCity("Berlin");
                  setKycState("");
                  setKycZip("10117");
                  setShipEmail("max.mueller@example.de");
                  setHeadlessPhoneInput("+49 151 23456789");
                } else if (c === "FR") {
                  setKycFirstName("Camille");
                  setKycLastName("Dupont");
                  setKycLine1("12 Rue de Rivoli");
                  setKycLine2("");
                  setKycCity("Paris");
                  setKycState("");
                  setKycZip("75001");
                  setShipEmail("camille.dupont@example.fr");
                  setHeadlessPhoneInput("+33 6 12 34 56 78");
                } else if (c === "ES") {
                  setKycFirstName("Carlos");
                  setKycLastName("García");
                  setKycLine1("Gran Vía 28");
                  setKycLine2("");
                  setKycCity("Madrid");
                  setKycState("M");
                  setKycZip("28013");
                  setShipEmail("carlos.garcia@example.es");
                  setHeadlessPhoneInput("+34 612 345678");
                } else {
                  setKycFirstName("Jane");
                  setKycLastName("Doe");
                  setKycLine1("742 Evergreen Terrace");
                  setKycLine2("Apt 4B");
                  setKycCity("Springfield");
                  setKycState("OR");
                  setKycZip("97477");
                  setShipEmail("jane.doe@example.com");
                  setHeadlessPhoneInput("+1 555-019-2834");
                }
              }}
              className="w-full h-8 px-2.5 text-[11px] rounded-lg bg-zinc-950 border border-emerald-500/40 text-emerald-300 font-bold focus:outline-none focus:border-emerald-400"
            >
              <option value="US">🇺🇸 United States (US - Pure L0 / Step-Up SSN)</option>
              <option value="AT">🇦🇹 Austria (AT - EU MiCA / Alexander Mayr Wien)</option>
              <option value="DE">🇩🇪 Germany (DE - EU MiCA KYC + L2)</option>
              <option value="FR">🇫🇷 France (FR - EU MiCA KYC + L2)</option>
              <option value="ES">🇪🇸 Spain (ES - EU MiCA NIF + L2)</option>
            </select>
          </div>
        </div>
      )}

      {checkoutVersion === "v1" && (
        /* Tier Switcher Tabs for V1 */
        <div className="w-full max-w-xl mb-6 grid grid-cols-2 p-1.5 rounded-2xl border bg-black/20 border-white/10">
          <button
            onClick={() => setActiveTier("l0")}
            className={`py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeTier === "l0"
                ? "bg-[#635BFF] text-white shadow-lg shadow-indigo-500/20"
                : "opacity-60 hover:opacity-100"
            }`}
          >
            <span>Tier 0 (L0)</span>
            <span className="text-[10px] opacity-75 font-normal">Legal Identity</span>
          </button>

          <button
            onClick={() => setActiveTier("l1")}
            className={`py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeTier === "l1"
                ? "bg-[#635BFF] text-white shadow-lg shadow-indigo-500/20"
                : "opacity-60 hover:opacity-100"
            }`}
          >
            <span>Tier 1 (L1)</span>
            <span className="text-[10px] opacity-75 font-normal">Identity Verification</span>
          </button>
        </div>
      )}

      {/* ─── EXACT PORTAL MODAL CARD CONTAINER ─── */}
      <div className={`w-full max-w-xl p-5 sm:p-7 rounded-3xl border shadow-2xl transition-all duration-300 ${
        isLightText 
          ? "bg-neutral-900/95 border-white/10 shadow-black/80" 
          : "bg-white border-black/10 shadow-black/10"
      }`}>
        
        {checkoutVersion === "v2" ? (
          <PortalPayAccordionCheckoutV2
            theme={{ primaryColor }}
            isLightText={isLightText}
            email={shipEmail}
            phone={headlessPhoneInput}
            fullName={`${kycFirstName} ${kycLastName}`}
            firstName={kycFirstName}
            lastName={kycLastName}
            line1={kycLine1}
            line2={kycLine2}
            city={kycCity}
            stateCode={kycState}
            zipCode={kycZip}
            country={kycCountry}
            amountUsd={25.00}
            receiptId="REC-SAMPLE-99"
            kycTierRequired={simulatedTier}
            simulatedTier={simulatedTier}
            simulatedStatus={simulatedStatus}
            simulatedError={simulatedError}
            simulatedPath={simulatedPath}
            isAllKycCompleted={simulatedStatus === "verified"}
          />
        ) : (
        
        <div className="w-full flex flex-col items-stretch justify-start animate-in zoom-in duration-300 text-left">
          {/* Payment Methods Badges Bar - Guaranteed Single Row */}
          <div className={`flex items-center justify-between px-3 py-2 rounded-xl mb-4 border ${isLightText ? 'bg-white/[0.03] border-white/10' : 'bg-black/[0.03] border-black/10'}`}>
            <span className={`text-[10px] font-bold uppercase tracking-wider shrink-0 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>
              Accepted
            </span>
            <div className="flex items-center gap-1.5 flex-nowrap shrink-0">
              {/* VISA */}
              <span className="h-5 px-1.5 rounded bg-[#1A1F71] border border-white/10 text-[9px] font-black tracking-widest text-white italic flex items-center select-none shadow-sm shrink-0">
                VISA
              </span>
              {/* Mastercard */}
              <span className="h-5 px-1.5 rounded bg-neutral-950 border border-white/10 flex items-center gap-0.5 select-none shadow-sm shrink-0">
                <span className="w-2 h-2 rounded-full bg-[#EB001B] inline-block" />
                <span className="w-2 h-2 rounded-full bg-[#F79E1B] -ml-1 inline-block mix-blend-screen" />
              </span>
              {/* Official Apple Pay Badge */}
              <span className="h-5 px-1.5 rounded bg-black border border-white/20 flex items-center gap-0.5 select-none shadow-sm shrink-0" title="Apple Pay">
                <svg className="w-2.5 h-2.5 fill-current text-white shrink-0 inline-block -mt-0.5" viewBox="0 0 24 24">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.32c.67-.82 1.12-1.96.99-3.1-.97.04-2.14.65-2.83 1.46-.62.72-1.16 1.88-1.01 3 .01 0 .03 0 .04 0 1.09 0 2.14-.54 2.81-1.36z" />
                </svg>
                <span className="text-[9.5px] font-bold tracking-tight text-white leading-none">Pay</span>
              </span>
              {/* Google Pay Badge */}
              <span className="h-5 px-1.5 rounded bg-neutral-900 border border-white/10 text-[9px] font-bold text-white flex items-center select-none shadow-sm shrink-0">
                <span className="text-blue-400">G</span><span className="text-red-400">P</span><span className="text-yellow-400">a</span><span className="text-green-400">y</span>
              </span>
              {/* ACH Bank Badge */}
              <span className="h-5 px-1.5 rounded bg-emerald-950/80 border border-emerald-500/30 text-[8.5px] font-bold text-emerald-300 flex items-center gap-1 select-none shadow-sm shrink-0" title="ACH Bank Transfer">
                <svg className="w-2.5 h-2.5 fill-current text-emerald-400 shrink-0" viewBox="0 0 24 24">
                  <path d="M2 10h20v2H2zm2-7h16l2 4H2zm3 9h2v7H7zm5 0h2v7h-2zm5 0h2v7h-2zm-13 8h16v2H4z" />
                </svg>
                <span>ACH</span>
              </span>
            </div>
          </div>

          {/* Form Header */}
          <div className="mb-3">
            <h3 className={`text-base font-bold tracking-tight mb-0.5 ${isLightText ? 'text-white' : 'text-black'}`}>
              {activeTier === "l0" ? "KYC & Compliance Verification" : "Identity Verification"}
            </h3>
            <p className={`text-xs font-medium mb-1 ${isLightText ? 'text-white/80' : 'text-black/80'}`}>
              {activeTier === "l0" 
                ? "Enter your full name and primary home address required for regulatory compliance."
                : "Stripe requires additional demographics to complete authorization."}
            </p>
          </div>

          <div className="space-y-3.5">
            {activeTier === "l0" ? (
              <>
                {/* L0 Name Fields */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>First Name</label>
                    <input
                      type="text"
                      placeholder="John"
                      className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                          ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                          : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                        }`}
                      value={kycFirstName}
                      onChange={(e) => setKycFirstName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Last Name</label>
                    <input
                      type="text"
                      placeholder="Smith"
                      className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                          ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                          : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                        }`}
                      value={kycLastName}
                      onChange={(e) => setKycLastName(e.target.value)}
                    />
                  </div>
                </div>

                {/* L0 Contact Fields */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Email Address</label>
                    <input
                      type="email"
                      name="email"
                      autoComplete="email"
                      placeholder="email@example.com"
                      className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                          ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                          : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                        }`}
                      value={shipEmail || headlessEmailInput}
                      onChange={(e) => {
                        setShipEmail(e.target.value);
                        setHeadlessEmailInput(e.target.value);
                      }}
                    />
                  </div>
                  <div>
                    <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Phone Number</label>
                    <input
                      type="tel"
                      autoComplete="tel"
                      placeholder="+15555555555"
                      className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                          ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                          : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                        }`}
                      value={headlessPhoneInput}
                      onChange={(e) => setHeadlessPhoneInput(e.target.value)}
                    />
                  </div>
                </div>

                {/* L0 Country Field */}
                <div>
                  <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Country</label>
                  <select
                    className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                        ? 'bg-white/5 border border-white/10 text-white focus:border-white/20 focus:bg-white/10 [&>option]:bg-neutral-900 [&>option]:text-white'
                        : 'bg-black/5 border border-black/10 text-black focus:border-black/20 focus:bg-black/10 [&>option]:bg-white [&>option]:text-black'
                      }`}
                    value={kycCountry}
                    onChange={(e) => setKycCountry(e.target.value)}
                  >
                    <option value="US">United States</option>
                    <option value="GB">United Kingdom</option>
                    <option value="DE">Germany</option>
                    <option value="FR">France</option>
                    <option value="ES">Spain</option>
                    <option value="IT">Italy</option>
                    <option value="NL">Netherlands</option>
                    <option value="IE">Ireland</option>
                  </select>
                </div>

                {/* L0 Address Fields */}
                {!isAddressVerified && !kycCity && !kycState ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Residential Address (from ID)</label>
                      <div className="relative" ref={addressDropdownRef}>
                        <input
                          type="text"
                          placeholder="Start typing your residential address (e.g. 123 Main St)..."
                          autoComplete="address-line1"
                          className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                              ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                              : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                            }`}
                          value={kycLine1}
                          onChange={(e) => {
                            setKycLine1(e.target.value);
                            setIsAddressVerified(false);
                          }}
                          onFocus={() => addressPredictions.length > 0 && setShowAddressDropdown(true)}
                        />

                        {/* Google Places Autocomplete Predictions Dropdown */}
                        {showAddressDropdown && addressPredictions.length > 0 && (
                          <div className={`absolute z-50 left-0 right-0 mt-1 rounded-xl shadow-2xl overflow-hidden border divide-y ${
                            isLightText
                              ? 'bg-neutral-900 border-white/15 divide-white/10 text-white'
                              : 'bg-white border-black/15 divide-black/10 text-black'
                          }`}>
                            {/* Header with Mobile Close Button */}
                            <div className={`px-3 py-1.5 flex items-center justify-between text-[10px] font-semibold tracking-wider uppercase border-b ${
                              isLightText ? 'bg-white/5 border-white/10 text-white/60' : 'bg-black/5 border-black/10 text-black/60'
                            }`}>
                              <span>Address Suggestions</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setShowAddressDropdown(false);
                                }}
                                className="px-2 py-0.5 rounded-md hover:bg-white/20 active:scale-95 transition flex items-center gap-1 text-[10px] font-bold text-gray-400 hover:text-white"
                              >
                                ✕ Close
                              </button>
                            </div>

                            {addressPredictions.map((p) => (
                              <button
                                key={p.placeId}
                                type="button"
                                onClick={() => handleSelectPrediction(p.placeId, p.description)}
                                className={`w-full text-left px-3 py-2.5 text-xs transition flex flex-col ${
                                  isLightText
                                    ? 'hover:bg-white/10 text-gray-200'
                                    : 'hover:bg-black/5 text-gray-800'
                                }`}
                              >
                                <span className="font-semibold">{p.mainText}</span>
                                {p.secondaryText && (
                                  <span className="text-[10px] opacity-60 mt-0.5">{p.secondaryText}</span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <p className={`text-[11px] font-medium flex items-center gap-1.5 ${isLightText ? 'text-amber-400/90' : 'text-amber-700'}`}>
                          <span>💡 Must match your legal residential address on your ID (no P.O. Boxes or work addresses).</span>
                        </p>
                        <button
                          type="button"
                          onClick={() => setIsAddressVerified(true)}
                          className={`text-[11px] font-semibold underline hover:opacity-80 transition whitespace-nowrap ml-2 ${isLightText ? 'text-indigo-300' : 'text-indigo-600'}`}
                        >
                          Enter manually
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 animate-in fade-in zoom-in-95 duration-200">
                    <div className="flex items-center justify-between mb-1">
                      <label className={`block text-[10.5px] font-bold uppercase tracking-wider ${isLightText ? 'text-emerald-400' : 'text-emerald-600'}`}>
                        ✓ Address Components Verified
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddressVerified(false);
                          setKycLine1("");
                          setKycCity("");
                          setKycState("");
                          setKycZip("");
                        }}
                        className={`text-[10.5px] font-semibold underline hover:opacity-80 transition ${isLightText ? 'text-white/60' : 'text-black/60'}`}
                      >
                        ✏️ Search different address
                      </button>
                    </div>

                    <div>
                      <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Street Address</label>
                      <input
                        type="text"
                        placeholder="123 Main St"
                        autoComplete="address-line1"
                        className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                            ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                            : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                          }`}
                        value={kycLine1}
                        onChange={(e) => setKycLine1(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Address Line 2 (Optional)</label>
                      <input
                        type="text"
                        placeholder="Apt, Suite, Unit"
                        autoComplete="address-line2"
                        className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                            ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                            : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                          }`}
                        value={kycLine2}
                        onChange={(e) => setKycLine2(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-5">
                        <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>City</label>
                        <input
                          type="text"
                          placeholder="Seattle"
                          autoComplete="address-level2"
                          className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                              ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                              : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                            }`}
                          value={kycCity}
                          onChange={(e) => setKycCity(e.target.value)}
                        />
                      </div>
                      <div className="col-span-4">
                        <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>State/Region</label>
                        <input
                          type="text"
                          placeholder="WA"
                          autoComplete="address-level1"
                          className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                              ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                              : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                            }`}
                          value={kycState}
                          onChange={(e) => setKycState(e.target.value)}
                        />
                      </div>
                      <div className="col-span-3">
                        <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Zip/Postal</label>
                        <input
                          type="text"
                          placeholder="98101"
                          autoComplete="postal-code"
                          className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                              ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                              : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                            }`}
                          value={kycZip}
                          onChange={(e) => setKycZip(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* L1 Form - Collapsible Address Accordion (Starts Collapsed) */}
                <details 
                  open={isAccordionOpen}
                  onToggle={(e) => setIsAccordionOpen((e.target as HTMLDetailsElement).open)}
                  className={`group rounded-xl border overflow-hidden transition-all duration-200 ${
                    isLightText ? 'border-white/10 bg-white/[0.02]' : 'border-black/10 bg-black/[0.02]'
                  }`}
                >
                  <summary className={`p-3 text-[11px] font-semibold cursor-pointer select-none flex items-center justify-between hover:bg-white/[0.04] active:bg-white/[0.06] transition-colors ${
                    isLightText ? 'text-white/80' : 'text-black/80'
                  }`}>
                    <div className="flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-emerald-400 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
                      </svg>
                      <span>Billing & Address details carried over</span>
                    </div>
                    <span className={`text-[10px] ${isLightText ? 'text-white/40' : 'text-black/40'} group-open:rotate-180 transition-transform duration-200`}>▼</span>
                  </summary>

                  <div className="p-3 border-t border-dashed space-y-3.5 bg-black/[0.04] border-white/5">
                    {/* Carried over Name Fields */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>Legal First Name</label>
                        <input
                          type="text"
                          placeholder="John"
                          className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                              ? 'bg-white/5 border border-white/10 text-white placeholder-white/40'
                              : 'bg-black/5 border border-black/10 text-black placeholder-black/40'
                            }`}
                          value={kycFirstName}
                          onChange={(e) => setKycFirstName(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>Legal Last Name</label>
                        <input
                          type="text"
                          placeholder="Smith"
                          className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                              ? 'bg-white/5 border border-white/10 text-white placeholder-white/40'
                              : 'bg-black/5 border border-black/10 text-black placeholder-black/40'
                            }`}
                          value={kycLastName}
                          onChange={(e) => setKycLastName(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Carried over Contact Fields (Email & Phone) */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>Email Address</label>
                        <input
                          type="email"
                          placeholder="email@example.com"
                          className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                              ? 'bg-white/5 border border-white/10 text-white placeholder-white/40'
                              : 'bg-black/5 border border-black/10 text-black placeholder-black/40'
                            }`}
                          value={shipEmail || headlessEmailInput}
                          onChange={(e) => {
                            setShipEmail(e.target.value);
                            setHeadlessEmailInput(e.target.value);
                          }}
                        />
                      </div>
                      <div>
                        <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>Phone Number</label>
                        <input
                          type="tel"
                          placeholder="+15555555555"
                          className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                              ? 'bg-white/5 border border-white/10 text-white placeholder-white/40'
                              : 'bg-black/5 border border-black/10 text-black placeholder-black/40'
                            }`}
                          value={headlessPhoneInput}
                          onChange={(e) => setHeadlessPhoneInput(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Country Field */}
                    <div>
                      <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>Country</label>
                      <select
                        className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                            ? 'bg-neutral-800 border border-white/10 text-white [&>option]:bg-neutral-900'
                            : 'bg-white border border-black/10 text-black [&>option]:bg-white'
                          }`}
                        value={kycCountry}
                        onChange={(e) => setKycCountry(e.target.value)}
                      >
                        <option value="US">United States</option>
                        <option value="CA">Canada</option>
                        <option value="GB">United Kingdom</option>
                      </select>
                    </div>

                    {/* Carried over Address Fields */}
                    <div className="space-y-2">
                      <div>
                        <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>Address Line 1</label>
                        <input
                          type="text"
                          placeholder="123 Main St"
                          className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                              ? 'bg-white/5 border border-white/10 text-white placeholder-white/40'
                              : 'bg-black/5 border border-black/10 text-black placeholder-black/40'
                            }`}
                          value={kycLine1}
                          onChange={(e) => setKycLine1(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>Address Line 2</label>
                        <input
                          type="text"
                          placeholder="Apt, Suite, Unit"
                          className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                              ? 'bg-white/5 border border-white/10 text-white placeholder-white/40'
                              : 'bg-black/5 border border-black/10 text-black placeholder-black/40'
                            }`}
                          value={kycLine2}
                          onChange={(e) => setKycLine2(e.target.value)}
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>City</label>
                          <input
                            type="text"
                            className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                                ? 'bg-white/5 border border-white/10 text-white placeholder-white/40'
                                : 'bg-black/5 border border-black/10 text-black placeholder-black/40'
                              }`}
                            value={kycCity}
                            onChange={(e) => setKycCity(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>State</label>
                          <input
                            type="text"
                            className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                                ? 'bg-white/5 border border-white/10 text-white placeholder-white/40'
                                : 'bg-black/5 border border-black/10 text-black placeholder-black/40'
                              }`}
                            value={kycState}
                            onChange={(e) => setKycState(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>Zip</label>
                          <input
                            type="text"
                            className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                                ? 'bg-white/5 border border-white/10 text-white placeholder-white/40'
                                : 'bg-black/5 border border-black/10 text-black placeholder-black/40'
                              }`}
                            value={kycZip}
                            onChange={(e) => setKycZip(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </details>

                {/* DOB Field with Interactive Calendar Picker */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={`block text-[10.5px] font-bold uppercase tracking-wider ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Date of Birth</label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          const input = e.currentTarget.nextElementSibling as HTMLInputElement;
                          if (input) {
                            try {
                              input.showPicker();
                            } catch {
                              input.focus();
                              input.click();
                            }
                          }
                        }}
                        className={`flex items-center gap-1 text-[10.5px] font-semibold transition-colors hover:underline cursor-pointer ${
                          isLightText ? 'text-indigo-400 hover:text-indigo-300' : 'text-indigo-600 hover:text-indigo-700'
                        }`}
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                        </svg>
                        <span>Select from calendar</span>
                      </button>
                      <input
                        type="date"
                        className="absolute top-0 right-0 opacity-0 w-0 h-0 pointer-events-none"
                        max={new Date().toISOString().split("T")[0]}
                        value={
                          kycDobYear && kycDobMonth && kycDobDay
                            ? `${kycDobYear}-${String(kycDobMonth).padStart(2, "0")}-${String(kycDobDay).padStart(2, "0")}`
                            : ""
                        }
                        onChange={(e) => {
                          if (e.target.value) {
                            const [y, m, d] = e.target.value.split("-");
                            setKycDobYear(y || "");
                            setKycDobMonth(m || "");
                            setKycDobDay(d || "");
                          }
                        }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="Month (MM)"
                        maxLength={2}
                        className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                            ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                            : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                          }`}
                        value={kycDobMonth}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          if (val === "" || (Number(val) <= 12)) setKycDobMonth(val);
                        }}
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="Day (DD)"
                        maxLength={2}
                        className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                            ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                            : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                          }`}
                        value={kycDobDay}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          if (val === "" || (Number(val) <= 31)) setKycDobDay(val);
                        }}
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="Year (YYYY)"
                        maxLength={4}
                        className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                            ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                            : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                          }`}
                        value={kycDobYear}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          const currentYear = new Date().getFullYear();
                          if (val === "" || (Number(val) <= currentYear)) setKycDobYear(val);
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Conditional KYC identification fields - EXACT FINCEN BANNER FROM PORTAL */}
                <div className={`p-4 sm:p-5 rounded-2xl border transition-all duration-200 relative overflow-hidden ${
                  isLightText 
                    ? 'bg-gradient-to-b from-amber-950/25 via-emerald-950/30 to-slate-950/90 border-amber-500/40 shadow-xl shadow-emerald-950/30' 
                    : 'bg-amber-50/50 border-2 border-amber-400/80 shadow-md shadow-amber-900/5'
                }`}>
                  {/* Top Security Banner Ribbon */}
                  <div className={`flex items-center justify-between gap-2 px-3.5 py-2 -mx-4 -mt-4 sm:-mx-5 sm:-mt-5 mb-3.5 border-b ${
                    isLightText 
                      ? 'bg-gradient-to-r from-amber-500/20 via-emerald-500/15 to-amber-500/20 border-amber-500/30' 
                      : 'bg-amber-100 border-amber-300/90'
                  }`}>
                    <div className="flex items-center gap-2">
                      <svg className={`w-3.5 h-3.5 shrink-0 ${isLightText ? 'text-amber-400' : 'text-amber-900'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      <span className={`text-[9.5px] uppercase tracking-wider ${
                        isLightText ? 'text-amber-300 font-black' : 'text-amber-950 font-extrabold'
                      }`}>
                        U.S. FINCEN & PATRIOT ACT CIP COMPLIANCE · CITATION 31 U.S.C. § 5318
                      </span>
                    </div>
                    <span className={`hidden sm:inline-block text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${
                      isLightText 
                        ? 'bg-amber-500/30 text-amber-300 border-amber-400/40' 
                        : 'bg-amber-200 text-amber-950 border-amber-400 font-extrabold'
                    }`}>
                      OFFICIAL
                    </span>
                  </div>

                  {/* Main Header with Seal & Title */}
                  <div className={`flex items-center justify-between gap-2 pb-3 mb-3 border-b ${
                    isLightText ? 'border-amber-500/20' : 'border-amber-200'
                  }`}>
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 shadow-sm ${
                        isLightText 
                          ? 'bg-gradient-to-br from-amber-500/20 to-emerald-500/20 border-amber-500/50' 
                          : 'bg-amber-100 border-amber-400/80'
                      }`}>
                        <svg className={`w-4.5 h-4.5 ${isLightText ? 'text-amber-400' : 'text-amber-800'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" />
                          <path strokeLinecap="round" strokeLinejoin="round" fill="currentColor" fillOpacity="0.25" d="M12 4.5L5 8.5v4.5c0 4.2 2.9 8.1 7 9.1 4.1-1 7-4.9 7-9.1V8.5l-7-4z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 0l-2-2m2 2l2-2m-4 4h4" />
                        </svg>
                      </div>

                      <div>
                        <h3 className={`text-xs font-black uppercase tracking-wider ${isLightText ? 'text-amber-300' : 'text-slate-900 font-extrabold'}`}>
                          Social Security Number (SSN)
                        </h3>
                        <p className={`text-[9.5px] font-bold ${isLightText ? 'text-emerald-300/90' : 'text-emerald-800'}`}>
                          Bank-Grade 256-Bit SSL Encrypted Verification
                        </p>
                      </div>
                    </div>

                    <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[9.5px] font-extrabold shrink-0 border ${
                      isLightText 
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                        : 'bg-emerald-100 border-emerald-400 text-emerald-900'
                    }`}>
                      <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      <span>Verified CIP</span>
                    </div>
                  </div>

                  <p className={`text-[10.5px] leading-relaxed mb-3.5 ${isLightText ? 'text-slate-300' : 'text-slate-800 font-medium'}`}>
                    Mandated by U.S. federal banking regulations. Encrypted directly with Stripe and <strong className={isLightText ? 'text-amber-200 font-bold' : 'text-slate-950 font-black'}>never stored on our servers</strong>.
                  </p>

                  {(() => {
                    const rawDigits = kycSsn.replace(/\D/g, "").slice(0, 9);
                    const totalDigits = rawDigits.length;

                    const getFormattedValue = () => {
                      if (!rawDigits) return "";
                      if (showSsn) {
                        if (rawDigits.length <= 3) return rawDigits;
                        if (rawDigits.length <= 5) return `${rawDigits.slice(0, 3)} - ${rawDigits.slice(3)}`;
                        return `${rawDigits.slice(0, 3)} - ${rawDigits.slice(3, 5)} - ${rawDigits.slice(5)}`;
                      } else {
                        if (rawDigits.length <= 3) return "•".repeat(rawDigits.length);
                        if (rawDigits.length <= 5) return `••• - ${"•".repeat(rawDigits.length - 3)}`;
                        const lastFour = rawDigits.slice(5);
                        return `••• - •• - ${lastFour}`;
                      }
                    };

                    return (
                      <div>
                        <div className="relative flex items-center w-full">
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="000 - 00 - 0000"
                            maxLength={14}
                            className={`w-full h-11 pl-10 pr-20 rounded-xl focus:outline-none transition-all text-xs font-mono font-bold tracking-widest ${
                              isLightText
                                ? 'bg-slate-950/80 border border-amber-500/30 text-amber-200 placeholder-amber-500/30 focus:border-amber-400 focus:bg-slate-950 focus:ring-1 focus:ring-amber-400/30'
                                : 'bg-white border-2 border-amber-300 text-slate-950 placeholder-slate-400 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30'
                            }`}
                            value={getFormattedValue()}
                            onChange={(e) => setKycSsn(e.target.value.replace(/\D/g, "").slice(0, 9))}
                          />
                          
                          <div className="absolute left-3 flex items-center pointer-events-none">
                            <svg className={`w-4 h-4 ${isLightText ? 'text-amber-400/70' : 'text-amber-800/70'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                          </div>

                          <button
                            type="button"
                            onClick={() => setShowSsn(!showSsn)}
                            className={`absolute right-2 px-2.5 py-1 rounded-lg text-[10.5px] font-bold transition-all ${
                              isLightText 
                                ? 'bg-white/10 hover:bg-white/20 text-amber-300 border border-amber-500/30' 
                                : 'bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300'
                            }`}
                          >
                            {showSsn ? "Hide" : "Show"}
                          </button>
                        </div>

                        <div className="mt-2.5 flex items-center justify-between px-1">
                          <span className={`text-[10px] font-semibold ${
                            totalDigits === 9 
                              ? 'text-emerald-400 font-bold flex items-center gap-1' 
                              : (isLightText ? 'text-slate-400' : 'text-slate-600')
                          }`}>
                            {totalDigits === 9 ? "✓ Full 9-Digit SSN Provided" : `${totalDigits} of 9 Digits Entered`}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </>
            )}
          </div>

          {/* Confirm Button */}
          <button
            className={`w-full mt-5 py-2.5 rounded-xl font-semibold transition-all text-xs hover:opacity-90 disabled:opacity-30 disabled:hover:opacity-30 shadow-md text-white`}
            style={{
              backgroundColor: primaryColor,
            }}
          >
            Confirm & Continue
          </button>

          {/* Compliance & Identity Disclosure Footer */}
          <p className={`mt-3 text-center text-[10.5px] leading-relaxed select-none ${isLightText ? 'text-white/60' : 'text-black/60'}`}>
            By continuing, you authorize <strong className={isLightText ? 'text-white/90' : 'text-black/90'}>BasaltSurge</strong> to perform identity verification and process payment authorizations in compliance with applicable KYC/AML financial regulations.
          </p>
          <div className={`mt-2 flex items-center justify-center gap-2.5 text-[9.5px] font-semibold uppercase tracking-wider ${isLightText ? 'text-white/40' : 'text-black/40'}`}>
            <span>🔒 256-Bit SSL Encrypted</span>
            <span>•</span>
            <span>🛡️ Bank-Grade Security</span>
            <span>•</span>
            <span>⚖️ Regulatory Compliant</span>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
