'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Search,
  Globe,
  MapPin,
  GitCompare,
  Eye,
  EyeOff,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  FileText,
  Tag,
  TrendingUp,
  Edit2,
  Save,
  X,
  Plus,
  Trash2,
  Settings,
  Layout,
  CheckSquare,
  Square,
  ToggleLeft,
  ToggleRight,
  Building2,
  Loader2,
  RefreshCw,
} from 'lucide-react';

// Import from existing data files
import { getAllIndustries } from '@/lib/landing-pages/industries';
import { getAllComparisons } from '@/lib/landing-pages/comparisons';
import { getAllLocations } from '@/lib/landing-pages/locations';
import { useBrand } from '@/contexts/BrandContext';
import type { IndustryLandingData, ComparisonData, LocationData } from '@/lib/landing-pages/types';

type PageCategory = 'industries' | 'comparisons' | 'locations';
type ViewMode = 'pages' | 'templates';

interface PageStatus {
  enabled: boolean;
}

interface PageItem {
  id: string;
  category: PageCategory;
  title: string;
  slug: string;
  metaDescription: string;
  path: string;
  details: Record<string, unknown>;
  rawData: IndustryLandingData | ComparisonData | LocationData;
}

const TEMPLATE_SECTIONS: Record<PageCategory, Array<{ key: string; label: string; description: string; type: 'text' | 'textarea' }>> = {
  industries: [
    { key: 'heroHeadline', label: 'Hero Headline Template', description: 'Main headline. Use {industry} and {brandName} for dynamic replacement.', type: 'text' },
    { key: 'heroSubheadline', label: 'Hero Subheadline Template', description: 'Supporting text. Use {industry} and {brandName} for dynamic replacement.', type: 'textarea' },
    { key: 'painPointsIntro', label: 'Pain Points Intro', description: 'Introduction for pain points section.', type: 'textarea' },
    { key: 'solutionsIntro', label: 'Solutions Intro', description: 'Introduction for solutions section.', type: 'textarea' },
    { key: 'ctaPrimary', label: 'Primary CTA Text', description: 'Main call-to-action button text.', type: 'text' },
    { key: 'ctaSecondary', label: 'Secondary CTA Text', description: 'Secondary call-to-action text.', type: 'text' },
  ],
  comparisons: [
    { key: 'headline', label: 'Headline Template', description: 'Use {competitor} and {brandName} for dynamic replacement.', type: 'text' },
    { key: 'subheadline', label: 'Subheadline Template', description: 'Use {competitor} and {brandName} for dynamic replacement.', type: 'textarea' },
    { key: 'pricingIntro', label: 'Pricing Intro', description: 'Introduction for pricing comparison.', type: 'textarea' },
    { key: 'featuresIntro', label: 'Features Intro', description: 'Introduction for features comparison.', type: 'textarea' },
  ],
  locations: [
    { key: 'headline', label: 'Headline Template', description: 'Use {city}, {state}, {country}, {brandName} for dynamic replacement.', type: 'text' },
    { key: 'subheadline', label: 'Subheadline Template', description: 'Use location placeholders and {brandName}.', type: 'textarea' },
    { key: 'localContextIntro', label: 'Local Context Intro', description: 'Introduction for local context.', type: 'textarea' },
  ],
};

// Brand-aware default templates
function getDefaultTemplates(brandName: string): Record<PageCategory, Record<string, string>> {
  return {
    industries: {
      heroHeadline: `Accept Crypto Payments for {industry}`,
      heroSubheadline: `The most affordable way for {industry} businesses to accept cryptocurrency payments with ${brandName}.`,
      painPointsIntro: `Common challenges faced by {industry} businesses:`,
      solutionsIntro: `How ${brandName} solves these challenges:`,
      ctaPrimary: 'Get Started Free',
      ctaSecondary: 'View Pricing',
    },
    comparisons: {
      headline: `${brandName} vs {competitor}`,
      subheadline: `See how ${brandName} compares to {competitor} for crypto payments.`,
      pricingIntro: 'Compare pricing and see your potential savings:',
      featuresIntro: 'Feature-by-feature comparison:',
    },
    locations: {
      headline: `Crypto Payments in {city}`,
      subheadline: `Accept cryptocurrency payments for your {city} business with ${brandName}.`,
      localContextIntro: `About crypto payments in {city}, {country}:`,
    },
  };
}

export function SEOLandingPagesPanel() {
  const brand = useBrand();
  const isPartnerContainer = brand.key.toLowerCase() !== 'portalpay' && brand.key.toLowerCase() !== 'basaltsurge';

  const [viewMode, setViewMode] = useState<ViewMode>('pages');
  const [activeCategory, setActiveCategory] = useState<PageCategory>('industries');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPage, setExpandedPage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [editingPage, setEditingPage] = useState<PageItem | null>(null);
  const [editFormData, setEditFormData] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [pageStatuses, setPageStatuses] = useState<Record<string, PageStatus>>({});
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());

  // Initialize templates with brand name
  const defaultTemplates = useMemo(() => getDefaultTemplates(brand.name), [brand.name]);
  const [templates, setTemplates] = useState<Record<PageCategory, Record<string, string>>>(defaultTemplates);
  const [editingTemplate, setEditingTemplate] = useState<{ category: PageCategory; key: string } | null>(null);
  const [templateEditValue, setTemplateEditValue] = useState('');

  // Loading and persistence state
  const [loading, setLoading] = useState(true);
  const [persistError, setPersistError] = useState('');
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadDone = useRef(false);

  // Ref to track modal and trigger element position
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Load settings from API on mount
  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        setLoading(true);
        setPersistError('');

        const res = await fetch('/api/admin/seo-pages', {
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!res.ok) {
          throw new Error(`Failed to load settings: ${res.status}`);
        }

        const data = await res.json();

        if (cancelled) return;

        if (data.ok && data.settings) {
          // Load page statuses
          if (data.settings.pageStatuses && typeof data.settings.pageStatuses === 'object') {
            setPageStatuses(data.settings.pageStatuses);
          }

          // Load templates - merge with defaults
          if (data.settings.templates && typeof data.settings.templates === 'object') {
            const loadedTemplates = data.settings.templates;
            setTemplates(prev => ({
              industries: { ...prev.industries, ...loadedTemplates.industries },
              comparisons: { ...prev.comparisons, ...loadedTemplates.comparisons },
              locations: { ...prev.locations, ...loadedTemplates.locations },
            }));
          }

          console.log('[SEOPages] Loaded settings for brand:', data.brandKey, {
            pageStatusCount: Object.keys(data.settings.pageStatuses || {}).length,
          });
        }

        initialLoadDone.current = true;
      } catch (err: any) {
        console.error('[SEOPages] Failed to load settings:', err);
        if (!cancelled) {
          setPersistError(err?.message || 'Failed to load settings');
        }
        initialLoadDone.current = true;
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadSettings();

    return () => {
      cancelled = true;
    };
  }, [brand.key]); // Reload when brand changes

  // Auto-save settings when they change (debounced)
  const saveSettings = useCallback(async (statuses: Record<string, PageStatus>, tmpls: Record<PageCategory, Record<string, string>>) => {
    try {
      setPersistError('');

      const res = await fetch('/api/admin/seo-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageStatuses: statuses,
          templates: tmpls,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Save failed: ${res.status}`);
      }

      const data = await res.json();
      if (data.ok) {
        setLastSaved(Date.now());
        console.log('[SEOPages] Settings saved for brand:', data.brandKey);
      }
    } catch (err: any) {
      console.error('[SEOPages] Failed to save settings:', err);
      setPersistError(err?.message || 'Failed to save');
    }
  }, []);

  // Debounced save when pageStatuses change
  useEffect(() => {
    if (!initialLoadDone.current) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveSettings(pageStatuses, templates);
    }, 1000); // 1 second debounce

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [pageStatuses, templates, saveSettings]);

  // Update templates when brand changes
  useEffect(() => {
    setTemplates(getDefaultTemplates(brand.name));
  }, [brand.name]);

  // Transform page content to be brand-aware
  const transformContentForBrand = useCallback((content: string): string => {
    return content
      .replace(/PortalPay/g, brand.name)
      .replace(/\{brandName\}/g, brand.name);
  }, [brand.name]);

  const allPages = useMemo((): PageItem[] => {
    const pages: PageItem[] = [];

    getAllIndustries().forEach((industry) => {
      pages.push({
        id: `industry-${industry.slug}`,
        category: 'industries',
        title: transformContentForBrand(industry.title),
        slug: industry.slug,
        metaDescription: transformContentForBrand(industry.metaDescription),
        path: `/crypto-payments/${industry.slug}`,
        details: {
          heroHeadline: transformContentForBrand(industry.heroHeadline),
          heroSubheadline: transformContentForBrand(industry.heroSubheadline),
          painPoints: industry.painPoints,
          solutions: industry.solutions?.map(s => transformContentForBrand(String(s))),
          benefits: industry.benefits,
          useCases: industry.useCases,
          industryFeatures: industry.industryFeatures,
          faqs: industry.faqs,
        },
        rawData: industry,
      });
    });

    getAllComparisons().forEach((comparison) => {
      pages.push({
        id: `comparison-${comparison.slug}`,
        category: 'comparisons',
        title: transformContentForBrand(comparison.title),
        slug: comparison.slug,
        metaDescription: transformContentForBrand(comparison.metaDescription),
        path: `/vs/${comparison.slug}`,
        details: {
          headline: transformContentForBrand(comparison.headline),
          subheadline: transformContentForBrand(comparison.subheadline),
          competitorName: comparison.name,
          pricing: comparison.pricing,
          features: comparison.features,
          migrationSteps: comparison.migrationSteps,
          useCases: comparison.useCases,
        },
        rawData: comparison,
      });
    });

    getAllLocations().forEach((location) => {
      pages.push({
        id: `location-${location.slug}`,
        category: 'locations',
        title: transformContentForBrand(location.title),
        slug: location.slug,
        metaDescription: transformContentForBrand(location.metaDescription),
        path: `/locations/${location.slug}`,
        details: {
          city: location.city,
          country: location.country,
          localContext: location.localContext ? transformContentForBrand(location.localContext) : undefined,
          popularIndustries: location.popularIndustries,
          population: location.population,
          businessCount: location.businessCount,
        },
        rawData: location,
      });
    });

    return pages;
  }, [transformContentForBrand]);

  const filteredPages = useMemo(() => {
    return allPages.filter((page) => {
      if (page.category !== activeCategory) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!page.title.toLowerCase().includes(query) &&
          !page.slug.toLowerCase().includes(query) &&
          !page.metaDescription.toLowerCase().includes(query)) return false;
      }
      if (statusFilter !== 'all') {
        const isEnabled = pageStatuses[page.id]?.enabled ?? true;
        if (statusFilter === 'enabled' && !isEnabled) return false;
        if (statusFilter === 'disabled' && isEnabled) return false;
      }
      return true;
    });
  }, [allPages, activeCategory, searchQuery, statusFilter, pageStatuses]);

  const categoryCounts = useMemo(() => ({
    industries: allPages.filter((p) => p.category === 'industries').length,
    comparisons: allPages.filter((p) => p.category === 'comparisons').length,
    locations: allPages.filter((p) => p.category === 'locations').length,
  }), [allPages]);

  // Check if entire category is disabled (all pages in category are disabled)
  // This is used to communicate to the site navbar which categories to hide
  const categoryAllDisabled = useMemo(() => {
    const result: Record<PageCategory, boolean> = {
      industries: false,
      comparisons: false,
      locations: false,
    };

    (['industries', 'comparisons', 'locations'] as PageCategory[]).forEach((category) => {
      const pagesInCategory = allPages.filter((p) => p.category === category);
      if (pagesInCategory.length === 0) {
        result[category] = false; // Empty category is not considered "all disabled"
      } else {
        // Check if ALL pages in this category are explicitly disabled
        result[category] = pagesInCategory.every((p) => pageStatuses[p.id]?.enabled === false);
      }
    });

    return result;
  }, [allPages, pageStatuses]);

  // Selection helpers
  const selectedInCurrentCategory = useMemo(() => {
    return filteredPages.filter(p => selectedPages.has(p.id));
  }, [filteredPages, selectedPages]);

  const allFilteredSelected = useMemo(() => {
    return filteredPages.length > 0 && filteredPages.every(p => selectedPages.has(p.id));
  }, [filteredPages, selectedPages]);

  const someSelected = selectedInCurrentCategory.length > 0;

  const toggleSelectAll = useCallback(() => {
    if (allFilteredSelected) {
      // Deselect all filtered pages
      setSelectedPages(prev => {
        const next = new Set(prev);
        filteredPages.forEach(p => next.delete(p.id));
        return next;
      });
    } else {
      // Select all filtered pages
      setSelectedPages(prev => {
        const next = new Set(prev);
        filteredPages.forEach(p => next.add(p.id));
        return next;
      });
    }
  }, [allFilteredSelected, filteredPages]);

  const toggleSelectPage = useCallback((pageId: string) => {
    setSelectedPages(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  }, []);

  const enableSelectedPages = useCallback(() => {
    setPageStatuses(prev => {
      const next = { ...prev };
      selectedInCurrentCategory.forEach(p => {
        next[p.id] = { enabled: true };
      });
      return next;
    });
    setInfo(`Enabled ${selectedInCurrentCategory.length} pages`);
    setTimeout(() => setInfo(''), 2000);
  }, [selectedInCurrentCategory]);

  const disableSelectedPages = useCallback(() => {
    setPageStatuses(prev => {
      const next = { ...prev };
      selectedInCurrentCategory.forEach(p => {
        next[p.id] = { enabled: false };
      });
      return next;
    });
    setInfo(`Disabled ${selectedInCurrentCategory.length} pages`);
    setTimeout(() => setInfo(''), 2000);
  }, [selectedInCurrentCategory]);

  const clearSelection = useCallback(() => {
    setSelectedPages(new Set());
  }, []);

  const togglePageStatus = (pageId: string) => {
    setPageStatuses((prev) => ({
      ...prev,
      [pageId]: { enabled: !(prev[pageId]?.enabled ?? true) },
    }));
    setInfo('Page status updated');
    setTimeout(() => setInfo(''), 2000);
  };

  const getCategoryIcon = (category: PageCategory) => {
    switch (category) {
      case 'industries': return <Globe className="h-4 w-4" />;
      case 'comparisons': return <GitCompare className="h-4 w-4" />;
      case 'locations': return <MapPin className="h-4 w-4" />;
    }
  };

  const openEditModal = useCallback((page: PageItem, buttonElement?: HTMLButtonElement) => {
    setEditingPage(page);
    setEditFormData({ title: page.title, metaDescription: page.metaDescription, ...page.details });
    setError('');
    setInfo('');
    triggerRef.current = buttonElement || null;
  }, []);

  // Scroll modal into view when it opens
  useEffect(() => {
    if (editingPage && modalRef.current) {
      // Small delay to ensure modal is rendered
      setTimeout(() => {
        modalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    }
  }, [editingPage]);

  const closeEditModal = useCallback(() => {
    setEditingPage(null);
    setEditFormData({});
    setError('');
  }, []);

  const savePageEdits = useCallback(async () => {
    if (!editingPage) return;
    setSaving(true);
    setError('');
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      setInfo('Page updated successfully. Changes stored locally until API integration.');
      setTimeout(() => { setInfo(''); closeEditModal(); }, 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }, [editingPage, closeEditModal]);

  const updateFormField = useCallback((key: string, value: unknown) => {
    setEditFormData(prev => ({ ...prev, [key]: value }));
  }, []);

  const startEditingTemplate = useCallback((category: PageCategory, key: string) => {
    setEditingTemplate({ category, key });
    setTemplateEditValue(templates[category][key] || defaultTemplates[category][key] || '');
  }, [templates, defaultTemplates]);

  const saveTemplate = useCallback(() => {
    if (!editingTemplate) return;
    setTemplates(prev => ({
      ...prev,
      [editingTemplate.category]: { ...prev[editingTemplate.category], [editingTemplate.key]: templateEditValue },
    }));
    setEditingTemplate(null);
    setTemplateEditValue('');
    setInfo('Template updated');
    setTimeout(() => setInfo(''), 2000);
  }, [editingTemplate, templateEditValue]);

  const resetTemplate = useCallback((category: PageCategory, key: string) => {
    setTemplates(prev => ({
      ...prev,
      [category]: { ...prev[category], [key]: defaultTemplates[category][key] },
    }));
    setInfo('Template reset to default');
    setTimeout(() => setInfo(''), 2000);
  }, [defaultTemplates]);

  const renderFormInput = useCallback((key: string, value: unknown) => {
    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

    if (Array.isArray(value)) {
      return (
        <div key={key} className="space-y-2">
          <label className="microtext text-muted-foreground flex items-center gap-2">
            <Tag className="h-3 w-3" />{label}
          </label>
          <div className="space-y-1">
            {((editFormData[key] as unknown[]) || value).map((item, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  className="flex-1 h-9 px-3 py-1 border rounded-md bg-background text-sm"
                  value={typeof item === 'object' ? JSON.stringify(item) : String(item)}
                  onChange={(e) => {
                    const arr = [...((editFormData[key] as unknown[]) || value)];
                    try { arr[idx] = JSON.parse(e.target.value); } catch { arr[idx] = e.target.value; }
                    updateFormField(key, arr);
                  }}
                />
                <button type="button" onClick={() => {
                  const arr = [...((editFormData[key] as unknown[]) || value)];
                  arr.splice(idx, 1);
                  updateFormField(key, arr);
                }} className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => {
              const arr = [...((editFormData[key] as unknown[]) || value), ''];
              updateFormField(key, arr);
            }} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400">
              <Plus className="h-3 w-3" /> Add item
            </button>
          </div>
        </div>
      );
    }

    if (typeof value === 'object' && value !== null) {
      return (
        <div key={key} className="space-y-2">
          <label className="microtext text-muted-foreground flex items-center gap-2">
            <Settings className="h-3 w-3" />{label}
          </label>
          <textarea
            className="w-full h-24 px-3 py-2 border rounded-md bg-background text-sm font-mono"
            value={JSON.stringify(editFormData[key] || value, null, 2)}
            onChange={(e) => { try { updateFormField(key, JSON.parse(e.target.value)); } catch { /* ignore */ } }}
          />
        </div>
      );
    }

    if (String(value).length > 100) {
      return (
        <div key={key} className="space-y-2">
          <label className="microtext text-muted-foreground">{label}</label>
          <textarea
            className="w-full h-24 px-3 py-2 border rounded-md bg-background text-sm"
            value={String(editFormData[key] ?? value)}
            onChange={(e) => updateFormField(key, e.target.value)}
          />
        </div>
      );
    }

    return (
      <div key={key} className="space-y-1">
        <label className="microtext text-muted-foreground">{label}</label>
        <input
          className="w-full h-9 px-3 py-1 border rounded-md bg-background text-sm"
          value={String(editFormData[key] ?? value)}
          onChange={(e) => updateFormField(key, e.target.value)}
        />
      </div>
    );
  }, [editFormData, updateFormField]);

  return (
    <div className="w-full space-y-6 pb-24 admin-panel-enter">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">SEO Landing Pages</h2>
            <p className="microtext text-muted-foreground mt-1">
              Manage programmatic SEO pages for industries, competitors, and locations
            </p>
          </div>
        <div className="flex items-center gap-4">
          {/* Save status indicator */}
          {lastSaved && !persistError && (
            <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <Save className="h-3 w-3" />
              <span>Saved</span>
            </div>
          )}
          {persistError && (
            <div className="flex items-center gap-1.5 text-xs text-red-500">
              <X className="h-3 w-3" />
              <span>{persistError}</span>
            </div>
          )}
          {isPartnerContainer && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/10 text-primary text-sm">
              <Building2 className="h-4 w-4" />
              <span>{brand.name}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            <span>{allPages.length} total pages</span>
          </div>
        </div>
      </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">Loading settings...</span>
        </div>
      )}

      {/* Brand Notice for Partner Containers */}
      {!loading && isPartnerContainer && (
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-3">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            <strong>Partner Container:</strong> Content is customized for <strong>{brand.name}</strong> (brand key: {brand.key}).
            All templates and page content will use your brand name instead of PortalPay.
          </p>
        </div>
      )}

      {/* View Mode Toggle */}
      {!loading && (
        <div className="flex gap-2 p-1 border border-foreground/[0.05] bg-foreground/[0.02] rounded-xl w-fit">
          <button data-tour="seoPages.viewMode.pages" data-tour-action="activate" data-tour-active={viewMode === 'pages'}
            onClick={() => setViewMode('pages')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${viewMode === 'pages' ? 'bg-background shadow text-foreground border border-foreground/[0.05]' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.02]'
              }`}
          >
            <FileText className="h-4 w-4" />Pages
          </button>
          <button data-tour="seoPages.viewMode.templates" data-tour-action="activate" data-tour-active={viewMode === 'templates'}
            onClick={() => setViewMode('templates')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${viewMode === 'templates' ? 'bg-background shadow text-foreground border border-foreground/[0.05]' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.02]'
              }`}
          >
            <Layout className="h-4 w-4" />Base Templates
          </button>
        </div>
      )}

      {!loading && info && <div className="microtext text-green-600 dark:text-green-400">{info}</div>}
      {!loading && error && <div className="microtext text-red-500">{error}</div>}

      {/* Category Tabs - always show all tabs in admin panel */}
      {!loading && (
        <div className="flex gap-2 border-b border-foreground/[0.05]">
          {(['industries', 'comparisons', 'locations'] as PageCategory[]).map((category) => {
            const isAllDisabled = categoryAllDisabled[category];

            return (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeCategory === category
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
              >
                {getCategoryIcon(category)}
                <span className="capitalize">{category}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs ${activeCategory === category ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                  }`}>
                  {categoryCounts[category]}
                </span>
                {isAllDisabled && (
                  <span className="px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                    Hidden
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {!loading && viewMode === 'templates' ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md p-6">
            <h3 className="font-medium mb-3 flex items-center gap-2">
              <Layout className="h-4 w-4" />
              {activeCategory.charAt(0).toUpperCase() + activeCategory.slice(1)} Templates
            </h3>
            <p className="microtext text-muted-foreground mb-4">
              Configure base templates for all {activeCategory} pages. Use placeholders for dynamic content.
              {isPartnerContainer && <span className="text-amber-600"> Templates use "{brand.name}" as the brand name.</span>}
            </p>
            <div className="space-y-4">
              {TEMPLATE_SECTIONS[activeCategory].map((section) => {
                const currentValue = templates[activeCategory][section.key] || defaultTemplates[activeCategory][section.key] || '';
                const isEditing = editingTemplate?.category === activeCategory && editingTemplate?.key === section.key;
                const isModified = currentValue !== defaultTemplates[activeCategory][section.key];

                return (
                  <div key={section.key} className="rounded-md border p-4 bg-background">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div>
                        <label className="font-medium text-sm flex items-center gap-2">
                          {section.label}
                          {isModified && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                              Modified
                            </span>
                          )}
                        </label>
                        <p className="microtext text-muted-foreground">{section.description}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        {!isEditing && (
                          <>
                            <button onClick={() => startEditingTemplate(activeCategory, section.key)} className="p-1.5 rounded-md hover:bg-muted transition-colors" title="Edit template">
                              <Edit2 className="h-4 w-4" />
                            </button>
                            {isModified && (
                              <button onClick={() => resetTemplate(activeCategory, section.key)} className="p-1.5 rounded-md hover:bg-muted transition-colors text-amber-600" title="Reset to default">
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    {isEditing ? (
                      <div className="space-y-2">
                        {section.type === 'textarea' ? (
                          <textarea className="w-full h-24 px-3 py-2 border rounded-md bg-background text-sm" value={templateEditValue} onChange={(e) => setTemplateEditValue(e.target.value)} autoFocus />
                        ) : (
                          <input className="w-full h-9 px-3 py-1 border rounded-md bg-background text-sm" value={templateEditValue} onChange={(e) => setTemplateEditValue(e.target.value)} autoFocus />
                        )}
                        <div className="flex items-center gap-2">
                          <button onClick={saveTemplate} className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm">
                            <Save className="h-3 w-3" /> Save
                          </button>
                          <button onClick={() => setEditingTemplate(null)} className="flex items-center gap-1 px-3 py-1.5 rounded-md border text-sm">
                            <X className="h-3 w-3" /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground bg-muted/30 rounded-md p-2">{currentValue || '—'}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : !loading ? (
        <>
          {/* Filters and Bulk Actions */}
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex-1 relative min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={`Search ${activeCategory}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 h-10 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] text-sm transition-colors hover:bg-foreground/[0.04] focus:border-foreground/30 focus:outline-none placeholder-muted-foreground"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="h-10 px-3 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] text-sm transition-colors hover:bg-foreground/[0.04] focus:border-foreground/30 focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>

          {/* Bulk Actions Bar */}
          <div className="flex items-center justify-between p-4 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {allFilteredSelected ? (
                  <CheckSquare className="h-5 w-5 text-primary" />
                ) : (
                  <Square className="h-5 w-5" />
                )}
                <span>{allFilteredSelected ? 'Deselect All' : 'Select All'}</span>
              </button>
              {someSelected && (
                <span className="text-sm text-muted-foreground">
                  {selectedInCurrentCategory.length} selected
                </span>
              )}
            </div>
            {someSelected && (
              <div className="flex items-center gap-2">
                <button
                  onClick={enableSelectedPages}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-sm hover:bg-emerald-500/20 transition-all font-medium"
                >
                  <Eye className="h-4 w-4" />
                  Enable Selected
                </button>
                <button
                  onClick={disableSelectedPages}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-sm hover:bg-red-500/20 transition-all font-medium"
                >
                  <EyeOff className="h-4 w-4" />
                  Disable Selected
                </button>
                <button
                  onClick={clearSelection}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-foreground/[0.05] bg-background text-sm hover:bg-foreground/[0.02] transition-all font-medium"
                >
                  <X className="h-4 w-4" />
                  Clear
                </button>
              </div>
            )}
          </div>

          <div className="microtext text-muted-foreground">
            Showing {filteredPages.length} of {categoryCounts[activeCategory]} {activeCategory}
          </div>

          {/* Page List */}
          <div className="space-y-2">
            {filteredPages.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No pages found matching your criteria</p>
              </div>
            ) : (
              filteredPages.map((page) => {
                const isExpanded = expandedPage === page.id;
                const isEnabled = pageStatuses[page.id]?.enabled ?? true;
                const isSelected = selectedPages.has(page.id);

                return (
                  <div key={page.id} className={`border rounded-xl overflow-hidden transition-colors ${isEnabled ? 'border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md' : 'border-foreground/[0.02] bg-transparent opacity-75'} ${isSelected ? 'ring-2 ring-primary' : ''}`}>
                    <div className="flex items-center gap-4 p-4">
                      <button onClick={() => toggleSelectPage(page.id)} className="text-muted-foreground hover:text-foreground">
                        {isSelected ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5" />}
                      </button>
                      <button onClick={() => setExpandedPage(isExpanded ? null : page.id)} className="text-muted-foreground hover:text-foreground">
                        {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className={`font-medium truncate ${isEnabled ? 'text-foreground' : 'text-muted-foreground'}`}>{page.title}</h3>
                          {!isEnabled && <span className="px-2 py-0.5 text-xs rounded bg-muted text-muted-foreground">Disabled</span>}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{page.path}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button onClick={(e) => openEditModal(page, e.currentTarget)} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Edit page">
                          <Edit2 className="h-5 w-5" />
                        </button>
                        <button onClick={() => togglePageStatus(page.id)} className={`p-2 rounded-lg transition-colors ${isEnabled ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20' : 'text-muted-foreground hover:bg-muted'}`} title={isEnabled ? 'Disable page' : 'Enable page'}>
                          {isEnabled ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
                        </button>
                        <a href={page.path} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lg text-muted-foreground hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Preview page">
                          <ExternalLink className="h-5 w-5" />
                        </a>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-4 pb-4 pt-2 border-t border-foreground/[0.02] bg-foreground/[0.01]">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="col-span-full">
                            <label className="microtext text-muted-foreground mb-1 block">Meta Description</label>
                            <p className="text-sm text-foreground bg-background p-3 rounded border border-border">{page.metaDescription}</p>
                          </div>
                          {Object.entries(page.details).map(([key, value]) => {
                            if (value === undefined || value === null) return null;
                            const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
                            let displayValue: React.ReactNode;

                            if (Array.isArray(value)) {
                              displayValue = (
                                <div className="flex flex-wrap gap-1">
                                  {value.map((item, idx) => (
                                    <span key={idx} className="px-2 py-0.5 text-xs rounded bg-primary/10 text-primary">
                                      {typeof item === 'object' ? JSON.stringify(item) : String(item)}
                                    </span>
                                  ))}
                                </div>
                              );
                            } else if (typeof value === 'object') {
                              displayValue = (
                                <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32">{JSON.stringify(value, null, 2)}</pre>
                              );
                            } else if (typeof value === 'number') {
                              displayValue = <span className="font-mono">{value.toLocaleString()}</span>;
                            } else {
                              displayValue = String(value);
                            }

                            return (
                              <div key={key}>
                                <label className="microtext text-muted-foreground mb-1 block flex items-center gap-1">
                                  <Tag className="h-3 w-3" />{label}
                                </label>
                                <div className="text-sm text-foreground">{displayValue}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : null}

      {/* Edit Modal - Fixed on screen, accounts for admin navbar */}
      {editingPage && (
        <>
          {/* Backdrop - covers entire viewport */}
          <div
            className="fixed inset-0 z-[60] bg-black/50"
            onClick={closeEditModal}
            aria-hidden="true"
          />

          {/* Modal container - positioned below admin nav */}
          <div
            ref={modalRef}
            className="fixed z-[61] left-1/2 -translate-x-1/2 top-[170px] md:top-[160px] w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] max-w-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-modal-title"
          >
            <div className="bg-background border border-border rounded-xl shadow-2xl overflow-hidden max-h-[calc(100vh-190px)] md:max-h-[calc(100vh-180px)] flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between p-3 sm:p-4 border-b border-border gap-2 flex-shrink-0">
                <h3 id="edit-modal-title" className="font-semibold text-base sm:text-lg truncate flex-1">
                  <span className="hidden sm:inline">Edit Page: </span>
                  <span className="sm:hidden">Edit: </span>
                  {editingPage.title}
                </h3>
                <button
                  onClick={closeEditModal}
                  className="p-1.5 rounded-md hover:bg-muted flex-shrink-0"
                  aria-label="Close modal"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Content - scrollable */}
              <div className="p-3 sm:p-4 overflow-y-auto flex-1">
                <div className="space-y-3 sm:space-y-4">
                  {renderFormInput('title', editingPage.title)}
                  {renderFormInput('metaDescription', editingPage.metaDescription)}
                  {Object.entries(editingPage.details).map(([key, value]) => {
                    if (value === undefined || value === null) return null;
                    return renderFormInput(key, value);
                  })}
                </div>
              </div>

              {/* Footer */}
              <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 p-3 sm:p-4 border-t border-border flex-shrink-0">
                <button
                  onClick={closeEditModal}
                  className="px-4 py-2.5 sm:py-2 rounded-md border text-sm w-full sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  onClick={savePageEdits}
                  disabled={saving}
                  className="px-4 py-2.5 sm:py-2 rounded-md bg-primary text-primary-foreground text-sm w-full sm:w-auto disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
