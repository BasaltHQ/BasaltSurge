
export const COUNTRY_CALLING_CODES: Record<string, string> = {
  US: "1", CA: "1", GB: "44", DE: "49", FR: "33", ES: "34", IT: "39",
  NL: "31", IE: "353", AT: "43", BE: "32", BG: "359", HR: "385", CY: "357",
  CZ: "420", DK: "45", EE: "372", FI: "358", GR: "30", HU: "36", LV: "371",
  LT: "370", LU: "352", MT: "356", PL: "48", PT: "351", RO: "40", SK: "421",
  SI: "386", SE: "46", CH: "41", NO: "47", AU: "61", NZ: "64", JP: "81",
  SG: "65", HK: "852", BR: "55", MX: "52", IN: "91", ZA: "27"
};

export function getCallingCode(countryOrCode: string = "US"): string {
  const upper = (countryOrCode || "").toUpperCase().trim();
  if (COUNTRY_CALLING_CODES[upper]) {
    return COUNTRY_CALLING_CODES[upper];
  }
  const digitsOnly = upper.replace(/\D/g, "");
  return digitsOnly || "1";
}

export function formatToE164(phone: string, countryOrCallingCode = "US"): string {
  if (!phone) return "";
  let cleaned = phone.trim().replace(/[^\d+]/g, "");

  // If already starts with "+", keep it
  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  // If starts with "00", replace with "+"
  if (cleaned.startsWith("00")) {
    return "+" + cleaned.slice(2);
  }

  const callingCode = getCallingCode(countryOrCallingCode);

  // If starts with European trunk prefix '0' (e.g. 0170... in Germany, UK, etc.), strip it
  if (callingCode !== "1" && cleaned.startsWith("0")) {
    cleaned = cleaned.replace(/^0+/, "");
  }

  // If already starts with the calling code and has sufficient length
  if (cleaned.startsWith(callingCode) && cleaned.length > callingCode.length + 5) {
    return `+${cleaned}`;
  }

  // Prepend calling code
  return `+${callingCode}${cleaned}`;
}
