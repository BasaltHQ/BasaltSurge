export interface TourBrand {
  key: string;
  name: string;
  platformName: string;
  isPartner: boolean;
  ready: boolean;
}

export const NEUTRAL_TOUR_BRAND: TourBrand = { key: '', name: 'your workspace', platformName: 'your workspace', isPartner: false, ready: false };

// These values are display data, never instructions. Remove markup/template delimiters.
export function cleanBrandName(value?: string): string {
  return String(value || '').replace(/[<>\r\n{}\[\]`\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function resolveTourBrand(input: {
  key: string; isPartner: boolean; partnerName?: string;
  contextKey?: string; contextName?: string; platformName?: string; ready: boolean;
}): TourBrand {
  const key = input.key.trim().toLowerCase();
  const candidate = input.isPartner
    ? input.partnerName || (input.contextKey?.toLowerCase() === key ? input.contextName : '')
    : input.platformName || input.contextName;
  const clean = cleanBrandName(candidate);
  const generic = !clean || /^(ledger\d*|partner\d*|default)$/i.test(clean) ||
    (input.isPartner && /^(portalpay|basaltsurge)$/i.test(clean));
  const fallback = key && !/^(portalpay|basaltsurge|default|partner\d*|ledger\d*)$/i.test(key)
    ? cleanBrandName(key.replace(/[-_]/g, ' ').replace(/\b\w/g, char => char.toUpperCase())) : 'your workspace';
  const name = generic ? fallback : clean;
  return { key, name, platformName: name, isPartner: input.isPartner, ready: input.ready };
}

/** Substitute only supported text tokens; never evaluate templates or instructions. */
export function renderTourText(text: string, brand: TourBrand, panelTitle = '', sectionTitle = 'your workspace'): string {
  const values: Record<string, string> = { brandName: brand.name, platformName: brand.platformName, panelTitle, sectionTitle };
  return text.replace(/\{\{(brandName|platformName|panelTitle|sectionTitle)\}\}/g, (_, name: string) => values[name]);
}

export function tourSessionVariables(brand: TourBrand, learnerName = '') {
  return { tour_brand_name: brand.name, tour_platform_name: brand.platformName, tour_learner_name: learnerName };
}
