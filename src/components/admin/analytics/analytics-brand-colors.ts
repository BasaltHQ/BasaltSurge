export const BRAND_COLOR_MAP: Record<string, string> = {
  aggregate: "#c084fc",   // Vibrant Purple / Orchid (Platform Aggregate)
  aipowerpay: "#38bdf8",  // Clear Sky Blue
  basaltsurge: "#f43f5e", // Crimson Rose
  lucky13: "#eab308",     // Warm Amber Gold
  "data-opt": "#10b981",  // Vivid Emerald Green
  dataopt: "#10b981",     // Vivid Emerald Green
  xoinpay: "#ec4899",     // Hot Magenta / Fuchsia
  lumina: "#06b6d4",      // Cyan / Teal
  luminapms: "#06b6d4",   // Cyan / Teal
  chickenbones: "#f97316",// Deep Orange
  varuna: "#14b8a6",      // Aquamarine Teal
  osiris: "#8b5cf6",      // Deep Lavender Violet
  skynetpod: "#6366f1",   // Indigo
  portalpay: "#a855f7",   // Violet Orchid
};

export const DISTINCT_BRAND_PALETTE: string[] = [
  "#10b981", // Emerald Green
  "#f59e0b", // Golden Amber
  "#ec4899", // Hot Magenta
  "#06b6d4", // Bright Cyan
  "#f97316", // Deep Orange
  "#8b5cf6", // Rich Violet
  "#84cc16", // Lime Chartreuse
  "#f43f5e", // Crimson Rose
  "#3b82f6", // Royal Blue
  "#14b8a6", // Aquamarine
  "#d946ef", // Fuchsia
  "#eab308", // Warm Gold
  "#6366f1", // Indigo
  "#059669", // Dark Mint
  "#fb7185", // Soft Rose
  "#0284c7", // Deep Sky Blue
];

export function getDistinctBrandColor(key?: string, idx?: number): string {
  if (!key) return DISTINCT_BRAND_PALETTE[0];
  const normalized = key.toLowerCase().trim();
  if (BRAND_COLOR_MAP[normalized]) {
    return BRAND_COLOR_MAP[normalized];
  }
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash << 5) - hash + normalized.charCodeAt(i);
    hash |= 0;
  }
  const colorIndex = Math.abs(hash + (idx !== undefined ? idx : 0)) % DISTINCT_BRAND_PALETTE.length;
  return DISTINCT_BRAND_PALETTE[colorIndex];
}
