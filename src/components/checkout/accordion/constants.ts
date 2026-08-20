import { SupportedCountry } from "./types";

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export const SUPPORTED_COUNTRIES: SupportedCountry[] = [
  // Primary (United States & United Kingdom)
  { code: "US", name: "United States", dial: "+1", flag: "🇺🇸" },
  { code: "GB", name: "United Kingdom", dial: "+44", flag: "🇬🇧" },

  // European Union & EEA Countries
  { code: "DE", name: "Germany", dial: "+49", flag: "🇩🇪" },
  { code: "FR", name: "France", dial: "+33", flag: "🇫🇷" },
  { code: "IT", name: "Italy", dial: "+39", flag: "🇮🇹" },
  { code: "ES", name: "Spain", dial: "+34", flag: "🇪🇸" },
  { code: "NL", name: "Netherlands", dial: "+31", flag: "🇳🇱" },
  { code: "IE", name: "Ireland", dial: "+353", flag: "🇮🇪" },
  { code: "AT", name: "Austria", dial: "+43", flag: "🇦🇹" },
  { code: "BE", name: "Belgium", dial: "+32", flag: "🇧🇪" },
  { code: "BG", name: "Bulgaria", dial: "+359", flag: "🇧🇬" },
  { code: "CH", name: "Switzerland", dial: "+41", flag: "🇨🇭" },
  { code: "CY", name: "Cyprus", dial: "+357", flag: "🇨🇾" },
  { code: "CZ", name: "Czech Republic", dial: "+420", flag: "🇨🇿" },
  { code: "DK", name: "Denmark", dial: "+45", flag: "🇩🇰" },
  { code: "EE", name: "Estonia", dial: "+372", flag: "🇪🇪" },
  { code: "FI", name: "Finland", dial: "+358", flag: "🇫🇮" },
  { code: "GR", name: "Greece", dial: "+30", flag: "🇬🇷" },
  { code: "HR", name: "Croatia", dial: "+385", flag: "🇭🇷" },
  { code: "HU", name: "Hungary", dial: "+36", flag: "🇭🇺" },
  { code: "IS", name: "Iceland", dial: "+354", flag: "🇮🇸" },
  { code: "LI", name: "Liechtenstein", dial: "+423", flag: "🇱🇮" },
  { code: "LT", name: "Lithuania", dial: "+370", flag: "🇱🇹" },
  { code: "LU", name: "Luxembourg", dial: "+352", flag: "🇱🇺" },
  { code: "LV", name: "Latvia", dial: "+371", flag: "🇱🇻" },
  { code: "MT", name: "Malta", dial: "+356", flag: "🇲🇹" },
  { code: "NO", name: "Norway", dial: "+47", flag: "🇳🇴" },
  { code: "PL", name: "Poland", dial: "+48", flag: "🇵🇱" },
  { code: "PT", name: "Portugal", dial: "+351", flag: "🇵🇹" },
  { code: "RO", name: "Romania", dial: "+40", flag: "🇷🇴" },
  { code: "SE", name: "Sweden", dial: "+46", flag: "🇸🇪" },
  { code: "SI", name: "Slovenia", dial: "+386", flag: "🇸🇮" },
  { code: "SK", name: "Slovakia", dial: "+421", flag: "🇸🇰" },
];
