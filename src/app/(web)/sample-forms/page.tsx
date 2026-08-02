"use client";

import React, { useState } from "react";

export default function SampleFormsPage() {
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

      {/* Tier Switcher Tabs */}
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
          <span className="text-[10px] opacity-75 font-normal">Billing Info</span>
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

      {/* ─── EXACT PORTAL MODAL CARD CONTAINER ─── */}
      <div className={`w-full max-w-xl p-5 sm:p-7 rounded-3xl border shadow-2xl transition-all duration-300 ${
        isLightText 
          ? "bg-neutral-900/95 border-white/10 shadow-black/80" 
          : "bg-white border-black/10 shadow-black/10"
      }`}>
        
        <div className="w-full flex flex-col items-stretch justify-start animate-in zoom-in duration-300 text-left">
          {/* Form Header */}
          <div className="mb-3">
            <h3 className={`text-base font-bold tracking-tight mb-0.5 ${isLightText ? 'text-white' : 'text-black'}`}>
              {activeTier === "l0" ? "Billing Information" : "Identity Verification"}
            </h3>
            <p className={`text-xs ${isLightText ? 'text-white/60' : 'text-black/60'}`}>
              {activeTier === "l0" 
                ? "Stripe requires basic billing and contact information to authorize this transaction."
                : "Stripe requires additional demographics to complete authorization."}
            </p>
          </div>

          <div className="space-y-3.5">
            {activeTier === "l0" ? (
              <>
                {/* L0 Name Fields */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Legal First Name</label>
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
                    <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Legal Last Name</label>
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
                    <option value="CA">Canada</option>
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
                <div className="space-y-2">
                  <div className="relative">
                    <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Address Line 1</label>
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
          <p className={`mt-3 text-center text-[10.5px] leading-relaxed select-none ${isLightText ? 'text-white/50' : 'text-black/50'}`}>
            By continuing, you allow <strong className={isLightText ? 'text-white/80' : 'text-black/80'}>BasaltSurge</strong> to check your identity verification and manage your saved crypto wallets and buy/sell crypto on your behalf.
          </p>
        </div>
      </div>
    </div>
  );
}
