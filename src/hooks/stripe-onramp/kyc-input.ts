import { isValidIsoCountryCode, type StripeKycSnapshot } from "@/lib/stripe-kyc-tracking";
import type { OnrampCoordinator } from "./types";

export const STRIPE_ONRAMP_SUPPORTED_COUNTRIES = new Set([
  "US", "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
  "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
  "NL", "PL", "PT", "RO", "SE", "SI", "SK", "NO", "IS", "LI", "CH", "GB"
]);

export function normalizeCountryCode(country?: string): string {
  if (!country) return "US";
  const trimmed = country.trim().toUpperCase();
  if (isValidIsoCountryCode(trimmed)) {
    return trimmed;
  }
  const NAME_TO_CODE: Record<string, string> = {
    "UNITED STATES": "US", "USA": "US", "UNITED STATES OF AMERICA": "US",
    "UNITED KINGDOM": "GB", "UK": "GB", "GREAT BRITAIN": "GB",
    "GERMANY": "DE", "FRANCE": "FR", "SPAIN": "ES", "ITALY": "IT",
    "NETHERLANDS": "NL", "IRELAND": "IE", "AUSTRIA": "AT", "BELGIUM": "BE",
    "SWITZERLAND": "CH", "SWEDEN": "SE", "NORWAY": "NO", "DENMARK": "DK",
    "FINLAND": "FI", "POLAND": "PL", "PORTUGAL": "PT", "GREECE": "GR",
    "CANADA": "CA", "AUSTRALIA": "AU", "NEW ZEALAND": "NZ", "JAPAN": "JP",
    "SINGAPORE": "SG", "HONG KONG": "HK", "BRAZIL": "BR", "MEXICO": "MX",
    "INDIA": "IN", "SOUTH AFRICA": "ZA",
  };
  return NAME_TO_CODE[trimmed] || "US";
}

export const EU_EEA_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
  "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
  "NL", "PL", "PT", "RO", "SE", "SI", "SK", "NO", "IS", "LI", "CH"
]);

export function isEuEeaCountry(country: string): boolean {
  return EU_EEA_COUNTRIES.has(normalizeCountryCode(country));
}

export async function submitKycInfoWithTimeout(coordinator: OnrampCoordinator, kycInfo: any, timeoutMs = 45000): Promise<void> {
  if (kycInfo) {
    if (kycInfo.address) {
      const addressCountry = String(kycInfo.address.country || "").trim().toUpperCase();
      if (!isValidIsoCountryCode(addressCountry)) {
        throw new Error("A valid residential country is required for identity verification.");
      }
      kycInfo.address.country = addressCountry;
    }
    if (kycInfo.birth_country !== undefined) {
      kycInfo.birth_country = String(kycInfo.birth_country || "").trim().toUpperCase();
    }
    if (Array.isArray(kycInfo.nationalities)) {
      kycInfo.nationalities = kycInfo.nationalities
        .map((n: any) => String(n || "").trim().toUpperCase())
        .filter((n: string) => !!n);
    }

    // Stripe requires birth_city, birth_country, date_of_birth, and nationalities for users with EU/EEA addresses under MiCA/AMLD regulations.
    const addrCountry = kycInfo.address?.country || "";
    if (isEuEeaCountry(addrCountry)) {
      if (!Array.isArray(kycInfo.nationalities) || kycInfo.nationalities.length === 0) {
        throw new Error("Nationality is required for EU identity verification.");
      }
      if (kycInfo.nationalities.some((code: string) => !isValidIsoCountryCode(code))) {
        throw new Error("Every nationality must use a valid ISO two-letter country code.");
      }
      if (!String(kycInfo.birth_city || "").trim()) {
        throw new Error("Birth city is required for EU identity verification.");
      }
      if (!isValidIsoCountryCode(kycInfo.birth_country)) {
        throw new Error("A valid birth country is required for EU identity verification.");
      }
      if (addrCountry === "IE" && !String(kycInfo.address?.state || "").trim()) {
        throw new Error("County is required for an Irish residential address.");
      }
      // Stripe EU KYC docs: State is not required for EU addresses except Ireland (IE)
      if (addrCountry !== "IE" && kycInfo.address?.state) {
        delete kycInfo.address.state;
      }
    }
  }

  return Promise.race([
    coordinator.submitKycInfo(kycInfo),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error("Stripe KYC submission timed out. Please refresh and try again."), { code: "timeout" })), timeoutMs)
    )
  ]);
}

export function validateUsKycInfoPayload(kycInfo: any, snapshot: StripeKycSnapshot | null): void {
  const hasDob = Boolean(kycInfo?.date_of_birth);
  const hasIdNumber = Boolean(kycInfo?.id_number);
  const isL1Submission = hasDob || hasIdNumber;

  if (isL1Submission) {
    if (!hasDob || !hasIdNumber) {
      throw new Error("US Level 1 verification requires both date of birth and SSN.");
    }
    const dob = kycInfo.date_of_birth;
    const year = Number(dob?.year);
    const month = Number(dob?.month);
    const day = Number(dob?.day);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)
      || parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() !== month - 1 || parsedDate.getUTCDate() !== day) {
      throw new Error("A valid date of birth is required for US Level 1 verification.");
    }
    if (kycInfo.id_number.type !== "us_ssn" || !/^\d{9}$/.test(String(kycInfo.id_number.value || ""))) {
      throw new Error("A complete 9-digit US SSN is required for Level 1 verification.");
    }
  }

  const l0Status = snapshot?.tiers.find((tier) => tier.tier === "l0")?.verification_status;
  const hasPriorL0Result = l0Status === "verified" || l0Status === "rejected"
    || snapshot?.verifiedTier === "L0" || snapshot?.verifiedTier === "L1" || snapshot?.verifiedTier === "L2";
  const includesAnyL0Field = Boolean(kycInfo?.given_name || kycInfo?.surname || kycInfo?.address);
  const requiresFullL0 = !isL1Submission || !hasPriorL0Result || includesAnyL0Field;

  if (!requiresFullL0) return;

  const address = kycInfo?.address;
  if (!String(kycInfo?.given_name || "").trim() || !String(kycInfo?.surname || "").trim()
    || !String(address?.line1 || "").trim() || !String(address?.city || "").trim()
    || !String(address?.state || "").trim() || !String(address?.postal_code || "").trim()
    || String(address?.country || "").toUpperCase() !== "US") {
    throw Object.assign(new Error("Full legal name and US residential address are required for this identity verification."), { code: "kyc_l0_input_required" });
  }
}

export function isUncertainKycSubmissionError(error: unknown): boolean {
  const candidate = error as any;
  const code = String(candidate?.code || candidate?.name || "").trim().toLowerCase();
  return ["aborterror", "timeouterror", "timeout", "network_error", "typeerror"].includes(code);
}
