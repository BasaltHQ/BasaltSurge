"use client";

import React, { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { AccordionMotionPosition } from "./types";

interface AccordionContentProps {
  isOpen: boolean;
  position?: AccordionMotionPosition;
  overflowVisible?: boolean;
  children: React.ReactNode;
}

const PREMIUM_EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Animates accordion content without ever unmounting it. Keeping the subtree
 * alive is important for Stripe's embedded elements, which retain their own
 * DOM state while the customer moves between checkout steps.
 */
export function AccordionContent({
  isOpen,
  position = 0,
  overflowVisible = false,
  children,
}: AccordionContentProps) {
  const prefersReducedMotion = useReducedMotion();
  const [expansionComplete, setExpansionComplete] = useState(isOpen);
  const horizontalOffset = position < 0 ? -18 : 18;

  return (
    <motion.div
      initial={false}
      animate={{ height: isOpen ? "auto" : 0 }}
      transition={{
        duration: prefersReducedMotion ? 0.01 : isOpen ? 0.46 : 0.34,
        ease: PREMIUM_EASE,
      }}
      onAnimationStart={() => {
        if (!isOpen) setExpansionComplete(false);
      }}
      onAnimationComplete={() => setExpansionComplete(isOpen)}
      aria-hidden={!isOpen}
      className={
        overflowVisible && isOpen && expansionComplete
          ? "overflow-visible"
          : "overflow-hidden"
      }
      style={{
        pointerEvents: isOpen ? "auto" : "none",
        willChange: prefersReducedMotion ? undefined : "height",
      }}
    >
      <motion.div
        initial={false}
        animate={{
          opacity: isOpen ? 1 : 0,
          x: isOpen || prefersReducedMotion ? 0 : horizontalOffset,
          y: isOpen || prefersReducedMotion ? 0 : -6,
          filter: isOpen || prefersReducedMotion ? "blur(0px)" : "blur(3px)",
        }}
        transition={{
          duration: prefersReducedMotion ? 0.01 : isOpen ? 0.36 : 0.2,
          delay: prefersReducedMotion || !isOpen ? 0 : 0.07,
          ease: PREMIUM_EASE,
        }}
        inert={!isOpen}
        style={{
          transformOrigin: position < 0 ? "right top" : "left top",
          willChange: prefersReducedMotion ? undefined : "opacity, transform, filter",
        }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
