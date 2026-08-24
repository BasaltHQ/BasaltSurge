import React from "react";
import { ShieldCheck, Lock } from "lucide-react";
import { CheckoutHeaderProps } from "./types";

export function CheckoutHeader({
  brandName,
  isLightText = true,
}: CheckoutHeaderProps) {
  return (
    <>
      {/* Top Global Trust Header */}
      <div className="flex items-center justify-between px-1 pb-1 gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-amber-400 min-w-0">
          <ShieldCheck className="w-4.5 h-4.5 text-emerald-400 shrink-0" />
          <span className="text-xs sm:text-sm font-bold uppercase tracking-wider truncate">
            {brandName ? `${brandName} Secure Checkout` : "Secure Checkout"}
          </span>
        </div>
        <div className={`text-xs font-semibold flex items-center gap-1.5 shrink-0 ${isLightText ? "text-white/70" : "text-black/70"}`}>
          <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>256-Bit Encrypted</span>
        </div>
      </div>

      {/* Payment Methods Badges Bar */}
      <div className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border gap-2 flex-wrap ${isLightText ? "bg-white/[0.03] border-white/10" : "bg-black/[0.03] border-black/10"}`}>
        <span className={`text-xs font-bold uppercase tracking-wider shrink-0 ${isLightText ? "text-white/50" : "text-black/50"}`}>
          Accepted
        </span>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {/* VISA */}
          <span className="h-6 px-2 rounded bg-[#1A1F71] border border-white/10 text-[10px] font-black tracking-widest text-white italic flex items-center select-none shadow-sm shrink-0">
            VISA
          </span>
          {/* Mastercard */}
          <span className="h-6 px-2 rounded bg-neutral-950 border border-white/10 flex items-center gap-0.5 select-none shadow-sm shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-[#EB001B] inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#F79E1B] -ml-1 inline-block mix-blend-screen" />
          </span>
          {/* Official Apple Pay Badge */}
          <span className="h-6 px-2 rounded bg-black border border-white/20 flex items-center gap-0.5 select-none shadow-sm shrink-0" title="Apple Pay">
            <svg className="w-3 h-3 fill-current text-white shrink-0 inline-block -mt-0.5" viewBox="0 0 24 24">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.32c.67-.82 1.12-1.96.99-3.1-.97.04-2.14.65-2.83 1.46-.62.72-1.16 1.88-1.01 3 .01 0 .03 0 .04 0 1.09 0 2.14-.54 2.81-1.36z" />
            </svg>
            <span className="text-[10.5px] font-bold tracking-tight text-white leading-none">Pay</span>
          </span>
          {/* Google Pay Badge */}
          <span className="h-6 px-2 rounded bg-neutral-900 border border-white/10 text-[10px] font-bold text-white flex items-center select-none shadow-sm shrink-0">
            <span className="text-blue-400">G</span><span className="text-red-400">P</span><span className="text-yellow-400">a</span><span className="text-green-400">y</span>
          </span>
          {/* ACH Bank Badge */}
          <span className="h-6 px-2 rounded bg-emerald-950/80 border border-emerald-500/30 text-[9.5px] font-bold text-emerald-300 flex items-center gap-1 select-none shadow-sm shrink-0" title="ACH Bank Transfer">
            <svg className="w-3 h-3 fill-current text-emerald-400 shrink-0" viewBox="0 0 24 24">
              <path d="M2 10h20v2H2zm2-7h16l2 4H2zm3 9h2v7H7zm5 0h2v7h-2zm5 0h2v7h-2zm-13 8h16v2H4z" />
            </svg>
            <span>ACH</span>
          </span>
        </div>
      </div>
    </>
  );
}
