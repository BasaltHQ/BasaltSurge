'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import {
  PanelLeftClose,
  PanelLeft,
  Bell,
  LayoutDashboard,
  Receipt,
  Package,
  ClipboardList,
  ShoppingBag,
  MessageSquare,
  Gauge,
  Utensils,
  Hotel,
  Brush,
  Users,
  Building2,
  BookOpen,
  FileText,
  Sparkles,
  Server,
  ChevronDown,
  LifeBuoy,
  UserCircle,
  ShoppingBasket,
  MessageCircle,
  Gift,
  Store,
  LineChart,
  Terminal,
  Vault,
  Boxes,
  ReceiptText,
  Medal,
  Trophy,
  Repeat,
  Plug,
  MonitorSmartphone,
  FileBarChart,
  ChefHat,
  Armchair,
  Truck,
  PenTool,
  ShieldCheck,
  Smartphone,
  GitMerge,
  Palette,
  Search,
  Puzzle,
  FileQuestion,
  Bot,
  Shield,
  Blocks,
  LayoutGrid,
  Handshake,
  FileSignature,
  Code,
  GraduationCap,
  Clock,
  Mail,
  Sliders,
  Menu,
  X
} from 'lucide-react';
import { useBrand } from '@/contexts/BrandContext';
import { useTheme } from '@/contexts/ThemeContext';
import { cachedFetch } from '@/lib/client-api-cache';
import { getDefaultBrandSymbol, resolveBrandSymbol, getEffectiveBrandKey, resolveBrandAppLogo } from '@/lib/branding';
import { useActiveAccount } from 'thirdweb/react';
import { canAccessPanel, isPlatformSuperAdmin } from '@/lib/authz';

export type AdminTabKey =
  | 'terminal'
  | 'devices'
  | 'kitchen'
  | 'tables'
  | 'delivery'
  | 'reserve'
  | 'onramps'
  | 'notificationsMerchant'
  | 'notificationsPartner'
  | 'notificationsPlatform'

  | 'inventory'
  | 'orders'
  | 'purchases'
  | 'messages'
  | 'messages-buyer'
  | 'messages-merchant'
  | 'endpoints'
  | 'team'
  | 'rewards'
  | 'loyalty'
  | 'loyaltyConfig'
  | 'pms'
  | 'branding'
  | 'globalArt'
  | 'users'
  | 'splitConfig'
  | 'applications'
  | 'partners'
  | 'contracts'
  | 'customAuthWallets'
  | 'shopSetup'
  | 'profileSetup'
  | 'manualShop'
  | 'manualProfile'
  | 'manualWhitelabel'
  | 'manualWithdrawal'
  | 'admins'
  | 'seoPages'
  | 'integrations'
  | 'plugins'
  | 'pluginStudio'
  | 'support'
  | 'supportAdmin'
  | 'writersWorkshop'
  | 'publications'
  | 'reports'
  | 'reportsPartner'
  | 'reportsPlatform'
  | 'clientRequests'
  | 'agentRequests'
  | 'driverRequests'
  | 'subscriptions'
  | 'shopifyPartner'
  | 'shopifyPlatform'
  | 'nodeOperators'
  | 'nodeDashboard'
  | 'modules'
  | 'cannabisCompliance'
  | 'roadmap'
  | 'updates'
  | 'analytics'
  | 'leaderboard'
  | 'autoclose'
  | 'emailConfig'
  | 'sandbox'
  | 'platformAnalytics'
  | 'agentUniversity';

interface AdminSidebarProps {
  activeTab: AdminTabKey;
  onChangeTab: (tab: AdminTabKey) => void;
  industryPack: string | null;
  canBranding: boolean;
  canMerchants: boolean;
  isSuperadmin: boolean;
  canAdmins?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
  disabledMerchantModules?: string[];
}

interface NavItem {
  title: string;
  key?: AdminTabKey;
  href?: string;
  icon?: React.ReactNode;
  roleBadge?: string;
  profile?: any;
  items?: { title: string; key?: AdminTabKey; href?: string; icon?: React.ReactNode; badge?: React.ReactNode }[];
}

function NavGroup({ item, activeTab, onChangeTab }: { item: NavItem; activeTab: AdminTabKey; onChangeTab: (tab: AdminTabKey) => void }) {
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    // Auto-open if any child is active
    if (item.items) {
      return item.items.some((child) => child.key && activeTab === child.key);
    }
    return true;
  });

  const hasChildren = item.items && item.items.length > 0;

  const handleTabClick = (tabKey: AdminTabKey) => {
    if (typeof window !== 'undefined') {
      if (item.profile) {
        localStorage.setItem('pp_active_merchant_context', JSON.stringify(item.profile));
        window.dispatchEvent(new CustomEvent('pp:merchantContextChanged', { detail: item.profile }));
      } else if (item.title && item.title.toLowerCase().includes('merchant')) {
        localStorage.removeItem('pp_active_merchant_context');
        window.dispatchEvent(new CustomEvent('pp:merchantContextChanged', { detail: null }));
      }
    }
    onChangeTab(tabKey);
  };

  if (!hasChildren) {
    if (item.href) {
      return (
        <Link
          href={item.href}
          className="admin-nav-item hover:bg-white/5"
        >
          <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center opacity-70">{item.icon}</span>
          <span className="text-left">{item.title}</span>
        </Link>
      );
    }
    if (item.key) {
      const isActive = activeTab === item.key;
      return (
        <button
          type="button"
          onClick={() => handleTabClick(item.key!)}
          className={`admin-nav-item ${isActive ? 'active' : ''}`}
        >
          <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center opacity-70">{item.icon}</span>
          <span className="text-left">{item.title}</span>
        </button>
      );
    }
  }

  return (
    <>
      {/* Desktop: vertical collapsible */}
      <div className="hidden md:block space-y-0.5">
        {/* Group label — clickable to toggle */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="admin-nav-group-label mt-4 mb-1 w-full cursor-pointer hover:text-white/40 transition-colors flex items-center justify-between pr-1"
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">{item.icon}</span>
            <span className="truncate text-white/90">{item.title}</span>
          </span>
          <div className="flex items-center gap-1.5 ml-auto">
            {item.roleBadge && (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] uppercase font-bold tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30 flex-shrink-0">
                {item.roleBadge}
              </span>
            )}
            <ChevronDown
              className={`w-3 h-3 text-white/15 transition-transform duration-200 flex-shrink-0 ${isOpen ? '' : '-rotate-90'}`}
            />
          </div>
        </button>

        {isOpen && hasChildren && (
          <div className="space-y-0.5">
            {item.items!.map((child) => {
              const isActive = child.key ? activeTab === child.key : false;
              if (child.href) {
                return (
                  <Link
                    key={child.title}
                    href={child.href}
                    className="admin-nav-item ml-3 group transition-all duration-300 hover:bg-white/5"
                  >
                    {child.icon && (
                      <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center transition-all duration-300 opacity-60 group-hover:opacity-100 group-hover:scale-110">
                        {child.icon}
                      </span>
                    )}
                    <span className="text-left transition-colors duration-300 flex-1 text-white/70 group-hover:text-white">{child.title}</span>
                    {child.badge && <span className="ml-auto">{child.badge}</span>}
                  </Link>
                );
              }
              return (
                <button
                  key={child.key}
                  type="button"
                  onClick={() => handleTabClick(child.key!)}
                  className={`admin-nav-item ml-3 group transition-all duration-300 ${isActive ? 'active' : 'hover:bg-white/5'}`}
                >
                  {child.icon && (
                    <span className={`flex-shrink-0 w-4 h-4 flex items-center justify-center transition-all duration-300 ${isActive ? 'opacity-100' : 'opacity-60 group-hover:opacity-100 group-hover:scale-110'}`}>
                      {child.icon}
                    </span>
                  )}
                  <span className={`text-left transition-colors duration-300 flex-1 ${isActive ? 'text-white font-medium' : 'text-white/70 group-hover:text-white'}`}>{child.title}</span>
                  {child.badge && <span className="ml-auto">{child.badge}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Mobile: flat list of children */}
      {hasChildren &&
        item.items!.map((child) => {
          const isActive = child.key ? activeTab === child.key : false;
          if (child.href) {
            return (
              <Link
                key={child.title}
                href={child.href}
                className="md:hidden admin-mobile-nav-item"
              >
                {child.title}
              </Link>
            );
          }
          return (
            <button
              key={child.key}
              type="button"
              onClick={() => handleTabClick(child.key!)}
              className={`md:hidden admin-mobile-nav-item ${isActive ? 'active' : ''}`}
            >
              {child.title}
            </button>
          );
        })}
    </>
  );
}

export function AdminSidebar({ activeTab, onChangeTab, industryPack, canBranding, canMerchants, isSuperadmin: isSuperadminProp, canAdmins, onCollapseChange, disabledMerchantModules = [] }: AdminSidebarProps) {
  const account = useActiveAccount();
  const wallet = (account?.address || "").toLowerCase();
  const isSuperadmin = isPlatformSuperAdmin(wallet);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [mobileSearchQuery, setMobileSearchQuery] = useState("");
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
  const [hoveredTooltip, setHoveredTooltip] = useState<{ title: string; top: number; right: number } | null>(null);

  const toggleSidebar = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    onCollapseChange?.(newState);
  };

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
      if (pSym) return resolveBrandSymbol(pSym, containerBrandKey);
      if (pFav) return resolveBrandSymbol(pFav, containerBrandKey);
      if (pApp) return resolveBrandSymbol(pApp, containerBrandKey);
      return getDefaultBrandSymbol(containerBrandKey); // Don't fall through to theme/brand context
    }
    // Platform container - use standard cascade with theme values
    const sym = effectiveLogoSymbol.trim();
    const fav = effectiveLogoFavicon.trim();
    const app = effectiveLogoApp.trim();
    // Use wide logo (app) if navbarMode indicates logo preference
    const useWide = (theme?.navbarMode === 'logo');
    const defaultPlatformSymbol = getDefaultBrandSymbol(getEffectiveBrandKey());
    const effectiveKey = containerBrandKey || theme?.brandKey || getEffectiveBrandKey();

    // Choose the right logo based on mode
    if (useWide && app) return resolveBrandSymbol(app, effectiveKey);
    return resolveBrandSymbol(sym || fav || app || defaultPlatformSymbol, effectiveKey);
  };

  // Safe display brand name for admin UI. If name is missing or a generic placeholder, fall back to titleized brand key.
  const rawBrandName = String((effectiveBrandNameFromPartner || theme?.brandName || (brand as any)?.displayName || brand?.name || "")).trim();
  const isGenericBrandName =
    /^ledger\d*$/i.test(rawBrandName) ||
    /^partner\d*$/i.test(rawBrandName) ||
    /^default$/i.test(rawBrandName) ||
    (isPartnerContainer && /^portalpay$/i.test(rawBrandName));
  const keyForDisplay = (() => {
    const bk = containerBrandKey;
    if (bk) return bk;
    return String((brand as any)?.key || '').trim();
  })();
  const titleizedKey = keyForDisplay.toLowerCase() === 'basaltsurge' ? 'BasaltSurge' : (keyForDisplay ? keyForDisplay.charAt(0).toUpperCase() + keyForDisplay.slice(1) : 'PortalPay');
  const finalName = (!rawBrandName || isGenericBrandName) ? titleizedKey : rawBrandName;
  const displayBrandName = finalName.toLowerCase() === 'basaltsurge' ? 'BasaltSurge' : finalName;

  const isWideLogo = (theme?.navbarMode === 'logo');

  const isRequestMode = (brand?.accessMode || "").toLowerCase().includes('request');



  const [teamProfiles, setTeamProfiles] = useState<any[]>([]);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    fetch(`/api/admin/reports/access?wallet=${encodeURIComponent(wallet)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data && Array.isArray(data.profiles)) {
          const extTeams = data.profiles.filter(
            (p: any) => p.merchantWallet && p.merchantWallet.toLowerCase() !== wallet.toLowerCase()
          );
          setTeamProfiles(extTeams);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  const getIndustryPackBadge = (pack: string) => {
    switch (pack) {
      case 'restaurant': return <ChefHat className="w-3.5 h-3.5 text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]" />;
      case 'hotel': return <Hotel className="w-3.5 h-3.5 text-indigo-400 drop-shadow-[0_0_8px_rgba(129,140,248,0.5)]" />;
      case 'publishing': return <PenTool className="w-3.5 h-3.5 text-pink-400 drop-shadow-[0_0_8px_rgba(244,114,182,0.5)]" />;
      case 'cannabis': return <ShieldCheck className="w-3.5 h-3.5 text-green-500 drop-shadow-[0_0_8px_rgba(34,197,94,0.5)]" />;
      default: return null;
    }
  };

  const teamMerchantGroups: NavItem[] = teamProfiles.map((tp: any) => {
    const roleKey = String(tp.role || "staff").toLowerCase();
    const roleBadge =
      roleKey === "merchant_owner" ? "Owner" :
      roleKey === "merchant_admin" || roleKey === "manager" ? "Manager" :
      roleKey === "merchant_cashier" || roleKey === "staff" ? "Cashier" :
      roleKey === "merchant_kitchen" ? "Kitchen" :
      roleKey === "merchant_finance" ? "Bookkeeper" :
      roleKey === "merchant_inventory" ? "Inventory" : tp.role;

    return {
      title: tp.merchantName ? `${tp.merchantName}` : "Merchant Team",
      icon: <Building2 className="w-4 h-4 text-purple-400" />,
      roleBadge,
      profile: tp,
      items: [
        { title: 'Shop Configuration', key: 'shopSetup' as AdminTabKey, icon: <Store className="w-4 h-4" /> },
        { title: 'Analytics', key: 'analytics' as AdminTabKey, icon: <LineChart className="w-4 h-4" /> },
        { title: 'Terminal', key: 'terminal' as AdminTabKey, icon: <Terminal className="w-4 h-4" /> },
        { title: 'Inventory', key: 'inventory' as AdminTabKey, icon: <Boxes className="w-4 h-4" /> },
        { title: 'Orders', key: 'orders' as AdminTabKey, icon: <ReceiptText className="w-4 h-4" /> },
        { title: 'Subscriptions', key: 'subscriptions' as AdminTabKey, icon: <Repeat className="w-4 h-4" /> },
        { title: 'Team', key: 'team' as AdminTabKey, icon: <Users className="w-4 h-4" /> },
        { title: 'Reports', key: 'reports' as AdminTabKey, icon: <FileBarChart className="w-4 h-4" /> },
        { title: 'Messages', key: 'messages-merchant' as AdminTabKey, icon: <MessageSquare className="w-4 h-4" /> },
        { title: 'Notifications', key: 'notificationsMerchant' as AdminTabKey, icon: <Bell className="w-4 h-4" /> },
      ].filter((item) => !disabledMerchantModules.includes(item.key) && canAccessPanel(item.key as any, wallet)),
    };
  });

  const groups: NavItem[] = [
    {
      title: 'General',
      icon: <LayoutDashboard className="w-4 h-4" />,
      items: [
        { title: 'Support', key: 'support' as AdminTabKey, icon: <LifeBuoy className="w-4 h-4" /> },
        { title: 'Developers', href: '/developers', icon: <Code className="w-4 h-4" /> },
      ],
    },
    {
      title: 'Shopper',
      icon: <ShoppingBag className="w-4 h-4" />,
      items: [
        { title: 'My Profile', key: 'profileSetup' as AdminTabKey, icon: <UserCircle className="w-4 h-4" /> },
        { title: 'My Purchases', key: 'purchases' as AdminTabKey, icon: <ShoppingBasket className="w-4 h-4" /> },
        { title: 'Messages', key: 'messages-buyer' as AdminTabKey, icon: <MessageCircle className="w-4 h-4" /> },
        { title: 'Rewards', key: 'rewards' as AdminTabKey, icon: <Gift className="w-4 h-4" /> },
      ],
    },
    {
      title: 'Merchant (My Shop)',
      icon: <Building2 className="w-4 h-4" />,
      items: [
        { title: 'Shop Configuration', key: 'shopSetup' as AdminTabKey, icon: <Store className="w-4 h-4" /> },
        { title: 'Analytics', key: 'analytics' as AdminTabKey, icon: <LineChart className="w-4 h-4" /> },
        { title: 'Terminal', key: 'terminal' as AdminTabKey, icon: <Terminal className="w-4 h-4" /> },
        { title: 'Reserve', key: 'reserve' as AdminTabKey, icon: <Vault className="w-4 h-4" /> },
        { title: 'Inventory', key: 'inventory' as AdminTabKey, icon: <Boxes className="w-4 h-4" /> },
        { title: 'Orders', key: 'orders' as AdminTabKey, icon: <ReceiptText className="w-4 h-4" /> },
        { title: 'Loyalty Config', key: 'loyalty' as AdminTabKey, icon: <Medal className="w-4 h-4" /> },
        { title: 'Loyalty Leaderboard', key: 'leaderboard' as AdminTabKey, icon: <Trophy className="w-4 h-4" /> },
        { title: 'Subscriptions', key: 'subscriptions' as AdminTabKey, icon: <Repeat className="w-4 h-4" /> },
        { title: 'Messages', key: 'messages-merchant' as AdminTabKey, icon: <MessageSquare className="w-4 h-4" /> },
        { title: 'Integrations', key: 'integrations' as AdminTabKey, icon: <Plug className="w-4 h-4" /> },
        { title: 'Team', key: 'team' as AdminTabKey, icon: <Users className="w-4 h-4" /> },
        { title: 'Reports', key: 'reports' as AdminTabKey, icon: <FileBarChart className="w-4 h-4" /> },
        { title: 'Notifications', key: 'notificationsMerchant' as AdminTabKey, icon: <Bell className="w-4 h-4" /> },
      ].filter((item) => !disabledMerchantModules.includes(item.key)),
    },
    ...teamMerchantGroups,
    {
      title: 'Apps',
      icon: <Package className="w-4 h-4" />,
      items: [
        { title: 'Touchpoints', key: 'endpoints' as AdminTabKey, icon: <MonitorSmartphone className="w-4 h-4" /> },
        ...(industryPack === 'restaurant' ? [
          { title: 'Kitchen', key: 'kitchen' as AdminTabKey, icon: <ChefHat className="w-4 h-4" />, badge: getIndustryPackBadge('restaurant') },
          { title: 'Tables', key: 'tables' as AdminTabKey, icon: <Armchair className="w-4 h-4" />, badge: getIndustryPackBadge('restaurant') },
          { title: 'Delivery', key: 'delivery' as AdminTabKey, icon: <Truck className="w-4 h-4" />, badge: getIndustryPackBadge('restaurant') }
        ] : []),
        ...(industryPack === 'hotel' ? [{ title: 'PMS', key: 'pms' as AdminTabKey, icon: <Hotel className="w-4 h-4" />, badge: getIndustryPackBadge('hotel') }] : []),
        ...(industryPack === 'publishing' ? [{ title: "Writer's Workshop", key: 'writersWorkshop' as AdminTabKey, icon: <PenTool className="w-4 h-4" />, badge: getIndustryPackBadge('publishing') }] : []),
        ...(industryPack === 'cannabis' ? [{ title: 'Compliance', key: 'cannabisCompliance' as AdminTabKey, icon: <ShieldCheck className="w-4 h-4" />, badge: getIndustryPackBadge('cannabis') }] : []),
      ],
    },
    {
      title: 'Partner/Admin',
      icon: <Brush className="w-4 h-4" />,
      items: [
        { title: 'Devices', key: 'devices' as AdminTabKey, icon: <Smartphone className="w-4 h-4" /> },
        ...(!isRequestMode || isSuperadmin ? [{ title: 'Split Config', key: 'splitConfig' as AdminTabKey, icon: <GitMerge className="w-4 h-4" /> }] : []),
        { title: 'Branding', key: 'branding' as AdminTabKey, icon: <Palette className="w-4 h-4" /> },
        { title: 'Email Settings', key: 'emailConfig' as AdminTabKey, icon: <Mail className="w-4 h-4" /> },
        { title: 'Onramps', key: 'onramps' as AdminTabKey, icon: <Plug className="w-4 h-4" /> },
        { title: 'Merchants', key: 'users' as AdminTabKey, icon: <Store className="w-4 h-4" /> },
        { title: 'SEO Pages', key: 'seoPages' as AdminTabKey, icon: <Search className="w-4 h-4" /> },
        { title: 'Plugins', key: 'plugins' as AdminTabKey, icon: <Puzzle className="w-4 h-4" /> },
        { title: 'Custom Auth Wallets', key: 'customAuthWallets' as AdminTabKey, icon: <ShieldCheck className="w-4 h-4" /> },
        { title: 'Client Requests', key: 'clientRequests' as AdminTabKey, icon: <FileQuestion className="w-4 h-4" /> },
        { title: 'Agent Requests', key: 'agentRequests' as AdminTabKey, icon: <Bot className="w-4 h-4" /> },
        { title: 'Driver Requests', key: 'driverRequests' as AdminTabKey, icon: <Truck className="w-4 h-4" /> },
        { title: 'Admin Users', key: 'admins' as AdminTabKey, icon: <Shield className="w-4 h-4" /> },
        { title: 'Reports', key: 'reportsPartner' as AdminTabKey, icon: <FileBarChart className="w-4 h-4" /> },
        { title: 'Autoclose', key: 'autoclose' as AdminTabKey, icon: <Clock className="w-4 h-4" /> },
        { title: 'Roadmap', key: 'roadmap' as AdminTabKey, icon: <LayoutGrid className="w-4 h-4" /> },
        { title: 'Modules', key: 'modules' as AdminTabKey, icon: <Blocks className="w-4 h-4" /> },
        { title: 'Notifications', key: 'notificationsPartner' as AdminTabKey, icon: <Bell className="w-4 h-4" /> },
      ].filter((item) => canAccessPanel(item.key as any, wallet)),
    },
    {
      title: 'Platform',
      icon: <Building2 className="w-4 h-4" />,
      items: [
        { title: 'Platform Analytics', key: 'platformAnalytics' as AdminTabKey, icon: <LineChart className="w-4 h-4" /> },
        { title: 'Publications', key: 'publications' as AdminTabKey, icon: <BookOpen className="w-4 h-4" /> },
        { title: 'Updates', key: 'updates' as AdminTabKey, icon: <FileBarChart className="w-4 h-4" /> },
        { title: 'Loyalty Config', key: 'loyaltyConfig' as AdminTabKey, icon: <Medal className="w-4 h-4" /> },
        { title: 'Applications', key: 'applications' as AdminTabKey, icon: <LayoutGrid className="w-4 h-4" /> },
        { title: 'Partners', key: 'partners' as AdminTabKey, icon: <Handshake className="w-4 h-4" /> },
        { title: 'Contracts', key: 'contracts' as AdminTabKey, icon: <FileSignature className="w-4 h-4" /> },
        { title: 'Plugin Studio', key: 'pluginStudio' as AdminTabKey, icon: <Code className="w-4 h-4" /> },
        { title: 'Support Admin', key: 'supportAdmin' as AdminTabKey, icon: <LifeBuoy className="w-4 h-4" /> },
        { title: 'Agent University', key: 'agentUniversity' as AdminTabKey, icon: <GraduationCap className="w-4 h-4" /> },
        { title: 'Reports', key: 'reportsPlatform' as AdminTabKey, icon: <FileBarChart className="w-4 h-4" /> },
        { title: 'Autoclose', key: 'autoclose' as AdminTabKey, icon: <Clock className="w-4 h-4" /> },
        { title: 'Notifications', key: 'notificationsPlatform' as AdminTabKey, icon: <Bell className="w-4 h-4" /> },
        ...(process.env.NEXT_PUBLIC_DECENTRALIZATION?.toUpperCase() === 'TRUE' ? [{ title: 'Node Operators', key: 'nodeOperators' as AdminTabKey, icon: <Server className="w-4 h-4" /> }] : []),
        ...(typeof window !== 'undefined' && window.location.hostname === 'surge-sand.basalthq.com'
          ? [{ title: 'Sandbox', key: 'sandbox' as AdminTabKey, icon: <Sliders className="w-4 h-4" /> }]
          : []),
      ].filter((item) => canAccessPanel(item.key as any, wallet)),
    },
    {
      title: 'Nodes',
      icon: <Server className="w-4 h-4" />,
      items: [
        { title: 'Dashboard', key: 'nodeDashboard' as AdminTabKey, icon: <LayoutDashboard className="w-4 h-4" /> },
      ].filter((item) => canAccessPanel(item.key as any, wallet)),
    },
    {
      title: 'Manuals',
      icon: <BookOpen className="w-4 h-4" />,
      items: [
        { title: 'Shop Setup', key: 'manualShop' as AdminTabKey, icon: <BookOpen className="w-4 h-4" /> },
        { title: 'Profile Setup', key: 'manualProfile' as AdminTabKey, icon: <BookOpen className="w-4 h-4" /> },
        { title: 'Whitelabel', key: 'manualWhitelabel' as AdminTabKey, icon: <BookOpen className="w-4 h-4" /> },
        { title: 'Withdrawal', key: 'manualWithdrawal' as AdminTabKey, icon: <BookOpen className="w-4 h-4" /> },
      ],
    },
  ];

  // Sort the items within each group alphabetically by title
  const sortedGroups = groups.map(g => ({
    ...g,
    items: g.items ? [...g.items].sort((a, b) => a.title.localeCompare(b.title)) : []
  }));

  // Filter out groups with zero children (e.g. Apps when no industry pack is set)
  const visibleGroups = sortedGroups.filter(g => !g.items || g.items.length > 0);

  return (
    <>
      <style>{`
        .compact-sidebar-scroll::-webkit-scrollbar {
          display: none !important;
          width: 0 !important;
        }
        .compact-sidebar-scroll {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
      `}</style>
      <aside
      className={`
        fixed z-[60] transition-all duration-300
        md:top-[64px] md:bottom-0 md:left-0 md:flex-col md:h-[calc(100vh-64px)]
        ${isCollapsed ? 'md:w-[72px]' : 'md:w-64'}
        top-[64px] left-0 right-0 md:border-b-0
        ${isMobileMenuOpen ? 'max-md:h-auto max-md:max-h-[85vh] max-md:overflow-y-auto' : 'max-md:h-14 max-md:overflow-hidden'}
        flex
        admin-sidebar-surface
      `}
    >
      {/* Desktop Sticky Logo section */}
      <div className={`hidden md:flex items-center group pt-4 pb-4 mb-2 shrink-0 border-b border-white/5 ${isCollapsed ? 'justify-center px-0' : 'px-5'}`}>
        {getSymbolLogo() ? (
          <img
            src={getSymbolLogo()}
            alt={displayBrandName || 'Brand'}
            className={"transition-all group-hover:scale-105 rounded-lg object-contain " + (isWideLogo ? "h-9 w-auto max-w-[180px]" : "h-9 w-9")}
          />
        ) : (
          !isCollapsed && (
            <div className="font-bold text-white/95 text-base truncate">{displayBrandName}</div>
          )
        )}
        {!isCollapsed && !isWideLogo && getSymbolLogo() && (
          <div className="ml-3 min-w-0">
            <div className="font-semibold text-white/90 text-sm truncate">{displayBrandName}</div>
            <div className="text-[10px] font-medium tracking-widest uppercase text-white/30">Console</div>
          </div>
        )}
        {!isCollapsed && !getSymbolLogo() && (
          <div className="ml-2 min-w-0">
            <div className="text-[10px] font-medium tracking-widest uppercase text-white/30">Console</div>
          </div>
        )}
        {!isCollapsed && isWideLogo && (
          <span className="sr-only">{displayBrandName} Admin</span>
        )}
      </div>

      {/* Desktop: vertical sidebar navigation */}
      <div className={`hidden md:flex md:flex-1 md:overflow-y-auto md:pb-4 md:space-y-1 md:flex-col ${isCollapsed ? 'compact-sidebar-scroll px-0' : 'admin-scroll md:px-3'}`}>
        {/* Navigation */}
        <nav className={isCollapsed ? 'space-y-1 flex flex-col items-stretch' : 'space-y-0.5 flex-1'}>
          {visibleGroups.map((item) => (
            <div key={item.title}>
              {isCollapsed ? (
                (() => {
                  const isGroupActive = item.items?.some((c) => c.key === activeTab);
                  return (
                    <div className={`flex flex-col items-center gap-1 py-3 mb-2 rounded-[20px] transition-all duration-500 relative mx-auto ${
                      isGroupActive 
                        ? 'bg-gradient-to-b from-white/[0.08] to-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_0_0_1px_rgba(255,255,255,0.02),0_8px_20px_-4px_rgba(0,0,0,0.5)] border-b border-black/20 w-[48px]' 
                        : 'w-[48px]'
                    }`}>
                      {/* Badass glowing accent for active group */}
                      {isGroupActive && (
                        <div className="absolute inset-0 rounded-[20px] pointer-events-none drop-shadow-[0_0_8px_var(--pp-secondary)]">
                          <div 
                            className="absolute top-0 inset-x-0 h-6 rounded-t-[20px] border-t-[2px] border-[var(--pp-secondary)] opacity-90"
                            style={{ WebkitMaskImage: 'linear-gradient(to right, transparent, black 25%, black 75%, transparent)', maskImage: 'linear-gradient(to right, transparent, black 25%, black 75%, transparent)' }}
                          />
                          <div 
                            className="absolute bottom-0 inset-x-0 h-6 rounded-b-[20px] border-b-[2px] border-[var(--pp-secondary)] opacity-90"
                            style={{ WebkitMaskImage: 'linear-gradient(to right, transparent, black 25%, black 75%, transparent)', maskImage: 'linear-gradient(to right, transparent, black 25%, black 75%, transparent)' }}
                          />
                        </div>
                      )}

                      {/* Group icon in collapsed mode */}
                      <div 
                        className={`w-10 h-10 flex items-center justify-center transition-all duration-300 rounded-xl relative ${
                          isGroupActive 
                            ? 'text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.5)] scale-110' 
                            : 'text-white/30 hover:text-white/80 hover:bg-white/5 hover:scale-105 cursor-default'
                        }`}
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setHoveredTooltip({ title: item.title, top: rect.top + rect.height / 2, right: rect.right });
                        }}
                        onMouseLeave={() => setHoveredTooltip(null)}
                      >
                        {item.icon}
                      </div>

                      {/* Sub-panel icons */}
                      <div className="flex flex-col items-center gap-1 w-full px-1 mt-1">
                        {item.items?.map((child) => {
                          const isActive = child.key ? activeTab === child.key : false;
                          if (child.href) {
                            return (
                              <Link
                                key={child.title}
                                href={child.href}
                                className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300 relative group/btn hover:bg-white/10 hover:shadow-lg border border-transparent hover:border-white/10"
                                aria-label={child.title}
                                onMouseEnter={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setHoveredTooltip({ title: child.title, top: rect.top + rect.height / 2, right: rect.right });
                                }}
                                onMouseLeave={() => setHoveredTooltip(null)}
                              >
                                <div className="transition-all duration-300 flex items-center justify-center text-white/40 scale-90 group-hover/btn:text-white/90 group-hover/btn:scale-100">
                                  {child.icon || item.icon}
                                </div>
                              </Link>
                            );
                          }
                          return (
                            <button
                              key={child.key}
                              type="button"
                              onClick={() => onChangeTab(child.key!)}
                              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300 relative group/btn ${
                                isActive
                                  ? 'bg-[var(--pp-secondary)] shadow-[0_0_15px_color-mix(in_srgb,var(--pp-secondary)_40%,transparent)] border border-white/20 z-10'
                                  : 'hover:bg-white/10 hover:shadow-lg border border-transparent hover:border-white/10'
                              }`}
                              aria-label={child.title}
                              onMouseEnter={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setHoveredTooltip({ title: child.title, top: rect.top + rect.height / 2, right: rect.right });
                              }}
                              onMouseLeave={() => setHoveredTooltip(null)}
                            >
                              <div className={`transition-all duration-300 flex items-center justify-center ${isActive ? 'text-white scale-100' : 'text-white/40 scale-90 group-hover/btn:text-white/90 group-hover/btn:scale-100'}`}>
                                {child.icon || item.icon}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      {/* Only render separator if the group is NOT active, since active group is self-contained visually */}
                      {!isGroupActive && <div className="w-6 h-px bg-white/5 mt-3" />}
                    </div>
                  );
                })()
              ) : (
                <NavGroup item={item} activeTab={activeTab} onChangeTab={onChangeTab} />
              )}
            </div>
          ))}
        </nav>
      </div>

      {/* Mobile: Sleek Hamburger Navigation Header & Full-Screen Searchable Menu Overlay */}
      <div className="flex md:hidden flex-col w-full admin-mobile-nav bg-zinc-950/95 border-b border-white/10 select-none">
        {/* Top Mobile Bar with Active Panel Title & Hamburger Button */}
        {(() => {
          const activeItem = visibleGroups.flatMap(g => g.items || []).find(it => it.key === activeTab);
          const activeTitle = activeItem?.title || "Platform Analytics";

          return (
            <div className="flex items-center justify-between px-4 h-14 w-full">
              <div className="flex items-center gap-2 max-w-[70%]">
                <span className="text-white/40 text-xs font-mono font-semibold uppercase tracking-wider">Active:</span>
                <span className="text-emerald-400 font-bold text-xs font-mono truncate px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 shadow-sm">
                  {activeTitle}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(prev => !prev)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10 text-xs font-mono font-bold transition-all active:scale-[0.96]"
              >
                {isMobileMenuOpen ? <X className="w-4 h-4 text-rose-400" /> : <Menu className="w-4 h-4 text-emerald-400" />}
                <span>{isMobileMenuOpen ? "Close" : "Menu"}</span>
              </button>
            </div>
          );
        })()}

        {/* 100% Full-Screen Searchable Menu Overlay mounted via React Portal onto document.body */}
        {isMobileMenuOpen && typeof document !== "undefined" && createPortal(
          (() => {
            const activeItem = visibleGroups.flatMap(g => g.items || []).find(it => it.key === activeTab);
            const activeTitle = activeItem?.title || "Platform Analytics";

            return (
              <div className="fixed inset-0 z-[99999] bg-zinc-950/98 backdrop-blur-2xl p-4 sm:p-6 flex flex-col justify-between font-sans animate-in fade-in duration-200 text-left">
                <div className="space-y-4">
                  {/* Overlay Header */}
                  <div className="flex items-center justify-between pb-3 border-b border-white/10">
                    <div className="flex items-center gap-2">
                      <span className="text-white/40 text-xs font-mono font-semibold uppercase">Active:</span>
                      <span className="text-emerald-400 font-bold text-xs font-mono truncate px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 shadow-sm">
                        {activeTitle}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10 text-xs font-mono font-bold"
                    >
                      <X className="w-4 h-4 text-rose-400" />
                      <span>Close</span>
                    </button>
                  </div>

                  {/* Live Search Input Box */}
                  <div className="relative flex items-center w-full">
                    <Search className="w-4 h-4 text-white/40 absolute left-3.5 pointer-events-none z-10" />
                    <input
                      type="text"
                      value={mobileSearchQuery}
                      onChange={(e) => setMobileSearchQuery(e.target.value)}
                      placeholder="Search admin panels (e.g. Analytics, Partners, Reports)..."
                      className="w-full bg-white/[0.08] border border-white/20 rounded-xl pl-10 pr-9 py-3 text-sm text-white placeholder:text-white/40 font-mono focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 transition-all"
                      autoComplete="off"
                    />
                    {mobileSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setMobileSearchQuery("")}
                        className="absolute right-2.5 text-white/40 hover:text-white text-xs p-1.5 z-10"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Faded Scrollable 2-Column Panel Grid */}
                  <div
                    className="max-h-[calc(100vh-210px)] overflow-y-auto pr-1 space-y-5 font-mono scrollbar-thin"
                    style={{
                      WebkitMaskImage: "linear-gradient(to bottom, black 0%, black calc(100% - 25px), transparent 100%)",
                      maskImage: "linear-gradient(to bottom, black 0%, black calc(100% - 25px), transparent 100%)",
                    }}
                  >
                    {visibleGroups.map((group) => {
                      const filteredItems = (group.items || []).filter(item =>
                        item.title.toLowerCase().includes(mobileSearchQuery.toLowerCase().trim())
                      );

                      if (filteredItems.length === 0) return null;

                      return (
                        <div key={group.title} className="space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-white/40 uppercase tracking-widest px-1">
                            {group.icon}
                            <span>{group.title}</span>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            {filteredItems.map((child) => {
                              const isActive = child.key ? activeTab === child.key : false;
                              if (child.href) {
                                return (
                                  <Link
                                    key={child.title}
                                    href={child.href}
                                    onClick={() => setIsMobileMenuOpen(false)}
                                    className="p-3 rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-white/80 hover:text-white text-xs font-semibold flex items-center gap-2 truncate transition-all"
                                  >
                                    <span className="text-white/40">{child.icon}</span>
                                    <span className="truncate">{child.title}</span>
                                  </Link>
                                );
                              }
                              return (
                                <button
                                  key={child.key}
                                  type="button"
                                  onClick={() => {
                                    onChangeTab(child.key!);
                                    setIsMobileMenuOpen(false);
                                  }}
                                  className={`p-3 rounded-2xl border text-xs font-semibold flex items-center gap-2 text-left truncate transition-all ${
                                    isActive
                                      ? "bg-primary/20 border-primary text-white font-bold shadow-md shadow-primary/20"
                                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-white/80 hover:text-white"
                                  }`}
                                >
                                  <span className={isActive ? "text-primary animate-pulse" : "text-white/40"}>
                                    {child.icon}
                                  </span>
                                  <span className="truncate">{child.title}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Footer Close Button */}
                <div className="pt-3 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="w-full py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-mono text-xs font-bold border border-white/10 shadow-lg active:scale-[0.98] transition-all"
                  >
                    Close Navigation Menu
                  </button>
                </div>
              </div>
            );
          })(),
          document.body
        )}
      </div>

      {/* Toggle Button at bottom */}
      <div className="hidden md:flex border-t border-white/5 p-3 justify-center shrink-0">
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-lg hover:bg-white/[0.04] transition-all text-white/30 hover:text-white/60"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      {/* Global Compact Tooltip */}
      {hoveredTooltip && isCollapsed && (
        <div 
          className="fixed px-2.5 py-1.5 rounded-md bg-[#1A1A1A] text-white/90 text-xs font-medium whitespace-nowrap border border-white/10 shadow-xl z-[9999] pointer-events-none animate-in fade-in zoom-in-95 duration-200"
          style={{
            top: hoveredTooltip.top,
            left: hoveredTooltip.right + 12,
            transform: 'translateY(-50%)'
          }}
        >
          {hoveredTooltip.title}
        </div>
        )}
      </aside>
    </>
  );
}
