"use client";

import React, { useState, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { isCandidateSlug, isMainDomainHost } from "@/lib/routing";
import { Navbar } from "@/components/navbar";
import { LanguageSelectorBar } from "@/components/language-selector-bar";
import { TerminalViewBar } from "@/components/terminal-view-bar";

/**
 * Check if the current hostname is a custom domain (not a main platform domain).
 */
function isCustomDomainHostname(hostname: string): boolean {
  return !isMainDomainHost(hostname);
}

/**
 * HideableNavbar
 * - Hides the global Navbar on the /portal route so the payment portal
 *   opens in a clean window without the rest of the interface.
 * - Hides on custom domains (shop storefronts accessed via custom domain)
 * - Includes the LanguageSelectorBar below the navbar for language selection
 */
export function HideableNavbar({ isServerCustomDomain = false }: { isServerCustomDomain?: boolean }) {
  const pathname = usePathname() || "";
  const searchParams = useSearchParams();
  const [isCustomDomain, setIsCustomDomain] = useState(isServerCustomDomain);
  const [isMobile, setIsMobile] = useState(false);

  // Detect custom domain on client mount
  useEffect(() => {
    try {
      const hostname = window.location.hostname;
      setIsCustomDomain(isCustomDomainHostname(hostname));
    } catch {
      setIsCustomDomain(false);
    }
  }, []);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);
  const fsParam = String(searchParams?.get("fs") || searchParams?.get("fullscreen") || "").toLowerCase();
  const isFullscreen = fsParam === "1" || fsParam === "true";

  // Determine if navbar should be hidden
  const viewParam = String(searchParams?.get("view") || "").toLowerCase();
  const isTerminalView = viewParam === "terminal" || viewParam === "" || !viewParam;

  const shouldHideNavbar =
    isCustomDomain ||
    pathname === "/portal" || pathname.startsWith("/portal/") ||
    pathname.startsWith("/shop/") ||
    pathname.startsWith("/shopify/") || pathname === "/shopify" ||
    pathname === "/apply" || pathname.startsWith("/apply/") ||
    pathname === "/kiosk" || pathname.startsWith("/kiosk/") ||
    pathname === "/kitchen" || pathname.startsWith("/kitchen/") ||
    pathname === "/msa" || pathname === "/msas" || pathname === "/msa-isa" ||
    pathname.startsWith("/reader/") || pathname === "/reader" ||
    ((pathname === "/terminal" || pathname.startsWith("/terminal")) && isFullscreen) ||
    ((pathname === "/terminal" || pathname.startsWith("/terminal")) && isMobile && isTerminalView) ||
    pathname.match(/^\/terminal\/0x[a-fA-F0-9]{40}/) ||
    pathname === "/handheld" || pathname.startsWith("/handheld/") ||
    pathname.startsWith("/pms/") || // PMS fullscreen mode
    pathname === "/admin" || pathname.startsWith("/admin/") ||
    pathname === "/touchpoint" || pathname.startsWith("/touchpoint/") ||
    pathname === "/legacy" || pathname.startsWith("/legacy/") ||
    pathname === "/delivers" || pathname.startsWith("/delivers/") ||
    pathname === "/drive" || pathname.startsWith("/drive/") ||
    isCandidateSlug(pathname);

  // Apply body class for navbar padding
  useEffect(() => {
    if (!shouldHideNavbar) {
      document.body.classList.add("with-global-navbar");
    } else {
      document.body.classList.remove("with-global-navbar");
    }
    return () => {
      document.body.classList.remove("with-global-navbar");
    };
  }, [shouldHideNavbar]);

  if (shouldHideNavbar) {
    return null;
  }

  return (
    <div id="global-hideable-navbar" className="fixed top-0 left-0 right-0 z-[10001] flex flex-col">
      <Navbar />
      {!isMobile && !((pathname.startsWith("/pricing") || pathname.startsWith("/terminal")) && isMobile) ? <LanguageSelectorBar /> : null}
      {(pathname.startsWith("/pricing") || pathname.startsWith("/terminal")) && !isMobile ? <TerminalViewBar /> : null}
    </div>
  );
}
