"use client";

import React from "react";
import { Check, Edit2 } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { AccordionStepHeaderProps } from "./types";

export function AccordionStepHeader({
  stepNumber,
  title,
  subtitle,
  badge,
  isActive,
  isCompleted,
  isLocked = false,
  isLightText = true,
  canEdit = true,
  onHeaderClick,
}: AccordionStepHeaderProps) {
  const isClickable = !isLocked && isCompleted && !isActive && canEdit;
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      layout="position"
      initial={false}
      whileTap={isClickable && !prefersReducedMotion ? { scale: 0.995 } : undefined}
      onClick={() => {
        if (isClickable) onHeaderClick?.();
      }}
      className={`p-3 sm:p-3.5 flex items-center justify-between gap-2 select-none min-w-0 transition-colors duration-200 ${
        isClickable ? "cursor-pointer hover:bg-white/[0.045]" : "cursor-default"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {isCompleted && !isActive ? (
          <motion.div
            layout
            initial={prefersReducedMotion ? false : { scale: 0.72, rotate: -12, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={prefersReducedMotion ? { duration: 0.01 } : { type: "spring", stiffness: 520, damping: 30 }}
            className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40 shrink-0 shadow-[0_0_12px_rgba(52,211,153,0.14)]"
          >
            <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
          </motion.div>
        ) : (
          <motion.div
            layout
            initial={false}
            animate={{ scale: isActive && !prefersReducedMotion ? 1.08 : 1 }}
            transition={prefersReducedMotion ? { duration: 0.01 } : { type: "spring", stiffness: 480, damping: 32 }}
            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold shrink-0 ${
              isActive
                ? "bg-amber-500 text-black shadow-[0_0_16px_rgba(245,158,11,0.28)]"
                : "bg-white/10 text-white/40"
            }`}
          >
            {stepNumber}
          </motion.div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <h4 className={`text-sm sm:text-base font-bold tracking-tight truncate ${isLightText ? "text-white" : "text-black"}`}>
              {title}
            </h4>
            {badge}
          </div>

          {subtitle}
        </div>
      </div>

      {isCompleted && !isActive && !isLocked && canEdit && (
        <motion.button
          type="button"
          whileHover={prefersReducedMotion ? undefined : { x: -2 }}
          whileTap={prefersReducedMotion ? undefined : { scale: 0.96 }}
          onClick={(e) => {
            e.stopPropagation();
            if (!isLocked) onHeaderClick?.();
          }}
          className="text-xs font-semibold text-amber-400 flex items-center gap-1 hover:underline cursor-pointer shrink-0 ml-1"
        >
          <Edit2 className="w-3 h-3" /> Edit
        </motion.button>
      )}
    </motion.div>
  );
}
