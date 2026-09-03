export type StripeKycTier = "L0" | "L1" | "L2";
export type StripeKycTierLower = "l0" | "l1" | "l2";
export type StripeKycVerificationStatus =
  | "not_available"
  | "not_started"
  | "pending"
  | "rejected"
  | "verified";

export type StripeKycTierSnapshot = {
  tier: StripeKycTierLower;
  verification_status: StripeKycVerificationStatus;
  verification_errors: string[];
};

export type StripeKycSnapshot = {
  currentTier: StripeKycTier | null;
  currentStatus: StripeKycVerificationStatus;
  verifiedTier: StripeKycTier | null;
  region: "us" | "eu" | null;
  tiers: StripeKycTierSnapshot[];
  providedFields: string[];
  identifiersSatisfied: boolean;
  attestationAccepted: boolean;
  euFullyVerified: boolean;
};

export type MicaIdentifierRequirement = {
  type: string;
  regulation: string;
};

const TIER_ORDER: StripeKycTierLower[] = ["l0", "l1", "l2"];
const ISO_ALPHA2_COUNTRY_CODES = new Set(`
AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR
IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO
EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY
HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY
LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI
NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC
WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK
TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW
`.trim().split(/\s+/));
const ACTIVE_TIER_STATUSES = new Set<StripeKycVerificationStatus>([
  "pending",
  "rejected",
  "verified",
]);

function normalizeStatus(value: unknown): StripeKycVerificationStatus {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "not_available" ||
    normalized === "not_started" ||
    normalized === "pending" ||
    normalized === "rejected" ||
    normalized === "verified"
  ) {
    return normalized;
  }
  if (normalized === "approved" || normalized === "completed") return "verified";
  if (normalized === "failed") return "rejected";
  return "not_started";
}

export function normalizeKycTier(value: unknown): StripeKycTier | null {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "L0" || normalized === "L1" || normalized === "L2") {
    return normalized;
  }
  return null;
}

export function isValidIsoCountryCode(value: unknown): boolean {
  return ISO_ALPHA2_COUNTRY_CODES.has(String(value || "").trim().toUpperCase());
}

export function normalizeKycTierLower(value: unknown): StripeKycTierLower | null {
  const normalized = normalizeKycTier(value);
  return normalized ? (normalized.toLowerCase() as StripeKycTierLower) : null;
}

export function kycTierRank(value: unknown): number {
  const tier = normalizeKycTier(value);
  if (tier === "L2") return 3;
  if (tier === "L1") return 2;
  if (tier === "L0") return 1;
  return 0;
}

export function highestKycTier(...values: unknown[]): StripeKycTier | null {
  let result: StripeKycTier | null = null;
  for (const value of values) {
    const tier = normalizeKycTier(value);
    if (kycTierRank(tier) > kycTierRank(result)) result = tier;
  }
  return result;
}

export function sanitizeKycTierSnapshots(value: unknown): StripeKycTierSnapshot[] {
  if (!Array.isArray(value)) return [];

  const byTier = new Map<StripeKycTierLower, StripeKycTierSnapshot>();
  for (const entry of value) {
    const tier = normalizeKycTierLower(entry?.tier);
    if (!tier) continue;
    const errors = Array.isArray(entry?.verification_errors)
      ? entry.verification_errors
          .map((error: unknown) => String(error || "").trim())
          .filter(Boolean)
          .slice(0, 10)
      : [];
    byTier.set(tier, {
      tier,
      verification_status: normalizeStatus(entry?.verification_status),
      verification_errors: errors,
    });
  }

  return TIER_ORDER.map((tier) => byTier.get(tier)).filter(Boolean) as StripeKycTierSnapshot[];
}

function verificationStatus(customer: any, name: string): StripeKycVerificationStatus {
  const verification = Array.isArray(customer?.verifications)
    ? customer.verifications.find((item: any) => String(item?.name || "") === name)
    : undefined;
  return normalizeStatus(verification?.status);
}

function inferLegacyVerifiedTier(customer: any): StripeKycTier | null {
  if (verificationStatus(customer, "id_document_verified") === "verified") return "L2";
  if (verificationStatus(customer, "kyc_verified") !== "verified") return null;

  const fields = new Set(
    (Array.isArray(customer?.provided_fields) ? customer.provided_fields : customer?.providedFields || [])
      .map((field: unknown) => String(field || "").trim().toLowerCase())
      .filter(Boolean)
  );
  if (fields.has("dob") && fields.has("id_number") && fields.has("id_type")) return "L1";
  return "L0";
}

export function deriveStripeKycSnapshot(customer: any): StripeKycSnapshot {
  const tiers = sanitizeKycTierSnapshots(customer?.kyc_tiers ?? customer?.kycTiers);
  const providedFields: string[] = Array.from(
    new Set<string>(
      (Array.isArray(customer?.provided_fields) ? customer.provided_fields : customer?.providedFields || [])
        .map((field: unknown) => String(field || "").trim().toLowerCase())
        .filter((field: string) => Boolean(field))
    )
  ).sort();
  const regionValue = String(customer?.kyc_region ?? customer?.kycRegion ?? "").trim().toLowerCase();
  const region: "us" | "eu" | null = regionValue === "eu" ? "eu" : regionValue === "us" ? "us" : null;

  let currentTierLower: StripeKycTierLower | null = null;
  let currentStatus: StripeKycVerificationStatus = "not_started";
  let verifiedTier: StripeKycTier | null = null;

  for (const tier of [...TIER_ORDER].reverse()) {
    const entry = tiers.find((candidate) => candidate.tier === tier);
    if (!currentTierLower && entry && ACTIVE_TIER_STATUSES.has(entry.verification_status)) {
      currentTierLower = tier;
      currentStatus = entry.verification_status;
    }
    if (!verifiedTier && entry?.verification_status === "verified") {
      verifiedTier = tier.toUpperCase() as StripeKycTier;
    }
  }

  if (tiers.length === 0) {
    verifiedTier = inferLegacyVerifiedTier(customer);
    const idDocStatus = normalizeStatus(customer?.idDocStatus);
    const kycStatus = normalizeStatus(customer?.kycStatus);
    if (idDocStatus !== "not_started" && idDocStatus !== "not_available") {
      currentTierLower = "l2";
      currentStatus = idDocStatus;
    } else if (kycStatus !== "not_started" && kycStatus !== "not_available") {
      currentTierLower = verifiedTier === "L1" ? "l1" : "l0";
      currentStatus = kycStatus;
    } else if (verifiedTier) {
      currentTierLower = verifiedTier.toLowerCase() as StripeKycTierLower;
      currentStatus = "verified";
    }
  }

  const identifiersSatisfied = providedFields.includes("identifiers");
  const attestationAccepted = providedFields.includes("attestation");
  const euFullyVerified = region === "eu"
    ? verifiedTier === "L2" && identifiersSatisfied && attestationAccepted
    : false;

  return {
    currentTier: currentTierLower ? (currentTierLower.toUpperCase() as StripeKycTier) : null,
    currentStatus,
    verifiedTier,
    region,
    tiers,
    providedFields,
    identifiersSatisfied,
    attestationAccepted,
    euFullyVerified,
  };
}

export function deriveKycCompletedDuringTransaction(
  initialVerifiedTier: unknown,
  finalVerifiedTier: unknown,
  kycOccurred: boolean
): StripeKycTier | null {
  if (!kycOccurred) return null;
  const finalTier = normalizeKycTier(finalVerifiedTier);
  if (!finalTier) return null;
  return kycTierRank(finalTier) > kycTierRank(initialVerifiedTier) ? finalTier : null;
}

export function normalizeMicaIdentifier(type: string, value: string): string {
  const compact = String(value || "").replace(/[\s\-/]/g, "");
  return ["es_nif", "it_cf", "mt_nic", "mt_pp"].includes(String(type || "").toLowerCase())
    ? compact.toUpperCase()
    : compact;
}

function validateEstonianId(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const calculate = (weights: number[]) => weights.reduce((sum, weight, index) => sum + digits[index] * weight, 0) % 11;
  let check = calculate([1, 2, 3, 4, 5, 6, 7, 8, 9, 1]);
  if (check === 10) check = calculate([3, 4, 5, 6, 7, 8, 9, 1, 2, 3]);
  if (check === 10) check = 0;
  return check === digits[10];
}

function validateSpanishNif(value: string): boolean {
  if (!/^([KLMXYZ]?\d{7}[A-Z]|\d{8}[A-Z])$/.test(value)) return false;
  const prefixMap: Record<string, string> = { X: "0", Y: "1", Z: "2", K: "0", L: "0", M: "0" };
  const numeric = /^\d/.test(value) ? value.slice(0, 8) : `${prefixMap[value[0]]}${value.slice(1, 8)}`;
  const letters = "TRWAGMYFPDXBNJZSQVHLCKE";
  return letters[Number(numeric) % 23] === value[8];
}

function validateIcelandicKt(value: string): boolean {
  if (!/^\d{10}$/.test(value) || !["0", "9"].includes(value[9])) return false;
  const day = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const year = Number(`${value[9] === "9" ? "19" : "20"}${value.slice(4, 6)}`);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateItalianCf(value: string): boolean {
  if (!/^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(value)) return false;
  if (!"ABCDEHLMPRST".includes(value[8])) return false;
  const day = Number(value.slice(9, 11));
  if (!((day >= 1 && day <= 31) || (day >= 41 && day <= 71))) return false;

  const oddValues: Record<string, number> = {
    "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
    A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4,
    M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
  };
  let sum = 0;
  for (let index = 0; index < 15; index++) {
    const char = value[index];
    sum += index % 2 === 0 ? oddValues[char] : (/\d/.test(char) ? Number(char) : char.charCodeAt(0) - 65);
  }
  return String.fromCharCode(65 + (sum % 26)) === value[15];
}

function validatePolishPesel(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const validMonth = (month >= 1 && month <= 12) || (month >= 21 && month <= 32) ||
    (month >= 41 && month <= 52) || (month >= 61 && month <= 72) || (month >= 81 && month <= 92);
  if (!validMonth || day < 1 || day > 31) return false;
  const digits = [...value].map(Number);
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const sum = weights.reduce((total, weight, index) => total + ((digits[index] * weight) % 10), 0);
  return ((10 - (sum % 10)) % 10) === digits[10];
}

function validatePolishNip(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const remainder = weights.reduce((total, weight, index) => total + digits[index] * weight, 0) % 11;
  return remainder !== 10 && remainder === digits[9];
}

export function validateMicaIdentifier(type: string, rawValue: string): boolean {
  const normalizedType = String(type || "").trim().toLowerCase();
  const value = normalizeMicaIdentifier(normalizedType, rawValue);
  if (!value) return false;
  if (normalizedType === "ee_ik") return validateEstonianId(value);
  if (normalizedType === "es_nif") return validateSpanishNif(value);
  if (normalizedType === "is_kt") return validateIcelandicKt(value);
  if (normalizedType === "it_cf") return validateItalianCf(value);
  if (normalizedType === "mt_nic") return /^\d{7}[MGAPLHBZ]$/.test(value) || (/^\d{9}$/.test(value) && /^(11|22|33|44|55|66|77|88)/.test(value));
  if (normalizedType === "mt_pp") return /^\d{7}$/.test(value);
  if (normalizedType === "pl_pesel") return validatePolishPesel(value);
  if (normalizedType === "pl_nip") return validatePolishNip(value);
  return /^[A-Z0-9]{3,64}$/i.test(value);
}

export function micaIdentifierLabel(type: string): string {
  const labels: Record<string, string> = {
    ee_ik: "Estonian Isikukood",
    es_nif: "Spanish NIF",
    is_kt: "Icelandic Kennitala",
    it_cf: "Italian Codice Fiscale",
    mt_nic: "Maltese National ID",
    mt_pp: "Maltese Passport Number",
    pl_pesel: "Polish PESEL",
    pl_nip: "Polish NIP",
  };
  return labels[String(type || "").toLowerCase()] || String(type || "National identifier").toUpperCase();
}
