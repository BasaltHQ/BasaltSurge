"use client";

import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AccordionCardProps } from "./types";

export function AccordionCard({
  isActive,
  isLightText = true,
  overflowVisible = false,
  className = "",
  children,
}: AccordionCardProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      layout="position"
      initial={false}
      animate={
        prefersReducedMotion
          ? { y: 0, scale: 1 }
          : { y: isActive ? -1 : 0, scale: isActive ? 1 : 0.997 }
      }
      transition={{
        layout: prefersReducedMotion
          ? { duration: 0.01 }
          : { type: "spring", stiffness: 430, damping: 40, mass: 0.82 },
        y: { duration: prefersReducedMotion ? 0.01 : 0.24 },
        scale: { duration: prefersReducedMotion ? 0.01 : 0.24 },
      }}
      data-state={isActive ? "active" : "collapsed"}
      className={`rounded-2xl border transition-[border-color,background-color,box-shadow] duration-300 ease-out relative ${
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
      <motion.div
        aria-hidden="true"
        initial={false}
        animate={{
          opacity: isActive ? 1 : 0,
          scaleY: isActive ? 1 : 0.35,
        }}
        transition={{
          duration: prefersReducedMotion ? 0.01 : 0.28,
          ease: [0.22, 1, 0.36, 1],
        }}
        className="pointer-events-none absolute inset-y-4 left-0 z-10 w-[2px] origin-center rounded-r-full bg-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.55)]"
      />
      {children}
    </motion.div>
  );
}
