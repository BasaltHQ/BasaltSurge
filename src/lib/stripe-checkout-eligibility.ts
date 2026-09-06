// Keep the portal's existing country policy, accepting the country formats used
// by imported receipts as well as the ISO alpha-2 codes returned by Stripe.
const SUPPORTED_COUNTRIES: Array<[string, string, ...string[]]> = [
  ["US", "USA", "United States", "United States of America"],
  ["AT", "AUT", "Austria"],
  ["BE", "BEL", "Belgium"],
  ["BG", "BGR", "Bulgaria"],
  ["CY", "CYP", "Cyprus"],
  ["CZ", "CZE", "Czechia", "Czech Republic"],
  ["DE", "DEU", "Germany", "Deutschland"],
  ["DK", "DNK", "Denmark"],
  ["EE", "EST", "Estonia"],
  ["ES", "ESP", "Spain"],
  ["FI", "FIN", "Finland"],
  ["FR", "FRA", "France"],
  ["GR", "GRC", "Greece"],
  ["HR", "HRV", "Croatia"],
  ["HU", "HUN", "Hungary"],
  ["IE", "IRL", "Ireland"],
  ["IT", "ITA", "Italy"],
  ["LT", "LTU", "Lithuania"],
  ["LU", "LUX", "Luxembourg"],
  ["LV", "LVA", "Latvia"],
  ["MT", "MLT", "Malta"],
  ["NL", "NLD", "Netherlands", "The Netherlands"],
  ["PL", "POL", "Poland"],
  ["PT", "PRT", "Portugal"],
  ["RO", "ROU", "Romania"],
  ["SE", "SWE", "Sweden"],
  ["SI", "SVN", "Slovenia"],
  ["SK", "SVK", "Slovakia"],
  ["NO", "NOR", "Norway"],
  ["IS", "ISL", "Iceland"],
  ["LI", "LIE", "Liechtenstein"],
  ["CH", "CHE", "Switzerland"],
  ["GB", "GBR", "United Kingdom", "Great Britain", "UK"],
];

const supportedCodes = new Set(SUPPORTED_COUNTRIES.map(([code]) => code));
const countryAliases = new Map<string, string>();
for (const [code, ...aliases] of SUPPORTED_COUNTRIES) {
  for (const alias of aliases) countryAliases.set(alias.toUpperCase(), code);
}
countryAliases.set("CAN", "CA");
countryAliases.set("CANADA", "CA");

export function normalizeStripeCheckoutCountry(value: unknown): string {
  const country = String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
  if (!country || country === "UNKNOWN" || country === "XX") return "";
  return countryAliases.get(country) || country;
}

export function isUnsupportedStripeCheckoutRegion(
  billingCountry: unknown,
  shippingCountry: unknown,
  clientCountry: unknown,
): boolean {
  // Explicit addresses take precedence over IP geolocation.
  for (const value of [billingCountry, shippingCountry, clientCountry]) {
    const country = normalizeStripeCheckoutCountry(value);
    if (country) return !supportedCodes.has(country);
  }
  return false;
}

export function isStripeEmbeddedCheckoutEnabled({
  legacyHeadlessEnabled,
  v2Active,
  unsupportedRegion,
}: {
  legacyHeadlessEnabled: boolean;
  v2Active: boolean;
  unsupportedRegion: boolean;
}): boolean {
  // V2 renders the embedded checkout itself, so its callbacks must have an
  // enabled hook even when the separate legacy headless flag is off.
  return !unsupportedRegion && (legacyHeadlessEnabled || v2Active);
}
