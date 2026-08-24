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
      className={`rounded-2xl border transition-all duration-300 relative ${
        overflowVisible ? "z-40 overflow-visible" : "overflow-hidden"
      } ${
        isActive
          ? isLightText
            ? "border-amber-500/40 bg-white/[0.04] shadow-xl"
            : "border-amber-500/40 bg-black/[0.01] shadow-md"
          : isLightText
          ? "border-white/10 bg-white/[0.02]"
          : "border-black/10 bg-black/[0.01]"
      } ${className}`}
    >
      {children}
    </div>
  );
}
