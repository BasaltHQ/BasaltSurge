"use client";

import React, { useState, useEffect } from "react";
import { darkTheme } from "thirdweb/react";

/**
 * Read a CSS variable from :root with a fallback if not present.
 */
function getCssVar(name: string, fallback: string): string {
  try {
    const root = document.documentElement;
    const val = getComputedStyle(root).getPropertyValue(name).trim();
    return val || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Unified Thirdweb dark theme derived from PortalPay CSS variables.
 * Ensures ConnectButton / modal uses the app's configured palette.
 */
export function getPortalThirdwebTheme() {
  const primary = getCssVar("--pp-primary", "#0f172a");
  const secondary = getCssVar("--pp-secondary", "#F54029");
  // Force all modal text to render white regardless of site CSS variables.
  const whiteText = "#ffffff";
  const primaryText = whiteText;
  const secondaryText = whiteText;
  const headerText = whiteText;

  return darkTheme({
    colors: {
      // Blurred glass aesthetic (aligns with .glass-float palette in globals.css)
      modalBg: "hsl(220 18% 7% / 0.86)",
      borderColor: secondary, // Use secondary for merchant highlights
      primaryText,
      secondaryText,
      // Ensure any "accent" text also renders white per requirement
      accentText: whiteText,
      accentButtonBg: secondary,
      accentButtonText: headerText,
      primaryButtonBg: secondary,
      primaryButtonText: headerText,
      connectedButtonBg: "rgba(255,255,255,0.04)",
      connectedButtonBgHover: "rgba(255,255,255,0.08)",
      // Overlay tint for backdrop
      modalOverlayBg: "hsl(220 18% 5% / 0.40)",
    },
  });
}

/**
 * React hook that returns a reactive Thirdweb theme that updates when CSS variables change.
 * Subscribes to pp:theme:ready and pp:theme:updated events to recompute the theme.
 */
export function usePortalThirdwebTheme() {
  const [theme, setTheme] = useState(getPortalThirdwebTheme());

  useEffect(() => {
    const handler = () => setTheme(getPortalThirdwebTheme());
    window.addEventListener("pp:theme:ready", handler as any);
    window.addEventListener("pp:theme:updated", handler as any);
    return () => {
      window.removeEventListener("pp:theme:ready", handler as any);
      window.removeEventListener("pp:theme:updated", handler as any);
    };
  }, []);

  return theme;
}

/**
 * Consistent inline styles for ConnectButton + SignInButton derived from CSS vars.
 * Returns SSR-safe defaults during server render, actual brand colors on client.
 * Text color is always white per design requirement.
 */
export function getConnectButtonStyle(): React.CSSProperties {
  // During SSR, return minimal safe defaults to avoid hydration mismatch
  if (typeof window === 'undefined') {
    return {
      backgroundColor: "transparent",
      border: "1px solid transparent",
      color: "#ffffff",
      padding: "6px 10px",
      lineHeight: "1",
      height: "28px",
      borderRadius: "8px",
      backdropFilter: "blur(6px) saturate(1.08)",
      WebkitBackdropFilter: "blur(6px) saturate(1.08)",
      transition: "border-color .2s ease, background-color .2s ease, box-shadow .2s ease",
    };
  }

  // Client-side: read actual CSS variable values
  // Text color is always white regardless of brand theme
  const secondary = getCssVar("--pp-secondary", "#F54029");
  return {
    backgroundColor: "transparent",
    border: `1px solid ${secondary}`,
    color: "#ffffff",
    padding: "6px 10px",
    lineHeight: "1",
    height: "28px",
    borderRadius: "8px",
    backdropFilter: "blur(6px) saturate(1.08)",
    WebkitBackdropFilter: "blur(6px) saturate(1.08)",
    transition: "border-color .2s ease, background-color .2s ease, box-shadow .2s ease",
  };
}

/**
 * Consistent className for ConnectButton + SignInButton.
 * Note: removed plain "border" utility to avoid neutral border colors; explicit border set via inline styles.
 */
export const connectButtonClass =
  "px-3 py-1.5 rounded-md microtext hover:bg-foreground/5 focus:outline-none transition-all hover:ring-1 hover:ring-[var(--pp-secondary)] focus:ring-2 focus:ring-[var(--pp-secondary)]";
