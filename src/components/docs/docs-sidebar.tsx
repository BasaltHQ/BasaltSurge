'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ChevronDown, ChevronRight, BookOpen, Code, Zap, FileText, PanelLeftClose, PanelLeft } from 'lucide-react';
import { Tooltip } from './tooltip';
import { useBrand } from "@/contexts/BrandContext";
import { useTheme } from "@/contexts/ThemeContext";
import { docsNavigation } from './docs-nav';
import { cachedFetch } from "@/lib/client-api-cache";
import { resolveBrandAppLogo } from "@/lib/branding";
import { useDocsSidebar } from "@/contexts/DocsSidebarContext";

interface NavItem {
  title: string;
  href?: string;
  icon?: React.ReactNode;
  items?: { title: string; href: string }[];
}

// Map section titles to icons
const sectionIcons: Record<string, React.ReactNode> = {
  'Getting Started': <BookOpen className="w-4 h-4" />,
  'API Reference': <Code className="w-4 h-4" />,
  'Integration Guides': <Zap className="w-4 h-4" />,
  'Merchant Manual': <BookOpen className="w-4 h-4" />,
  'Partner Manual': <Code className="w-4 h-4" />,
  'Resources': <FileText className="w-4 h-4" />,
};

// Transform centralized navigation to include icons
const navigation: NavItem[] = docsNavigation.map(section => ({
  title: section.title,
  icon: sectionIcons[section.title],
  items: section.items,
}));

function NavGroup({ item, currentPath }: { item: NavItem; currentPath: string }) {
  const [isOpen, setIsOpen] = useState(() => {
    // Auto-open if any child is active
    if (item.items) {
      return item.items.some(child => currentPath === child.href);
    }
    return false;
  });

  const hasChildren = item.items && item.items.length > 0;

  if (!hasChildren && item.href) {
    return (
      <Link
        href={item.href}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap ${currentPath === item.href
          ? 'bg-primary text-primary-foreground font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
      >
        {item.icon}
        <span>{item.title}</span>
      </Link>
    );
  }

  return (
    <>
      {/* Desktop: vertical collapsible */}
      <div className="hidden md:block space-y-1">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-foreground hover:bg-muted rounded-lg transition-colors"
        >
          {item.icon}
          <span className="flex-1 text-left">{item.title}</span>
          {hasChildren && (
            isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
          )}
        </button>
        {isOpen && hasChildren && (
          <div className="ml-6 space-y-1 border-l border-border pl-3">
            {item.items!.map((child) => (
              <Link
                key={child.href}
                href={child.href!}
                className={`block px-3 py-2 text-sm rounded-lg transition-colors ${currentPath === child.href
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
              >
                {child.title}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Mobile: horizontal flat list */}
      {hasChildren && item.items!.map((child) => (
        <Link
          key={child.href}
          href={child.href!}
          className={`md:hidden flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap ${currentPath === child.href
            ? 'bg-primary text-primary-foreground font-medium'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
        >
          <span>{child.title}</span>
        </Link>
      ))}
    </>
  );
}

export function DocsSidebar({ currentPath }: { currentPath: string }) {
  const { isCollapsed, setIsCollapsed } = useDocsSidebar();
  const brand = useBrand();
  const { theme } = useTheme();
  const [containerBrandKey, setContainerBrandKey] = useState<string>("");
  const [containerType, setContainerType] = useState<string>("");
  // Partner brand assets (fetched when container is partner type)
  const [partnerLogoSymbol, setPartnerLogoSymbol] = useState<string>("");
  const [partnerLogoFavicon, setPartnerLogoFavicon] = useState<string>("");
  const [partnerLogoApp, setPartnerLogoApp] = useState<string>("");
  const [partnerBrandName, setPartnerBrandName] = useState<string>("");
  const [isPartnerBrandLoading, setIsPartnerBrandLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    cachedFetch("/api/site/container", { cache: "no-store" })
      .then((ci: any) => {
        if (cancelled) return;
        const bk = String(ci?.brandKey || "").trim();
        const ct = String(ci?.containerType || "").trim();
        setContainerBrandKey(bk);
        setContainerType(ct);
        // If not a partner container, stop loading state immediately
        if (ct.toLowerCase() !== "partner" || !bk) {
          setIsPartnerBrandLoading(false);
        }
      })
      .catch(() => {
        setIsPartnerBrandLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Fetch partner brand configuration when in a partner container
  useEffect(() => {
    if (containerType.toLowerCase() !== "partner" || !containerBrandKey) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/platform/brands/${encodeURIComponent(containerBrandKey)}/config`, { cache: "no-store" });
        if (!res.ok || cancelled) {
          if (!cancelled) setIsPartnerBrandLoading(false);
          return;
        }
        const data = await res.json();
        // API returns { brandKey, brand: { logos, ... }, overrides }
        const cfg = data?.brand || data?.config || data || {};
        const logos = cfg?.logos || data?.overrides?.logos || cfg?.theme?.logos || {};
        if (!cancelled) {
          setPartnerLogoSymbol(String(logos?.symbol || "").trim());
          setPartnerLogoFavicon(String(logos?.favicon || cfg?.theme?.brandFaviconUrl || "").trim());
          setPartnerLogoApp(String(logos?.app || cfg?.theme?.brandLogoUrl || "").trim());
          setPartnerBrandName(String(cfg?.name || cfg?.displayName || "").trim());
          setIsPartnerBrandLoading(false);
        }
      } catch {
        if (!cancelled) setIsPartnerBrandLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [containerType, containerBrandKey]);

  // Effective values: partner assets take precedence over theme context for partner containers
  const isPartnerContainer = String(containerType || "").toLowerCase() === "partner";
  const effectiveLogoSymbol = (isPartnerContainer && partnerLogoSymbol) ? partnerLogoSymbol : (theme?.symbolLogoUrl || "");
  const effectiveLogoFavicon = (isPartnerContainer && partnerLogoFavicon) ? partnerLogoFavicon : (theme?.brandFaviconUrl || "");
  const effectiveLogoApp = (isPartnerContainer && partnerLogoApp) ? partnerLogoApp : (theme?.brandLogoUrl || "");
  const effectiveBrandNameFromPartner = (isPartnerContainer && partnerBrandName) ? partnerBrandName : "";

  // Helper to get symbol logo with proper fallback cascade
  // While loading partner brand data, use a transparent placeholder to prevent flash
  const getSymbolLogo = () => {
    // If we're still loading partner brand data, don't show fallback yet
    if (isPartnerBrandLoading && containerType.toLowerCase() === "partner") {
      // Return a 1x1 transparent data URL to prevent flashing wrong logo
      return "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    }
    // Partner-fetched logos take ABSOLUTE priority in partner containers
    // Do NOT fall through to theme/brand context values - they can override partner logos
    if (isPartnerContainer) {
      const pSym = partnerLogoSymbol.trim();
      const pFav = partnerLogoFavicon.trim();
      const pApp = partnerLogoApp.trim();
      if (pSym) return pSym;
      if (pFav) return pFav;
      if (pApp) return pApp;
      return "/ppsymbol.png"; // Don't fall through to theme/brand context
    }
    // Platform container - use standard cascade with theme values
    const sym = effectiveLogoSymbol.trim();
    const fav = effectiveLogoFavicon.trim();
    const app = effectiveLogoApp.trim();
    // Use wide logo (app) if navbarMode indicates logo preference
    const useWide = (theme?.navbarMode === 'logo') || String((brand as any)?.key || "").toLowerCase() === "basaltsurge";
    const defaultPlatformSymbol = String((brand as any)?.key || "").toLowerCase() === "basaltsurge" ? "/BasaltSurgeD.png" : "/ppsymbol.png";

    if (useWide && app) return app;
    return sym || fav || app || defaultPlatformSymbol;
  };

  // Safe brand display for sidebar: if name missing or generic (ledgerN/partnerN/default), titleize brand key (prefer container brandKey)
  const rawBrandName = String((effectiveBrandNameFromPartner || theme?.brandName || (brand as any)?.displayName || brand?.name || "")).trim();
  const isGenericBrandName =
    /^ledger\d*$/i.test(rawBrandName) ||
    /^partner\d*$/i.test(rawBrandName) ||
    /^default$/i.test(rawBrandName) ||
    (isPartnerContainer && /^portalpay$/i.test(rawBrandName));
  const keyForDisplay = (() => {
    const bk = containerBrandKey;
    if (bk) return bk;
    return String((brand as any)?.key || "").trim();
  })();
  const titleizedKey = keyForDisplay ? keyForDisplay.charAt(0).toUpperCase() + keyForDisplay.slice(1) : "PortalPay";
  const displayBrandName = (!rawBrandName || isGenericBrandName) ? titleizedKey : rawBrandName;

  // Use bigger container for wide logos
  const isWideLogo = (theme?.navbarMode === 'logo') || String((brand as any)?.key || "").toLowerCase() === "basaltsurge";

  return (
    <aside className={`
      fixed z-10 bg-background transition-all duration-300
      md:top-[176px] md:bottom-0 md:left-0 md:border-r md:flex-col
      ${isCollapsed ? 'md:w-16' : 'md:w-64'}
      top-[176px] left-0 right-0 border-b md:border-b-0 border-border
      max-md:h-14 max-md:overflow-x-auto max-md:overflow-y-hidden
      flex
    `}>
      {/* Desktop: traditional vertical sidebar */}
      <div className="hidden md:flex md:flex-1 md:overflow-y-auto md:p-2 md:space-y-2 md:flex-col">
        {/* Logo - desktop only */}
        <Link href="/developers" className="flex items-center justify-center group p-2 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getSymbolLogo()}
            alt={displayBrandName || "Brand"}
            className={"transition-transform group-hover:scale-105 rounded-md object-contain " + (isWideLogo ? "h-10 w-auto max-w-[200px]" : "h-10 w-10")}
          />
          {!isCollapsed && !isWideLogo && (
            <div className="ml-3">
              <div className="font-bold text-foreground text-sm">{displayBrandName} Docs</div>
              <div className="text-xs text-muted-foreground">API Reference</div>
            </div>
          )}
          {!isCollapsed && isWideLogo && (
            <span className="sr-only">{displayBrandName} Docs</span>
          )}
        </Link>

        {/* Desktop Navigation */}
        <nav className={isCollapsed ? "space-y-0.5 flex flex-col items-stretch" : "space-y-1"}>
          {navigation.map((item) => (
            <div key={item.title}>
              {isCollapsed ? (
                <div className="flex flex-col items-center gap-1 py-1">
                  <Tooltip content={item.title} side="right">
                    <Link
                      href={item.items?.[0]?.href || '#'}
                      onClick={(e) => e.stopPropagation()}
                      className="w-8 h-8 rounded-full border-2 border-[var(--pp-secondary)] flex items-center justify-center hover:bg-[var(--pp-secondary)]/10 transition-colors"
                    >
                      <div className="text-[var(--pp-secondary)]">
                        {item.icon}
                      </div>
                    </Link>
                  </Tooltip>
                  <div className="w-px h-1 bg-border" />
                  {item.items?.slice(1).map((child) => (
                    <Tooltip key={child.href} content={child.title} side="right">
                      <Link
                        href={child.href!}
                        onClick={(e) => e.stopPropagation()}
                        className={`p-1 rounded-sm transition-colors ${currentPath === child.href
                          ? 'bg-primary'
                          : 'hover:bg-muted'
                          }`}
                      >
                        <div className={`w-1.5 h-1.5 rounded-full ${currentPath === child.href ? 'bg-primary-foreground' : 'bg-foreground'
                          }`} />
                      </Link>
                    </Tooltip>
                  ))}
                </div>
              ) : (
                <NavGroup item={item} currentPath={currentPath} />
              )}
            </div>
          ))}
        </nav>
      </div>

      {/* Mobile: horizontal scrolling compact carousel */}
      <div className="flex md:hidden items-center gap-6 px-3 overflow-x-auto flex-nowrap w-full h-14">
        {navigation.map((item, groupIndex) => (
          <div key={item.title} className="flex items-center gap-6 shrink-0 h-full">
            {/* Main topic icon circle */}
            <Link
              href={item.items?.[0]?.href || '#'}
              className="flex flex-col items-center justify-center gap-0.5 w-8 h-full"
            >
              <div className="w-4 h-4 rounded-full border border-[var(--pp-secondary)] flex items-center justify-center hover:bg-[var(--pp-secondary)]/10 transition-colors shrink-0">
                <div className="text-[var(--pp-secondary)] scale-[0.6]">
                  {item.icon}
                </div>
              </div>
              <div className="h-5 flex items-center overflow-hidden">
                <span className="text-[6px] uppercase tracking-wide font-medium text-center text-muted-foreground leading-[7px] line-clamp-2 w-full">
                  {item.title}
                </span>
              </div>
            </Link>

            {/* Separator */}
            <div className="w-px h-8 bg-border shrink-0" />

            {/* Subtopic dots */}
            {item.items?.slice(1).map((child) => (
              <Link
                key={child.href}
                href={child.href!}
                className="flex flex-col items-center justify-center gap-0.5 w-8 h-full"
              >
                <div className={`p-0.5 rounded-sm transition-colors shrink-0 ${currentPath === child.href
                  ? 'bg-primary'
                  : 'hover:bg-muted'
                  }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${currentPath === child.href ? 'bg-primary-foreground' : 'bg-foreground'
                    }`} />
                </div>
                <div className="h-5 flex items-center overflow-hidden">
                  <span className={`text-[6px] uppercase tracking-wide text-center leading-[7px] line-clamp-2 w-full ${currentPath === child.href ? 'text-foreground font-semibold' : 'text-muted-foreground font-medium'
                    }`}>
                    {child.title}
                  </span>
                </div>
              </Link>
            ))}

            {/* Group separator (except last) */}
            {groupIndex < navigation.length - 1 && (
              <div className="w-0.5 h-8 bg-border/50 shrink-0" />
            )}
          </div>
        ))}
      </div>

      {/* Toggle Button at bottom */}
      <div className="hidden md:flex border-t border-border p-2 justify-center">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-2 rounded-lg hover:bg-muted transition-colors"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
}
