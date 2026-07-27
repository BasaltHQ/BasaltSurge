/**
 * Foreign Exchange (FX) utilities for multi-currency support
 * Uses Coinbase ETH-base exchange rates to derive USD-base conversions
 */

/**
 * Comprehensive currency list - these are commonly available from Coinbase
 * Format: { code, symbol, name, decimals }
 */
export const SUPPORTED_CURRENCIES = [
  { code: "USD", symbol: "$", name: "US Dollar", decimals: 2 },
  { code: "EUR", symbol: "€", name: "Euro", decimals: 2 },
  { code: "GBP", symbol: "£", name: "British Pound", decimals: 2 },
  { code: "JPY", symbol: "¥", name: "Japanese Yen", decimals: 0 },
  { code: "CAD", symbol: "$", name: "Canadian Dollar", decimals: 2 },
  { code: "AUD", symbol: "$", name: "Australian Dollar", decimals: 2 },
  { code: "CHF", symbol: "CHF", name: "Swiss Franc", decimals: 2 },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan", decimals: 2 },
  { code: "INR", symbol: "₹", name: "Indian Rupee", decimals: 2 },
  { code: "KRW", symbol: "₩", name: "South Korean Won", decimals: 0 },
  { code: "BRL", symbol: "R$", name: "Brazilian Real", decimals: 2 },
  { code: "MXN", symbol: "$", name: "Mexican Peso", decimals: 2 },
  { code: "ZAR", symbol: "R", name: "South African Rand", decimals: 2 },
  { code: "SGD", symbol: "$", name: "Singapore Dollar", decimals: 2 },
  { code: "HKD", symbol: "$", name: "Hong Kong Dollar", decimals: 2 },
  { code: "NOK", symbol: "kr", name: "Norwegian Krone", decimals: 2 },
  { code: "SEK", symbol: "kr", name: "Swedish Krona", decimals: 2 },
  { code: "DKK", symbol: "kr", name: "Danish Krone", decimals: 2 },
  { code: "PLN", symbol: "zł", name: "Polish Zloty", decimals: 2 },
  { code: "TRY", symbol: "₺", name: "Turkish Lira", decimals: 2 },
  { code: "RUB", symbol: "₽", name: "Russian Ruble", decimals: 2 },
  { code: "NZD", symbol: "$", name: "New Zealand Dollar", decimals: 2 },
  { code: "THB", symbol: "฿", name: "Thai Baht", decimals: 2 },
  { code: "MYR", symbol: "RM", name: "Malaysian Ringgit", decimals: 2 },
  { code: "IDR", symbol: "Rp", name: "Indonesian Rupiah", decimals: 0 },
  { code: "PHP", symbol: "₱", name: "Philippine Peso", decimals: 2 },
  { code: "CZK", symbol: "Kč", name: "Czech Koruna", decimals: 2 },
  { code: "ILS", symbol: "₪", name: "Israeli Shekel", decimals: 2 },
  { code: "CLP", symbol: "$", name: "Chilean Peso", decimals: 0 },
  { code: "ARS", symbol: "$", name: "Argentine Peso", decimals: 2 },
  { code: "COP", symbol: "$", name: "Colombian Peso", decimals: 0 },
  { code: "PEN", symbol: "S/", name: "Peruvian Sol", decimals: 2 },
  { code: "AED", symbol: "د.إ", name: "UAE Dirham", decimals: 2 },
  { code: "SAR", symbol: "﷼", name: "Saudi Riyal", decimals: 2 },
  { code: "EGP", symbol: "£", name: "Egyptian Pound", decimals: 2 },
  { code: "NGN", symbol: "₦", name: "Nigerian Naira", decimals: 2 },
  { code: "KES", symbol: "KSh", name: "Kenyan Shilling", decimals: 2 },
  { code: "PKR", symbol: "₨", name: "Pakistani Rupee", decimals: 2 },
  { code: "BDT", symbol: "৳", name: "Bangladeshi Taka", decimals: 2 },
  { code: "VND", symbol: "₫", name: "Vietnamese Dong", decimals: 0 },
] as const;

export type CurrencyCode = typeof SUPPORTED_CURRENCIES[number]["code"];

/**
 * Get currency info by code
 */
export function getCurrency(code: string) {
  return SUPPORTED_CURRENCIES.find((c) => c.code === code.toUpperCase());
}

/**
 * Check if currency code is supported
 */
export function isSupportedCurrency(code: string): boolean {
  return SUPPORTED_CURRENCIES.some((c) => c.code === code.toUpperCase());
}

/**
 * Convert USD to any fiat currency using ETH-base rates from Coinbase
 * 
 * @param usdAmount - Amount in USD
 * @param targetCurrency - Target currency code (e.g., "EUR", "GBP")
 * @param ethRates - ETH-base rates map from Coinbase (e.g., { USD: 2000, EUR: 1800 })
 * @returns Amount in target currency, or 0 if conversion not possible
 * 
 * Formula: targetAmount = usdAmount * (targetPerEth / usdPerEth)
 * This derives the USD-to-target rate from ETH-base rates
 */
export function convertFromUsd(
  usdAmount: number,
  targetCurrency: string,
  ethRates: Record<string, number>
): number {
  const target = targetCurrency.toUpperCase();
  
  // If target is USD, no conversion needed
  if (target === "USD") return usdAmount;
  
  const usdPerEth = Number(ethRates["USD"] || 0);
  const targetPerEth = Number(ethRates[target] || 0);
  
  // Need both rates to convert
  if (!usdPerEth || usdPerEth <= 0 || !targetPerEth || targetPerEth <= 0) {
    return 0;
  }
  
  // Derive USD-to-target rate: (target per ETH) / (USD per ETH) = target per USD
  const targetPerUsd = targetPerEth / usdPerEth;
  return usdAmount * targetPerUsd;
}

/**
 * Convert any fiat currency to USD using ETH-base rates
 * 
 * @param amount - Amount in source currency
 * @param sourceCurrency - Source currency code
 * @param ethRates - ETH-base rates map from Coinbase
 * @returns Amount in USD, or 0 if conversion not possible
 */
export function convertToUsd(
  amount: number,
  sourceCurrency: string,
  ethRates: Record<string, number>
): number {
  const source = sourceCurrency.toUpperCase();
  
  // If source is USD, no conversion needed
  if (source === "USD") return amount;
  
  const usdPerEth = Number(ethRates["USD"] || 0);
  const sourcePerEth = Number(ethRates[source] || 0);
  
  if (!usdPerEth || usdPerEth <= 0 || !sourcePerEth || sourcePerEth <= 0) {
    return 0;
  }
  
  // Derive source-to-USD rate: (USD per ETH) / (source per ETH) = USD per source
  const usdPerSource = usdPerEth / sourcePerEth;
  return amount * usdPerSource;
}

/**
 * Format an amount in the specified currency
 * 
 * @param amount - Numeric amount
 * @param currencyCode - Currency code (e.g., "USD", "EUR")
 * @param options - Formatting options
 * @returns Formatted string (e.g., "$10.50", "€9.20")
 */
export function formatCurrency(
  amount: number,
  currencyCode: string,
  options?: {
    showCode?: boolean;
    locale?: string;
  }
): string {
  const code = currencyCode.toUpperCase();
  const currency = getCurrency(code);
  
  if (!currency) {
    // Fallback for unsupported currencies
    return `${code} ${amount.toFixed(2)}`;
  }
  
  try {
    // Use Intl.NumberFormat for proper formatting
    const locale = options?.locale || "en-US";
    let formatted = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: currency.decimals,
      maximumFractionDigits: currency.decimals,
    }).format(amount);
    
    // Special cases for certain currencies
    if (code === "USD" && formatted.includes("US$")) {
      formatted = formatted.replace("US$", "$");
    }
    if (code === "NGN" && formatted.includes("NGN")) {
      return formatted.replace("NGN", currency.symbol);
    }
    
    return formatted;
  } catch (error) {
    // Fallback if Intl fails
    const symbol = currency.symbol;
    const rounded = amount.toFixed(currency.decimals);
    return `${symbol}${rounded}`;
  }
}

/**
 * Get flag URL for currency (using country code mapping)
 */
export function getCurrencyFlag(code: string): string {
  const flagMap: Record<string, string> = {
    USD: "us", EUR: "eu", GBP: "gb", JPY: "jp", CAD: "ca",
    AUD: "au", CHF: "ch", CNY: "cn", INR: "in", KRW: "kr",
    BRL: "br", MXN: "mx", ZAR: "za", SGD: "sg", HKD: "hk",
    NOK: "no", SEK: "se", DKK: "dk", PLN: "pl", TRY: "tr",
    RUB: "ru", NZD: "nz", THB: "th", MYR: "my", IDR: "id",
    PHP: "ph", CZK: "cz", ILS: "il", CLP: "cl", ARS: "ar",
    COP: "co", PEN: "pe", AED: "ae", SAR: "sa", EGP: "eg",
    NGN: "ng", KES: "ke", PKR: "pk", BDT: "bd", VND: "vn",
  };
  
  const cc = flagMap[code.toUpperCase()] || code.toLowerCase();
  return `https://flagcdn.com/48x36/${cc}.png`;
}

/**
 * Round amount to appropriate decimal places for currency
 */
export function roundForCurrency(amount: number, currencyCode: string): number {
  const currency = getCurrency(currencyCode);
  if (!currency) return Math.round(amount * 100) / 100; // Default 2 decimals
  
  const factor = Math.pow(10, currency.decimals);
  return Math.round(amount * factor) / factor;
}
