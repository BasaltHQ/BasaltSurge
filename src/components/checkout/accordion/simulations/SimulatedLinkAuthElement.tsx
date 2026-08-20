"use client";

import React, { useState, useEffect, useRef } from "react";
import { Lock, Check, RefreshCw, Sparkles, CheckCircle2, ShieldCheck } from "lucide-react";

export interface SimulatedLinkAuthElementProps {
  email?: string;
  phone?: string;
  isLightText?: boolean;
  primaryColor?: string;
  onSuccess: () => void;
  onCancel?: () => void;
}

export function SimulatedLinkAuthElement({
  email = "customer@example.com",
  phone = "+1 (555) 019-2834",
  isLightText = true,
  primaryColor = "#635BFF",
  onSuccess,
}: SimulatedLinkAuthElementProps) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [countdown, setCountdown] = useState(45);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    // Focus first input on mount
    inputsRef.current[0]?.focus();
  }, []);

  // Countdown for Resend code
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleChange = (index: number, val: string) => {
    const clean = val.replace(/\D/g, "");
    if (!clean) {
      const newDigits = [...digits];
      newDigits[index] = "";
      setDigits(newDigits);
      return;
    }

    const newDigits = [...digits];
    // Handle single digit input
    newDigits[index] = clean.slice(-1);
    setDigits(newDigits);

    // Auto-advance to next input
    if (index < 5) {
      inputsRef.current[index + 1]?.focus();
    }

    // If all 6 digits filled, trigger verification
    const fullCode = newDigits.join("");
    if (fullCode.length === 6 && !newDigits.includes("")) {
      triggerVerification(fullCode);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    } else if (e.key === "ArrowLeft" && index > 0) {
      inputsRef.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const paste = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!paste) return;

    const newDigits = [...digits];
    for (let i = 0; i < 6; i++) {
      newDigits[i] = paste[i] || "";
    }
    setDigits(newDigits);

    const nextIndex = Math.min(paste.length, 5);
    inputsRef.current[nextIndex]?.focus();

    if (paste.length === 6) {
      triggerVerification(paste);
    }
  };

  const triggerVerification = (code: string) => {
    setIsVerifying(true);
    setTimeout(() => {
      setIsVerifying(false);
      setIsSuccess(true);
      setTimeout(() => {
        onSuccess();
      }, 700);
    }, 900);
  };

  const handleQuickFill = () => {
    const testCode = ["1", "2", "3", "4", "5", "6"];
    setDigits(testCode);
    triggerVerification("123456");
  };

  const maskedPhone = phone ? phone.replace(/(\+\d{1,2}\s?|\(\d{3}\)\s?)(\d{3})/, "$1•••") : "•••-2834";

  return (
    <div
      className={`p-4 rounded-2xl border transition-all duration-300 ${
        isLightText
          ? "bg-[#0c0d14] border-amber-500/30 text-white shadow-2xl"
          : "bg-white border-amber-500/40 text-black shadow-lg"
      }`}
    >
      {/* Link Header with Official Badge */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
        <div className="flex items-center gap-2">
          {/* Stripe Link Emblem */}
          <div className="h-6 px-2 rounded-lg bg-[#00D66F] text-black font-black text-[11px] tracking-tight flex items-center gap-1 shadow-sm">
            <span>link</span>
            <span className="w-1.5 h-1.5 rounded-full bg-black inline-block" />
          </div>
          <span className="text-xs font-bold text-amber-400 flex items-center gap-1">
            <Lock className="w-3 h-3" /> Security Code
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Verified Stripe Partner</span>
        </div>
      </div>

      {/* Prompt Explanation */}
      <div className="space-y-1 text-left mb-3.5">
        <p className={`text-xs font-medium ${isLightText ? "text-white/90" : "text-black/90"}`}>
          Enter the 6-digit verification code sent to your mobile:
        </p>
        <p className="text-[11px] font-mono text-amber-300 flex items-center gap-1">
          <span>{maskedPhone}</span>
          <span className="opacity-60 font-sans font-normal">({email})</span>
        </p>
      </div>

      {/* 6 Digit Boxes */}
      <div className="flex items-center justify-between gap-1.5 sm:gap-2 my-3" onPaste={handlePaste}>
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => {
              inputsRef.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={digit}
            disabled={isVerifying || isSuccess}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className={`w-10 h-12 sm:w-11 sm:h-13 text-center text-lg font-mono font-bold rounded-xl border transition-all focus:outline-none select-all ${
              isSuccess
                ? "bg-emerald-500/20 border-emerald-500 text-emerald-400 shadow-emerald-500/20"
                : isVerifying
                ? "bg-amber-500/10 border-amber-400 text-amber-400 animate-pulse"
                : digit
                ? isLightText
                  ? "bg-white/10 border-amber-400/80 text-white shadow-sm ring-1 ring-amber-400/30"
                  : "bg-black/5 border-amber-500 text-black shadow-sm ring-1 ring-amber-500/20"
                : isLightText
                ? "bg-white/5 border-white/15 text-white focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30"
                : "bg-black/5 border-black/15 text-black focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30"
            }`}
          />
        ))}
      </div>

      {/* Status / Feedback State */}
      {isSuccess ? (
        <div className="py-2 flex items-center justify-center gap-2 text-xs font-bold text-emerald-400 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 animate-bounce" />
          <span>Link Account Verified! Advancing...</span>
        </div>
      ) : isVerifying ? (
        <div className="py-2 flex items-center justify-center gap-2 text-xs font-bold text-amber-400 animate-pulse">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span>Verifying security token with Stripe Link...</span>
        </div>
      ) : (
        <div className="flex items-center justify-between pt-2 border-t border-white/10 text-[11px]">
          {/* Resend Code Button */}
          <button
            type="button"
            disabled={countdown > 0}
            onClick={() => {
              setCountdown(45);
              setDigits(["", "", "", "", "", ""]);
              inputsRef.current[0]?.focus();
            }}
            className={`font-semibold transition cursor-pointer ${
              countdown > 0
                ? "opacity-50 cursor-not-allowed text-zinc-400"
                : "text-amber-400 hover:underline"
            }`}
          >
            {countdown > 0 ? `Resend Code in ${countdown}s` : "Resend Code"}
          </button>

          {/* Sandbox Quick Fill Action */}
          <button
            type="button"
            onClick={handleQuickFill}
            className="px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold flex items-center gap-1 transition cursor-pointer border border-amber-500/30 shadow-sm"
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>Fill Code (123456)</span>
          </button>
        </div>
      )}
    </div>
  );
}
