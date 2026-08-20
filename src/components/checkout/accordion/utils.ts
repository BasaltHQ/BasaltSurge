export interface CountryAddressConfig {
  countryCode: string;
  isUS: boolean;
  isGB: boolean;
  isEU: boolean;
  requiresState: boolean;
  stateLabel: string;
  statePlaceholder: string;
  postalCodeLabel: string;
  postalCodePlaceholder: string;
  cityLabel: string;
  ssnRequired: boolean;
  idDocumentLabel: string;
}

export const getCountryAddressConfig = (countryCode: string = "US"): CountryAddressConfig => {
  const code = (countryCode || "US").trim().toUpperCase();
  const isUS = code === "US";
  const isGB = code === "GB";
  const isEU = !isUS && !isGB;

  if (isUS) {
    return {
      countryCode: "US",
      isUS: true,
      isGB: false,
      isEU: false,
      requiresState: true,
      stateLabel: "State",
      statePlaceholder: "CA",
      postalCodeLabel: "Zip Code",
      postalCodePlaceholder: "90210",
      cityLabel: "City",
      ssnRequired: true,
      idDocumentLabel: "US Driver's License or Passport",
    };
  }

  if (isGB) {
    return {
      countryCode: "GB",
      isUS: false,
      isGB: true,
      isEU: false,
      requiresState: false,
      stateLabel: "County (Optional)",
      statePlaceholder: "Greater London",
      postalCodeLabel: "Postcode",
      postalCodePlaceholder: "SW1A 1AA",
      cityLabel: "Town / City",
      ssnRequired: false,
      idDocumentLabel: "UK Passport or Driver's License",
    };
  }

  // EU & EEA Countries
  switch (code) {
    case "DE": // Germany
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Bundesland (Optional)",
        statePlaceholder: "Berlin",
        postalCodeLabel: "Postal Code (PLZ)",
        postalCodePlaceholder: "10115",
        cityLabel: "City / Stadt",
        ssnRequired: false,
        idDocumentLabel: "Personalausweis or Passport",
      };
    case "FR": // France
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Région (Optional)",
        statePlaceholder: "Île-de-France",
        postalCodeLabel: "Code Postal",
        postalCodePlaceholder: "75001",
        cityLabel: "Ville / City",
        ssnRequired: false,
        idDocumentLabel: "Carte d'Identité or Passeport",
      };
    case "IT": // Italy
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Provincia (Optional)",
        statePlaceholder: "RM",
        postalCodeLabel: "CAP (Codice Postale)",
        postalCodePlaceholder: "00186",
        cityLabel: "Città / City",
        ssnRequired: false,
        idDocumentLabel: "Carta d'Identità or Passaporto",
      };
    case "ES": // Spain
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Provincia (Optional)",
        statePlaceholder: "Madrid",
        postalCodeLabel: "Código Postal",
        postalCodePlaceholder: "28001",
        cityLabel: "Ciudad / City",
        ssnRequired: false,
        idDocumentLabel: "DNI, NIE or Pasaporte",
      };
    case "NL": // Netherlands
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Provincie (Optional)",
        statePlaceholder: "Noord-Holland",
        postalCodeLabel: "Postcode",
        postalCodePlaceholder: "1012 AB",
        cityLabel: "Stad / City",
        ssnRequired: false,
        idDocumentLabel: "Identiteitskaart or Paspoort",
      };
    case "IE": // Ireland
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "County (Optional)",
        statePlaceholder: "Co. Dublin",
        postalCodeLabel: "Eircode / Postal Code",
        postalCodePlaceholder: "D02 X285",
        cityLabel: "Town / City",
        ssnRequired: false,
        idDocumentLabel: "Irish Passport or ID",
      };
    case "AT": // Austria
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Bundesland (Optional)",
        statePlaceholder: "Wien",
        postalCodeLabel: "Postleitzahl (PLZ)",
        postalCodePlaceholder: "1010",
        cityLabel: "Stadt / City",
        ssnRequired: false,
        idDocumentLabel: "Reisepass or Personalausweis",
      };
    case "BE": // Belgium
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Province (Optional)",
        statePlaceholder: "Bruxelles",
        postalCodeLabel: "Code Postal / Postcode",
        postalCodePlaceholder: "1000",
        cityLabel: "Ville / Stad",
        ssnRequired: false,
        idDocumentLabel: "Carte d'Identité or Passport",
      };
    case "CH": // Switzerland
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Canton (Optional)",
        statePlaceholder: "ZH",
        postalCodeLabel: "PLZ / NPA",
        postalCodePlaceholder: "8001",
        cityLabel: "City / Ort",
        ssnRequired: false,
        idDocumentLabel: "Swiss ID or Passport",
      };
    case "SE": // Sweden
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Län (Optional)",
        statePlaceholder: "Stockholm",
        postalCodeLabel: "Postnummer",
        postalCodePlaceholder: "111 22",
        cityLabel: "Stad / City",
        ssnRequired: false,
        idDocumentLabel: "ID-kort or Pass",
      };
    case "NO": // Norway
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Fylke (Optional)",
        statePlaceholder: "Oslo",
        postalCodeLabel: "Postnummer",
        postalCodePlaceholder: "0150",
        cityLabel: "Poststed / City",
        ssnRequired: false,
        idDocumentLabel: "Nasjonalt ID-kort or Pass",
      };
    case "DK": // Denmark
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Region (Optional)",
        statePlaceholder: "Hovedstaden",
        postalCodeLabel: "Postnummer",
        postalCodePlaceholder: "1050",
        cityLabel: "By / City",
        ssnRequired: false,
        idDocumentLabel: "Pas or Sundhedskort",
      };
    case "FI": // Finland
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Maakunta (Optional)",
        statePlaceholder: "Uusimaa",
        postalCodeLabel: "Postinumero",
        postalCodePlaceholder: "00100",
        cityLabel: "Kaupunki / City",
        ssnRequired: false,
        idDocumentLabel: "Henkilökortti or Passi",
      };
    case "PT": // Portugal
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Distrito (Optional)",
        statePlaceholder: "Lisboa",
        postalCodeLabel: "Código Postal",
        postalCodePlaceholder: "1000-001",
        cityLabel: "Cidade / City",
        ssnRequired: false,
        idDocumentLabel: "Cartão de Cidadão or Passaporte",
      };
    case "PL": // Poland
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Województwo (Optional)",
        statePlaceholder: "Mazowieckie",
        postalCodeLabel: "Kod Pocztowy",
        postalCodePlaceholder: "00-001",
        cityLabel: "Miasto / City",
        ssnRequired: false,
        idDocumentLabel: "Dowód Osobisty or Paszport",
      };
    case "CZ": // Czech Republic
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Kraj (Optional)",
        statePlaceholder: "Praha",
        postalCodeLabel: "PSČ (Poštovní Směrovací Číslo)",
        postalCodePlaceholder: "110 00",
        cityLabel: "Město / City",
        ssnRequired: false,
        idDocumentLabel: "Občanský Průkaz or Cestovní Pas",
      };
    case "GR": // Greece
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Perifereia (Optional)",
        statePlaceholder: "Attiki",
        postalCodeLabel: "Taxydromikos Kodikas (TK)",
        postalCodePlaceholder: "104 31",
        cityLabel: "City / Poli",
        ssnRequired: false,
        idDocumentLabel: "Tavtotita or Diavatirio",
      };
    case "HU": // Hungary
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Megye (Optional)",
        statePlaceholder: "Pest",
        postalCodeLabel: "Irányítószám",
        postalCodePlaceholder: "1011",
        cityLabel: "Város / City",
        ssnRequired: false,
        idDocumentLabel: "Személyi Igazolvány or Útlevél",
      };
    case "RO": // Romania
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Județ (Optional)",
        statePlaceholder: "București",
        postalCodeLabel: "Cod Poștal",
        postalCodePlaceholder: "010011",
        cityLabel: "Oraș / City",
        ssnRequired: false,
        idDocumentLabel: "Carte de Identitate or Pașaport",
      };
    case "HR": // Croatia
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Županija (Optional)",
        statePlaceholder: "Zagreb",
        postalCodeLabel: "Poštanski Broj",
        postalCodePlaceholder: "10000",
        cityLabel: "Grad / City",
        ssnRequired: false,
        idDocumentLabel: "Osobna Iskaznica or Putovnica",
      };
    case "BG": // Bulgaria
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Oblast (Optional)",
        statePlaceholder: "Sofia",
        postalCodeLabel: "Poshtenski Kod",
        postalCodePlaceholder: "1000",
        cityLabel: "Grad / City",
        ssnRequired: false,
        idDocumentLabel: "Lichna Karta or Pasport",
      };
    case "SK": // Slovakia
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Kraj (Optional)",
        statePlaceholder: "Bratislava",
        postalCodeLabel: "PSČ",
        postalCodePlaceholder: "811 01",
        cityLabel: "Mesto / City",
        ssnRequired: false,
        idDocumentLabel: "Občiansky Preukaz or Pas",
      };
    case "SI": // Slovenia
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Regija (Optional)",
        statePlaceholder: "Ljubljana",
        postalCodeLabel: "Poštna Številka",
        postalCodePlaceholder: "1000",
        cityLabel: "Mesto / City",
        ssnRequired: false,
        idDocumentLabel: "Osebna Izkaznica or Potni List",
      };
    case "EE": // Estonia
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Maakond (Optional)",
        statePlaceholder: "Harjumaa",
        postalCodeLabel: "Postiindeks",
        postalCodePlaceholder: "10111",
        cityLabel: "Linn / City",
        ssnRequired: false,
        idDocumentLabel: "ID-kaart or Pass",
      };
    case "LV": // Latvia
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Novads (Optional)",
        statePlaceholder: "Rīga",
        postalCodeLabel: "Pasta Indekss",
        postalCodePlaceholder: "LV-1050",
        cityLabel: "Pilsēta / City",
        ssnRequired: false,
        idDocumentLabel: "Personas Apliecība or Pase",
      };
    case "LT": // Lithuania
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Apskritis (Optional)",
        statePlaceholder: "Vilnius",
        postalCodeLabel: "Pašto Kodas",
        postalCodePlaceholder: "LT-01100",
        cityLabel: "Miestas / City",
        ssnRequired: false,
        idDocumentLabel: "Asmens Tapatybės Kortelė or Pasas",
      };
    case "LU": // Luxembourg
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Canton (Optional)",
        statePlaceholder: "Luxembourg",
        postalCodeLabel: "Code Postal",
        postalCodePlaceholder: "1111",
        cityLabel: "Ville / City",
        ssnRequired: false,
        idDocumentLabel: "Carte d'Identité or Passeport",
      };
    case "MT": // Malta
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Region (Optional)",
        statePlaceholder: "Valletta",
        postalCodeLabel: "Postcode",
        postalCodePlaceholder: "VLT 1115",
        cityLabel: "Locality / City",
        ssnRequired: false,
        idDocumentLabel: "ID Card or Passport",
      };
    case "CY": // Cyprus
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "District (Optional)",
        statePlaceholder: "Nicosia",
        postalCodeLabel: "Postal Code",
        postalCodePlaceholder: "1010",
        cityLabel: "City",
        ssnRequired: false,
        idDocumentLabel: "Identity Card or Passport",
      };
    case "IS": // Iceland
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Region (Optional)",
        statePlaceholder: "Reykjavík",
        postalCodeLabel: "Póstnúmer",
        postalCodePlaceholder: "101",
        cityLabel: "Bær / City",
        ssnRequired: false,
        idDocumentLabel: "Nafnskírteini or Vegabréf",
      };
    case "LI": // Liechtenstein
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "Gemeinde (Optional)",
        statePlaceholder: "Vaduz",
        postalCodeLabel: "PLZ",
        postalCodePlaceholder: "9490",
        cityLabel: "Gemeinde / City",
        ssnRequired: false,
        idDocumentLabel: "Identitätskarte or Reisepass",
      };
    default:
      return {
        countryCode: code,
        isUS: false,
        isGB: false,
        isEU: true,
        requiresState: false,
        stateLabel: "State / Region (Optional)",
        statePlaceholder: "",
        postalCodeLabel: "Postal Code",
        postalCodePlaceholder: "Postal Code",
        cityLabel: "City / Town",
        ssnRequired: false,
        idDocumentLabel: "National ID or Passport",
      };
  }
};

export const formatSSN = (raw: string): string => {
  const d = raw.replace(/\D/g, "").slice(0, 9);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
};

export const formatPhoneInput = (raw: string): string => {
  const cleaned = raw.replace(/[^\d+]/g, "");
  return cleaned;
};

// Robust Date of Birth validation (YYYY-MM-DD, past date)
export const validateDob = (val: string): { valid: boolean; age?: number; error?: string } => {
  if (!val || val.length < 10) return { valid: false, error: "Date of birth is required" };
  const parts = val.split("-").map(Number);
  if (parts.length !== 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
    return { valid: false, error: "Invalid date format" };
  }
  const [year, month, day] = parts;
  const currentYear = new Date().getFullYear();
  if (year < 1900 || year > currentYear || month < 1 || month > 12 || day < 1 || day > 31) {
    return { valid: false, error: "Please enter a valid date" };
  }
  const birthDate = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (birthDate > today) {
    return { valid: false, error: "Date of birth cannot be in the future" };
  }
  let age = today.getFullYear() - birthDate.getFullYear();
  const mDiff = today.getMonth() - birthDate.getMonth();
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return { valid: true, age };
};

// Format and translate raw errors into clear customer guidance
export const formatErrorMessage = (err?: string | null): string | null => {
  if (!err) return null;
  const lower = err.toLowerCase();
  if (
    lower.includes("address provided isn't supported for headless mode") ||
    lower.includes("unsupported for headless mode") ||
    lower.includes("unsupported_region") ||
    lower.includes("unsupported_country")
  ) {
    return "Instant card checkout is currently unavailable for this residential address or state (e.g., NY, HI, or US territories) due to regional crypto regulations. Please verify your address or use an alternative payment method.";
  }
  if (lower.includes("card_declined") || lower.includes("do_not_honor") || lower.includes("card was declined")) {
    return "Your card was declined by your issuing bank. Please check your card balance, contact your bank, or select another payment method.";
  }
  if (lower.includes("insufficient_funds")) {
    return "Payment failed due to insufficient funds on this card. Please try another card or bank account.";
  }
  if (lower.includes("expired_card")) {
    return "This card has expired. Please enter an active card.";
  }
  if (lower.includes("incorrect_cvc") || lower.includes("invalid_cvc")) {
    return "The security code (CVC) entered is incorrect. Please verify the 3 or 4-digit code on your card.";
  }
  if (lower.includes("amount_above_maximum") || lower.includes("exceeds the maximum")) {
    return "This order exceeds the single-transaction limit for this payment method. Please select a bank account or contact support.";
  }
  if (lower.includes("amount_below_minimum")) {
    return "This order is below the minimum supported purchase limit.";
  }
  if (lower.includes("unsupportable_customer") || lower.includes("unsupported link account")) {
    return "This Link account cannot be used for this checkout. Please verify your details or use another payment method.";
  }
  if (lower.includes("wallet_ownership_verification_required") || lower.includes("travel rule")) {
    return "EU Travel Rule requires cryptographic proof of destination wallet ownership for transactions at or above €1,000. Please sign the challenge message to proceed.";
  }
  if (lower.includes("invalid_wallet_ownership_signature") || lower.includes("invalid signature")) {
    return "The submitted signature does not prove control of this destination wallet. In test mode, use 'abcd'.";
  }
  if (lower.includes("wallet_ownership_challenge_expired")) {
    return "The wallet ownership challenge has expired. A fresh challenge has been generated for you.";
  }
  return err;
};
