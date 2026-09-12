"use client";

import modalStyles from "./landing/landing-modal.module.css";

import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { Globe, Search } from "lucide-react";
import Link from "next/link";
import { GROUPS, LANGS_BY_REGION_OR_GROUP, FICTIONAL_LANG_ICONS } from "@/lib/master-langs";
import { useTheme } from "@/contexts/ThemeContext";
import { getSupportedLanguages, isLanguageSupported, getLanguageCode } from "@/lib/site-translator";
import { useTranslations } from "next-intl";
import { useSeoCategoryVisibility } from "@/hooks/useSeoCategoryVisibility";


interface LanguageSelectorBarProps {
  className?: string;
}

// Most popular languages worldwide (in order of global usage)
const POPULAR_LANGUAGES = [
  "English (US)",
  "Chinese (Mandarin)",
  "Spanish",
  "Hindi",
  "Arabic (MSA)",
  "French",
  "Bengali",
  "Portuguese (Brazil)",
  "Russian",
  "Urdu",
  "Indonesian",
  "German",
  "Japanese",
  "Swahili",
  "Marathi",
  "Telugu",
  "Turkish",
  "Tamil",
  "Vietnamese",
  "Korean",
];

export function LanguageSelectorBar({ className = "" }: LanguageSelectorBarProps) {
  const { theme } = useTheme();
  const tLanguageBar = useTranslations("languageBar");
  const [currentLanguage, setCurrentLanguage] = useState("English (US)");
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [failedLanguages, setFailedLanguages] = useState<Set<string>>(new Set());
  const [showUnsupportedModal, setShowUnsupportedModal] = useState(false);
  const [unsupportedLanguageName, setUnsupportedLanguageName] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const categoryVisibility = useSeoCategoryVisibility();

  // Load saved language preference and failed languages on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("pp:language");
      if (saved) {
        setCurrentLanguage(saved);
      }

    } catch { }


    // Clear any previously stored failed languages so users can retry
    // especially Fictional languages that triggered 400 errors previously
    try {
      localStorage.removeItem("pp:failed-languages");
    } catch { }

    // Listen for translation failures
    const handleTranslationFailed = (event: CustomEvent) => {
      const language = event.detail?.language;
      if (language) {
        setFailedLanguages(prev => {
          const newSet = new Set(prev);
          newSet.add(language);
          try {
            localStorage.setItem("pp:failed-languages", JSON.stringify(Array.from(newSet)));
          } catch { }
          return newSet;
        });
        setUnsupportedLanguageName(language);
        setShowUnsupportedModal(true);

        // Revert to English
        setCurrentLanguage("English (US)");
        try {
          localStorage.setItem("pp:language", "English (US)");
          localStorage.setItem("pp:locale", "en");
          window.dispatchEvent(new CustomEvent("pp:language:changed", { detail: { language: "English (US)", locale: "en" } }));
        } catch { }
      }
    };

    window.addEventListener('pp:translation:failed', handleTranslationFailed as EventListener);
    return () => {
      window.removeEventListener('pp:translation:failed', handleTranslationFailed as EventListener);
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery(""); // Clear search when closing
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Get all supported languages across all groups
  const allSupportedLanguages = useMemo(() => {
    const langs: string[] = [];
    GROUPS.forEach((group) => {
      const allLanguages = LANGS_BY_REGION_OR_GROUP[group] || [];
      allLanguages.forEach(lang => {
        if (isLanguageSupported(lang) && !langs.includes(lang)) {
          langs.push(lang);
        }
      });
    });
    return langs;
  }, []);

  // Filter popular languages that are supported
  const supportedPopularLanguages = useMemo(() => {
    return POPULAR_LANGUAGES.filter(lang =>
      isLanguageSupported(lang) && allSupportedLanguages.includes(lang)
    );
  }, [allSupportedLanguages]);

  // Filter languages based on search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery) return null;

    const query = searchQuery.toLowerCase();
    const filtered: Record<string, string[]> = {};

    GROUPS.forEach((group) => {
      const allLanguages = LANGS_BY_REGION_OR_GROUP[group] || [];
      const matchedLanguages = allLanguages.filter(lang =>
        isLanguageSupported(lang) && lang.toLowerCase().includes(query)
      );
      if (matchedLanguages.length > 0) {
        filtered[group] = matchedLanguages;
      }
    });

    return filtered;
  }, [searchQuery]);

  const handleLanguageChange = (language: string) => {
    // Note: Fictional languages previously got locked out here due to Cloudflare 400s.
    // They are now allowed to pass through repeatedly.
    
    // Resolve ISO locale code from display name
    const locale = getLanguageCode(language) || language;

    setCurrentLanguage(language);
    setIsOpen(false);
    setSearchQuery(""); // Clear search

    // Save to localStorage and dispatch both language and locale
    try {
      localStorage.setItem("pp:language", language);
      localStorage.setItem("pp:locale", locale);
      // Dispatch event for other components to react
      window.dispatchEvent(new CustomEvent("pp:language:changed", { detail: { language, locale } }));
    } catch { }
  };

  return (
    <>
      {/* Unsupported Language Modal */}
      {showUnsupportedModal && typeof document !== "undefined" && createPortal(
        <div className={`${modalStyles.backdrop} fixed inset-0 z-[12000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4`}>
          <div className={`${modalStyles.surface} bg-background border rounded-lg shadow-xl p-6 w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain`}>
            <h3 className="text-lg font-semibold mb-2">Language Not Yet Supported</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {unsupportedLanguageName} translation is coming soon! We're working on adding support for more languages.
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              This language will be marked as "Coming Soon" in the language selector.
            </p>
            <button
              onClick={() => setShowUnsupportedModal(false)}
              className={`${modalStyles.primary} w-full px-4 py-2 bg-foreground text-background rounded hover:opacity-90 transition-opacity`}
            >
              Got it
            </button>
          </div>
        </div>,
        document.body
      )}

      <div
        className={`w-full backdrop-blur-md relative z-40 font-mono ${className}`}
        style={{
          backgroundColor: `${theme.primaryColor}1a`,
        }}
      >
        <div className="absolute bottom-0 left-0 right-0 h-[1px] w-full bg-gradient-to-r from-transparent via-current to-transparent opacity-100 pointer-events-none z-50"
          style={{
            color: theme.primaryColor,
            boxShadow: `0 1px 12px ${theme.primaryColor}60`
          }}
        />

        <div className="absolute top-[1px] left-0 right-0 h-[1px] w-full bg-gradient-to-r from-transparent via-current to-transparent opacity-80 pointer-events-none z-50" style={{ color: theme.primaryColor }} />

        <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 h-7 flex items-center justify-between">
          <nav className="hidden sm:flex items-center space-x-1">
            {categoryVisibility.industries && (
              <Link href="/crypto-payments" className="flex items-center text-[10px] leading-none tracking-widest uppercase text-foreground/80 px-2 py-0.5 rounded hover:bg-foreground/5 transition-colors">
                Industries
              </Link>
            )}
            {categoryVisibility.comparisons && (
              <Link href="/vs" className="flex items-center text-[10px] leading-none tracking-widest uppercase text-foreground/80 px-2 py-0.5 rounded hover:bg-foreground/5 transition-colors">
                Comparisons
              </Link>
            )}
            {categoryVisibility.locations && (
              <Link href="/locations" className="flex items-center text-[10px] leading-none tracking-widest uppercase text-foreground/80 px-2 py-0.5 rounded hover:bg-foreground/5 transition-colors">
                Locations
              </Link>
            )}
            <Link href="/developers" className="flex items-center text-[10px] leading-none tracking-widest uppercase text-foreground/80 px-2 py-0.5 rounded hover:bg-foreground/5 transition-colors">
              Developers
            </Link>
          </nav>
          <div className="relative z-50 ml-auto" ref={dropdownRef}>
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="flex items-center space-x-1.5 px-2 py-0.5 rounded hover:bg-foreground/5 transition-colors max-w-[180px] sm:max-w-none"
              aria-label={tLanguageBar("selectLanguage")}
            >
              <Globe className="h-3 w-3 opacity-60 -mt-px shrink-0" />
              <span className="text-[10px] leading-none tracking-widest uppercase opacity-80 truncate">{currentLanguage}</span>
            </button>

            {isOpen && (
              <div className="absolute right-0 top-full mt-1 w-72 max-h-[400px] glass-float rounded-md border shadow-xl z-50 flex flex-col font-sans">
                {/* Search field */}
                <div className="p-2 border-b sticky top-0 bg-background/95 backdrop-blur-sm">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search languages..."
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck="false"
                      data-form-type="other"
                      data-lpignore="true"
                      className="w-full pl-7 pr-2 py-1 text-xs rounded border bg-background/50 focus:outline-none focus:ring-1 focus:ring-foreground/20 font-sans"
                    />
                  </div>
                </div>

                {/* Language list */}
                <div className="overflow-y-auto flex-1 p-1">
                  {!searchQuery && supportedPopularLanguages.length > 0 && (
                    <div className="mb-2">
                      <div className="px-1.5 py-0.5 microtext text-[8px] font-semibold text-muted-foreground uppercase tracking-wider sticky top-0 bg-background/95 backdrop-blur-sm z-10">
                        POPULAR LANGUAGES
                      </div>
                      <div className="space-y-0">
                        {supportedPopularLanguages.map((lang) => {
                          const emoji = FICTIONAL_LANG_ICONS[lang];
                          return (
                            <button
                              key={lang}
                              onClick={() => handleLanguageChange(lang)}
                              className={`w-full text-left px-1.5 py-0.5 rounded microtext text-[9px] transition-colors flex items-center justify-between ${
                                currentLanguage === lang
                                  ? "bg-foreground/5 font-medium text-foreground"
                                  : "text-foreground/80 hover:bg-foreground/10"
                                }`}
                            >
                              <span className="flex items-center gap-1.5">
                                {emoji && <span className="text-[10px]">{emoji}</span>}
                                <span>{lang}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="border-t my-2" />
                    </div>
                  )}

                  {searchQuery && filteredGroups ? (
                    Object.entries(filteredGroups).length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                        No languages found matching "{searchQuery}"
                      </div>
                    ) : (
                      Object.entries(filteredGroups).map(([group, languages]) => (
                        <div key={group} className="mb-1 last:mb-0">
                          <div className="px-1.5 py-0.5 microtext text-[8px] font-semibold text-muted-foreground uppercase tracking-wider sticky top-0 bg-background/95 backdrop-blur-sm z-10">
                            {group}
                          </div>
                          <div className="space-y-0">
                            {languages.map((lang) => {
                              const emoji = FICTIONAL_LANG_ICONS[lang];
                              return (
                                <button
                                  key={lang}
                                  onClick={() => handleLanguageChange(lang)}
                                  className={`w-full text-left px-1.5 py-0.5 rounded microtext text-[9px] transition-colors flex items-center justify-between ${
                                    currentLanguage === lang
                                      ? "bg-foreground/5 font-medium text-foreground"
                                      : "text-foreground/80 hover:bg-foreground/10"
                                    }`}
                                >
                                  <span className="flex items-center gap-1.5">
                                    {emoji && <span className="text-[10px]">{emoji}</span>}
                                    <span>{lang}</span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    )
                  ) : !searchQuery ? (
                    GROUPS.map((group) => {
                      const allLanguages = LANGS_BY_REGION_OR_GROUP[group] || [];
                      const languages = allLanguages.filter(lang => isLanguageSupported(lang));
                      if (languages.length === 0) return null;

                      return (
                        <div key={group} className="mb-1 last:mb-0">
                          <div className="px-1.5 py-0.5 microtext text-[8px] font-semibold text-muted-foreground uppercase tracking-wider sticky top-0 bg-background/95 backdrop-blur-sm z-10">
                            {group}
                          </div>
                          <div className="space-y-0">
                            {languages.map((lang) => {
                              const emoji = FICTIONAL_LANG_ICONS[lang];
                              return (
                                <button
                                  key={lang}
                                  onClick={() => handleLanguageChange(lang)}
                                  className={`w-full text-left px-1.5 py-0.5 rounded microtext text-[9px] transition-colors flex items-center justify-between ${
                                    currentLanguage === lang
                                      ? "bg-foreground/5 font-medium text-foreground"
                                      : "text-foreground/80 hover:bg-foreground/10"
                                    }`}
                                >
                                  <span className="flex items-center gap-1.5">
                                    {emoji && <span className="text-[10px]">{emoji}</span>}
                                    <span>{lang}</span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </>
  );
}
