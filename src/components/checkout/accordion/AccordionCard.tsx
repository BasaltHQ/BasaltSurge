import React from "react";
import { AccordionCardProps } from "./types";

export function AccordionCard({
  isActive,
  isLightText = true,
  overflowVisible = false,
  className = "",
  children,
}: AccordionCardProps) {
  return (
    <div
      className={`rounded-2xl border transition-all duration-300 ease-out relative ${
        overflowVisible ? "z-40 overflow-visible" : "overflow-hidden"
      } ${
        isActive
          ? isLightText
            ? "border-amber-500/40 bg-white/[0.04] shadow-xl shadow-amber-500/[0.03] ring-1 ring-amber-500/20 backdrop-blur-md"
            : "border-amber-500/40 bg-black/[0.02] shadow-lg ring-1 ring-amber-500/20 backdrop-blur-md"
          : isLightText
          ? "border-white/10 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.03]"
          : "border-black/10 bg-black/[0.01] hover:border-black/15 hover:bg-black/[0.02]"
      } ${className}`}
    >
      {children}
    </div>
  );
}
