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
