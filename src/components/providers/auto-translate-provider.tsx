"use client";

import { useEffect, useState, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { getLocaleFromLanguage, defaultLocale, type Locale } from '@/lib/i18n/config';
import { getLanguageCode } from '@/lib/site-translator';

// ── Client-side translation cache ────────────────────────────────────────
// Key format: "sourceText|targetLang" → translatedText
// Persisted to sessionStorage so it survives soft navigations.

const CACHE_STORAGE_KEY = 'pp:translation-cache';
const MAX_CACHE_ENTRIES = 5000; // cap to prevent unbounded growth

let clientCache: Map<string, string> = new Map();
let cacheLoaded = false;

function cacheKey(text: string, targetLang: string): string {
  return `${text}|${targetLang}`;
}

function loadCacheFromStorage() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const raw = sessionStorage.getItem(CACHE_STORAGE_KEY);
    if (raw) {
      const entries: [string, string][] = JSON.parse(raw);
      clientCache = new Map(entries);
    }
  } catch {
    // sessionStorage unavailable or corrupt — start fresh
  }
}

function persistCacheToStorage() {
  try {
    // Trim if too large (keep most recent entries)
    if (clientCache.size > MAX_CACHE_ENTRIES) {
      const entries = Array.from(clientCache.entries());
      clientCache = new Map(entries.slice(entries.length - MAX_CACHE_ENTRIES));
    }
    sessionStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(Array.from(clientCache.entries())));
  } catch {
    // storage full or unavailable — non-critical
  }
}

function getCachedTranslation(text: string, targetLang: string): string | undefined {
  return clientCache.get(cacheKey(text, targetLang));
}

function setCachedTranslation(text: string, targetLang: string, translated: string) {
  clientCache.set(cacheKey(text, targetLang), translated);
}

/**
 * AutoTranslateProvider
 * Automatically translates all text content in the DOM when language changes.
 * Uses a 3-layer cache: client memory → sessionStorage → server (MongoDB → Cloudflare).
 */
export function AutoTranslateProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [currentLocale, setCurrentLocale] = useState<Locale>(defaultLocale);
  const originalTextsRef = useRef<Map<Node, string>>(new Map());
  const isTranslatingRef = useRef(false);
  const isApplyingRef = useRef(false); // guards MutationObserver during DOM writes
  const lastPathnameRef = useRef(pathname);
  const originalAttrsRef = useRef<Map<Element, Map<string, string>>>(new Map());
  const serverCooldownUntilRef = useRef<number>(0);
  const runTimesRef = useRef<number[]>([]);
  const ATTRS_TO_TRANSLATE = ['placeholder', 'title', 'aria-label', 'alt'];

  useEffect(() => {
    // Load client-side cache from sessionStorage
    loadCacheFromStorage();

    // Load saved language/locale on mount
    try {
      const savedLocale = localStorage.getItem("pp:locale");
      const savedLanguage = localStorage.getItem("pp:language");
      const locale = savedLocale || (savedLanguage ? (getLanguageCode(savedLanguage) || getLocaleFromLanguage(savedLanguage)) : null);
      if (locale && locale !== defaultLocale) {
        setCurrentLocale(locale as Locale);
      }
    } catch {}

    // Listen for language changes
    const handleLanguageChange = (event: CustomEvent) => {
      const language = event.detail?.language as string | undefined;
      const localeFromEvent = event.detail?.locale as string | undefined;
      const locale = (localeFromEvent || (language ? (getLanguageCode(language) || getLocaleFromLanguage(language)) : defaultLocale)) as Locale;
      setCurrentLocale(locale);
      // NOTE: Do NOT clear originalTextsRef here!
      // The original English text must persist across language switches
      // so we always translate FROM English, not from the previous translation.
    };

    window.addEventListener('pp:language:changed', handleLanguageChange as EventListener);
    return () => {
      window.removeEventListener('pp:language:changed', handleLanguageChange as EventListener);
    };
  }, []);

  // Translate when locale changes
  useEffect(() => {
    if (currentLocale === defaultLocale) {
      restoreOriginalTexts();
    } else {
      translatePageContent(currentLocale);
    }
  }, [currentLocale]);

  // Re-translate when navigating to new pages (Next.js route changes)
  useEffect(() => {
    if (pathname !== lastPathnameRef.current) {
      lastPathnameRef.current = pathname;

      if (currentLocale !== defaultLocale && !isTranslatingRef.current) {
        // Clear original texts/attrs cache for new page
        originalTextsRef.current.clear();
        try { originalAttrsRef.current.clear(); } catch {}

        // Translate new page content after a short delay to let DOM settle
        setTimeout(() => {
          if (!isTranslatingRef.current) {
            translatePageContent(currentLocale);
          }
        }, 500);
      }
    }
  }, [pathname, currentLocale]);

  // Observe DOM mutations and re-translate newly inserted content (modals, carts, etc.)
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;

    let debounceTimer: number | null = null;
    const schedule = () => {
      if (debounceTimer) return;
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        // Skip if we are currently applying translations (our own writes)
        if (currentLocale !== defaultLocale && !isTranslatingRef.current && !isApplyingRef.current) {
          translatePageContent(currentLocale);
        }
      }, 600); // 600ms debounce (up from 300ms) to reduce noise
    };

    const observer = new MutationObserver((mutations) => {
      // Skip mutations triggered by our own translation writes
      if (isApplyingRef.current) return;

      for (const m of mutations) {
        if (m.type === 'childList') {
          schedule();
          break;
        }
        if (m.type === 'characterData' && m.target && (m.target as Node).nodeType === Node.TEXT_NODE) {
          schedule();
          break;
        }
        if (m.type === 'attributes' && ATTRS_TO_TRANSLATE.includes(m.attributeName || '')) {
          schedule();
          break;
        }
      }
    });

    try {
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ATTRS_TO_TRANSLATE
      });
    } catch {}

    return () => {
      try { observer.disconnect(); } catch {}
      if (debounceTimer) {
        try { clearTimeout(debounceTimer); } catch {}
        debounceTimer = null;
      }
    };
  }, [currentLocale]);

  function shouldSkipElement(element: Element): boolean {
    const skipTags = ['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'INPUT'];
    if (skipTags.includes(element.tagName)) return true;
    if (element.hasAttribute('data-notranslate')) return true;
    if (element.getAttribute('translate') === 'no') return true;
    if (element.classList.contains('notranslate')) return true;
    return false;
  }

  function isTranslatable(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;

    // Must contain at least one English/Latin letter to be an English text worth translating
    if (!/[a-zA-Z]/.test(trimmed)) return false;

    // Skip EVM addresses (0x followed by 40 hex chars)
    if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return false;

    // Skip transaction hashes (0x followed by 64 hex chars)
    if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) return false;

    // Skip Solana or other base58 public keys (typically 32 to 44 alphanumeric characters)
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) return false;

    // Skip pure date/time strings (e.g., "12:34", "2026-06-11", "06/11/2026", "10:15:30")
    if (/^\d+[\/:\-]\d+([\/:\-]\d+)?$/.test(trimmed)) return false;

    // Skip strings that are just currency amounts, percentages, or numbers (e.g. "$123.45", "100.00", "+5%", "0.005 ETH")
    const cryptoTokenRegex = /\b(ETH|BTC|SOL|USDC|USDT|BASE|POL)\b/i;
    const withoutToken = trimmed.replace(cryptoTokenRegex, '').trim();
    if (/^[+\-]?[\d\s\.,$%€£¥₩]+$/.test(withoutToken)) return false;

    return true;
  }

  function collectTextNodes(root: Node, textNodes: Array<{ node: Node; text: string }> = []): Array<{ node: Node; text: string }> {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            if (shouldSkipElement(element)) {
              return NodeFilter.FILTER_REJECT;
            }
          }
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent?.trim() || '';
            if (text.length > 0 && !/^[\s\n\r]*$/.test(text)) {
              return NodeFilter.FILTER_ACCEPT;
            }
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim() || '';
        if (text) {
          // Always store the FIRST text we ever see for this node (the English original)
          if (!originalTextsRef.current.has(node)) {
            originalTextsRef.current.set(node, node.textContent || '');
          }
          // Use the ORIGINAL English text as the source, not current DOM content
          const sourceText = (originalTextsRef.current.get(node) || node.textContent || '').trim();
          if (sourceText && isTranslatable(sourceText)) {
            textNodes.push({ node, text: sourceText });
          }
        }
      }
    }
    return textNodes;
  }

  function collectAttributeTexts(root: Element): Array<{ element: Element; attr: string; text: string }> {
    const out: Array<{ element: Element; attr: string; text: string }> = [];
    try {
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: (node) => {
            const el = node as Element;
            if (shouldSkipElement(el)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as Element;
          for (const attr of ATTRS_TO_TRANSLATE) {
            if (el.hasAttribute(attr)) {
              const val = (el.getAttribute(attr) || '').trim();
              if (val.length > 0 && !/^[\s\n\r]*$/.test(val)) {
                // Store original attribute value the first time we see it
                if (!originalAttrsRef.current.has(el)) {
                  originalAttrsRef.current.set(el, new Map<string, string>());
                }
                const m = originalAttrsRef.current.get(el)!;
                if (!m.has(attr)) {
                  m.set(attr, el.getAttribute(attr) || '');
                }
                // Use the ORIGINAL English attribute value as the source
                const sourceVal = (m.get(attr) || val).trim();
                if (sourceVal && isTranslatable(sourceVal)) {
                  out.push({ element: el, attr, text: sourceVal });
                }
              }
            }
          }
        }
      }
    } catch {}
    return out;
  }

  async function translatePageContent(targetLocale: Locale) {
    if (isTranslatingRef.current) return;

    // Rate limiter: detect loops
    const now = Date.now();
    runTimesRef.current = runTimesRef.current.filter(t => now - t < 10000);
    if (runTimesRef.current.length >= 10) {
      console.warn('[AutoTranslate] ⚠️ Translation loop detected! Pausing auto-translator to prevent browser lockup.');
      serverCooldownUntilRef.current = now + 60000; // 1 min server cooldown
      return;
    }
    runTimesRef.current.push(now);

    isTranslatingRef.current = true;

    try {
      const textNodes = collectTextNodes(document.body);
      const attrEntries = collectAttributeTexts(document.body);

      if (textNodes.length === 0 && attrEntries.length === 0) {
        isTranslatingRef.current = false;
        return;
      }

      const allTexts = Array.from(new Set([
        ...textNodes.map(tn => tn.text),
        ...attrEntries.map(ae => ae.text)
      ]));

      const targetCode = getLanguageCode(targetLocale) || targetLocale;
      const sourceCode = getLanguageCode(defaultLocale) || defaultLocale;

      // Restore english if target is english
      if (targetCode === 'en' || targetCode === 'en-US' || targetCode === 'en-GB') {
        restoreOriginalTexts();
        isTranslatingRef.current = false;
        return;
      }

      // ─── Layer 1: Check client-side cache first ────────────────────
      const translations: Record<string, string> = {};
      const uncachedTexts: string[] = [];

      for (const text of allTexts) {
        const cached = getCachedTranslation(text, targetCode);
        if (cached) {
          translations[text] = cached;
        } else {
          uncachedTexts.push(text);
        }
      }

      const clientHits = allTexts.length - uncachedTexts.length;
      console.log(`[AutoTranslate] ${allTexts.length} unique texts: ${clientHits} client-cached, ${uncachedTexts.length} need server`);

      // ─── Layer 2+3: Fetch uncached from server ─────────────────────
      if (uncachedTexts.length > 0) {
        const serverOnCooldown = Date.now() < serverCooldownUntilRef.current;
        if (serverOnCooldown) {
          console.warn('[AutoTranslate] Server translation is currently on cooldown due to previous failures. Skipping fetch.');
        } else {
          try {
            const response = await fetch('/api/translate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              cache: 'no-store',
              body: JSON.stringify({
                texts: uncachedTexts,
                targetLang: targetCode,
                sourceLang: sourceCode,
              }),
            });

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              if (errorData.failedLanguage) {
                window.dispatchEvent(new CustomEvent('pp:translation:failed', {
                  detail: { language: errorData.failedLanguage }
                }));
              }
              throw new Error(`Server returned ${response.status}`);
            }

            const data = await response.json();
            const serverTranslations: Record<string, string> = data.translations;

            // Merge server results into translations + client cache
            for (const [src, translated] of Object.entries(serverTranslations)) {
              translations[src] = translated;
              if (translated !== src) {
                setCachedTranslation(src, targetCode, translated);
              }
            }

            // Persist updated cache to sessionStorage
            persistCacheToStorage();

            console.log(`[AutoTranslate] Server returned ${Object.keys(serverTranslations).length} translations (cached: ${data.cached || 0})`);
          } catch (error) {
            console.error('[AutoTranslate] Server translation failed. Entering 30s cooldown:', error);
            serverCooldownUntilRef.current = Date.now() + 30000; // 30s cooldown
            // Continue with whatever we have from client cache
          }
        }
      }

      // ─── Apply translations to DOM ─────────────────────────────────
      // Guard: pause MutationObserver while we write to avoid re-triggering
      isApplyingRef.current = true;

      let updatedCount = 0;
      let updatedAttrs = 0;

      textNodes.forEach(({ node, text }) => {
        const translated = translations[text];
        if (translated && translated !== text) {
          if (node.textContent !== translated) {
            node.textContent = translated;
            updatedCount++;
          }
        }
      });

      try {
        attrEntries.forEach(({ element, attr, text }) => {
          const translated = translations[text];
          if (translated && translated !== text) {
            if (element.getAttribute(attr) !== translated) {
              element.setAttribute(attr, translated);
              updatedAttrs++;
            }
          }
        });
      } catch {}

      // Release guard after a tick so queued mutation events are ignored
      requestAnimationFrame(() => {
        isApplyingRef.current = false;
      });

      if (updatedCount > 0 || updatedAttrs > 0) {
        console.log(`[AutoTranslate] ✅ Applied ${updatedCount} text nodes + ${updatedAttrs} attributes`);
      }
    } catch (error) {
      console.error('[AutoTranslate] Failed:', error);
    } finally {
      isTranslatingRef.current = false;
    }
  }

  function restoreOriginalTexts() {
    let restored = 0;
    originalTextsRef.current.forEach((originalText, node) => {
      if (node.textContent !== originalText) {
        node.textContent = originalText;
        restored++;
      }
    });
    let restoredAttrs = 0;
    originalAttrsRef.current.forEach((attrMap, el) => {
      attrMap.forEach((val, attr) => {
        if (el.getAttribute(attr) !== val) {
          el.setAttribute(attr, val);
          restoredAttrs++;
        }
      });
    });
    console.log(`[AutoTranslate] Restored ${restored} text nodes + ${restoredAttrs} attributes to English`);
  }

  // Ensure DOM auto-translation follows after i18n messages complete (navbar translated) on mobile
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      try {
        const locale = (e.detail?.locale || currentLocale) as Locale;
        if (locale !== defaultLocale && !isTranslatingRef.current) {
          translatePageContent(locale);
        }
      } catch {}
    };
    window.addEventListener('pp:messages:translated', handler as EventListener);
    return () => window.removeEventListener('pp:messages:translated', handler as EventListener);
  }, [currentLocale]);

  return <>{children}</>;
}
