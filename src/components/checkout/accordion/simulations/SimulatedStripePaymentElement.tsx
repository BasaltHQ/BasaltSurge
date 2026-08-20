"use client";

import React, { useState } from "react";
import {
  CreditCard,
  Building2,
  Lock,
  Loader2,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

export interface SimulatedStripePaymentElementProps {
  amountUsd?: number;
  isLightText?: boolean;
  primaryColor?: string;
  simulatedError?: string;
  onSuccess: (paymentDetails: {
    funding: string;
    brand?: string;
    last4?: string;
    token: string;
  }) => void;
  onError: (errorMessage: string) => void;
}

export function SimulatedStripePaymentElement({
  amountUsd = 25.0,
  isLightText = true,
  primaryColor = "#635BFF",
  simulatedError = "none",
  onSuccess,
  onError,
}: SimulatedStripePaymentElementProps) {
  const [paymentTab, setPaymentTab] = useState<"card" | "wallet" | "bank">("card");
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [expiry, setExpiry] = useState("12/28");
  const [cvc, setCvc] = useState("123");
  const [zip, setZip] = useState("90210");
  const [isProcessing, setIsProcessing] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  // Detect card brand
  const cleanCard = cardNumber.replace(/\s/g, "");
  const detectedBrand = cleanCard.startsWith("4")
    ? "Visa"
    : cleanCard.startsWith("5")
    ? "Mastercard"
    : cleanCard.startsWith("3")
    ? "Amex"
    : cleanCard.startsWith("6")
    ? "Discover"
    : "Card";

  const handleCardInput = (val: string) => {
    const raw = val.replace(/\D/g, "").slice(0, 16);
    const parts = raw.match(/[\s\S]{1,4}/g) || [];
    setCardNumber(parts.join(" "));
  };

  const handleExpiryInput = (val: string) => {
    let clean = val.replace(/\D/g, "").slice(0, 4);
    if (clean.length > 2) {
      clean = `${clean.slice(0, 2)}/${clean.slice(2)}`;
    }
    setExpiry(clean);
  };

  const handleFillCard = (type: "success" | "declined" | "insufficient" | "address") => {
    setLocalErr(null);
    if (type === "success") {
      setCardNumber("4242 4242 4242 4242");
      setExpiry("12/28");
      setCvc("123");
      setZip("90210");
    } else if (type === "declined") {
      setCardNumber("4000 0000 0000 0002");
      setExpiry("10/27");
      setCvc("999");
      setZip("10001");
    } else if (type === "insufficient") {
      setCardNumber("5100 0000 0000 9999");
      setExpiry("08/29");
      setCvc("456");
      setZip("94105");
    } else if (type === "address") {
      setCardNumber("4000 0000 0000 0119");
      setExpiry("11/27");
      setCvc("777");
      setZip("10001");
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLocalErr(null);
    setIsProcessing(true);

    setTimeout(() => {
      setIsProcessing(false);

      // Check card number or injected error
      const cleanNum = cardNumber.replace(/\s/g, "");
      if (simulatedError === "payment_decline" || cleanNum.endsWith("0002")) {
        const msg = "Your card was declined by your issuing bank (do_not_honor). Please contact your bank or use another card.";
        setLocalErr(msg);
        onError(msg);
        return;
      }

      if (simulatedError === "insufficient_funds" || cleanNum.endsWith("9999")) {
        const msg = "Payment failed due to insufficient funds on this card. Please try another card or bank account.";
        setLocalErr(msg);
        onError(msg);
        return;
      }

      if (cleanNum.endsWith("0119")) {
        const msg = "Instant card checkout is currently unavailable for this residential address due to regional banking regulations.";
        setLocalErr(msg);
        onError(msg);
        return;
      }

      // Success Path
      if (paymentTab === "card") {
        onSuccess({
          funding: "card",
          brand: detectedBrand,
          last4: cleanNum.slice(-4) || "4242",
          token: `cpt_sim_${Date.now()}`,
        });
      } else if (paymentTab === "wallet") {
        onSuccess({
          funding: "apple_pay",
          brand: "Apple Pay",
          last4: "8821",
          token: `cpt_sim_wallet_${Date.now()}`,
        });
      } else if (paymentTab === "bank") {
        onSuccess({
          funding: "us_bank_account",
          brand: "Chase Bank",
          last4: "9102",
          token: `cpt_sim_ach_${Date.now()}`,
        });
      }
    }, 1400);
  };

  return (
    <div
      className={`p-4 rounded-2xl border transition-all duration-300 ${
        isLightText
          ? "bg-[#0b0c14] border-white/15 text-white shadow-2xl"
          : "bg-white border-black/15 text-black shadow-xl"
      }`}
    >
      {/* Stripe Header with Official Brand & Security Badge */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
        <div className="flex items-center gap-2">
          {/* Stripe Badge */}
          <div className="h-6 px-2.5 rounded-lg bg-[#635BFF] text-white font-black text-[11px] tracking-tight flex items-center shadow-sm">
            <span>stripe</span>
          </div>
          <span className="text-xs font-bold text-amber-400 flex items-center gap-1">
            <Lock className="w-3 h-3 text-emerald-400" /> Embedded Payment Element
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>PCI-DSS Level 1 Encrypted</span>
        </div>
      </div>

      {/* Payment Method Switcher Tabs */}
      <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-black/30 border border-white/10 mb-3.5">
        <button
          type="button"
          onClick={() => setPaymentTab("card")}
          className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            paymentTab === "card"
              ? "bg-[#635BFF] text-white shadow-md"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          <CreditCard className="w-3.5 h-3.5" />
          <span>Card</span>
        </button>

        <button
          type="button"
          onClick={() => setPaymentTab("wallet")}
          className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            paymentTab === "wallet"
              ? "bg-[#635BFF] text-white shadow-md"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          <span className="text-[11px]"> Pay / GPay</span>
        </button>

        <button
          type="button"
          onClick={() => setPaymentTab("bank")}
          className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            paymentTab === "bank"
              ? "bg-[#635BFF] text-white shadow-md"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          <Building2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>US Bank</span>
        </button>
      </div>

      {/* Local Error Alert Banner */}
      {localErr && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-start gap-2.5 animate-in fade-in duration-200 mb-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-0.5 text-left">
            <div className="font-bold text-white">Payment Declined:</div>
            <p className="text-[11px] leading-relaxed text-red-300">{localErr}</p>
          </div>
        </div>
      )}

      {/* TAB 1: CARD FORM */}
      {paymentTab === "card" && (
        <form onSubmit={handleSubmit} className="space-y-3 text-left">
          {/* Card Number Input */}
          <div>
            <label className={`flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
              <span>Card Number</span>
              <span className="text-emerald-400 font-bold text-[10px]">{detectedBrand}</span>
            </label>
            <div className="relative">
              <input
                type="text"
                required
                value={cardNumber}
                onChange={(e) => handleCardInput(e.target.value)}
                placeholder="4242 4242 4242 4242"
                className={`w-full h-10 px-3 pl-9 rounded-xl focus:outline-none text-xs font-mono font-medium transition-all ${
                  isLightText
                    ? "bg-white/5 border border-white/15 text-white placeholder-white/30 focus:border-amber-400 focus:ring-1 focus:ring-amber-400/30"
                    : "bg-black/5 border border-black/15 text-black placeholder-black/30 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30"
                }`}
              />
              <CreditCard className="w-4 h-4 absolute left-3 top-3 opacity-50 text-amber-400" />
            </div>
          </div>

          {/* Expiry, CVC & ZIP */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                MM / YY
              </label>
              <input
                type="text"
                required
                maxLength={5}
                value={expiry}
                onChange={(e) => handleExpiryInput(e.target.value)}
                placeholder="MM/YY"
                className={`w-full h-10 px-2.5 text-center rounded-xl focus:outline-none text-xs font-mono font-medium transition-all ${
                  isLightText
                    ? "bg-white/5 border border-white/15 text-white placeholder-white/30 focus:border-amber-400"
                    : "bg-black/5 border border-black/15 text-black placeholder-black/30 focus:border-amber-500"
                }`}
              />
            </div>

            <div>
              <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                CVC
              </label>
              <input
                type="text"
                required
                maxLength={4}
                value={cvc}
                onChange={(e) => setCvc(e.target.value.replace(/\D/g, ""))}
                placeholder="123"
                className={`w-full h-10 px-2.5 text-center rounded-xl focus:outline-none text-xs font-mono font-medium transition-all ${
                  isLightText
                    ? "bg-white/5 border border-white/15 text-white placeholder-white/30 focus:border-amber-400"
                    : "bg-black/5 border border-black/15 text-black placeholder-black/30 focus:border-amber-500"
                }`}
              />
            </div>

            <div>
              <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                ZIP Code
              </label>
              <input
                type="text"
                required
                maxLength={10}
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder="90210"
                className={`w-full h-10 px-2.5 text-center rounded-xl focus:outline-none text-xs font-mono font-medium transition-all ${
                  isLightText
                    ? "bg-white/5 border border-white/15 text-white placeholder-white/30 focus:border-amber-400"
                    : "bg-black/5 border border-black/15 text-black placeholder-black/30 focus:border-amber-500"
                }`}
              />
            </div>
          </div>

          {/* Quick Test Cards Presets Bar */}
          <div className="pt-2 border-t border-white/10 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
              <span>Sandbox Quick Test Cards:</span>
              <Sparkles className="w-3 h-3 text-amber-400" />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => handleFillCard("success")}
                className="px-2 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 font-mono text-[10px] font-bold border border-emerald-500/30 transition cursor-pointer"
              >
                ✓ 4242 (Success)
              </button>
              <button
                type="button"
                onClick={() => handleFillCard("declined")}
                className="px-2 py-1 rounded-md bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 font-mono text-[10px] font-bold border border-rose-500/30 transition cursor-pointer"
              >
                ✕ 4002 (Decline)
              </button>
              <button
                type="button"
                onClick={() => handleFillCard("insufficient")}
                className="px-2 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 font-mono text-[10px] font-bold border border-amber-500/30 transition cursor-pointer"
              >
                ⚠ 5100 (No Funds)
              </button>
              <button
                type="button"
                onClick={() => handleFillCard("address")}
                className="px-2 py-1 rounded-md bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 font-mono text-[10px] font-bold border border-purple-500/30 transition cursor-pointer"
              >
                ⚑ 0119 (NY/HI Block)
              </button>
            </div>
          </div>

          {/* Pay Button */}
          <button
            type="submit"
            disabled={isProcessing || !cardNumber || !expiry || !cvc || !zip}
            className="w-full h-11 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-lg mt-3 text-white cursor-pointer hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: primaryColor }}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Authorizing ${amountUsd.toFixed(2)} with Stripe...</span>
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5" />
                <span>Pay ${amountUsd.toFixed(2)} USD</span>
              </>
            )}
          </button>
        </form>
      )}

      {/* TAB 2: WALLET (APPLE / GOOGLE PAY) */}
      {paymentTab === "wallet" && (
        <div className="space-y-3 py-2 text-center">
          <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
            <div className="text-xs font-bold text-amber-400">1-Click Express Checkout</div>
            <p className="text-[11px] opacity-75">
              Simulate authorizing your payment directly with Touch ID, Face ID, or Google Pay.
            </p>
          </div>

          <button
            type="button"
            disabled={isProcessing}
            onClick={() => handleSubmit()}
            className="w-full h-12 rounded-xl font-bold text-xs bg-black text-white border border-white/20 hover:bg-neutral-900 transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer active:scale-95"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Authorizing Apple Pay...</span>
              </>
            ) : (
              <>
                <span className="text-sm">Pay</span>
                <span>Pay ${amountUsd.toFixed(2)}</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* TAB 3: US BANK (ACH) */}
      {paymentTab === "bank" && (
        <div className="space-y-3 py-2 text-left">
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-1.5 text-xs text-emerald-300">
            <div className="font-bold flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-emerald-400" />
              <span>Simulated Instant Bank Verification (Plaid / Financial Connections)</span>
            </div>
            <p className="text-[11px] text-emerald-300/80 leading-relaxed">
              Linked Account: <strong>Chase Bank •••• 9102 (Checking)</strong>
            </p>
          </div>

          <button
            type="button"
            disabled={isProcessing}
            onClick={() => handleSubmit()}
            className="w-full h-11 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer active:scale-95"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Authorizing ACH Debit...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Authorize ACH Debit (${amountUsd.toFixed(2)} USD)</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
