"use client";

import { useEffect, useState } from "react";
import { getAllIndustries } from "@/lib/landing-pages/industries";
import { getAllComparisons } from "@/lib/landing-pages/comparisons";
import { getAllLocations } from "@/lib/landing-pages/locations";

export type SeoCategory = "industries" | "comparisons" | "locations";
type PageStatuses = Record<string, { enabled?: boolean }>;

export function getSeoCategoryVisibility(pageStatuses: PageStatuses) {
  // Unconfigured pages are enabled, matching the SEO settings API defaults.
  const hasEnabledPage = (ids: string[]) => ids.some(id => pageStatuses[id]?.enabled !== false);
  return {
    industries: hasEnabledPage(getAllIndustries().map(page => `industry-${page.slug}`)),
    comparisons: hasEnabledPage(getAllComparisons().map(page => `comparison-${page.slug}`)),
    locations: hasEnabledPage(getAllLocations().map(page => `location-${page.slug}`)),
  };
}

export function useSeoCategoryVisibility() {
  // Do not flash disabled links while the current host's settings are loading.
  const [visibility, setVisibility] = useState<Record<SeoCategory, boolean>>({ industries: false, comparisons: false, locations: false });
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/admin/seo-pages", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        if (data.ok && data.settings?.pageStatuses && !controller.signal.aborted) {
          setVisibility(getSeoCategoryVisibility(data.settings.pageStatuses));
        }
      } catch { /* Keep links hidden when their visibility cannot be confirmed. */ }
    }
    void load();
    return () => controller.abort();
  }, []);
  return visibility;
}
