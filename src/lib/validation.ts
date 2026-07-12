import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";

/**
 * Common validators and schemas for request payloads.
 * Focus: robust type validation + bounds checking prior to normalization.
 */

export const HexAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "hex_address");

export const PaymentTokenSchema = z.union([
  z.literal("USDC"),
  z.literal("USDT"),
  z.literal("cbBTC"),
  z.literal("cbXRP"),
  z.literal("ETH"),
  z.literal("SOL"),
]);

/**
 * Allow http(s) absolute or site-relative (/path) URLs.
 */
export const UrlOrSiteRelativeSchema = z
  .string()
  .min(1)
  .refine(
    (v) => /^(https?:\/\/)/i.test(v) || v.startsWith("/"),
    "url_or_site_relative"
  );

/**
 * Theme update payload (optional fields; normalized later).
 */
export const SiteThemeSchema = z.object({
  primaryColor: z.string().min(1).optional(),
  secondaryColor: z.string().min(1).optional(),
  brandLogoUrl: UrlOrSiteRelativeSchema.optional(),
  brandFaviconUrl: UrlOrSiteRelativeSchema.optional(),
  appleTouchIconUrl: UrlOrSiteRelativeSchema.optional(),
  brandName: z.string().min(1).optional(),
  brandLogoShape: z.enum(["round", "square", "unmasked"]).optional(),
  textColor: z.string().min(1).optional(),
  headerTextColor: z.string().min(1).optional(),
  bodyTextColor: z.string().min(1).optional(),
  fontFamily: z.string().min(1).optional(),
  receiptBackgroundUrl: UrlOrSiteRelativeSchema.or(z.literal("")).optional(),
  discretePayWithCrypto: z.boolean().optional(),
  // Allow compact logos object (app, favicon, symbol)
  logos: z.object({
    app: UrlOrSiteRelativeSchema.optional(),
    favicon: UrlOrSiteRelativeSchema.optional(),
    symbol: UrlOrSiteRelativeSchema.optional(),
    socialDefault: UrlOrSiteRelativeSchema.optional(),
  }).optional(),
  meta: z.object({
    ogTitle: z.string().max(120).optional(),
    ogDescription: z.string().max(300).optional(),
  }).optional(),
});

/**
 * Tax components and jurisdictions.
 */
export const TaxComponentSchema = z.object({
  code: z.string().min(1).max(24),
  name: z.string().min(1).max(80),
  rate: z.number().min(0).max(1),
});

export const TaxJurisdictionSchema = z.object({
  code: z.string().min(1).max(16),
  name: z.string().min(1).max(80),
  rate: z.number().min(0).max(1),
  country: z.string().optional(),
  type: z.string().optional(),
  components: z.array(TaxComponentSchema).max(16).optional(),
});

export const TaxProviderSchema = z.object({
  name: z.string().default(""),
  apiKeySet: z.boolean().optional(),
});

export const TaxConfigSchema = z.object({
  jurisdictions: z.array(TaxJurisdictionSchema).max(256).optional(),
  provider: TaxProviderSchema.optional(),
  defaultJurisdictionCode: z.string().max(16).optional(),
});

/**
 * Split recipient schema.
 */
export const SplitRecipientSchema = z.object({
  address: HexAddressSchema,
  sharesBps: z.number().min(0).max(10000),
});

export const SplitConfigSchema = z.object({
  address: HexAddressSchema,
  recipients: z.array(SplitRecipientSchema).max(128).optional(),
});

/**
 * Reserve ratios: record of allowed tokens to bounded [0,1] numbers.
 * We permit arbitrary keys but enforce that keys (if present) are within the allowed set
 * and each value is clamped by schema.
 */
const AllowedReserveTokens = ["USDC", "USDT", "cbBTC", "cbXRP", "ETH", "SOL"] as const;
export const ReserveRatiosSchema = z.record(
  z.enum(AllowedReserveTokens),
  z.number().min(0).max(1)
);

/**
 * Tip configuration for portal tip presets.
 */
export const TipConfigSchema = z.object({
  presets: z.array(z.number().min(0).max(100)).max(6).optional(),
  defaultTip: z.number().min(0).max(100).nullable().optional(),
  allowCustom: z.boolean().optional(),
  enabled: z.boolean().optional(),
});


/**
 * Site config update payload schema.
 * All fields are optional and normalized later.
 */
export const SiteConfigUpdateSchema = z.object({
  story: z.string().max(4000).optional(),
  storyHtml: z.string().max(20000).optional(),
  defiEnabled: z.boolean().optional(),
  appUrl: UrlOrSiteRelativeSchema.optional(),
  partnerWallet: HexAddressSchema.optional(),

  theme: SiteThemeSchema.optional(),

  processingFeePct: z.number().min(0).optional(),
  reserveRatios: ReserveRatiosSchema.optional(),
  defaultPaymentToken: PaymentTokenSchema.optional(),
  storeCurrency: z.string().max(8).optional(),

  splitAddress: HexAddressSchema.optional(),
  split: SplitConfigSchema.optional(),

  accumulationMode: z.enum(["fixed", "dynamic"]).optional(),

  taxConfig: TaxConfigSchema.optional(),

  tipConfig: TipConfigSchema.optional(),

  industryParams: z.record(z.string(), z.any()).optional(),

  // touchpointThemes: each key accepts a string (legacy theme ID) OR an object
  // (because the GET handler's applyThemeOverrides normalizes strings into objects
  // with injected primaryColor/secondaryColor — the admin panel echoes these back)
  touchpointThemes: z.record(
    z.string(),
    z.union([
      z.string().max(64),
      z.object({}).passthrough(),
    ])
  ).optional(),
  feeMinusEnabled: z.boolean().optional(),
  currencySelectionEnabled: z.boolean().optional(),
  discretePayWithCrypto: z.boolean().optional(),
  achEnabled: z.boolean().optional(),
  trackTransactionLimits: z.boolean().optional(),
});

/**
 * JSON parsing helper that throws a standardized error on failure.
 */
export async function parseJsonBody(req: NextRequest): Promise<any> {
  try {
    return await req.json();
  } catch (e: any) {
    const err: any = new Error("invalid_json");
    err.status = 400;
    throw err;
  }
}

/**
 * Convert ZodError to serializable issue details.
 */
export function zodErrorToIssues(err: ZodError) {
  try {
    const flat = err.flatten();
    return {
      fieldErrors: flat.fieldErrors,
      formErrors: flat.formErrors,
    };
  } catch {
    return { fieldErrors: {}, formErrors: ["invalid_body"] };
  }
}

/**
 * Validate helper: returns typed data or throws with { status: 400, issues }
 */
export function validateSiteConfigUpdateOrThrow(body: any) {
  const parsed = SiteConfigUpdateSchema.safeParse(body);
  if (!parsed.success) {
    const e: any = new Error("invalid_body");
    e.status = 400;
    e.issues = zodErrorToIssues(parsed.error);
    throw e;
  }
  return parsed.data;
}
