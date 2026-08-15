"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Check,
  Edit2,
  Lock,
  Sparkles,
  Shield,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  FileText,
  BadgeCheck,
  CheckCircle2,
  RefreshCw,
  CreditCard,
  Building2,
  Loader2,
  Mail,
  Phone,
  MapPin,
  User,
  Calendar,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  ArrowRight,
  Search
} from "lucide-react";

export interface PortalPayAccordionCheckoutV2Props {
  theme?: {
    primaryColor?: string;
    brandKey?: string;
    brandName?: string;
  };
  isLightText?: boolean;
  email?: string;
  phone?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  line1?: string;
  line2?: string;
  city?: string;
  stateCode?: string;
  zipCode?: string;
  country?: string;
  dob?: string;
  amountUsd?: number;
  receiptId?: string;
  headlessError?: string | null;
  kycTierRequired?: "l0" | "l1" | "l2" | string;
  kycLevel?: "L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING" | string;
  kycTiers?: Array<{ tier: string; verification_status: string }>;
  simulatedTier?: "l0" | "l1" | "l2" | string;
  simulatedStatus?: "normal" | "step_up" | "doc_verify" | "verified" | string;
  simulatedError?: "none" | "address_error" | "payment_decline" | "kyc_rejection" | string;
  simulatedPath?: "normal" | "skip_kyc" | "step_up" | "doc_verify" | string;
  isAllKycCompleted?: boolean;
  onHeadlessSubmitEmailPhone?: (email: string, phone: string, country?: string, fullName?: string) => Promise<void>;
  onSubmitKycInfo?: (info: any) => Promise<void>;
  onVerifyDocuments?: () => Promise<void | boolean>;
  onSelectPaymentMethod?: (type: string) => Promise<void>;
  onCompleteCheckout?: () => Promise<void>;
  paymentElement?: HTMLElement | React.ReactNode | null;
  authElement?: HTMLElement | React.ReactNode | null;
  headlessStatus?: string;
  headlessStep?: string;
  paymentConfirmed?: { txHash: string; amount: number; token: string; funding?: string } | null;
  detectedCardFunding?: string | null;
  detectedCardBrand?: string | null;
  detectedCardLast4?: string | null;
  onEmailReceipt?: () => void;
}

const formatSSN = (raw: string): string => {
  const d = raw.replace(/\D/g, "").slice(0, 9);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
};

const formatPhoneInput = (raw: string): string => {
  const cleaned = raw.replace(/[^\d+]/g, "");
  return cleaned;
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

interface DobPickerProps {
  value: string; // YYYY-MM-DD
  onChange: (val: string) => void;
  onBlur?: () => void;
  isLightText?: boolean;
  primaryColor?: string;
  hasError?: boolean;
  isValid?: boolean;
  onOpenStateChange?: (isOpen: boolean) => void;
}

function DobPicker({
  value,
  onChange,
  onBlur,
  isLightText = true,
  primaryColor = "#635BFF",
  hasError = false,
  isValid = false,
  onOpenStateChange,
}: DobPickerProps) {
  // Parse initial YYYY-MM-DD
  const [year, setYear] = useState(() => (value && value.includes("-") ? value.split("-")[0] : ""));
  const [month, setMonth] = useState(() => (value && value.includes("-") ? value.split("-")[1] : ""));
  const [day, setDay] = useState(() => (value && value.includes("-") ? value.split("-")[2] : ""));

  const [isOpen, setIsOpen] = useState(false);

  // Default view: selected year or 20 years ago
  const currentYear = new Date().getFullYear();
  const maxAllowedYear = currentYear;
  const [viewYear, setViewYear] = useState(() => (year ? parseInt(year, 10) : currentYear - 20));
  const [viewMonth, setViewMonth] = useState(() => (month ? parseInt(month, 10) - 1 : 0));

  const containerRef = useRef<HTMLDivElement>(null);
  const monthRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);

  // Sync internal state when external value changes
  useEffect(() => {
    if (value && value.includes("-")) {
      const [y, m, d] = value.split("-");
      if (y && y !== year) setYear(y);
      if (m && m !== month) setMonth(m);
      if (d && d !== day) setDay(d);
    } else if (!value) {
      setYear("");
      setMonth("");
      setDay("");
    }
  }, [value]);

  const triggerOnChange = (m: string, d: string, y: string) => {
    if (m && d && y && y.length === 4 && m.length === 2 && d.length === 2) {
      onChange(`${y}-${m}-${d}`);
    } else if (!m && !d && !y) {
      onChange("");
    } else {
      onChange(`${y || ""}-${m || ""}-${d || ""}`);
    }
  };

  const handleToggleOpen = () => {
    const next = !isOpen;
    setIsOpen(next);
    onOpenStateChange?.(next);
    if (next) {
      if (year && month) {
        setViewYear(parseInt(year, 10));
        setViewMonth(parseInt(month, 10) - 1);
      }
    }
  };

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        onOpenStateChange?.(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onOpenStateChange]);

  const handleMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, "").slice(0, 2);
    if (val.length === 1 && parseInt(val, 10) > 1) {
      val = `0${val}`;
    }
    if (parseInt(val, 10) > 12) {
      val = "12";
    }
    setMonth(val);
    triggerOnChange(val, day, year);
    if (val.length === 2) {
      dayRef.current?.focus();
    }
  };

  const handleDayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, "").slice(0, 2);
    if (val.length === 1 && parseInt(val, 10) > 3) {
      val = `0${val}`;
    }
    if (parseInt(val, 10) > 31) {
      val = "31";
    }
    setDay(val);
    triggerOnChange(month, val, year);
    if (val.length === 2) {
      yearRef.current?.focus();
    }
  };

  const handleYearChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, "").slice(0, 4);
    setYear(val);
    triggerOnChange(month, day, val);
  };

  const handleKeyDown = (field: "m" | "d" | "y", e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (field === "d" && !day) {
        monthRef.current?.focus();
      } else if (field === "y" && !year) {
        dayRef.current?.focus();
      }
    } else if (e.key === "ArrowRight") {
      if (field === "m" && month.length > 0) dayRef.current?.focus();
      if (field === "d" && day.length > 0) yearRef.current?.focus();
    } else if (e.key === "ArrowLeft") {
      if (field === "y") dayRef.current?.focus();
      if (field === "d") monthRef.current?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text").trim();
    // Support formats like MM/DD/YYYY, YYYY-MM-DD, MMDDYYYY
    if (text.includes("-")) {
      const p = text.split("-");
      if (p.length === 3 && p[0].length === 4) {
        setYear(p[0]);
        setMonth(p[1].padStart(2, "0"));
        setDay(p[2].padStart(2, "0"));
        triggerOnChange(p[1].padStart(2, "0"), p[2].padStart(2, "0"), p[0]);
        e.preventDefault();
        return;
      }
    }
    const cleanDigits = text.replace(/\D/g, "");
    if (cleanDigits.length === 8) {
      // MM DD YYYY
      const m = cleanDigits.slice(0, 2);
      const d = cleanDigits.slice(2, 4);
      const y = cleanDigits.slice(4, 8);
      setMonth(m);
      setDay(d);
      setYear(y);
      triggerOnChange(m, d, y);
      e.preventDefault();
    }
  };

  // Calendar calculations
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();

  const handleSelectDay = (selectedD: number) => {
    const mStr = String(viewMonth + 1).padStart(2, "0");
    const dStr = String(selectedD).padStart(2, "0");
    const yStr = String(viewYear);
    setMonth(mStr);
    setDay(dStr);
    setYear(yStr);
    onChange(`${yStr}-${mStr}-${dStr}`);
    setIsOpen(false);
    onOpenStateChange?.(false);
  };

  // Check if a date in the calendar is on or before today
  const isDateAllowed = (d: number) => {
    const date = new Date(viewYear, viewMonth, d);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return date <= today;
  };

  // Year options list: from maxAllowedYear down to 1920
  const yearOptions = [];
  for (let y = maxAllowedYear; y >= 1920; y--) {
    yearOptions.push(y);
  }

  // Border & background styling based on validation
  const containerClass = hasError
    ? isLightText
      ? "bg-red-500/10 border-2 border-red-500/80 ring-1 ring-red-500/30"
      : "bg-red-50/80 border-2 border-red-500 ring-1 ring-red-500/20"
    : isValid
    ? isLightText
      ? "bg-emerald-500/5 border border-emerald-500/40"
      : "bg-emerald-50/40 border border-emerald-500/40"
    : isLightText
    ? "bg-white/5 border border-white/10 focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-400/30"
    : "bg-black/5 border border-black/10 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500/30";

  return (
    <div ref={containerRef} className="relative w-full">
      {/* 3-Segment Input Container */}
      <div
        className={`w-full h-10 px-2.5 rounded-xl flex items-center justify-between transition-all select-none ${containerClass}`}
        onClick={() => {
          if (!month) monthRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-1 font-mono text-xs font-medium" onPaste={handlePaste}>
          <input
            ref={monthRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            placeholder="MM"
            value={month}
            onChange={handleMonthChange}
            onKeyDown={(e) => handleKeyDown("m", e)}
            onBlur={onBlur}
            className={`w-7 text-center bg-transparent focus:outline-none placeholder:opacity-40 font-mono text-xs ${
              isLightText ? "text-white placeholder-white/30" : "text-black placeholder-black/30"
            }`}
          />
          <span className="opacity-30 text-xs">/</span>
          <input
            ref={dayRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            placeholder="DD"
            value={day}
            onChange={handleDayChange}
            onKeyDown={(e) => handleKeyDown("d", e)}
            onBlur={onBlur}
            className={`w-7 text-center bg-transparent focus:outline-none placeholder:opacity-40 font-mono text-xs ${
              isLightText ? "text-white placeholder-white/30" : "text-black placeholder-black/30"
            }`}
          />
          <span className="opacity-30 text-xs">/</span>
          <input
            ref={yearRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            placeholder="YYYY"
            value={year}
            onChange={handleYearChange}
            onKeyDown={(e) => handleKeyDown("y", e)}
            onBlur={onBlur}
            className={`w-12 text-center bg-transparent focus:outline-none placeholder:opacity-40 font-mono text-xs ${
              isLightText ? "text-white placeholder-white/30" : "text-black placeholder-black/30"
            }`}
          />
        </div>

        {/* Calendar Picker Trigger Button */}
        <button
          type="button"
          onClick={handleToggleOpen}
          aria-label="Toggle calendar picker"
          className={`p-1.5 rounded-lg transition flex items-center justify-center cursor-pointer ${
            isOpen
              ? "bg-amber-400/20 text-amber-400"
              : isLightText
              ? "text-white/60 hover:text-white hover:bg-white/10"
              : "text-black/60 hover:text-black hover:bg-black/10"
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Interactive Calendar Popover */}
      {isOpen && (
        <div
          className={`pp-calendar-popover absolute z-50 mt-1.5 left-0 right-0 sm:left-auto sm:right-0 sm:w-72 p-3 rounded-2xl shadow-2xl border backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150 ${
            isLightText
              ? "bg-[#141624] border-white/20 text-white shadow-black/80"
              : "bg-white border-black/15 text-black shadow-xl"
          }`}
          style={{ zIndex: 99999 }}
        >
          {/* Header Controls: Month & Year Dropdowns */}
          <div className="flex items-center justify-between gap-1.5 mb-2.5 pb-2 border-b border-white/10">
            <button
              type="button"
              onClick={() => {
                if (viewMonth === 0) {
                  setViewMonth(11);
                  setViewYear((y) => y - 1);
                } else {
                  setViewMonth((m) => m - 1);
                }
              }}
              className="p-1 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-center gap-1">
              {/* Month Select */}
              <select
                value={viewMonth}
                onChange={(e) => setViewMonth(parseInt(e.target.value, 10))}
                className="bg-white/10 border border-white/15 rounded-lg px-2 py-1 text-xs font-bold text-white focus:outline-none cursor-pointer"
              >
                {MONTH_NAMES.map((name, idx) => (
                  <option key={name} value={idx} className="bg-[#141624] text-white">
                    {name.slice(0, 3)}
                  </option>
                ))}
              </select>

              {/* Year Select */}
              <select
                value={viewYear}
                onChange={(e) => setViewYear(parseInt(e.target.value, 10))}
                className="bg-white/10 border border-white/15 rounded-lg px-2 py-1 text-xs font-bold text-white focus:outline-none cursor-pointer"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y} className="bg-[#141624] text-white">
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              disabled={viewYear === maxAllowedYear && viewMonth >= new Date().getMonth()}
              onClick={() => {
                if (viewMonth === 11) {
                  setViewMonth(0);
                  setViewYear((y) => y + 1);
                } else {
                  setViewMonth((m) => m + 1);
                }
              }}
              className="p-1 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition disabled:opacity-30 cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Days of Week Row */}
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wider opacity-50 mb-1">
            <span>Su</span>
            <span>Mo</span>
            <span>Tu</span>
            <span>We</span>
            <span>Th</span>
            <span>Fr</span>
            <span>Sa</span>
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="h-7 w-7" />
            ))}

            {Array.from({ length: daysInMonth }).map((_, i) => {
              const dNum = i + 1;
              const allowed = isDateAllowed(dNum);
              const isSelected =
                parseInt(year, 10) === viewYear &&
                parseInt(month, 10) === viewMonth + 1 &&
                parseInt(day, 10) === dNum;

              return (
                <button
                  key={dNum}
                  type="button"
                  disabled={!allowed}
                  onClick={() => handleSelectDay(dNum)}
                  className={`h-7 w-7 rounded-lg text-xs font-medium flex items-center justify-center transition cursor-pointer ${
                    isSelected
                      ? "text-white font-bold shadow-md ring-1 ring-white/40"
                      : allowed
                      ? "hover:bg-white/15 text-white/90"
                      : "opacity-20 cursor-not-allowed text-white/40"
                  }`}
                  style={isSelected ? { backgroundColor: primaryColor } : {}}
                >
                  {dNum}
                </button>
              );
            })}
          </div>

          {/* Footer note */}
          <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[10.5px]">
            <span className="text-white/50 font-medium">Select Date of Birth</span>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onOpenStateChange?.(false);
              }}
              className="text-white/60 hover:text-white font-semibold underline cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PortalPayAccordionCheckoutV2({
  theme,
  isLightText = true,
  email: initialEmail = "",
  phone: initialPhone = "",
  fullName: initialFullName = "",
  firstName: initialFirstName = "",
  lastName: initialLastName = "",
  line1: initialLine1 = "",
  line2: initialLine2 = "",
  city: initialCity = "",
  stateCode: initialStateCode = "",
  zipCode: initialZipCode = "",
  country: initialCountry = "US",
  dob: initialDob = "",
  amountUsd = 25.0,
  receiptId = "REC-88492-V2",
  headlessError: propError,
  kycTierRequired = "l0",
  kycLevel = "L0",
  kycTiers = [],
  simulatedTier,
  simulatedStatus,
  simulatedError = "none",
  simulatedPath = "normal",
  isAllKycCompleted = false,
  onHeadlessSubmitEmailPhone,
  onSubmitKycInfo,
  onVerifyDocuments,
  onSelectPaymentMethod,
  onCompleteCheckout,
  paymentElement,
  authElement,
  headlessStatus,
  headlessStep,
  paymentConfirmed,
  detectedCardFunding,
  detectedCardBrand,
  detectedCardLast4,
  onEmailReceipt,
}: PortalPayAccordionCheckoutV2Props) {
  const primaryColor = theme?.primaryColor || "#635BFF";

  // Active accordion step: 1 = Contact & Account, 2 = Identity (L0/L1/L2), 3 = Payment, 4 = Order Processing
  const [activeStep, setActiveStep] = useState<number>(1);
  const [localError, setLocalError] = useState<string | null>(null);
  const [manualEditAddress, setManualEditAddress] = useState<boolean>(false);

  // Format and translate raw errors into clear customer guidance
  const formatErrorMessage = (err?: string | null): string | null => {
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
    return err;
  };

  // Active error (props or simulated, formatted)
  const activeError = formatErrorMessage(localError || propError);

  // Step 1: Contact State
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone);
  const [country, setCountry] = useState(initialCountry || "US");
  const [isSubmittingContact, setIsSubmittingContact] = useState(false);

  // Step 2: Identity & Address State (L0, L1, L2)
  const parts = (initialFullName || "").trim().split(/\s+/);
  const [firstName, setFirstName] = useState(initialFirstName || parts[0] || "");
  const [lastName, setLastName] = useState(initialLastName || parts.slice(1).join(" ") || "");
  const [line1, setLine1] = useState(initialLine1 || "");
  const [line2, setLine2] = useState(initialLine2 || "");
  const [city, setCity] = useState(initialCity || "");
  const [stateCode, setStateCode] = useState(initialStateCode || "");
  const [zipCode, setZipCode] = useState(initialZipCode || "");
  const [ssn, setSsn] = useState("");
  const [dob, setDob] = useState(initialDob || "");

  // Compiled single-line address for address lookup & autocomplete
  const compiledInitialAddress = [initialLine1, initialLine2, initialCity, initialStateCode, initialZipCode]
    .filter(Boolean)
    .map((s) => String(s).trim())
    .filter(Boolean)
    .join(", ");
  const [addressSearchInput, setAddressSearchInput] = useState(compiledInitialAddress || initialLine1 || "");

  const [isAddressParsed, setIsAddressParsed] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isSubmittingIdentity, setIsSubmittingIdentity] = useState(false);
  const [isVerifyingDocs, setIsVerifyingDocs] = useState(false);
  const [docVerificationSuccess, setDocVerificationSuccess] = useState(false);

  // Step 2 Form validation tracking & visual highlighting
  const [attemptedIdentitySubmit, setAttemptedIdentitySubmit] = useState(false);
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});

  const markFieldTouched = (field: string) => {
    setTouchedFields((prev) => ({ ...prev, [field]: true }));
  };

  const ssnDigits = (ssn || "").replace(/\D/g, "");

  // Robust Date of Birth validation (YYYY-MM-DD, past date)
  const validateDob = (val: string): { valid: boolean; age?: number; error?: string } => {
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

  const dobStatus = validateDob(dob);

  const fieldValidation = {
    firstName: (firstName || "").trim().length >= 1,
    lastName: (lastName || "").trim().length >= 1,
    line1: (line1 || "").trim().length >= 3,
    city: (city || "").trim().length >= 2,
    stateCode: (stateCode || "").trim().length >= 2,
    zipCode: (zipCode || "").trim().length >= 5,
    dob: dobStatus.valid,
    ssn: ssnDigits.length === 9,
  };

  // Effective tier and status determination
  const effectiveTier: string = simulatedTier || kycTierRequired || "l0";
  const effectiveStatus: string = simulatedStatus || (isAllKycCompleted ? "verified" : "normal");

  // Strict separation of simulation demo mode vs live production checkout
  const isSimulationMode = Boolean(simulatedTier || simulatedStatus || (simulatedPath && simulatedPath !== "normal"));
  const isLiveMode = !isSimulationMode;

  // Step 3: Payment State (Simulation / Preview)
  const [selectedPaymentType, setSelectedPaymentType] = useState<"applePay" | "googlePay" | "card" | "bank">("card");
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  // Step 4: Fulfillment Stage ("processing" | "confirming" | "complete")
  const [fulfillmentStage, setFulfillmentStage] = useState<"processing" | "confirming" | "complete">("processing");

  // In live production mode, order confirmation strictly requires verifiable payment confirmation or completed onramp state
  const isOrderConfirmed = isLiveMode
    ? Boolean(paymentConfirmed || headlessStep === "completed")
    : fulfillmentStage === "complete";

  // DOM Container Refs for Stripe Embedded Elements
  const authContainerRef = useRef<HTMLDivElement>(null);
  const paymentContainerRef = useRef<HTMLDivElement>(null);
  const identityContainerRef = useRef<HTMLDivElement>(null);

  // Sync props when initial values change
  useEffect(() => {
    if (initialEmail && !email) setEmail(initialEmail);
    if (initialPhone && !phone) setPhone(initialPhone);
    if (initialFirstName && !firstName) setFirstName(initialFirstName);
    if (initialLastName && !lastName) setLastName(initialLastName);
    if (initialFullName && (!firstName || !lastName)) {
      const p = initialFullName.trim().split(/\s+/);
      if (!firstName) setFirstName(p[0] || "");
      if (!lastName) setLastName(p.slice(1).join(" ") || "");
    }
    if (initialLine1 && !line1) setLine1(initialLine1);
    if (initialLine2 && !line2) setLine2(initialLine2);
    if (initialCity && !city) setCity(initialCity);
    if (initialStateCode && !stateCode) setStateCode(initialStateCode);
    if (initialZipCode && !zipCode) setZipCode(initialZipCode);
    if (initialCountry && (!country || country === "US")) setCountry(initialCountry);
    if (initialDob && !dob) setDob(initialDob);

    // Compile into one line for the address lookup field
    const compiled = [initialLine1, initialLine2, initialCity, initialStateCode, initialZipCode]
      .filter(Boolean)
      .map((s) => String(s).trim())
      .filter(Boolean)
      .join(", ");

    if (compiled) {
      setAddressSearchInput((prev) => prev || compiled);
      if (!addressSearchInput) {
        handleFetchSuggestions(compiled);
      }
    }
  }, [initialEmail, initialPhone, initialFullName, initialFirstName, initialLastName, initialLine1, initialLine2, initialCity, initialStateCode, initialZipCode, initialCountry, initialDob]);

  // Clean mounting of authElement into container
  useEffect(() => {
    const container = authContainerRef.current;
    if (!container) return;
    if (authElement && typeof authElement === "object" && "nodeType" in authElement) {
      container.innerHTML = "";
      container.appendChild(authElement as HTMLElement);
    }
  }, [authElement, activeStep]);

  // Clean mounting of paymentElement / identity verification element into container
  useEffect(() => {
    const isVerifying = headlessStep === "verifying_identity";
    const container = isVerifying ? identityContainerRef.current : paymentContainerRef.current;
    if (!container) return;
    if (paymentElement && typeof paymentElement === "object" && "nodeType" in paymentElement) {
      container.innerHTML = "";
      container.appendChild(paymentElement as HTMLElement);
    }
  }, [paymentElement, activeStep, headlessStep]);

  // Handle Step 4 Fulfillment Progression (Simulation preview only — strictly disabled in live production mode)
  useEffect(() => {
    // ONLY run preview timer when explicitly in simulation mode (e.g. sample preview forms)
    if (
      isSimulationMode &&
      activeStep === 4 &&
      (!headlessStep || headlessStep === "idle") &&
      !paymentElement &&
      !propError &&
      !localError
    ) {
      setFulfillmentStage("processing");
      const t1 = setTimeout(() => setFulfillmentStage("confirming"), 1200);
      const t2 = setTimeout(() => setFulfillmentStage("complete"), 2500);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [isSimulationMode, activeStep, headlessStep, paymentElement, propError, localError]);

  // Address Autocomplete handler
  const handleFetchSuggestions = async (input: string) => {
    if (!input || input.trim().length < 3) {
      setAddressSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const res = await fetch(`/api/address/autocomplete?input=${encodeURIComponent(input)}`);
      if (res.ok) {
        const data = await res.json();
        setAddressSuggestions(data.predictions || []);
        setShowSuggestions((data.predictions || []).length > 0);
      }
    } catch (e) {
      console.warn("Autocomplete search failed:", e);
    }
  };

  const handleSelectSuggestion = async (item: any) => {
    if (!item) return;
    const selectedText = item.mainText || item.description || "";
    setAddressSearchInput(selectedText);
    setLine1(selectedText);
    setShowSuggestions(false);
    if (item.placeId) {
      try {
        const res = await fetch(`/api/address/autocomplete?placeId=${encodeURIComponent(item.placeId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.streetAddress) setLine1(data.streetAddress);
          if (data.apartment) setLine2(data.apartment);
          if (data.city) setCity(data.city);
          if (data.state) setStateCode(data.state);
          if (data.zip) setZipCode(data.zip);
          if (data.country) setCountry(data.country);
        }
      } catch (err) {
        console.warn("Place details fetch failed:", err);
      }
    }
    setIsAddressParsed(true);
  };

  // Reset Simulation
  const handleResetSimulation = () => {
    setActiveStep(1);
    setFulfillmentStage("processing");
    setLocalError(null);
    setDocVerificationSuccess(false);
  };

  // Automatically advance accordion steps when live Stripe headlessStep transitions!
  useEffect(() => {
    // 1. If an error occurs, halt Step 4 immediately and return to Step 2 (if address issue) or Step 3 (if payment issue)
    if (headlessStep === "error" || propError) {
      setIsSubmittingContact(false);
      setIsSubmittingIdentity(false);
      setIsSubmittingPayment(false);
      setFulfillmentStage("processing");

      const errStr = String(propError || localError || "").toLowerCase();
      const isAddressIssue =
        errStr.includes("address") ||
        errStr.includes("headless mode") ||
        errStr.includes("unsupported_region") ||
        errStr.includes("unsupported_country");

      if (isAddressIssue) {
        setActiveStep(2);
      } else {
        setActiveStep(3);
      }
      return;
    }

    if (paymentConfirmed) {
      setIsSubmittingContact(false);
      setIsSubmittingIdentity(false);
      setIsSubmittingPayment(false);
      setActiveStep(4);
      setFulfillmentStage("complete");
      return;
    }
    if (!headlessStep) return;
    if (
      headlessStep === "checking_link" ||
      headlessStep === "registering_link" ||
      headlessStep === "authenticating" ||
      headlessStep === "collecting_phone"
    ) {
      if (authElement || headlessStep === "collecting_phone" || headlessStep === "authenticating") {
        setActiveStep(1);
      }
    } else if (
      headlessStep === "checking_kyc" ||
      headlessStep === "collecting_kyc" ||
      headlessStep === "submitting_kyc" ||
      headlessStep === "verifying_identity"
    ) {
      setIsSubmittingContact(false);
      if (headlessStep === "verifying_identity") {
        setActiveStep(2);
      } else if (!isAllKycCompleted && effectiveStatus !== "verified") {
        setActiveStep(2);
      } else {
        setActiveStep(3);
      }
    } else if (
      headlessStep === "creating_wallet" ||
      headlessStep === "registering_wallet" ||
      headlessStep === "collecting_payment" ||
      headlessStep === "payment_method_required"
    ) {
      setIsSubmittingContact(false);
      setIsSubmittingIdentity(false);
      setActiveStep(3);
    } else if (
      headlessStep === "creating_session" ||
      headlessStep === "confirming_fees" ||
      headlessStep === "checking_out" ||
      headlessStep === "transferring" ||
      (headlessStep === "awaiting_funds" && detectedCardFunding !== "us_bank_account")
    ) {
      setIsSubmittingContact(false);
      setIsSubmittingIdentity(false);
      setIsSubmittingPayment(false);
      setActiveStep(4);
      setFulfillmentStage("processing");
    } else if (
      headlessStep === "completed" ||
      (headlessStep === "awaiting_funds" && detectedCardFunding === "us_bank_account")
    ) {
      setIsSubmittingContact(false);
      setIsSubmittingIdentity(false);
      setIsSubmittingPayment(false);
      setActiveStep(4);
      setFulfillmentStage("complete");
    }
  }, [headlessStep, authElement, isAllKycCompleted, effectiveStatus, paymentConfirmed, propError, localError, detectedCardFunding]);

  // If KYC is already completed or verified, automatically skip or advance to Step 3 (unless on payment execution/completion or error)
  useEffect(() => {
    if (
      [
        "verifying_identity",
        "checking_kyc",
        "collecting_kyc",
        "submitting_kyc",
        "creating_session",
        "confirming_fees",
        "checking_out",
        "transferring",
        "awaiting_funds",
        "completed",
        "error",
      ].includes(headlessStep as string) ||
      paymentConfirmed ||
      propError ||
      localError
    ) {
      return;
    }
    if ((isAllKycCompleted || effectiveStatus === "verified") && headlessStep === "collecting_payment") {
      setIsSubmittingContact(false);
      setIsSubmittingIdentity(false);
      setActiveStep((prev) => (prev <= 2 ? 3 : prev));
    }
  }, [isAllKycCompleted, effectiveStatus, headlessStep, paymentConfirmed, propError, localError]);

  // Step 1 Submit (Account & Contact)
  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setIsSubmittingContact(true);
    setLocalError(null);
    try {
      if (onHeadlessSubmitEmailPhone) {
        await onHeadlessSubmitEmailPhone(email, phone, country, `${firstName} ${lastName}`.trim());
      } else {
        // Pure simulation mode without backend
        if (
          simulatedPath === "skip_kyc" ||
          isAllKycCompleted ||
          effectiveStatus === "verified"
        ) {
          setActiveStep(3);
        } else {
          setActiveStep(2);
        }
      }
    } catch (err: any) {
      console.error("Contact submission error:", err);
      setLocalError(err?.message || "Failed to submit contact information.");
    } finally {
      setIsSubmittingContact(false);
    }
  };

  // Canonical Stripe Onramp KYC tier detection matching WizardView:
  const l1Verified = (kycTiers || []).some(
    (t: any) => t.tier === "l1" && t.verification_status === "verified",
  );
  const l1NotAvailable = (kycTiers || []).some(
    (t: any) => t.tier === "l1" && t.verification_status === "not_available",
  );

  // L1 step-up form (SSN + DOB required to advance from L0 → L1)
  const showStepUpForm =
    effectiveTier === "l1" ||
    effectiveStatus === "step_up" ||
    kycLevel === "L0";

  // Full L0 form (name, address): initial users, or when manual address editing is active in step-up
  const showFullForm =
    !showStepUpForm ||
    manualEditAddress ||
    kycLevel === "REQUIRES_KYC" ||
    (kycLevel === "REJECTED" && !l1Verified && !l1NotAvailable);

  // Document verification button: user is at L1, or REJECTED but L1 was already verified or not_available
  const showVerifyDocs =
    effectiveTier === "l2" ||
    effectiveStatus === "doc_verify" ||
    kycLevel === "L1" ||
    (kycLevel === "REJECTED" && l1Verified) ||
    (kycLevel === "REJECTED" && l1NotAvailable);

  const isL2Requirement = showVerifyDocs || effectiveTier === "l2" || (kycTierRequired as string) === "l2";
  const isL1Requirement = showStepUpForm || showVerifyDocs || effectiveTier === "l1" || (kycTierRequired as string) === "l1";

  const isL2Approved =
    isAllKycCompleted ||
    docVerificationSuccess ||
    kycLevel === "L2" ||
    effectiveStatus === "verified";

  // Step 2 Document Verification Trigger
  const handleDocumentVerificationClick = async () => {
    setIsVerifyingDocs(true);
    setLocalError(null);
    try {
      if (onVerifyDocuments) {
        await onVerifyDocuments();
      }
      // If in simulation or test mode, mock successful verification
      setDocVerificationSuccess(true);
      if (effectiveStatus === "doc_verify" || effectiveTier === "l2") {
        setActiveStep(3);
      }
    } catch (err: any) {
      console.error("Document verification error:", err);
      setLocalError(err?.message || "Government ID verification could not be completed.");
    } finally {
      setIsVerifyingDocs(false);
    }
  };

  // Missing fields list for dynamic feedback
  const missingIdentityFields: { key: string; label: string }[] = [];
  if (showStepUpForm) {
    if (!fieldValidation.dob) missingIdentityFields.push({ key: "dob", label: dobStatus.error || "Date of Birth" });
    if (!fieldValidation.ssn) missingIdentityFields.push({ key: "ssn", label: ssnDigits.length > 0 ? `SSN (${9 - ssnDigits.length} digits left)` : "9-Digit SSN" });
    if (manualEditAddress) {
      if (!fieldValidation.firstName) missingIdentityFields.push({ key: "firstName", label: "First Name" });
      if (!fieldValidation.lastName) missingIdentityFields.push({ key: "lastName", label: "Last Name" });
      if (!fieldValidation.line1) missingIdentityFields.push({ key: "line1", label: "Street Address" });
      if (!fieldValidation.city) missingIdentityFields.push({ key: "city", label: "City" });
      if (!fieldValidation.stateCode) missingIdentityFields.push({ key: "stateCode", label: "State" });
      if (!fieldValidation.zipCode) missingIdentityFields.push({ key: "zipCode", label: "Zip Code" });
    }
  } else if (showFullForm) {
    if (!fieldValidation.firstName) missingIdentityFields.push({ key: "firstName", label: "First Name" });
    if (!fieldValidation.lastName) missingIdentityFields.push({ key: "lastName", label: "Last Name" });
    if (!fieldValidation.line1) missingIdentityFields.push({ key: "line1", label: "Street Address" });
    if (!fieldValidation.city) missingIdentityFields.push({ key: "city", label: "City" });
    if (!fieldValidation.stateCode) missingIdentityFields.push({ key: "stateCode", label: "State" });
    if (!fieldValidation.zipCode) missingIdentityFields.push({ key: "zipCode", label: "Zip Code" });
  }

  const isIdentityComplete = missingIdentityFields.length === 0;

  const errText = String(activeError || "").toLowerCase();
  const hasAddressError = Boolean(
    errText &&
    (errText.includes("address") ||
     errText.includes("postal") ||
     errText.includes("zip") ||
     errText.includes("street") ||
     errText.includes("city") ||
     errText.includes("headless mode") ||
     errText.includes("unsupported_region") ||
     errText.includes("unsupported_country"))
  );
  const hasDobError = Boolean(errText && (errText.includes("date_of_birth") || errText.includes("birth") || errText.includes("dob") || errText.includes("18 years")));
  const hasSsnError = Boolean(errText && (errText.includes("ssn") || errText.includes("id_number") || errText.includes("social security")));
  const hasNameError = Boolean(
    errText &&
    (errText.includes("given_name") ||
     errText.includes("surname") ||
     (errText.includes("name") && !errText.includes("bank_name")) ||
     errText.includes("legal details") ||
     errText.includes("identity verification details were rejected"))
  );

  const isFieldInvalid = (field: keyof typeof fieldValidation) => {
    if (hasNameError && (field === "firstName" || field === "lastName")) {
      return true;
    }
    if (hasAddressError && (field === "line1" || field === "city" || field === "stateCode" || field === "zipCode")) {
      return true;
    }
    if (hasDobError && field === "dob") {
      return true;
    }
    if (hasSsnError && field === "ssn") {
      return true;
    }
    return (attemptedIdentitySubmit || touchedFields[field]) && !fieldValidation[field];
  };

  const isFieldValid = (field: keyof typeof fieldValidation) => {
    if (hasNameError && (field === "firstName" || field === "lastName")) {
      return false;
    }
    if (hasAddressError && (field === "line1" || field === "city" || field === "stateCode" || field === "zipCode")) {
      return false;
    }
    if (hasDobError && field === "dob") {
      return false;
    }
    if (hasSsnError && field === "ssn") {
      return false;
    }
    return touchedFields[field] && fieldValidation[field];
  };

  const getFieldInputClass = (field: keyof typeof fieldValidation) => {
    const invalid = isFieldInvalid(field);
    const valid = isFieldValid(field);
    if (invalid) {
      return isLightText
        ? "bg-red-500/10 border-2 border-red-500/80 text-white placeholder-red-300/40 ring-1 ring-red-500/30 focus:border-red-400 focus:ring-red-400/40"
        : "bg-red-50/80 border-2 border-red-500 text-red-900 placeholder-red-400/60 ring-1 ring-red-500/20 focus:border-red-600 focus:ring-red-600/30";
    }
    if (valid) {
      return isLightText
        ? "bg-emerald-500/5 border border-emerald-500/40 text-white focus:border-emerald-400"
        : "bg-emerald-50/40 border border-emerald-500/40 text-black focus:border-emerald-600";
    }
    return isLightText
      ? "bg-white/5 border border-white/10 text-white focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/30"
      : "bg-black/5 border border-black/10 text-black focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30";
  };

  // Step 2 Submit (L0 / L1 / L2)
  const handleIdentitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttemptedIdentitySubmit(true);
    setLocalError(null);

    // Guard: Validate complete form before sending anything to Stripe!
    if (!isIdentityComplete) {
      setLocalError(`Please complete all required fields: ${missingIdentityFields.map((f) => f.label).join(", ")}`);
      return;
    }

    // If L2 is required and not yet approved, user MUST click the document upload button first!
    if (isL2Requirement && !isL2Approved) {
      setLocalError("Government ID / Document upload is required for Level 2 verification. Please click the upload button above.");
      return;
    }

    setIsSubmittingIdentity(true);

    // Simulated Error Handling
    if (simulatedError === "address_error") {
      setTimeout(() => {
        setLocalError("Residential address could not be verified by USPS/Stripe. Please enter legal address matching government ID.");
        setIsSubmittingIdentity(false);
      }, 500);
      return;
    }

    if (simulatedError === "kyc_rejection") {
      setTimeout(() => {
        setLocalError("Identity check failed. Government ID upload is required to proceed.");
        setIsSubmittingIdentity(false);
      }, 500);
      return;
    }

    try {
      let parsedDob: { year: number; month: number; day: number } | undefined = undefined;
      if (dob) {
        const parts = dob.split("-").map(Number);
        if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
          parsedDob = { year: parts[0], month: parts[1], day: parts[2] };
        }
      }

      if (onSubmitKycInfo) {
        if (showStepUpForm && !manualEditAddress) {
          await onSubmitKycInfo({
            ...(parsedDob ? { date_of_birth: parsedDob } : {}),
            ...(ssnDigits ? { id_number: { type: "us_ssn", value: ssnDigits } } : {}),
          });
        } else {
          await onSubmitKycInfo({
            given_name: firstName.trim(),
            surname: lastName.trim(),
            address: {
              line1: line1.trim(),
              ...(line2 ? { line2: line2.trim() } : {}),
              city: city.trim(),
              state: stateCode.trim(),
              postal_code: zipCode.trim(),
              country: country || "US",
            },
            ...(showStepUpForm && parsedDob ? { date_of_birth: parsedDob } : {}),
            ...(showStepUpForm && ssnDigits ? { id_number: { type: "us_ssn", value: ssnDigits } } : {}),
          });
        }
      }

      if (isL2Requirement && !isL2Approved && onVerifyDocuments) {
        await onVerifyDocuments();
      }

      if (!propError && headlessStep !== "error") {
        setActiveStep(3);
      }
    } catch (err: any) {
      console.error("Identity submission error:", err);
      setLocalError(err?.message || "Failed to submit identity details.");
    } finally {
      setIsSubmittingIdentity(false);
    }
  };

  // Step 3 Submit (Fallback simulation / testing when no live Stripe paymentElement is mounted)
  const handleSimulatedPaymentSubmit = async () => {
    setIsSubmittingPayment(true);
    setLocalError(null);

    // Simulated Payment Decline Error
    if (simulatedError === "payment_decline") {
      setTimeout(() => {
        setLocalError("Payment Declined: Card authorization failed due to insufficient funds or risk check.");
        setIsSubmittingPayment(false);
      }, 600);
      return;
    }

    try {
      if (onCompleteCheckout) {
        await onCompleteCheckout();
      }
      setActiveStep(4);
    } catch (err: any) {
      console.error("Payment checkout error:", err);
      setLocalError(err?.message || "Payment authorization failed.");
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  return (
    <div className="w-full flex flex-col items-stretch justify-start space-y-3.5 text-left font-sans antialiased animate-in zoom-in-95 duration-300">
      
      {/* Top Global Trust Header */}
      <div className="flex items-center justify-between px-1 pb-1">
        <div className="flex items-center gap-1.5 text-amber-400">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold uppercase tracking-wider">
            {theme?.brandName ? `${theme.brandName} Secure Checkout` : "Secure Checkout"}
          </span>
        </div>
        <div className={`text-[10px] font-semibold flex items-center gap-1.5 ${isLightText ? "text-white/60" : "text-black/60"}`}>
          <Lock className="w-3 h-3 text-emerald-400" />
          <span>256-Bit Encrypted</span>
        </div>
      </div>

      {/* Global Error Banner */}
      {activeError && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-medium flex items-start justify-between gap-2 animate-in slide-in-from-top-2 ${
            isLightText
              ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
              : "bg-amber-50 border-amber-300 text-amber-900"
          }`}
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{activeError}</span>
          </div>
          <button
            type="button"
            onClick={() => setLocalError(null)}
            className="text-[10px] underline opacity-80 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* STEP 1: CONTACT & ACCOUNT */}
      {/* ==================================================================== */}
      <div
        className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
          activeStep === 1
            ? isLightText
              ? "border-amber-500/40 bg-white/[0.04] shadow-xl"
              : "border-amber-500/40 bg-black/[0.02] shadow-md"
            : isLightText
            ? "border-white/10 bg-white/[0.02]"
            : "border-black/10 bg-black/[0.01]"
        }`}
      >
        {/* Step 1 Header / Summary Pill */}
        <div
          onClick={() => activeStep > 1 && setActiveStep(1)}
          className={`p-3.5 flex items-center justify-between select-none ${
            activeStep > 1 ? "cursor-pointer hover:bg-white/[0.04]" : ""
          }`}
        >
          <div className="flex items-center gap-2.5">
            {activeStep > 1 ? (
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40">
                <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />
              </div>
            ) : (
              <div className="w-5 h-5 rounded-full bg-amber-500 text-black flex items-center justify-center text-xs font-bold">
                1
              </div>
            )}
            <div>
              <h4 className={`text-xs font-bold tracking-tight ${isLightText ? "text-white" : "text-black"}`}>
                1. Contact & Account Information
              </h4>
              {activeStep > 1 && (
                <p className={`text-[11px] font-medium opacity-70 flex items-center gap-1.5 ${isLightText ? "text-white" : "text-black"}`}>
                  <Mail className="w-2.5 h-2.5 opacity-60" />
                  <span>{email}</span>
                  {phone && <span>• {phone}</span>}
                  {country && <span>({country})</span>}
                </p>
              )}
            </div>
          </div>
          {activeStep > 1 && (
            <button
              type="button"
              className="text-[11px] font-semibold text-amber-400 flex items-center gap-1 hover:underline"
            >
              <Edit2 className="w-3 h-3" /> Edit
            </button>
          )}
        </div>

        {/* Step 1 Expanded Body */}
        <form onSubmit={handleContactSubmit} className={`p-3.5 pt-0 space-y-3 border-t border-dashed border-white/10 ${activeStep === 1 ? "" : "hidden"}`}>
            <div>
              <label className={`flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                <Mail className="w-3 h-3" />
                <span>Email Address</span>
              </label>
              <input
                type="email"
                required
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${
                  isLightText
                    ? "bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-amber-400/50"
                    : "bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-amber-400/50"
                }`}
              />
            </div>

            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-5">
                <label className={`flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                  <Phone className="w-3 h-3" />
                  <span>Mobile Phone</span>
                </label>
                <input
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                  className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${
                    isLightText
                      ? "bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-amber-400/50"
                      : "bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-amber-400/50"
                  }`}
                />
              </div>
              <div className="col-span-7">
                <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                  Country
                </label>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className={`w-full h-10 px-2 rounded-xl focus:outline-none transition-all text-xs font-medium ${
                    isLightText
                      ? "bg-neutral-900 border border-white/10 text-white focus:border-amber-400/50"
                      : "bg-white border border-black/10 text-black focus:border-amber-400/50"
                  }`}
                >
                  <option value="US">United States (US)</option>
                  <option value="GB">United Kingdom (GB)</option>
                  <option value="DE">Germany (DE)</option>
                  <option value="FR">France (FR)</option>
                  <option value="ES">Spain (ES)</option>
                  <option value="IT">Italy (IT)</option>
                  <option value="NL">Netherlands (NL)</option>
                  <option value="IE">Ireland (IE)</option>
                  <option value="AU">Australia (AU)</option>
                </select>
              </div>
            </div>

            {/* Inline OTP Element if triggered by Stripe Link */}
            {authElement && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 my-2">
                <p className="text-[11px] font-bold text-amber-400 mb-2 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" /> Enter 6-Digit Link Security Code
                </p>
                <div
                  ref={(el) => {
                    (authContainerRef as any).current = el;
                    if (el && authElement && typeof authElement === "object" && "nodeType" in authElement) {
                      if (!el.contains(authElement as Node)) {
                        el.innerHTML = "";
                        el.appendChild(authElement as HTMLElement);
                      }
                    }
                  }}
                >
                  {typeof authElement !== "object" || !("nodeType" in (authElement || {}))
                    ? (authElement as React.ReactNode)
                    : null}
                </div>
              </div>
            )}

            {/* Inline Step 1 Error Notice */}
            {activeError && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5 animate-in fade-in duration-200">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold text-amber-200">Account Notice:</div>
                  <div className="text-[11px] leading-relaxed text-amber-300">
                    {activeError}
                  </div>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmittingContact || !email}
              className="w-full h-10 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-lg"
              style={{ backgroundColor: primaryColor, color: "#fff" }}
            >
              {isSubmittingContact ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying Contact Information...</span>
                </>
              ) : authElement ? (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Enter 6-Digit Code Above</span>
                </>
              ) : (
                <>
                  <span>Continue to Identity Verification</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
        </form>
      </div>

      {/* ==================================================================== */}
      {/* STEP 2: LEGAL & RESIDENTIAL IDENTITY */}
      {/* ==================================================================== */}
      <div
        className={`rounded-2xl border transition-all duration-300 relative ${
          showSuggestions || isCalendarOpen ? "z-40 overflow-visible" : "overflow-hidden"
        } ${
          activeStep === 2
            ? isLightText
              ? "border-amber-500/40 bg-white/[0.04] shadow-xl"
              : "border-amber-500/40 bg-black/[0.01] shadow-md"
            : isLightText
            ? "border-white/10 bg-white/[0.02]"
            : "border-black/10 bg-black/[0.01]"
        }`}
      >
        {/* Step 2 Header / Summary Pill */}
        <div
          onClick={() => activeStep > 2 && setActiveStep(2)}
          className={`p-3.5 flex items-center justify-between select-none ${
            activeStep > 2 ? "cursor-pointer hover:bg-white/[0.04]" : ""
          }`}
        >
          <div className="flex items-center gap-2.5">
            {activeStep > 2 || effectiveStatus === "verified" || isAllKycCompleted ? (
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40">
                <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />
              </div>
            ) : (
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                  activeStep === 2 ? "bg-amber-500 text-black" : "bg-white/10 text-white/40"
                }`}
              >
                2
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h4 className={`text-xs font-bold tracking-tight ${isLightText ? "text-white" : "text-black"}`}>
                  2. Identity & Residential Verification
                </h4>
                {(isL2Approved || isAllKycCompleted || effectiveStatus === "verified") && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1">
                    <Check className="w-2.5 h-2.5 stroke-[3]" /> Verified
                  </span>
                )}
              </div>

              {(activeStep > 2 || effectiveStatus === "verified" || isAllKycCompleted) && (
                <p className={`text-[11px] font-medium opacity-70 flex items-center gap-1.5 ${isLightText ? "text-white" : "text-black"}`}>
                  <User className="w-2.5 h-2.5 opacity-60" />
                  <span>{firstName} {lastName}</span>
                  {line1 && <span>• {line1}, {city}</span>}
                </p>
              )}
            </div>
          </div>

          {activeStep > 2 && (
            <button
              type="button"
              className="text-[11px] font-semibold text-amber-400 flex items-center gap-1 hover:underline"
            >
              <Edit2 className="w-3 h-3" /> Edit
            </button>
          )}
        </div>

        {/* Step 2 Expanded Body */}
        <form onSubmit={handleIdentitySubmit} className={`p-3.5 pt-0 space-y-3 border-t border-dashed border-white/10 ${activeStep === 2 ? "" : "hidden"}`}>
            
            {/* Step-Up Notice Banner (L1) */}
            {showStepUpForm && !isL2Requirement && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5 animate-in fade-in duration-200">
                <Shield className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold text-amber-200">Identity Step-Up Required (Level 1):</div>
                  <div className="text-[11px] leading-relaxed text-amber-300">
                    Stripe requires your Date of Birth and Social Security Number to verify your identity and authorize this transaction.
                  </div>
                </div>
              </div>
            )}

            {/* Address Summary Pill when in Step-Up Mode */}
            {showStepUpForm && !manualEditAddress && (firstName || line1) && (
              <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between text-xs animate-in fade-in duration-200">
                <div className="flex items-center gap-2">
                  <User className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <div>
                    <span className="font-semibold text-white">{firstName} {lastName}</span>
                    {line1 && <span className="text-white/60 text-[11px] ml-1.5">• {line1}, {city}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setManualEditAddress(true)}
                  className="text-[11px] font-semibold text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Edit2 className="w-3 h-3" /> Edit Address
                </button>
              </div>
            )}

            {/* Document Verification Notice Banner (L2) */}
            {isL2Requirement && (
              <div
                className={`p-2.5 rounded-xl border text-[11px] flex items-center gap-2 ${
                  isL2Approved
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    : "bg-purple-500/10 border-purple-500/30 text-purple-300"
                }`}
              >
                {isL2Approved ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                ) : (
                  <FileText className="w-4 h-4 shrink-0 text-purple-400" />
                )}
                <span>
                  {isL2Approved ? (
                    <strong>Document Verification Approved:</strong>
                  ) : (
                    <strong>Document Verification Required:</strong>
                  )}{" "}
                  {isL2Approved
                    ? "Government ID and compliance checks verified."
                    : "A valid government-issued ID or passport is required to complete verification for this transaction."}
                </span>
              </div>
            )}

            {/* Legal Name & Residential Address (Full Form) */}
            {showFullForm && (
              <>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className={`flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        <span>First Name</span>
                        <span className="text-red-400">*</span>
                      </span>
                      {isFieldValid("firstName") && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                    </label>
                    <input
                      type="text"
                      required={showFullForm}
                      placeholder="Jane"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      onBlur={() => markFieldTouched("firstName")}
                      className={`w-full h-10 px-3 rounded-xl focus:outline-none text-xs font-medium transition-all ${getFieldInputClass("firstName")}`}
                    />
                    {isFieldInvalid("firstName") && (
                      <span className="text-[10px] text-red-400 font-semibold mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> First name is required
                      </span>
                    )}
                  </div>
                  <div>
                    <label className={`flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        <span>Last Name</span>
                        <span className="text-red-400">*</span>
                      </span>
                      {isFieldValid("lastName") && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                    </label>
                    <input
                      type="text"
                      required={showFullForm}
                      placeholder="Doe"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      onBlur={() => markFieldTouched("lastName")}
                      className={`w-full h-10 px-3 rounded-xl focus:outline-none text-xs font-medium transition-all ${getFieldInputClass("lastName")}`}
                    />
                    {isFieldInvalid("lastName") && (
                      <span className="text-[10px] text-red-400 font-semibold mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Last name is required
                      </span>
                    )}
                  </div>
                </div>

                {/* Full Residential Address Autocomplete Single Input */}
                {!isAddressParsed ? (
                  <div className="space-y-1.5">
                    <div className="relative z-50">
                      <label className={`flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          <span>Full Residential Address</span>
                          <span className="text-red-400">*</span>
                        </span>
                        {isFieldValid("line1") && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                      </label>
                      <input
                        type="text"
                        placeholder="Enter full residential address (e.g., 123 Main St, City, State)..."
                        value={addressSearchInput || line1}
                        onChange={(e) => {
                          setAddressSearchInput(e.target.value);
                          setLine1(e.target.value);
                          handleFetchSuggestions(e.target.value);
                        }}
                        onBlur={() => markFieldTouched("line1")}
                        onFocus={() => {
                          const q = addressSearchInput || line1;
                          if (q && q.length >= 3) {
                            handleFetchSuggestions(q);
                          } else if (addressSuggestions.length > 0) {
                            setShowSuggestions(true);
                          }
                        }}
                        className={`w-full h-10 px-3 rounded-xl focus:outline-none text-xs font-medium transition-all ${getFieldInputClass("line1")}`}
                      />

                      {/* Autocomplete Predictions */}
                      {showSuggestions && addressSuggestions.length > 0 && (
                        <div
                          data-pp-address-dropdown="1"
                          style={{
                            backgroundColor: isLightText ? "#141522" : "#ffffff",
                            borderColor: isLightText ? "rgba(255, 255, 255, 0.18)" : "rgba(0, 0, 0, 0.18)",
                            zIndex: 99999,
                          }}
                          className={`pp-address-menu absolute left-0 right-0 mt-1 rounded-xl max-h-60 overflow-y-auto shadow-2xl border divide-y ${
                            isLightText ? "divide-white/10 text-white" : "divide-black/10 text-black"
                          }`}
                        >
                          {addressSuggestions.map((item, idx) => (
                            <button
                              key={item.placeId || idx}
                              type="button"
                              onClick={() => handleSelectSuggestion(item)}
                              style={{
                                backgroundColor: isLightText ? "#141522" : "#ffffff",
                              }}
                              className={`w-full text-left px-3.5 py-2.5 text-xs transition flex flex-col cursor-pointer ${
                                isLightText
                                  ? "hover:!bg-[#23263b] !text-white"
                                  : "hover:!bg-[#f1f5f9] !text-slate-900"
                              }`}
                            >
                              <span className="font-bold flex items-center gap-2">
                                <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span>{item.mainText || item.description}</span>
                              </span>
                              {item.secondaryText && (
                                <span className="text-[10.5px] opacity-70 ml-5.5 mt-0.5">
                                  {item.secondaryText}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {isFieldInvalid("line1") && (
                      <span className="text-[10px] text-red-400 font-semibold flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Full residential address is required
                      </span>
                    )}
                    <div className="flex items-center justify-between text-[11px] pt-0.5">
                      <span className="text-amber-400 font-medium flex items-center gap-1">
                        <Shield className="w-3 h-3" />
                        <span>Address must match primary residence on ID.</span>
                      </span>
                      <button type="button" onClick={() => setIsAddressParsed(true)} className="underline text-indigo-400 hover:text-indigo-300 font-medium">
                        Enter city & zip manually
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Expanded Address Component Inputs */
                  <div className="space-y-2 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-emerald-400 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Address Details
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddressParsed(false);
                        }}
                        className="underline opacity-70 hover:opacity-100 flex items-center gap-1 text-xs"
                      >
                        <Search className="w-3 h-3" /> Search with autocomplete
                      </button>
                    </div>

                    <div>
                      <label className={`flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          <span>Street Address</span>
                          <span className="text-red-400">*</span>
                        </span>
                        {isFieldValid("line1") && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                      </label>
                      <input
                        type="text"
                        placeholder="123 Main St"
                        value={line1}
                        onChange={(e) => setLine1(e.target.value)}
                        onBlur={() => markFieldTouched("line1")}
                        className={`w-full h-10 px-3 rounded-xl focus:outline-none text-xs font-medium transition-all ${getFieldInputClass("line1")}`}
                      />
                      {isFieldInvalid("line1") && (
                        <span className="text-[10px] text-red-400 font-semibold mt-1 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> Street address is required
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-5">
                        <label className={`flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                          <span>City <span className="text-red-400">*</span></span>
                          {isFieldValid("city") && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                        </label>
                        <input
                          type="text"
                          placeholder="Los Angeles"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          onBlur={() => markFieldTouched("city")}
                          className={`w-full h-10 px-3 rounded-xl focus:outline-none text-xs font-medium transition-all ${getFieldInputClass("city")}`}
                        />
                        {isFieldInvalid("city") && (
                          <span className="text-[10px] text-red-400 font-semibold mt-1 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> Required
                          </span>
                        )}
                      </div>
                      <div className="col-span-3">
                        <label className={`flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                          <span>State <span className="text-red-400">*</span></span>
                          {isFieldValid("stateCode") && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                        </label>
                        <input
                          type="text"
                          placeholder="CA"
                          maxLength={2}
                          value={stateCode}
                          onChange={(e) => setStateCode(e.target.value.toUpperCase())}
                          onBlur={() => markFieldTouched("stateCode")}
                          className={`w-full h-10 px-3 rounded-xl focus:outline-none text-xs font-medium uppercase text-center transition-all ${getFieldInputClass("stateCode")}`}
                        />
                        {isFieldInvalid("stateCode") && (
                          <span className="text-[10px] text-red-400 font-semibold mt-1 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> State
                          </span>
                        )}
                      </div>
                      <div className="col-span-4">
                        <label className={`flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                          <span>Zip Code <span className="text-red-400">*</span></span>
                          {isFieldValid("zipCode") && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                        </label>
                        <input
                          type="text"
                          placeholder="90210"
                          maxLength={10}
                          value={zipCode}
                          onChange={(e) => setZipCode(e.target.value)}
                          onBlur={() => markFieldTouched("zipCode")}
                          className={`w-full h-10 px-3 rounded-xl focus:outline-none text-xs font-medium font-mono text-center transition-all ${getFieldInputClass("zipCode")}`}
                        />
                        {isFieldInvalid("zipCode") && (
                          <span className="text-[10px] text-red-400 font-semibold mt-1 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> 5-digit zip
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* L1 Demographic Demands: Date of Birth & SSN (Rendered strictly when Step-Up is required) */}
            {showStepUpForm && (
              <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-white/10 animate-in fade-in duration-200">
                <div>
                  <label className={`flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span>Date of Birth</span>
                      <span className="text-red-400">*</span>
                    </span>
                    {isFieldValid("dob") && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                  </label>
                  
                  {/* Custom Mobile-Responsive DOB Input & Calendar Popover */}
                  <DobPicker
                    value={dob}
                    onChange={(val) => setDob(val)}
                    onBlur={() => markFieldTouched("dob")}
                    isLightText={isLightText}
                    primaryColor={primaryColor}
                    hasError={isFieldInvalid("dob")}
                    isValid={isFieldValid("dob")}
                    onOpenStateChange={setIsCalendarOpen}
                  />

                  {isFieldInvalid("dob") ? (
                    <span className="text-[10px] text-red-400 font-semibold mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {dobStatus.error || "Valid date of birth required"}
                    </span>
                  ) : dobStatus.valid ? (
                    <span className="text-[10px] text-emerald-400 font-medium mt-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Date of Birth Verified
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground mt-1 block">MM / DD / YYYY</span>
                  )}
                </div>
                <div>
                  <label className={`flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                    <span className="flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      <span>SSN (9 Digits)</span>
                      <span className="text-red-400">*</span>
                    </span>
                    {isFieldValid("ssn") && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="000-00-0000"
                    maxLength={11}
                    value={formatSSN(ssn)}
                    onChange={(e) => setSsn(e.target.value)}
                    onBlur={() => markFieldTouched("ssn")}
                    className={`w-full h-10 px-3 rounded-xl focus:outline-none text-xs font-medium font-mono transition-all ${getFieldInputClass("ssn")}`}
                  />
                  {isFieldInvalid("ssn") ? (
                    <span className="text-[10px] text-red-400 font-semibold mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Full 9-digit SSN required ({ssnDigits.length}/9)
                    </span>
                  ) : ssnDigits.length === 9 ? (
                    <span className="text-[10px] text-emerald-400 font-medium mt-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> 9 Digits Encrypted
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground mt-1 block">
                      {ssnDigits.length > 0 ? `${ssnDigits.length} of 9 digits entered` : "Encrypted directly to Stripe"}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Live Incomplete Checklist Banner if submit attempted without full info */}
            {attemptedIdentitySubmit && !isIdentityComplete && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-start gap-2.5 animate-in fade-in duration-200">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold text-white">Please complete the required details before continuing:</div>
                  <div className="text-[11px] text-red-300 flex flex-wrap gap-1.5 items-center">
                    {missingIdentityFields.map((f) => (
                      <span key={f.key} className="px-2 py-0.5 rounded-md bg-red-500/20 border border-red-500/30 text-red-200 font-semibold">
                        {f.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Inline Verification Notice / Error Alert */}
            {activeError && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5 animate-in fade-in duration-200">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold text-amber-200">Verification Notice:</div>
                  <div className="text-[11px] leading-relaxed text-amber-300">
                    {activeError}
                  </div>
                </div>
              </div>
            )}

            {/* L2 Document Verification Container & Action */}
            {isL2Requirement && (
              <div className="pt-2 space-y-2">
                {headlessStep === "verifying_identity" && (
                  <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/30 space-y-2 animate-in fade-in duration-200">
                    <div className="flex items-center gap-1.5 text-purple-300 text-xs font-bold">
                      <Shield className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      <span>Stripe Identity Verification: Complete ID verification below</span>
                    </div>
                    <div
                      className="p-2 rounded-xl bg-black/20 border border-white/10 min-h-[300px]"
                      ref={(el) => {
                        (identityContainerRef as any).current = el;
                        if (el && paymentElement && typeof paymentElement === "object" && "nodeType" in paymentElement) {
                          if (!el.contains(paymentElement as Node)) {
                            el.innerHTML = "";
                            el.appendChild(paymentElement as HTMLElement);
                          }
                        }
                      }}
                    >
                      {typeof paymentElement !== "object" || !("nodeType" in (paymentElement || {}))
                        ? (paymentElement as React.ReactNode)
                        : null}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleDocumentVerificationClick}
                  disabled={isVerifyingDocs || isL2Approved || headlessStep === "verifying_identity"}
                  className={`w-full h-11 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-lg ${
                    isL2Approved
                      ? "bg-emerald-600 text-white cursor-default"
                      : headlessStep === "verifying_identity"
                      ? "bg-purple-900/60 text-purple-200 border border-purple-500/40 cursor-wait"
                      : "bg-purple-600 hover:bg-purple-500 text-white animate-pulse"
                  }`}
                >
                  {isVerifyingDocs || headlessStep === "verifying_identity" ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Verifying identification with Stripe...</span>
                    </>
                  ) : isL2Approved ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-white" />
                      <span>Government ID Verified</span>
                    </>
                  ) : (
                    <>
                      <FileText className="w-4 h-4" />
                      <span>Verify Government-Issued ID</span>
                    </>
                  )}
                </button>
                {!isL2Approved && (
                  <p className="text-[10px] text-purple-300 text-center opacity-80">
                    A valid government-issued ID or passport is required for Level 2 verification.
                  </p>
                )}
              </div>
            )}

            {/* Save & Continue Button */}
            <button
              type="submit"
              disabled={
                isSubmittingIdentity ||
                (isL2Requirement && !isL2Approved)
              }
              className={`w-full h-11 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-lg mt-2 ${
                isSubmittingIdentity
                  ? "bg-emerald-600 text-white cursor-wait"
                  : !isIdentityComplete
                  ? isLightText
                    ? "bg-white/10 hover:bg-white/15 text-white/50 border border-white/10 cursor-pointer"
                    : "bg-black/10 hover:bg-black/15 text-black/50 border border-black/10 cursor-pointer"
                  : isL2Requirement && !isL2Approved
                  ? "bg-white/10 text-white/40 cursor-not-allowed border border-white/10"
                  : "hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
              }`}
              style={
                isIdentityComplete && !isSubmittingIdentity && !(isL2Requirement && !isL2Approved)
                  ? { backgroundColor: primaryColor, color: "#fff" }
                  : {}
              }
            >
              {isSubmittingIdentity ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying Identity Details...</span>
                </>
              ) : isL2Requirement && !isL2Approved ? (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Complete ID Verification Above to Proceed</span>
                </>
              ) : !isIdentityComplete ? (
                <>
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  <span>Complete All Details to Continue ({missingIdentityFields.length} remaining)</span>
                </>
              ) : showStepUpForm ? (
                <>
                  <span>Verify Identity & Continue</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              ) : (
                <>
                  <span>Save Address & Continue</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
        </form>
      </div>

      {/* ==================================================================== */}
      {/* STEP 3: PAYMENT METHOD SELECTION */}
      {/* ==================================================================== */}
      <div
        className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
          activeStep === 3
            ? isLightText
              ? "border-amber-500/40 bg-white/[0.04] shadow-xl"
              : "border-amber-500/40 bg-black/[0.01] shadow-md"
            : isLightText
            ? "border-white/10 bg-white/[0.02]"
            : "border-black/10 bg-black/[0.01]"
        }`}
      >
        {/* Step 3 Header / Summary Pill */}
        <div
          onClick={() => activeStep > 3 && setActiveStep(3)}
          className={`p-3.5 flex items-center justify-between select-none ${
            activeStep > 3 ? "cursor-pointer hover:bg-white/[0.04]" : ""
          }`}
        >
          <div className="flex items-center gap-2.5">
            {activeStep > 3 ? (
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40">
                <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />
              </div>
            ) : (
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                  activeStep === 3 ? "bg-amber-500 text-black" : "bg-white/10 text-white/40"
                }`}
              >
                3
              </div>
            )}
            <div>
              <h4 className={`text-xs font-bold tracking-tight ${isLightText ? "text-white" : "text-black"}`}>
                3. Payment Method
              </h4>
              {activeStep > 3 && (
                <p className={`text-[11px] font-medium opacity-70 flex items-center gap-1.5 ${isLightText ? "text-white" : "text-black"}`}>
                  <CreditCard className="w-2.5 h-2.5 opacity-60" />
                  <span>Authorized via Stripe Secure Payment</span>
                </p>
              )}
            </div>
          </div>
          {activeStep > 3 && (
            <button
              type="button"
              className="text-[11px] font-semibold text-amber-400 flex items-center gap-1 hover:underline"
            >
              <Edit2 className="w-3 h-3" /> Edit
            </button>
          )}
        </div>

        {/* Step 3 Expanded Body */}
        <div className={`p-3.5 pt-0 space-y-3 border-t border-dashed border-white/10 ${activeStep === 3 ? "" : "hidden"}`}>
            {/* Embedded Live Stripe Payment Element */}
            {paymentElement ? (
              <div className="space-y-2">
                <div className="p-3 rounded-xl bg-white/5 border border-white/10 my-2">
                  <div
                    ref={(el) => {
                      (paymentContainerRef as any).current = el;
                      if (el && paymentElement && typeof paymentElement === "object" && "nodeType" in paymentElement) {
                        if (!el.contains(paymentElement as Node)) {
                          el.innerHTML = "";
                          el.appendChild(paymentElement as HTMLElement);
                        }
                      }
                    }}
                  >
                    {typeof paymentElement !== "object" || !("nodeType" in (paymentElement || {}))
                      ? (paymentElement as React.ReactNode)
                      : null}
                  </div>
                </div>

                {/* Subtitle explaining Stripe auto-progression on click */}
                <div className="flex items-center justify-center gap-1.5 py-1 text-[11px] font-semibold text-amber-400/90 text-center animate-in fade-in">
                  <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>Please confirm your payment method in the secure form above to complete checkout.</span>
                </div>
              </div>
            ) : isSimulationMode ? (
              /* Fallback Simulation UI for Sample Previews ONLY */
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedPaymentType("applePay")}
                    className={`h-10 rounded-xl font-bold text-xs border transition-all flex items-center justify-center gap-1.5 ${
                      selectedPaymentType === "applePay"
                        ? "bg-amber-500/20 border-amber-400 text-amber-300"
                        : "bg-white/5 border-white/10 text-white/70"
                    }`}
                  >
                    <span>Apple Pay</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPaymentType("googlePay")}
                    className={`h-10 rounded-xl font-bold text-xs border transition-all flex items-center justify-center gap-1.5 ${
                      selectedPaymentType === "googlePay"
                        ? "bg-amber-500/20 border-amber-400 text-amber-300"
                        : "bg-white/5 border-white/10 text-white/70"
                    }`}
                  >
                    <span>Google Pay</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPaymentType("card")}
                    className={`h-10 rounded-xl font-bold text-xs border transition-all flex items-center justify-center gap-1.5 ${
                      selectedPaymentType === "card"
                        ? "bg-amber-500/20 border-amber-400 text-amber-300"
                        : "bg-white/5 border-white/10 text-white/70"
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>Credit / Debit Card</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPaymentType("bank")}
                    className={`h-10 rounded-xl font-bold text-xs border transition-all flex items-center justify-center gap-1.5 ${
                      selectedPaymentType === "bank"
                        ? "bg-amber-500/20 border-amber-400 text-amber-300"
                        : "bg-white/5 border-white/10 text-white/70"
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span>US Bank Account (ACH)</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleSimulatedPaymentSubmit}
                  disabled={isSubmittingPayment}
                  className="w-full h-11 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-xl mt-3"
                  style={{ backgroundColor: primaryColor, color: "#fff" }}
                >
                  {isSubmittingPayment ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Authorizing Payment...</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-3.5 h-3.5" />
                      <span>Authorize Payment (${amountUsd.toFixed(2)} USD)</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            ) : activeError ? (
              /* Live Error & Retry State */
              <div className="p-6 flex flex-col items-center justify-center space-y-3 text-center animate-in fade-in">
                <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <p className={`text-xs font-semibold max-w-sm leading-relaxed ${isLightText ? "text-amber-300" : "text-amber-900"}`}>
                  {activeError}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setLocalError(null);
                    if (onHeadlessSubmitEmailPhone) {
                      onHeadlessSubmitEmailPhone(email, phone);
                    }
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 text-black hover:bg-amber-400 active:scale-95 transition cursor-pointer"
                >
                  Retry Payment Selection
                </button>
              </div>
            ) : (
              /* Live Production Loading State */
              <div className="p-8 flex flex-col items-center justify-center space-y-3 text-center animate-in fade-in">
                <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
                <p className={`text-xs font-medium ${isLightText ? "text-white/70" : "text-black/70"}`}>
                  Loading secure Stripe payment form...
                </p>
              </div>
            )}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* STEP 4: ORDER PROCESSING & FULFILLMENT */}
      {/* ==================================================================== */}
      <div
        className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
          activeStep === 4
            ? isLightText
              ? "border-emerald-500/40 bg-emerald-500/5 shadow-xl"
              : "border-emerald-500/40 bg-emerald-50 shadow-md"
            : isLightText
            ? "border-white/10 bg-white/[0.02]"
            : "border-black/10 bg-black/[0.01]"
        }`}
      >
        <div className="p-3.5 flex items-center justify-between select-none">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                isOrderConfirmed
                  ? "bg-emerald-500 text-black font-bold"
                  : activeStep === 4
                  ? "bg-emerald-500 text-black animate-pulse"
                  : "bg-white/10 text-white/40"
              }`}
            >
              {isOrderConfirmed ? (
                <Check className="w-3 h-3 text-black stroke-[3]" />
              ) : (
                "4"
              )}
            </div>
            <div>
              <h4 className={`text-xs font-bold tracking-tight ${isLightText ? "text-white" : "text-black"}`}>
                4. Payment & Order Fulfillment
              </h4>
            </div>
          </div>
        </div>

        <div className={`p-3.5 pt-0 space-y-3 border-t border-dashed border-white/10 ${activeStep === 4 ? "" : "hidden"}`}>
            {!isOrderConfirmed ? (
              <div className="p-4 rounded-xl bg-black/30 border border-white/10 space-y-2.5 animate-in fade-in duration-300">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin text-emerald-400" />
                  <span>Processing payment with Stripe...</span>
                </div>
                <div className="flex items-center gap-2.5 text-xs font-medium text-amber-400 animate-pulse">
                  <span>
                    {headlessStatus || "Finalizing order and confirming transaction..."}
                  </span>
                </div>
              </div>
            ) : (
              /* Order Success Summary Receipt Card */
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-3.5 animate-in zoom-in-95 duration-300">
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    Order #{receiptId} Confirmed
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="opacity-60">Total Paid:</span>
                    <span className="font-bold">${amountUsd.toFixed(2)} USD</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-60">Contact Email:</span>
                    <span className="font-semibold">{email}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-60">Payment Method:</span>
                    <span className="font-semibold">
                      {detectedCardBrand && detectedCardLast4
                        ? `${detectedCardBrand} •••• ${detectedCardLast4}`
                        : selectedPaymentType === "applePay"
                        ? "Apple Pay"
                        : selectedPaymentType === "googlePay"
                        ? "Google Pay"
                        : selectedPaymentType === "bank" || detectedCardFunding === "us_bank_account"
                        ? "US Bank Account (ACH)"
                        : "Credit / Debit Card (Stripe)"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-60">Status:</span>
                    <span className="text-emerald-400 font-bold inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        {detectedCardFunding === "us_bank_account" || paymentConfirmed?.funding === "us_bank_account" || headlessStep === "awaiting_funds"
                          ? "Payment Authorized (ACH Pending)"
                          : "Payment Confirmed"}
                      </span>
                    </span>
                  </div>
                </div>

                {(detectedCardFunding === "us_bank_account" || paymentConfirmed?.funding === "us_bank_account" || headlessStep === "awaiting_funds") && (
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 leading-relaxed">
                    Funds will be deducted from your bank account within 2–3 business days. Your order is confirmed.
                  </div>
                )}

                {email && (
                  <p className="text-[11px] text-emerald-400 font-medium text-center">
                    ✓ Receipt automatically sent to <span className="underline">{email}</span>
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window !== "undefined" && window.parent && window.parent !== window) {
                        try {
                          window.parent.postMessage({ type: "portalpay:checkout_complete", receiptId }, "*");
                        } catch {}
                      }
                    }}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white border border-white/10 flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Done</span>
                  </button>
                  {onEmailReceipt && (
                    <button
                      type="button"
                      onClick={onEmailReceipt}
                      className="flex-1 py-2.5 rounded-xl text-xs font-bold shadow-lg transition active:scale-95 text-white flex items-center justify-center gap-1.5 cursor-pointer"
                      style={{ backgroundColor: primaryColor }}
                    >
                      <span>Email Receipt</span>
                    </button>
                  )}
                </div>
              </div>
            )}
        </div>
      </div>

    </div>
  );
}

