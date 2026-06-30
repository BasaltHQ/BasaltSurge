"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useActiveAccount, useActiveWallet, useDisconnect, darkTheme, AutoConnect } from "thirdweb/react";
import { signLoginPayload } from "thirdweb/auth";
import { chain, getWallets, getPrivateWallets, getPrivateLoginWallets } from "@/lib/thirdweb/client";
import { usePortalThirdwebTheme, getConnectButtonStyle, connectButtonClass } from "@/lib/thirdweb/theme";
import { ChevronDown, Dot, Ellipsis } from "lucide-react";
import { AuthModal } from "./auth-modal";
import { AccessPendingModal } from "./access-pending-modal";
import { SignupWizard } from "./signup-wizard";
import { ContactFormModal } from "@/components/landing/ContactFormSection";
import { useTranslations } from "next-intl";
import { cachedContainerIdentity } from "@/lib/client-api-cache";
import { useBrand } from "@/contexts/BrandContext";
import { getDefaultBrandSymbol, getDefaultBrandName, getEffectiveBrandKey, resolveBrandSymbol } from "@/lib/branding";
import { getAllIndustries } from "@/lib/landing-pages/industries";
import { getAllComparisons } from "@/lib/landing-pages/comparisons";
import { getAllLocations } from "@/lib/landing-pages/locations";
import { useThirdwebClient } from "@/hooks/useThirdwebClient";

type SeoPageCategory = 'industries' | 'comparisons' | 'locations';

// Dynamic import to avoid SSR hydration mismatch
const ConnectButton = dynamic(() => import("thirdweb/react").then((m) => m.ConnectButton), { ssr: false });

import { useTheme } from "@/contexts/ThemeContext";

type NavItem = { href: string; label: string; ownerOnly?: boolean; authOnly?: boolean };

export function Navbar() {
    const client = useThirdwebClient();
    const twTheme = usePortalThirdwebTheme();
    const account = useActiveAccount();
    const activeWallet = useActiveWallet();
    const { disconnect } = useDisconnect();
    const [owner, setOwner] = useState("");
    useEffect(() => {
        try {
            if (typeof document !== 'undefined') {
                const envOwner = (document.documentElement?.getAttribute('data-pp-owner-wallet') || "").toLowerCase();
                if (envOwner) setOwner(envOwner);
            }
        } catch { }
    }, []);
    const isOwner = (account?.address || "").toLowerCase() === owner && !!owner;
    const wallet = (account?.address || "").toLowerCase();
    const pathname = usePathname();
    const tCommon = useTranslations("common");
    const tNavbar = useTranslations("navbar");
    const tSearch = useTranslations("search");
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [isSocialLogin, setIsSocialLogin] = useState(false);
    const [showSignupWizard, setShowSignupWizard] = useState(false);
    const checkingAuth = useRef(false);
    const [authed, setAuthed] = useState(false);
    const [showAccessPending, setShowAccessPending] = useState(false);
    const [hasPendingApplication, setHasPendingApplication] = useState(false);
    const [pendingAdminNav, setPendingAdminNav] = useState(false);
    const router = useRouter();
    const brand = useBrand();
    const [showContactModal, setShowContactModal] = useState(false);
    // Container identity (platform vs partner) to control branding load behavior
    const [container, setContainer] = useState<{ containerType: string; brandKey: string }>(() => {
        try {
            const d = typeof document !== 'undefined' ? document.documentElement : null;
            const t = (d?.getAttribute('data-pp-container-type') || '').toLowerCase();
            const k = (d?.getAttribute('data-pp-brand-key') || (brand as any)?.key || '').toString();
            if (t === 'partner' || t === 'platform') {
                return { containerType: t, brandKey: k };
            }
        } catch { }
        const key = String((brand as any)?.key || '');
        const isPlatformBrand = !key || key.toLowerCase() === 'portalpay' || key.toLowerCase() === 'basaltsurge';
        const typeGuess = isPlatformBrand ? 'platform' : 'partner';
        return { containerType: typeGuess, brandKey: key };
    });
    const [wallets, setWallets] = useState<any[]>([]);
    const [scrolled, setScrolled] = useState(false);
    const [time, setTime] = useState('');

    // Re-read container type from DOM after mount (SSR may not have it available during initial render)
    useEffect(() => {
        try {
            const d = document.documentElement;
            const t = (d?.getAttribute('data-pp-container-type') || '').toLowerCase();
            const k = (d?.getAttribute('data-pp-brand-key') || (brand as any)?.key || '').toString();
            if (t === 'partner' || t === 'platform') {
                setContainer(prev => {
                    if (prev.containerType !== t || prev.brandKey !== k) {
                        return { containerType: t, brandKey: k };
                    }
                    return prev;
                });
            }
        } catch { }
    }, [brand]);

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 50);
        };
        const tick = () => {
            setTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        };
        tick();
        const interval = setInterval(tick, 1000);
        window.addEventListener('scroll', handleScroll);
        return () => {
            window.removeEventListener('scroll', handleScroll);
            clearInterval(interval);
        };
    }, []);
    useEffect(() => {
        let mounted = true;
        // Determine if this is a private partner container
        // Private mode requires approval - use getPrivateLoginWallets for LOGIN (email + phone + external wallets)
        const accessMode = (brand as any)?.accessMode || "open";
        const isPrivate = accessMode === "request";
        const isPlatformContainer = container.containerType === "platform";
        const shouldUsePrivateWallets = isPrivate && !isPlatformContainer;

        const loadWallets = shouldUsePrivateWallets ? getPrivateLoginWallets : getWallets;
        loadWallets()
            .then((w) => { if (mounted) setWallets(w as any[]); })
            .catch(() => setWallets([]));
        return () => { mounted = false; };
    }, [brand, container.containerType]);

    // Detect thirdweb modal and lock body scroll to prevent content jump
    useEffect(() => {
        let savedScrollY = 0;

        const lockScroll = () => {
            savedScrollY = window.scrollY;
            document.body.style.position = 'fixed';
            document.body.style.top = `-${savedScrollY}px`;
            document.body.style.left = '0';
            document.body.style.right = '0';
            document.body.style.overflow = 'hidden';
        };

        const unlockScroll = () => {
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.left = '';
            document.body.style.right = '';
            document.body.style.overflow = '';
            window.scrollTo(0, savedScrollY);
        };

        const checkForModal = () => {
            // Thirdweb uses various selectors for its modals
            const modal = document.querySelector('[data-rk], [role="dialog"], [class*="ConnectModal"], [class*="tw-modal"]');
            if (modal) {
                // Close the mobile menu to prevent overlapping layout conflicts
                setMobileOpen(prev => {
                    if (prev) return false;
                    return prev;
                });
                if (!document.body.hasAttribute('data-modal-locked')) {
                    document.body.setAttribute('data-modal-locked', 'true');
                    lockScroll();
                }
            } else if (document.body.hasAttribute('data-modal-locked')) {
                document.body.removeAttribute('data-modal-locked');
                unlockScroll();
            }
        };

        // Use MutationObserver to detect modal injection
        const observer = new MutationObserver(checkForModal);
        observer.observe(document.body, { childList: true, subtree: true });

        return () => {
            observer.disconnect();
            if (document.body.hasAttribute('data-modal-locked')) {
                document.body.removeAttribute('data-modal-locked');
                unlockScroll();
            }
        };
    }, []);

    // Site branding from dynamic ThemeContext (which now includes Shop overrides)
    const { theme: ctxTheme } = useTheme();
    // Helper to resolve effective branding, prioritizing partner assets if in partner container
    // CRITICAL: When logged out on BasaltSurge, use static defaults, NOT stored config data
    // BUT: Never do this in Partner containers - they should always show their own branding
    const effectiveTheme = useMemo(() => {
        const t = ctxTheme;

        // Read DOM attributes directly for most reliable partner detection
        // These are set by the server based on env vars
        const domContainerType = typeof document !== 'undefined'
            ? (document.documentElement.getAttribute('data-pp-container-type') || '').toLowerCase()
            : '';
        const domBrandKey = typeof document !== 'undefined'
            ? (document.documentElement.getAttribute('data-pp-brand-key') || '').toLowerCase()
            : '';

        // CRITICAL: Use DOM brand key first, then container state, then theme context
        const effectiveBrandKey = (domBrandKey || container.brandKey || t.brandKey || getEffectiveBrandKey()).toLowerCase();
        const isBasalt = effectiveBrandKey === "basaltsurge" || effectiveBrandKey === "portalpay";
        const isLoggedIn = Boolean(account?.address);

        // Detect if this is a partner container - NEVER force Basalt in partner context
        // DOM attribute is authoritative - set by server based on env vars
        const isPartnerContainer = (() => {
            // Check DOM attribute directly - this is the most reliable source
            if (domContainerType === "partner") return true;
            if (domContainerType === "platform") return false;

            // Fallback to container state
            const ct = (container.containerType || "").toLowerCase();
            if (ct === "partner") return true;
            if (ct === "platform") return false;

            // Last resort: Check BrandContext
            const brandName = String((brand as any)?.name || "").toLowerCase();
            const brandKeyFromCtx = String((brand as any)?.key || "").toLowerCase();
            const isPlatformBrand = (!brandName || brandName === "basaltsurge" || brandName === "portalpay") &&
                (!brandKeyFromCtx || brandKeyFromCtx === "basaltsurge" || brandKeyFromCtx === "portalpay");
            return !isPlatformBrand;
        })();

        // DEBUG: Trace navbar partner detection
        console.log('[Navbar DEBUG] effectiveTheme:', {
            domContainerType,
            domBrandKey,
            containerType: container.containerType,
            effectiveBrandKey,
            isBasalt,
            isLoggedIn,
            isPartnerContainer,
            willOverride: isBasalt && !isLoggedIn && !isPartnerContainer
        });

        // When logged out on BasaltSurge (PLATFORM only), force static platform defaults
        if (isBasalt && !isLoggedIn && !isPartnerContainer) {
            return {
                brandLogoUrl: "/BasaltSurgeWideD.png",
                brandFaviconUrl: t.brandFaviconUrl || "/favicon-32x32.png",
                symbolLogoUrl: "/BasaltSurgeD.png",
                brandName: "BasaltSurge",
                brandLogoShape: "square",
                brandKey: "basaltsurge",
                navbarMode: "symbol" as const
            };
        }

        // For partners, NEVER return BasaltSurge logos - use partner's or empty
        const sanitizeLogoForPartner = (logo: string | undefined) => {
            if (!isPartnerContainer || !logo) return logo;
            if (logo.startsWith('http')) return logo;
            const s = String(logo).toLowerCase();
            // Only block specific known platform assets, not just any URL containing the string
            // This prevents blocking valid logos that might have 'basaltsurge' in the path (e.g. blob storage account)
            const filename = s.split('/').pop()?.split('?')[0] || '';
            const isPlatformAsset =
                filename === 'basaltsurge.png' ||
                filename === 'basaltsurgewided.png' ||
                filename === 'basaltsurged.png' ||
                filename === 'bssymbol.png' ||
                filename === 'bswide.png' ||
                filename === 'ppsymbol.png' ||
                filename === 'cblogod.png';

            if (isPlatformAsset) {
                return ''; // Block default platform logos for partners
            }
            return logo;
        };

        return {
            brandLogoUrl: sanitizeLogoForPartner(t.brandLogoUrl),
            brandFaviconUrl: t.brandFaviconUrl,
            symbolLogoUrl: sanitizeLogoForPartner(t.symbolLogoUrl),
            brandName: t.brandName,
            brandLogoShape: t.brandLogoShape,
            brandKey: t.brandKey,
            navbarMode: t.navbarMode
        };
    }, [ctxTheme, container.containerType, container.brandKey, account?.address, brand]);

    // Use effectiveTheme instead of local state
    const theme = effectiveTheme;

    // Check authentication status and auto-authenticate or show modal
    useEffect(() => {
        const w = (account?.address || "").toLowerCase();
        // If wizard is open, DO NOT run this auth check. The wizard handles its own flow.
        // Also suppress auth modal on legal review pages (?track=1) opened from the auth modal
        const isLegalReviewTab = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('track') === '1';
        // Suppress on agent pages, apply page, and legal documents
        const isSuppressedRoute = typeof window !== 'undefined' && (
            window.location.pathname.startsWith('/agents') ||
            window.location.pathname.startsWith('/legal') ||
            window.location.pathname.startsWith('/apply')
        );
        if (!w || checkingAuth.current || showSignupWizard || isLegalReviewTab || isSuppressedRoute) {
            return;
        }

        checkingAuth.current = true;

        (async () => {
            try {
                // Check if already authenticated (Passing x - wallet to detect approved but unauthenticated users)
                console.log("[Navbar] Checking Auth:", { wallet: w, brandKey: (brand as any)?.key });
                const me = await fetch('/api/auth/me', {
                    cache: 'no-store',
                    headers: {
                        'x-wallet': w,
                        'x-brand-key': (brand as any)?.key || ""
                    }
                })
                    .then(r => r.ok ? r.json() : { authed: false })
                    .catch(() => ({ authed: false }));

                // Detect Platform Admin (Pre-calculation for access gating)
                const platformWallet = (process.env.NEXT_PUBLIC_PLATFORM_WALLET || "").toLowerCase();
                const isPlatformAdmin = me?.isPlatformAdmin || (!!platformWallet && w === platformWallet);

                const domContainerType = typeof document !== 'undefined' ? (document.documentElement.getAttribute('data-pp-container-type') || '').toLowerCase() : '';
                const ct = (container?.containerType || "").toLowerCase();
                const isPartner = domContainerType === "partner" || ct === "partner";
                const isRegistrationRegime = process.env.NEXT_PUBLIC_PLATFORM_REGISTRATION_REGIME === "true";

                // Access Control Gating — Approval is only mandatory on partner containers for now
                // The platform container uses the registration regime only if the env var is set.
                const isApproved = (!isPartner && !isRegistrationRegime) || String(me?.shopStatus || "").toLowerCase() === "approved" || isPlatformAdmin;
                const blocked = !isApproved;

                if (me?.authed && !blocked) {
                    setAuthed(true);
                    setShowAccessPending(false); // Clear any stale blocked state
                    // Already authenticated, just register user
                    try {
                        await fetch('/api/users/register', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ wallet: w })
                        });
                    } catch { }
                    checkingAuth.current = false;
                    return;
                }

                // Detect wallet type
                const walletId = activeWallet?.id;
                const isEmbeddedWallet = walletId === "inApp" || walletId === "embedded";

                // Show authentication modal for both social and external wallets (or pending modal if blocked)
                setAuthed(false);
                setTimeout(() => {
                    // Safety check: if wizard is open, do absolutely nothing
                    if (showSignupWizard) {
                        checkingAuth.current = false;
                        return;
                    }

                    if (!isApproved) {
                        // Not Approved -> SHOW PENDING/APPLICATION MODAL
                        // Check if user has a pending application
                        setHasPendingApplication(me?.shopStatus === "pending");
                        if (!showSignupWizard) {
                            setShowAuthModal(false); // FORCE CLOSE signing modal if it was opened by a button click
                            setShowAccessPending(true);
                        }
                        // Do NOT show AuthModal - that asks for signature/login which we don't want yet
                    } else if (!me?.authed) {
                        // Approved User -> PROCEED TO LOGIN/SIGNING
                        // Check if they have already accepted the legal documents
                        fetch(`/api/legal-read-status?wallet=${encodeURIComponent(w)}`)
                            .then(r => r.ok ? r.json() : null)
                            .then(async (legal) => {
                                if (legal?.termsReadAt && legal?.privacyReadAt && legal?.aidpaReadAt) {
                                    // They have already accepted everything in the past!
                                    // Auto-login them directly without showing any modal or signing message!
                                    try {
                                        const autoLoginResponse = await fetch('/api/auth/auto-login', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ wallet: w })
                                        });
                                        if (autoLoginResponse.ok) {
                                            setAuthed(true);
                                            // Broadcast login event
                                            window.dispatchEvent(
                                                new CustomEvent("pp:auth:logged_in", { detail: { wallet: w } })
                                            );
                                            // Register user
                                            await fetch('/api/users/register', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ wallet: w })
                                            }).catch(() => {});
                                            return;
                                        }
                                    } catch (e) {
                                        console.error("[Navbar] Auto-login failed, falling back to modal:", e);
                                    }
                                }
                                // Fallback to showing modal if not accepted or auto-login failed
                                setIsSocialLogin(isEmbeddedWallet);
                                setShowAuthModal(true);
                            })
                            .catch(() => {
                                setIsSocialLogin(isEmbeddedWallet);
                                setShowAuthModal(true);
                            });
                    }
                    checkingAuth.current = false;
                }, 800);
            } catch {
                checkingAuth.current = false;
            }
        })();
    }, [account, account?.address, activeWallet?.id, brand, container, showSignupWizard]);

    // Broadcast login/logout so ThemeLoader can immediately apply merchant-scoped theme
    useEffect(() => {
        const w = (account?.address || "").toLowerCase();
        try {
            if (w) {
                window.dispatchEvent(new CustomEvent("pp:auth:logged_in", { detail: { wallet: w } }));
            } else {
                window.dispatchEvent(new CustomEvent("pp:auth:logged_out"));
            }
        } catch { }
    }, [account?.address, brand, (brand as any)?.key]);

    // Listen for explicit auth prompt triggers (e.g., clicking gated links)
    useEffect(() => {
        function onPrompt(ev: any) {
            try {
                const d = ev?.detail || {};
                setIsSocialLogin(Boolean(d?.preferSocial));
                setShowAuthModal(true);
            } catch { }
        }
        function onWizardOpen() {
            setShowSignupWizard(true);
        }
        window.addEventListener("pp:auth:prompt", onPrompt as any);
        window.addEventListener("pp:wizard:open", onWizardOpen);
        return () => {
            window.removeEventListener("pp:auth:prompt", onPrompt as any);
            window.removeEventListener("pp:wizard:open", onWizardOpen);
        };
    }, []);

    const items = useMemo<NavItem[]>(() => {
        const base: NavItem[] = [];
        if (authed && account?.address) base.push({ href: "/profile", label: tNavbar("profile"), authOnly: true });
        if (authed && account?.address) base.push({ href: "/shop", label: tNavbar("shop"), authOnly: true });
        if (authed && account?.address) base.push({ href: "/admin", label: tNavbar("admin"), authOnly: true });
        return base;
    }, [authed, account?.address, tNavbar]);

    // Animated active underline pointer
    const navRef = useRef<HTMLDivElement | null>(null);
    const linkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
    const [indicator, setIndicator] = useState<{ left: number; width: number; visible: boolean }>({ left: 0, width: 0, visible: false });
    const [defiEnabled, setDefiEnabled] = useState(true);
    const [defiOverride, setDefiOverride] = useState(false);

    useEffect(() => {
        function update() {
            const container = navRef.current;
            if (!container) { setIndicator(i => ({ ...i, visible: false })); return; }
            // Force Loyalty highlight for loyalty routes
            const isLoyaltyPath = pathname?.startsWith('/live') || pathname?.startsWith('/leaderboard');
            if (isLoyaltyPath) {
                const socialEl = linkRefs.current['/loyalty'];
                if (socialEl) {
                    const cb = socialEl.getBoundingClientRect();
                    const nb = container.getBoundingClientRect();
                    setIndicator({ left: cb.left - nb.left, width: cb.width, visible: true });
                    return;
                }
            }
            // Find active item by pathname prefix
            let active: HTMLAnchorElement | null = null;
            let bestLen = -1;
            for (const k of Object.keys(linkRefs.current)) {
                const el = linkRefs.current[k];
                if (!el) continue;
                const href = el.getAttribute('href') || '';
                if (pathname?.startsWith(href) && href.length > bestLen) { active = el; bestLen = href.length; }
            }
            if (!active) { setIndicator(i => ({ ...i, visible: false })); return; }
            const cb = active.getBoundingClientRect();
            const nb = container.getBoundingClientRect();
            setIndicator({ left: cb.left - nb.left, width: cb.width, visible: true });
        }
        update();
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, [pathname, items.length]);

    useEffect(() => {
        let cancelled = false;
        const headers: Record<string, string> = { "x-theme-caller": "navbar:defi" };
        if (wallet) headers["x-wallet"] = wallet;
        let skip = false;
        try {
            const u = new URL(window.location.href);
            const path = u.pathname || "";
            skip = path.startsWith("/portal") || path.startsWith("/terminal") || path.startsWith("/pricing");
        } catch { }
        (!skip ? fetch('/api/site/config', { headers, cache: "no-store" }) : Promise.resolve({ json: async () => ({}) } as any))
            .then(r => r.json())
            .then(j => {
                if (cancelled) return;
                const cfg = j?.config || {};
                setDefiEnabled(cfg?.defiEnabled !== false);
            })
            .catch(() => {
                if (cancelled) return;
                setDefiEnabled(true);
            });
        return () => { cancelled = true; };
    }, [wallet]);

    useEffect(() => {
        function updateOverride() {
            try {
                const hasCookie = typeof document !== "undefined" && document.cookie.split(";").some(c => c.trim().startsWith("cb_defi_local_override="));
                const hasSession = typeof window !== "undefined" && window.sessionStorage && window.sessionStorage.getItem("cb:defiLocalOverride") === "1";
                setDefiOverride((hasCookie || hasSession) && isOwner);
            } catch {
                setDefiOverride(false);
            }
        }
        updateOverride();
        const handler = () => updateOverride();
        window.addEventListener("cb:defiLocalOverride", handler as any);
        return () => { window.removeEventListener("cb:defiLocalOverride", handler as any); };
    }, [isOwner]);

    // Search UI state
    const [q, setQ] = useState("");
    const [domain, setDomain] = useState("");
    const [platform, setPlatform] = useState("");
    const [language, setLanguage] = useState("");
    const [minXp, setMinXp] = useState<string>("");
    const [open, setOpen] = useState(false);
    // Profiles sort/filter
    const [liveOnly, setLiveOnly] = useState(false);
    const [userSort, setUserSort] = useState<string>("xp_desc"); // xp_desc | heartbeat_desc | seen_desc | name_asc
    // Shops sort/filter
    const [shopSort, setShopSort] = useState<string>("updated_desc"); // updated_desc | name_asc | slug_asc
    const [shopSetupOnly, setShopSetupOnly] = useState(false);
    const [shopHasSlugOnly, setShopHasSlugOnly] = useState(false);
    const [shopPack, setShopPack] = useState("");
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [loadingShops, setLoadingShops] = useState(false);
    const loading = loadingUsers || loadingShops;
    const [userResults, setUserResults] = useState<any[]>([]);
    const [shopResults, setShopResults] = useState<any[]>([]);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [mobileSocialOpen, setMobileSocialOpen] = useState(false);
    const [socialOpen, setSocialOpen] = useState(false);
    const [isMobileViewport, setIsMobileViewport] = useState(false);

    useEffect(() => {
        const handleResize = () => {
            setIsMobileViewport(window.innerWidth < 1024); // lg breakpoint (1024px)
        };
        handleResize();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);
    const socialHideRef = useRef<number | null>(null);
    const [defiOpen, setDefiOpen] = useState(false);
    const [mobileDefiOpen, setMobileDefiOpen] = useState(false);
    const defiHideRef = useRef<number | null>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);

    // SEO page visibility state for mobile menu
    const [seoCategoryVisibility, setSeoCategoryVisibility] = useState<Record<SeoPageCategory, boolean>>({
        industries: true,
        comparisons: true,
        locations: true,
    });
    const [mobileExploreOpen, setMobileExploreOpen] = useState(false);

    // Load SEO page settings for mobile menu visibility
    useEffect(() => {
        async function loadSeoPageSettings() {
            try {
                const res = await fetch('/api/admin/seo-pages', {
                    cache: 'no-store',
                    headers: { 'Content-Type': 'application/json' },
                });
                if (!res.ok) return;
                const data = await res.json();
                if (!data.ok || !data.settings?.pageStatuses) return;

                const pageStatuses = data.settings.pageStatuses;
                const industryIds = getAllIndustries().map(i => `industry-${i.slug}`);
                const comparisonIds = getAllComparisons().map(c => `comparison-${c.slug}`);
                const locationIds = getAllLocations().map(l => `location-${l.slug}`);

                const isAllDisabled = (ids: string[]) => {
                    if (ids.length === 0) return false;
                    return ids.every(id => pageStatuses[id]?.enabled === false);
                };

                setSeoCategoryVisibility({
                    industries: !isAllDisabled(industryIds),
                    comparisons: !isAllDisabled(comparisonIds),
                    locations: !isAllDisabled(locationIds),
                });
            } catch (err) {
                console.error('[Navbar] Failed to load SEO page settings:', err);
            }
        }
        loadSeoPageSettings();
    }, []);

    useEffect(() => {
        function onDocClick(e: MouseEvent) {
            const t = e.target as Node;
            if (!dropdownRef.current) return;
            if (!dropdownRef.current.contains(t)) setOpen(false);
        }
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);

    useEffect(() => {
        return () => { if (socialHideRef.current) { clearTimeout(socialHideRef.current); } };
    }, []);

    useEffect(() => {
        return () => { if (defiHideRef.current) { clearTimeout(defiHideRef.current); } };
    }, []);

    useEffect(() => {
        const effective = defiEnabled || (isOwner && defiOverride);
        if (!effective) {
            setDefiOpen(false);
            setMobileDefiOpen(false);
        }
    }, [defiEnabled, defiOverride, isOwner]);

    useEffect(() => {
        const ctrlUsers = new AbortController();
        const ctrlShops = new AbortController();
        const term = q.trim();
        const noFilters = !domain && !platform && !language && !minXp;
        if (term.length < 2 && noFilters) {
            setUserResults([]);
            setShopResults([]);
            setLoadingUsers(false);
            setLoadingShops(false);
            return;
        }
        // Users search (supports filters)
        setLoadingUsers(true);
        const u = new URL('/api/users/search', window.location.origin);
        if (term) u.searchParams.set('q', term);
        if (domain) u.searchParams.set('domains', domain);
        if (platform) u.searchParams.set('platforms', platform);
        if (language) u.searchParams.set('languages', language);
        if (minXp) u.searchParams.set('minXp', String(Math.max(0, parseInt(minXp) || 0)));
        if (liveOnly) u.searchParams.set('live', 'true');
        if (userSort && userSort !== 'xp_desc') u.searchParams.set('sort', userSort);
        u.searchParams.set('limit', '12');
        fetch(u.toString(), { signal: ctrlUsers.signal })
            .then(r => r.json())
            .then(j => { setUserResults(Array.isArray(j?.users) ? j.users : []); })
            .catch(() => { })
            .finally(() => setLoadingUsers(false));
        // Shops search (only when term is present)
        if (term.length >= 2) {
            setLoadingShops(true);
            const s = new URL('/api/shop/search', window.location.origin);
            s.searchParams.set('q', term);
            if (shopSort) s.searchParams.set('sort', shopSort);
            if (shopSetupOnly) s.searchParams.set('setup', 'true');
            if (shopHasSlugOnly) s.searchParams.set('hasSlug', 'true');
            if (shopPack) s.searchParams.set('pack', shopPack);
            s.searchParams.set('limit', '12');
            fetch(s.toString(), { signal: ctrlShops.signal })
                .then(r => r.json())
                .then(j => { setShopResults(Array.isArray(j?.shops) ? j.shops : []); })
                .catch(() => { })
                .finally(() => setLoadingShops(false));
        } else {
            setShopResults([]);
            setLoadingShops(false);
        }
        return () => { ctrlUsers.abort(); ctrlShops.abort(); };
    }, [q, domain, platform, language, minXp, liveOnly, userSort, shopSort, shopSetupOnly, shopHasSlugOnly, shopPack]);

    const socialActive = useMemo(() => pathname?.startsWith('/analytics') || pathname?.startsWith('/leaderboard'), [pathname]);
    const defiEffective = defiEnabled || (isOwner && defiOverride);
    const navZ = (pathname?.startsWith('/terminal') || pathname?.startsWith('/pricing')) ? 'z-[10000]' : 'z-50';
    // Compute branding readiness and whether to show skeleton in partner containers
    const isPartnerContainer = (() => {
        const t = (container.containerType || "").toLowerCase();
        if (t) return t === "partner";
        const bk = (theme.brandKey || container.brandKey || (brand as any)?.key || "").toLowerCase();
        return !!bk && bk !== "portalpay" && bk !== "basaltsurge";
    })();
    const hasBrandAssets = Boolean((theme.symbolLogoUrl || "").trim() || (theme.brandFaviconUrl || "").trim() || (theme.brandLogoUrl || "").trim());
    const effectiveBrandKey = (theme.brandKey || container.brandKey || getEffectiveBrandKey()).toLowerCase();
    const showBrandSkeleton = isPartnerContainer && !hasBrandAssets;
    // Determine if a proper full-width logo exists for this brand; if not, fall back to symbol+text
    const fullLogoUrl = String((theme.brandLogoUrl || "")).trim();
    const hasPartnerFullLogo = (() => {
        if (!fullLogoUrl) return false;
        // Detect blob storage URLs containing the brand key (case-insensitive)
        const lowerUrl = fullLogoUrl.toLowerCase();
        const lowerKey = (effectiveBrandKey || "").toLowerCase();
        if (lowerKey && lowerKey !== "portalpay" && lowerKey !== "basaltsurge") {
            // Check for brand key in blob storage paths (e.g., /Brands/paynex... or /brands/paynex...)
            if (lowerUrl.includes(`/brands/${lowerKey}`) || lowerUrl.includes(`/${lowerKey}`)) return true;
            // Check for blob storage URLs that contain the brand key anywhere
            if (lowerUrl.includes(lowerKey) && (lowerUrl.includes('blob.core.windows.net') || lowerUrl.includes('azureedge.net'))) return true;
        }
        // Reject known default PortalPay assets
        const filename = (fullLogoUrl.split("/").pop() || "").toLowerCase();
        const isDefaultAsset = /^(portalpay\d*\.png|ppsymbol(bg)?\.png|bssymbol\.png|cblogod\.png|favicon-\d+x\d+\.png|next\.svg)$/i.test(filename);
        // Accept any non-default URL
        return !isDefaultAsset;
    })();

    // Effective logo URLs
    const effectiveLogoApp = theme.brandLogoUrl;
    const effectiveLogoSymbol = theme.symbolLogoUrl;
    const effectiveLogoFavicon = theme.brandFaviconUrl;

    // Trust explicit navbarMode from theme or brand config
    const brandNavbarMode = (brand as any)?.logos?.navbarMode;
    const navbarMode: "symbol" | "logo" = (() => {
        // Explicit theme mode takes highest precedence
        if (theme.navbarMode === "logo" || theme.navbarMode === "symbol") {
            return theme.navbarMode;
        }
        // Explicit brand mode takes second precedence
        if (brandNavbarMode === "logo" || brandNavbarMode === "symbol") {
            return brandNavbarMode;
        }
        // Fallback: use "logo" for partners with a full logo, otherwise "symbol"
        if (effectiveBrandKey && effectiveBrandKey !== "portalpay" && effectiveBrandKey !== "basaltsurge") return "logo";
        return "symbol";
    })();

    // DEBUG: Log navbar mode
    console.log('[Navbar] navbarMode:', {
        'theme.navbarMode': theme.navbarMode,
        'brand.logos.navbarMode': brandNavbarMode,
        effectiveNavbarMode: navbarMode
    });

    // Partner-safe display name: treat generic names and 'PortalPay' as placeholders in partner containers
    const displayBrandName = (() => {
        const raw = String(theme.brandName || "").trim();
        const generic =
            /^ledger\d*$/i.test(raw) ||
            /^partner\d*$/i.test(raw) ||
            /^default$/i.test(raw) ||
            (isPartnerContainer && /^portalpay$/i.test(raw));
        const key = String((theme.brandKey || container.brandKey || "")).trim();
        const lowerKey = key.toLowerCase();
        // explicit casing for basaltsurge
        if (lowerKey === "basaltsurge") {
            // Only force BasaltSurge if the name is empty, generic, or explicitly "BasaltSurge"/"PortalPay"
            if (!raw || generic || raw.toLowerCase() === "basaltsurge" || raw.toLowerCase() === "portalpay") {
                return "BasaltSurge";
            }
            return raw;
        }
        const titleizedKey = key ? key.charAt(0).toUpperCase() + key.slice(1) : "PortalPay";
        return (!raw || generic) ? titleizedKey : raw;
    })();

    // Consolidate functionality into the new template structure
    const themeColor = ctxTheme.primaryColor || '#06b6d4'; // Dynamic Basalt Theme Color
    const secondaryColor = ctxTheme.secondaryColor || '#F54029'; // Dynamic Basalt Secondary
    const isBasaltSurge = displayBrandName === "BasaltSurge";
    // For partners, use partner brand logo from context as fallback, not platform logos
    const partnerFallbackLogo = (brand as any)?.logos?.app || (brand as any)?.logos?.symbol || '';
    const platformFallbackLogo = "/Surge.png";
    const fallbackLogo = isPartnerContainer ? partnerFallbackLogo : platformFallbackLogo;

    // DEBUG: Trace EXACT logo values at render time
    console.log('[Navbar LOGO DEBUG]', {
        'theme.symbolLogoUrl': theme.symbolLogoUrl,
        'theme.brandLogoUrl': theme.brandLogoUrl,
        fallbackLogo,
        isBasaltSurge,
        isPartnerContainer,
        displayBrandName,
    });

    const effectiveLogo = isBasaltSurge ? "/Surge.png" : (theme.symbolLogoUrl || theme.brandLogoUrl || fallbackLogo || "/api/favicon");
    const maskUrl = effectiveLogo.startsWith("http")
        ? `/_next/image?url=${encodeURIComponent(effectiveLogo)}&w=96&q=75`
        : effectiveLogo;

    // Modal icon should be a square symbol, not a full-width logo
    // Fix: Prioritize raw partner symbol from BrandContext to prevent ThemeContext from falling back to full logo
    const rawPartnerSymbol = (brand as any)?.logos?.symbol;
    const modalTitleIcon = isBasaltSurge ? "/Surge.png" : (rawPartnerSymbol || effectiveLogoSymbol || effectiveLogoFavicon || "/Surge.png");

    return (
        <>
            <AutoConnect client={client} wallets={wallets} accountAbstraction={{ chain, sponsorGas: true }} />
            <style>{`
                .nav-item-custom-border {
                    border: 1px solid transparent;
                }
                .nav-item-custom-border:hover, .nav-item-custom-border.active {
                    border-color: ${secondaryColor} !important;
                }
            `}</style>
            <nav
                className={`w-full relative ${navZ} transition-all duration-500 ease-in-out ${scrolled
                    ? 'bg-black/80 backdrop-blur-2xl py-[22px]'
                    : 'py-[22px] bg-transparent'
                    }`}
            >
                <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 flex items-center justify-between">
                    {/* Logo & System Status */}
                    <div className="flex items-center gap-6 shrink-0">
                        <Link href="/" className="flex items-center gap-3 group relative z-50">
                            {navbarMode === "logo" ? (
                                /* Full-width logo mode - Logo behind STATUS.ONLINE */
                                <div className="flex flex-col min-w-0 relative">
                                    <span className="hidden md:block text-xs font-mono tracking-widest opacity-80 transition-colors whitespace-nowrap relative z-10" style={{ color: themeColor }}>
                                        STATUS.ONLINE
                                    </span>
                                    <div className="relative h-8 min-w-[120px] max-w-[180px] transform group-hover:scale-105 transition-transform duration-300">
                                        <Image
                                            src={effectiveLogoApp || effectiveLogo || partnerFallbackLogo}
                                            alt={theme.brandName || "Logo"}
                                            fill
                                            className="object-contain object-left"
                                            priority
                                            sizes="180px"
                                        />
                                    </div>
                                </div>
                            ) : (
                                /* Symbol + Text mode - Square symbol with brand name */
                                <>
                                    <div className="relative w-10 h-10 transform group-hover:scale-110 transition-transform duration-300">
                                        <Image
                                            src={effectiveLogo}
                                            alt={theme.brandName || "Logo"}
                                            fill
                                            className="object-contain"
                                            priority
                                            sizes="40px"
                                        />
                                        <div
                                            className="shield-gleam-container"
                                            style={{
                                                maskImage: `url('${maskUrl}')`,
                                                WebkitMaskImage: `url('${maskUrl}')`,
                                                maskSize: 'contain',
                                                WebkitMaskSize: 'contain',
                                                maskPosition: 'center',
                                                WebkitMaskPosition: 'center',
                                                maskRepeat: 'no-repeat',
                                                WebkitMaskRepeat: 'no-repeat'
                                            }}
                                        />
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className="hidden md:block text-xs font-mono tracking-widest opacity-80 transition-colors whitespace-nowrap" style={{ color: themeColor }}>
                                            STATUS.ONLINE
                                        </span>
                                        {displayBrandName === "BasaltSurge" ? (
                                            <span className="text-lg text-white tracking-widest group-hover:opacity-80 transition-opacity font-vox whitespace-nowrap" style={{ fontFamily: 'vox, sans-serif' }}>
                                                <span style={{ fontWeight: 300 }}>BASALT</span><span style={{ fontWeight: 700 }}>SURGE</span>
                                            </span>
                                        ) : (
                                            <span className={`${displayBrandName.length > 20 ? 'text-xs' : displayBrandName.length > 12 ? 'text-sm' : 'text-lg'} text-white tracking-widest group-hover:opacity-80 transition-opacity font-mono font-bold whitespace-nowrap`}>
                                                {displayBrandName}
                                            </span>
                                        )}
                                    </div>
                                </>
                            )}
                        </Link>

                        {/* Desktop Navigation */}
                        <div className="hidden lg:flex items-center gap-1">
                            {account?.address ? (
                                <div
                                    className="relative"
                                    onMouseEnter={() => {
                                        if (socialHideRef.current) clearTimeout(socialHideRef.current);
                                        setSocialOpen(true);
                                    }}
                                    onMouseLeave={() => {
                                        if (socialHideRef.current) clearTimeout(socialHideRef.current);
                                        socialHideRef.current = window.setTimeout(() => setSocialOpen(false), 180);
                                    }}
                                >
                                    <Link
                                        href="/analytics"
                                        className={"px-4 py-2 text-xs font-mono tracking-wider text-gray-400 hover:text-white hover:bg-white/5 rounded-[10px] transition-all duration-200 inline-flex items-center gap-1 nav-item-custom-border " + (socialActive ? "text-white bg-white/5 active" : "")}
                                    >
                                        LOYALTY
                                        <ChevronDown className="w-3 h-3 opacity-50" />
                                    </Link>
                                    {socialOpen && (
                                        <div className="absolute left-0 top-full mt-1 w-32 glass-float rounded-xl border border-white/10 p-1 flex flex-col gap-1 z-50">
                                            <Link href="/analytics" className="px-3 py-2 text-[10px] font-mono hover:bg-white/10 rounded-lg text-gray-300 hover:text-white">ANALYTICS</Link>
                                            <Link href="/leaderboard" className="px-3 py-2 text-[10px] font-mono hover:bg-white/10 rounded-lg text-gray-300 hover:text-white">LEADERBOARD</Link>
                                        </div>
                                    )}
                                </div>
                            ) : null}
                            {items.map((it: NavItem) => (
                                <Link
                                    key={it.href}
                                    href={it.href}
                                    onClick={(e) => {
                                        try {
                                            if (it.href === "/admin" && !authed) {
                                                e.preventDefault();
                                                setPendingAdminNav(true);
                                                const walletId = activeWallet?.id;
                                                const isEmbeddedWallet = walletId === "inApp" || walletId === "embedded";
                                                setIsSocialLogin(isEmbeddedWallet);
                                                setShowAuthModal(true);
                                            }
                                        } catch { }
                                    }}
                                    className={"px-4 py-2 text-xs font-mono tracking-wider text-gray-400 hover:text-white hover:bg-white/5 rounded-[10px] transition-all duration-200 uppercase nav-item-custom-border " + (pathname?.startsWith(it.href) ? "text-white bg-white/5 active" : "")}
                                >
                                    {it.label}
                                </Link>
                            ))}
                        </div>
                    </div>

                    {/* Right Side */}
                    <div className="flex items-center gap-4">
                        {/* Time Display */}
                        <div className="hidden xl:block text-xs font-mono tracking-wider opacity-80" style={{ color: themeColor }}>
                            {time}
                        </div>

                        {/* Search & Filters */}
                        <div className="static md:relative flex items-center gap-2" ref={dropdownRef}>
                            <button
                                onClick={() => setOpen(o => !o)}
                                className="hidden md:flex items-center gap-2 px-3 py-2 rounded-[10px] bg-black/20 hover:bg-white/5 border border-white/10 hover:border-white/20 transition-all group"
                            >
                                <svg className="w-4 h-4 text-gray-400 group-hover:text-white transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></svg>
                                <span className="text-[10px] font-mono tracking-widest text-gray-400 group-hover:text-white transition-colors uppercase leading-none pt-[1px]">Search</span>
                            </button>

                            {/* Mobile Search Trigger */}
                            <button
                                className="md:hidden w-9 h-9 grid place-items-center rounded-[10px] border border-white/10 hover:bg-white/5 text-gray-400"
                                onClick={() => setOpen(o => !o)}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></svg>
                            </button>

                            {open && (
                                <div
                                    className="absolute top-full left-4 right-4 md:left-auto md:right-0 mt-2 md:w-[520px] max-h-[75vh] rounded-xl border p-4 text-sm z-50 animate-in fade-in zoom-in-95 duration-200 origin-top-right shadow-2xl backdrop-blur-2xl bg-black/80"
                                    style={{ borderColor: secondaryColor }}
                                >
                                    <div className="mb-3">
                                        <label className="text-[10px] font-mono uppercase mb-1 block opacity-80" style={{ color: secondaryColor }}>{tSearch("search")}</label>
                                        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={tCommon("search")}
                                            className="h-10 w-full px-3 rounded-lg bg-black/50 border border-white/10 focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/10 text-gray-300 font-mono text-sm" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <div className="microtext text-[10px] mb-2 opacity-80" style={{ color: secondaryColor }}>PROFILES</div>
                                            <input value={domain} onChange={e => setDomain(e.target.value)} className="h-8 w-full px-3 rounded-lg bg-white/5 border border-white/5 focus:border-white/20 focus:outline-none text-xs" placeholder={tSearch("domain")} />
                                            <input value={platform} onChange={e => setPlatform(e.target.value)} className="h-8 w-full px-3 rounded-lg bg-white/5 border border-white/5 focus:border-white/20 focus:outline-none text-xs" placeholder={tSearch("platform")} />
                                            <input value={language} onChange={e => setLanguage(e.target.value)} className="h-8 w-full px-3 rounded-lg bg-white/5 border border-white/5 focus:border-white/20 focus:outline-none text-xs" placeholder={tSearch("language")} />
                                            <div className="flex items-center justify-between pt-1">
                                                <label className="text-[10px] text-gray-400 flex items-center gap-1.5 cursor-pointer hover:text-white">
                                                    <input type="checkbox" checked={liveOnly} onChange={e => setLiveOnly(e.target.checked)} className="rounded border-white/20 bg-white/5 checked:bg-cyan-500" />
                                                    LIVE
                                                </label>
                                                <select value={userSort} onChange={e => setUserSort(e.target.value)} className="h-6 bg-transparent text-[10px] text-gray-400 hover:text-white focus:outline-none cursor-pointer border-none text-right">
                                                    <option value="xp_desc">XP</option>
                                                    <option value="heartbeat_desc">Active</option>
                                                    <option value="seen_desc">Seen</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="microtext text-[10px] text-cyan-500/80 mb-2">SHOPS</div>
                                            <select value={shopPack} onChange={e => setShopPack(e.target.value)} className="h-8 w-full px-2 rounded-lg bg-white/5 border border-white/5 focus:border-white/20 focus:outline-none text-xs text-gray-300">
                                                <option value="">All Packs</option>
                                                <option value="restaurant">Restaurant</option>
                                                <option value="retail">Retail</option>
                                                <option value="hotel">Hotel</option>
                                                <option value="freelancer">Freelancer</option>
                                            </select>
                                            <div className="flex flex-col gap-1.5 pt-1">
                                                <label className="text-[10px] text-gray-400 flex items-center gap-1.5 cursor-pointer hover:text-white">
                                                    <input type="checkbox" checked={shopSetupOnly} onChange={e => setShopSetupOnly(e.target.checked)} className="rounded border-white/20 bg-white/5 checked:bg-cyan-500" />
                                                    Setup Complete
                                                </label>
                                                <label className="text-[10px] text-gray-400 flex items-center gap-1.5 cursor-pointer hover:text-white">
                                                    <input type="checkbox" checked={shopHasSlugOnly} onChange={e => setShopHasSlugOnly(e.target.checked)} className="rounded border-white/20 bg-white/5 checked:bg-cyan-500" />
                                                    Has Slug
                                                </label>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Results Area */}
                                    <div className="mt-4 max-h-60 overflow-y-auto custom-scrollbar border-t border-white/10 pt-2 space-y-1">
                                        {loading ? (
                                            <div className="py-8 text-center text-gray-500 text-xs font-mono animate-pulse">SEARCHING_DATABASE...</div>
                                        ) : (!userResults.length && !shopResults.length) ? (
                                            <div className="py-8 text-center text-gray-600 text-xs font-mono">NO DATA FOUND</div>
                                        ) : (
                                            <>
                                                {shopResults.map((s: any, i: number) => (
                                                    <Link key={`shop-${s.wallet || s.slug}-${i}`} href={`/shop/${s.slug}`} className="flex items-center gap-3 p-2 hover:bg-white/5 rounded-lg group transition-colors">
                                                        <div className="w-8 h-8 rounded bg-white/10 overflow-hidden relative">
                                                            {s.brandLogoUrl && <img src={s.brandLogoUrl} alt="" className="w-full h-full object-cover" />}
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="text-xs font-medium text-white group-hover:text-cyan-400 transition-colors">{s.name || s.slug}</span>
                                                            <span className="text-[10px] text-gray-500 font-mono">/shop/{s.slug}</span>
                                                        </div>
                                                    </Link>
                                                ))}
                                                {userResults.map((u: any, i: number) => (
                                                    <Link key={`user-${u.wallet}-${i}`} href={`/u/${u.wallet}`} className="flex items-center gap-3 p-2 hover:bg-white/5 rounded-lg group transition-colors">
                                                        <div className="w-8 h-8 rounded-full bg-white/10 overflow-hidden relative">
                                                            {u.pfpUrl && <img src={u.pfpUrl} alt="" className="w-full h-full object-cover" />}
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="text-xs font-medium text-white group-hover:text-cyan-400 transition-colors">{u.displayName || "User"}</span>
                                                            <span className="text-[10px] text-gray-500 font-mono">{u.wallet.slice(0, 6)}...{u.wallet.slice(-4)} • {u.xp || 0} XP</span>
                                                        </div>
                                                    </Link>
                                                ))}
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* CTA / Login & Signup */}
                        <div className="hidden md:flex items-center gap-3 mr-4">
                            {/* Contact Button */}
                            {!account?.address && !isPartnerContainer && (
                                <button
                                    onClick={() => setShowContactModal(true)}
                                    className="px-5 py-2.5 rounded-[10px] border border-white/20 hover:border-white/40 text-white text-xs font-mono tracking-wider font-bold transition-all hover:bg-white/5"
                                >
                                    CONTACT
                                </button>
                            )}
                            {/* Signup Button */}
                            {!account?.address && (
                                <button
                                    onClick={() => setShowSignupWizard(true)}
                                    className="relative px-5 py-2.5 rounded-[10px] border border-white/20 hover:border-white/40 text-white text-xs font-mono tracking-wider font-bold transition-all hover:bg-white/5"
                                >
                                    SIGNUP
                                    {!isPartnerContainer && <span className="absolute -top-2 -right-2 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 backdrop-blur-sm">FREE</span>}
                                </button>
                            )}
                            {/* Login / Account Button */}
                            {!isMobileViewport && wallets.length > 0 ? (
                                <ConnectButton
                                    client={client}
                                    chain={chain}
                                    wallets={wallets}
                                    accountAbstraction={{ chain, sponsorGas: true }}
                                    connectButton={{
                                        label: "LOGIN",
                                        className: "!text-white !rounded-[10px] !px-5 !py-2.5 !h-auto !min-w-[100px] !font-mono !text-xs !tracking-wider !font-bold !border-none !ring-0 !shadow-none transition-all hover:opacity-80 hover:scale-[1.02] active:scale-95",
                                        style: { backgroundColor: secondaryColor, color: '#ffffff', borderRadius: '10px' },
                                    }}
                                    signInButton={{
                                        label: "SIGN IN",
                                        className: "!text-white !rounded-[10px] !px-5 !py-2.5 !h-auto !min-w-[100px] !font-mono !text-xs !tracking-wider !font-bold !border-none transition-all hover:opacity-80 hover:scale-[1.02] active:scale-95",
                                        style: { backgroundColor: secondaryColor, color: '#ffffff', borderRadius: '10px' },
                                    }}
                                    detailsButton={{
                                        displayBalanceToken: { [((chain as any)?.id ?? 8453)]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
                                        style: { borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' },
                                        className: "!rounded-[10px] !bg-white/5 !border-white/10 hover:!bg-white/10 !px-4 !h-9"
                                    }}
                                    detailsModal={{
                                        payOptions: {
                                            buyWithFiat: { prefillSource: { currency: "USD" } },
                                            prefillBuy: { chain: chain, token: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", symbol: "USDC" } },
                                        },
                                    }}
                                    connectModal={{ title: tCommon("login"), titleIcon: modalTitleIcon, size: "compact", showThirdwebBranding: false }}
                                    theme={twTheme}
                                    onDisconnect={async () => {
                                        if (typeof window !== "undefined") {
                                            const w = window as any;
                                            if (w.__pp_deploying || (w.__pp_last_deploy_time && Date.now() - w.__pp_last_deploy_time < 30000)) {
                                                console.log("Wallet state cycled during or after split contract deployment, bypass desktop navbar logout.");
                                                return;
                                            }
                                        }
                                        try {
                                            await fetch('/api/auth/logout', { method: 'POST' });
                                            window.dispatchEvent(new CustomEvent("pp:auth:logged_out"));
                                        } catch { }
                                        try { window.location.href = '/'; } catch { }
                                    }}
                                />
                            ) : !isMobileViewport ? (
                                <div className="w-[100px] h-[36px] bg-white/5 animate-pulse rounded-[10px]" />
                            ) : null}
                        </div>

                        {/* Mobile Menu Button */}
                        <button
                            onClick={() => setMobileOpen(!mobileOpen)}
                            className="lg:hidden p-2 text-white transition-colors hover:text-cyan-500"
                            style={{ color: mobileOpen ? themeColor : 'white' }}
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                {mobileOpen ? (
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                ) : (
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                                )}
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Mobile Menu Overlay */}
                {/* Backdrop — tap outside to close */}
                {mobileOpen && (
                    <div
                        className="lg:hidden fixed inset-0 z-[-1]"
                        onClick={() => setMobileOpen(false)}
                        aria-hidden
                    />
                )}
                <div
                    className={`lg:hidden backdrop-blur-xl absolute top-[calc(100%+1px)] left-4 right-4 rounded-2xl p-4 shadow-2xl max-h-[70vh] overflow-y-auto transition-all duration-300 ease-in-out ${
                        mobileOpen
                            ? "opacity-100 translate-y-0 pointer-events-auto"
                            : "opacity-0 -translate-y-2 pointer-events-none"
                    }`}
                    style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.92)',
                        border: `1px solid ${themeColor}30`,
                        boxShadow: `0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px ${themeColor}15`
                    }}
                >
                            {/* Themed top accent line */}
                            <div
                                className="absolute top-0 left-4 right-4 h-[2px] rounded-full"
                                style={{
                                    background: `linear-gradient(90deg, transparent, ${themeColor}, transparent)`,
                                    opacity: 0.8
                                }}
                            />

                            <div className="flex flex-col gap-2 pt-2">
                                {/* Explore Section - SEO Pages */}
                                <div className="mb-2 pb-2" style={{ borderBottom: `1px solid ${themeColor}20` }}>
                                    <button
                                        onClick={() => setMobileExploreOpen(o => !o)}
                                        className="w-full px-4 py-3 text-sm font-mono tracking-wider text-gray-300 hover:text-white rounded-lg transition-all flex items-center justify-between"
                                        style={{
                                            backgroundColor: mobileExploreOpen ? `${themeColor}10` : 'transparent',
                                        }}
                                    >
                                        <span style={{ color: mobileExploreOpen ? themeColor : undefined }}>EXPLORE</span>
                                        <ChevronDown
                                            className={`w-4 h-4 transition-transform ${mobileExploreOpen ? 'rotate-180' : ''}`}
                                            style={{ color: mobileExploreOpen ? themeColor : undefined }}
                                        />
                                    </button>
                                    {mobileExploreOpen && (
                                        <div className="pl-4 mt-1 space-y-1">
                                            {seoCategoryVisibility.industries && (
                                                <Link
                                                    href="/crypto-payments"
                                                    onClick={() => setMobileOpen(false)}
                                                    className="block px-4 py-2 text-xs font-mono text-gray-400 hover:text-white rounded transition-colors"
                                                    style={{ '--hover-color': themeColor } as any}
                                                >
                                                    INDUSTRIES
                                                </Link>
                                            )}
                                            {seoCategoryVisibility.comparisons && (
                                                <Link href="/vs" onClick={() => setMobileOpen(false)} className="block px-4 py-2 text-xs font-mono text-gray-400 hover:text-white rounded transition-colors">COMPARISONS</Link>
                                            )}
                                            {seoCategoryVisibility.locations && (
                                                <Link href="/locations" onClick={() => setMobileOpen(false)} className="block px-4 py-2 text-xs font-mono text-gray-400 hover:text-white rounded transition-colors">LOCATIONS</Link>
                                            )}
                                            <Link href="/developers" onClick={() => setMobileOpen(false)} className="block px-4 py-2 text-xs font-mono text-gray-400 hover:text-white rounded transition-colors">DEVELOPERS</Link>
                                        </div>
                                    )}
                                </div>
                                {account?.address && (
                                    <div className="mb-2 pb-2" style={{ borderBottom: `1px solid ${themeColor}20` }}>
                                        <button
                                            onClick={() => setMobileSocialOpen(o => !o)}
                                            className="w-full px-4 py-3 text-sm font-mono tracking-wider text-gray-300 hover:text-white rounded-lg transition-all flex items-center justify-between"
                                            style={{
                                                backgroundColor: mobileSocialOpen ? `${themeColor}10` : 'transparent',
                                            }}
                                        >
                                            <span style={{ color: mobileSocialOpen ? themeColor : undefined }}>LOYALTY</span>
                                            <ChevronDown
                                                className={`w-4 h-4 transition-transform ${mobileSocialOpen ? 'rotate-180' : ''}`}
                                                style={{ color: mobileSocialOpen ? themeColor : undefined }}
                                            />
                                        </button>
                                        {mobileSocialOpen && (
                                            <div className="pl-4 mt-1 space-y-1">
                                                <Link href="/analytics" onClick={() => setMobileOpen(false)} className="block px-4 py-2 text-xs font-mono text-gray-400 hover:text-white rounded transition-colors">ANALYTICS</Link>
                                                <Link href="/leaderboard" onClick={() => setMobileOpen(false)} className="block px-4 py-2 text-xs font-mono text-gray-400 hover:text-white rounded transition-colors">LEADERBOARD</Link>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {items.map((it) => (
                                    <Link
                                        key={it.href}
                                        href={it.href}
                                        onClick={(e) => {
                                            if (it.href === "/admin" && !authed) {
                                                e.preventDefault();
                                                setMobileOpen(false);
                                                setPendingAdminNav(true);
                                                const walletId = activeWallet?.id;
                                                const isEmbeddedWallet = walletId === "inApp" || walletId === "embedded";
                                                setIsSocialLogin(isEmbeddedWallet);
                                                setShowAuthModal(true);
                                            } else {
                                                setMobileOpen(false);
                                            }
                                        }}
                                        className="px-4 py-3 text-sm font-mono tracking-wider text-gray-300 hover:text-white rounded-lg transition-all uppercase nav-item-custom-border"
                                        style={{
                                            backgroundColor: pathname?.startsWith(it.href) ? `${themeColor}10` : 'transparent',
                                            color: pathname?.startsWith(it.href) ? themeColor : undefined,
                                        }}
                                    >
                                        {it.label}
                                    </Link>
                                ))}

                                <div className="mt-4 pt-4 flex flex-col gap-3" style={{ borderTop: `1px solid ${themeColor}20` }}>
                                    {!account?.address && !isPartnerContainer && (
                                        <button
                                            onClick={() => {
                                                setMobileOpen(false);
                                                setShowContactModal(true);
                                            }}
                                            className="w-full py-3 rounded-lg text-white text-xs font-mono tracking-wider font-bold transition-all hover:opacity-90 text-center"
                                            style={{
                                                border: `1px solid ${themeColor}50`,
                                                backgroundColor: `${themeColor}10`,
                                            }}
                                        >
                                            CONTACT US
                                        </button>
                                    )}
                                    {!account?.address && (
                                        <button
                                            onClick={() => {
                                                setMobileOpen(false);
                                                setShowSignupWizard(true);
                                            }}
                                            className="relative w-full py-3 rounded-lg text-white text-xs font-mono tracking-wider font-bold transition-all hover:opacity-90"
                                            style={{
                                                border: `1px solid ${themeColor}50`,
                                                backgroundColor: `${themeColor}10`,
                                            }}
                                        >
                                            SIGNUP
                                            {!isPartnerContainer && <span className="absolute -top-2 -right-2 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 backdrop-blur-sm">FREE</span>}
                                        </button>
                                    )}
                                    {wallets.length > 0 ? (
                                        <ConnectButton
                                            client={client}
                                            chain={chain}
                                            wallets={wallets}
                                            accountAbstraction={{ chain, sponsorGas: true }}
                                            connectButton={{
                                                label: "LOGIN",
                                                className: "!text-white !w-full !justify-center !rounded-lg !py-3 !font-mono !text-xs !tracking-wider !font-bold !border-none !ring-0 !shadow-none transition-all hover:opacity-80",
                                                style: { backgroundColor: secondaryColor, color: '#ffffff', borderRadius: '8px' },
                                            }}
                                            signInButton={{
                                                label: "SIGN IN",
                                                className: "!text-white !w-full !justify-center !rounded-lg !py-3 !font-mono !text-xs !tracking-wider !font-bold !border-none transition-all hover:opacity-80",
                                                style: { backgroundColor: secondaryColor, color: '#ffffff', borderRadius: '8px' },
                                            }}
                                            detailsButton={{
                                                displayBalanceToken: { [((chain as any)?.id ?? 8453)]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
                                                style: { borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' },
                                                className: "!rounded-lg !bg-white/5 !border-white/10 hover:!bg-white/10 !px-4 !w-full !justify-center !py-3 !h-auto"
                                            }}
                                            detailsModal={{
                                                payOptions: {
                                                    buyWithFiat: { prefillSource: { currency: "USD" } },
                                                    prefillBuy: { chain: chain, token: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", symbol: "USDC" } },
                                                },
                                            }}
                                            connectModal={{ title: tCommon("login"), titleIcon: modalTitleIcon, size: "compact", showThirdwebBranding: false }}
                                            theme={twTheme}
                                            onConnect={() => setMobileOpen(false)}
                                            onDisconnect={async () => {
                                                if (typeof window !== "undefined") {
                                                    const w = window as any;
                                                    if (w.__pp_deploying || (w.__pp_last_deploy_time && Date.now() - w.__pp_last_deploy_time < 30000)) {
                                                        console.log("Wallet state cycled during or after split contract deployment, bypass desktop navbar logout.");
                                                        return;
                                                    }
                                                }
                                                try {
                                                    await fetch('/api/auth/logout', { method: 'POST' });
                                                    window.dispatchEvent(new CustomEvent("pp:auth:logged_out"));
                                                } catch { }
                                                try { window.location.href = '/'; } catch { }
                                            }}
                                        />
                                    ) : (
                                        <div className="w-full h-[40px] bg-white/5 animate-pulse rounded-lg" />
                                    )}
                                </div>
                            </div>
                        </div>

                {/* HUD Decorative Lines */}
                <div className={`absolute bottom-0 left-0 right-0 pointer-events-none z-40 transition-opacity duration-300 ${scrolled ? 'opacity-100' : 'opacity-0'}`}>
                    <div className="absolute h-px bg-gradient-to-r from-transparent via-current to-transparent w-full" style={{ color: themeColor, opacity: 0.3 }} />
                </div>
            </nav>

            {/* Authentication Modal */}
            <AuthModal
                isOpen={showAuthModal}
                isSocialLogin={isSocialLogin}
                onClose={() => setShowAuthModal(false)}
                onSuccess={() => {
                    setShowAuthModal(false);
                    setAuthed(true);
                    checkingAuth.current = false;
                    if (wallet) {
                        try {
                            fetch('/api/users/register', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ wallet })
                            }).catch(() => { });
                        } catch { }
                    }
                    try {
                        if (pendingAdminNav) {
                            setPendingAdminNav(false);
                            router.push("/admin");
                        }
                    } catch { }
                }}
                onError={(error) => console.error('[Auth] Failed:', error)}
            />

            {/* Signup Wizard */}
            <SignupWizard
                isOpen={showSignupWizard}
                onClose={() => setShowSignupWizard(false)}
                onComplete={() => {
                    setShowSignupWizard(false);
                    // The user connected via the wizard, they'll go through normal auth flow
                }}
            />
            <AccessPendingModal
                isOpen={showAccessPending && !showSignupWizard}
                onClose={() => {
                    setShowAccessPending(false);
                    if (activeWallet) {
                        disconnect(activeWallet);
                    }
                    setAuthed(false);
                }}
                onOpenApplication={() => {
                    setShowAccessPending(false);
                    setShowSignupWizard(true);
                }}
                hasPendingApplication={hasPendingApplication}
            />

            {/* Contact Form Modal */}
            {!isPartnerContainer && (
                <ContactFormModal
                    isOpen={showContactModal}
                    onClose={() => setShowContactModal(false)}
                />
            )}

        </>
    );
}
