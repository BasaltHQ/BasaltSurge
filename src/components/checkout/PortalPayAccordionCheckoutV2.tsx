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
  Search,
  Globe,
  Clock,
} from "lucide-react";

export function isSettled(status?: string): boolean {
  if (!status) return false;
  const s = String(status).toLowerCase().trim();
  return (
    s === "paid" ||
    s === "paid - ach pending" ||
    s === "ach_pending" ||
    s === "checkout_success" ||
    s === "confirmed" ||
    s === "reconciled" ||
    s === "tx_mined" ||
    s === "recipient_validated" ||
    s === "receipt_claimed" ||
    s.includes("refund")
  );
}

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
  receiptStatus?: string;
  isPaid?: boolean;
  receipt?: any;
  headlessError?: string | null;
  kycTierRequired?: "l0" | "l1" | "l2" | string;
  kycLevel?: "L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING" | string;
  kycTiers?: Array<{ tier: string; verification_status: string }>;
  simulatedTier?: "l0" | "l1" | "l2" | string;
  simulatedStatus?: "normal" | "step_up" | "doc_verify" | "verified" | "paid" | "processing" | string;
  simulatedError?: "none" | "address_error" | "payment_decline" | "kyc_rejection" | string;
  simulatedPath?: "normal" | "skip_kyc" | "step_up" | "doc_verify" | string;
  isAllKycCompleted?: boolean;
  onHeadlessSubmitEmailPhone?: (email: string, phone: string, country?: string, fullName?: string) => Promise<void>;
  onSubmitPhone?: (phoneNumber: string, email?: string, country?: string) => void | Promise<void>;
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

export const SUPPORTED_COUNTRIES = [
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
    <div ref={containerRef} className="relative w-full min-w-0">
      {/* 3-Segment Input Container */}
      <div
        className={`w-full h-10 px-2 sm:px-2.5 rounded-xl flex items-center justify-between transition-all select-none min-w-0 overflow-hidden ${containerClass}`}
        onClick={() => {
          if (!month) monthRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-0.5 sm:gap-1 font-mono text-xs font-medium min-w-0 shrink" onPaste={handlePaste}>
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
            className={`w-6 sm:w-7 shrink-0 text-center bg-transparent focus:outline-none placeholder:opacity-40 font-mono text-xs ${
              isLightText ? "text-white placeholder-white/30" : "text-black placeholder-black/30"
            }`}
          />
          <span className="opacity-30 text-xs shrink-0">/</span>
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
            className={`w-6 sm:w-7 shrink-0 text-center bg-transparent focus:outline-none placeholder:opacity-40 font-mono text-xs ${
              isLightText ? "text-white placeholder-white/30" : "text-black placeholder-black/30"
            }`}
          />
          <span className="opacity-30 text-xs shrink-0">/</span>
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
            className={`w-10 sm:w-12 shrink-0 text-center bg-transparent focus:outline-none placeholder:opacity-40 font-mono text-xs ${
              isLightText ? "text-white placeholder-white/30" : "text-black placeholder-black/30"
            }`}
          />
        </div>

        {/* Calendar Picker Trigger Button */}
        <button
          type="button"
          onClick={handleToggleOpen}
          aria-label="Toggle calendar picker"
          className={`p-1 sm:p-1.5 rounded-lg transition flex items-center justify-center cursor-pointer shrink-0 ml-0.5 sm:ml-1 ${
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
          className={`pp-calendar-popover absolute z-50 mt-1.5 left-0 right-0 sm:left-auto sm:right-0 sm:w-72 max-w-[calc(100vw-32px)] p-3 rounded-2xl shadow-2xl border backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150 ${
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
  receiptStatus,
  isPaid = false,
  receipt,
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
  onSubmitPhone,
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

  const [activeStep, setActiveStep] = useState<number>(1);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isRetryingPayment, setIsRetryingPayment] = useState<boolean>(false);
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
  const isUS = (country || "US").toUpperCase() === "US";

  const fieldValidation = {
    firstName: (firstName || "").trim().length >= 1,
    lastName: (lastName || "").trim().length >= 1,
    line1: (line1 || "").trim().length >= 3,
    city: (city || "").trim().length >= 2,
    stateCode: isUS ? (stateCode || "").trim().length >= 2 : true,
    zipCode: (zipCode || "").trim().length >= 3,
    dob: dobStatus.valid,
    ssn: isUS ? ssnDigits.length === 9 : true,
  };

  // Effective tier and status determination
  const effectiveTier: string = simulatedTier || kycTierRequired || "l0";
  const effectiveStatus: string = simulatedStatus || (isAllKycCompleted ? "verified" : "normal");

  // Canonical Stripe Onramp KYC tier detection from GET /v1/crypto/customers/:id kyc_tiers:
  const rawKycTiers = kycTiers || [];
  const l0Verified = rawKycTiers.some(
    (t: any) => t.tier === "l0" && (t.verification_status === "verified" || t.verification_status === "not_available"),
  );
  const l1Verified = rawKycTiers.some(
    (t: any) => t.tier === "l1" && t.verification_status === "verified",
  );
  const l1NotAvailable = rawKycTiers.some(
    (t: any) => t.tier === "l1" && t.verification_status === "not_available",
  );
  const l2Verified = rawKycTiers.some(
    (t: any) => t.tier === "l2" && t.verification_status === "verified",
  );

  const isL0Approved =
    l0Verified ||
    l1Verified ||
    l2Verified ||
    isAllKycCompleted ||
    effectiveStatus === "verified";

  const isL1Approved =
    l1Verified ||
    l1NotAvailable ||
    l2Verified ||
    (effectiveStatus === "verified" && (kycTierRequired as string) !== "l1" && (kycTierRequired as string) !== "L1");

  const isL2Approved =
    l2Verified ||
    docVerificationSuccess ||
    kycLevel === "L2" ||
    (effectiveStatus === "verified" && (kycTierRequired as string) !== "l2" && (kycTierRequired as string) !== "L2" && headlessStep !== "verifying_identity");

  // Step-up (DOB + SSN) is strictly ONLY shown when NOT already verified AND Stripe explicitly requires L1 tier
  const showStepUpForm =
    !isL1Approved &&
    (effectiveTier === "l1" ||
     effectiveTier === "L1" ||
     effectiveStatus === "step_up" ||
     (kycTierRequired as string) === "l1" ||
     (kycTierRequired as string) === "L1");

  // Document verification requirement: only when L2 tier is explicitly demanded
  const showVerifyDocs =
    !isL2Approved &&
    (effectiveTier === "l2" ||
     effectiveTier === "L2" ||
     effectiveStatus === "doc_verify" ||
     (kycTierRequired as string) === "l2" ||
     (kycTierRequired as string) === "L2" ||
     headlessStep === "verifying_identity");

  const isL2Requirement =
    effectiveTier === "l2" ||
    effectiveTier === "L2" ||
    (kycTierRequired as string) === "l2" ||
    (kycTierRequired as string) === "L2" ||
    headlessStep === "verifying_identity";
  const isL1Requirement = showStepUpForm || showVerifyDocs || effectiveTier === "l1" || effectiveTier === "L1" || (kycTierRequired as string) === "l1" || (kycTierRequired as string) === "L1";

  // Strict separation of simulation demo mode vs live production checkout
  const isSimulationMode = Boolean(simulatedTier || simulatedStatus || (simulatedPath && simulatedPath !== "normal"));
  const isLiveMode = !isSimulationMode;

  // Step 3: Payment State (Simulation / Preview)
  const [selectedPaymentType, setSelectedPaymentType] = useState<"applePay" | "googlePay" | "card" | "bank">("card");
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  // Step 4: Fulfillment Stage ("processing" | "confirming" | "complete")
  const [fulfillmentStage, setFulfillmentStage] = useState<"processing" | "confirming" | "complete">("processing");

  // Canonical receipt settlement resolution
  const isReceiptPaid = Boolean(
    isPaid ||
    paymentConfirmed ||
    isSettled(receiptStatus) ||
    isSettled(receipt?.status) ||
    headlessStep === "completed" ||
    simulatedStatus === "paid"
  );

  // In live production mode, order confirmation strictly requires verifiable payment confirmation, completed onramp state, or paid receipt
  const isOrderConfirmed = isLiveMode
    ? Boolean(isReceiptPaid || paymentConfirmed || headlessStep === "completed")
    : Boolean(isReceiptPaid || fulfillmentStage === "complete");

  // Identity / KYC active check to prevent processing backdrop from blocking verification UI
  const isIdentityActive = Boolean(
    showStepUpForm ||
    kycTierRequired === "l1" ||
    headlessStep === "verifying_identity" ||
    headlessStep === "collecting_kyc" ||
    headlessStep === "checking_kyc" ||
    (headlessStatus && (
      headlessStatus.toLowerCase().includes("identity") ||
      headlessStatus.toLowerCase().includes("verifying identity") ||
      headlessStatus.toLowerCase().includes("document") ||
      headlessStatus.toLowerCase().includes("kyc")
    ))
  );

  // Payment Processing Modal Overlay Guard:
  // Specifically active during fee review, payment processing, or fund transfer
  // Automatically stays open and locks interactions until payment completes or fails with an error
  const isPaymentProcessing = Boolean(
    !isOrderConfirmed &&
    !isReceiptPaid &&
    !activeError &&
    !isIdentityActive &&
    (
      simulatedStatus === "processing" ||
      (isSubmittingPayment && !isIdentityActive) ||
      (activeStep === 4 && (
        fulfillmentStage === "processing" ||
        fulfillmentStage === "confirming" ||
        headlessStep === "confirming_fees" ||
        headlessStep === "checking_out" ||
        headlessStep === "transferring" ||
        headlessStep === "creating_session" ||
        (headlessStatus && (
          headlessStatus.toLowerCase().includes("processing") ||
          headlessStatus.toLowerCase().includes("fee") ||
          headlessStatus.toLowerCase().includes("finalizing") ||
          headlessStatus.toLowerCase().includes("transfer") ||
          headlessStatus.toLowerCase().includes("confirming")
        ))
      ))
    )
  );

  const processingStatusSubtitle = (
    headlessStatus ||
    (headlessStep === "confirming_fees"
      ? "Reviewing payment fee & live conversion rates..."
      : headlessStep === "checking_out"
      ? "Processing transaction securely with Stripe..."
      : "Finalizing your transaction. Please keep this window open.")
  );

  // DOM Container Refs for Stripe Embedded Elements
  const authContainerRef = useRef<HTMLDivElement>(null);
  const paymentContainerRef = useRef<HTMLDivElement>(null);
  const identityContainerRef = useRef<HTMLDivElement>(null);

  // Dynamic error detection
  const rawErr = String(localError || propError || "").toLowerCase();
  const hasAddressError = Boolean(
    rawErr &&
    (rawErr.includes("address") ||
     rawErr.includes("postal") ||
     rawErr.includes("zip") ||
     rawErr.includes("street") ||
     rawErr.includes("city") ||
     rawErr.includes("subdivision") ||
     rawErr.includes("home address") ||
     rawErr.includes("unsupported_region") ||
     rawErr.includes("unsupported_country"))
  );

  const hasNameError = Boolean(
    rawErr &&
    (rawErr.includes("given_name") ||
     rawErr.includes("surname") ||
     rawErr.includes("first_name") ||
     rawErr.includes("last_name") ||
     (rawErr.includes("name") && !rawErr.includes("bank_name")) ||
     rawErr.includes("legal details") ||
     rawErr.includes("identity verification details were rejected"))
  );

  // Full L0 form (name, address): default for all unverified users starting at L0, when address error occurs, when fields are empty, or when manual address editing is active
  const showFullForm =
    !showStepUpForm ||
    manualEditAddress ||
    hasAddressError ||
    hasNameError ||
    !line1 ||
    !firstName ||
    kycLevel === "REQUIRES_KYC";

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

  // Automatically clear isSubmittingPayment if identity verification becomes active
  useEffect(() => {
    if (isIdentityActive) {
      setIsSubmittingPayment(false);
    }
  }, [isIdentityActive]);

  // Clean mounting of authElement into container
  useEffect(() => {
    if (authElement) {
      setIsSubmittingContact(false);
    }
  }, [authElement]);

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
      const res = await fetch(`/api/address/autocomplete?input=${encodeURIComponent(input)}${country ? `&country=${encodeURIComponent(country)}` : ""}`);
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

  // Dedicated Receipt Settlement & Lockdown Guard: When paid, lock activeStep strictly to Step 4
  useEffect(() => {
    if (isReceiptPaid) {
      setIsSubmittingContact(false);
      setIsSubmittingIdentity(false);
      setIsSubmittingPayment(false);
      setActiveStep(4);
      setFulfillmentStage("complete");
      setLocalError(null);
    }
  }, [isReceiptPaid]);

  // Automatically advance accordion steps when live Stripe headlessStep transitions!
  useEffect(() => {
    if (isReceiptPaid) {
      setIsSubmittingContact(false);
      setIsSubmittingIdentity(false);
      setIsSubmittingPayment(false);
      setActiveStep(4);
      setFulfillmentStage("complete");
      return;
    }

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
      setIsSubmittingContact(false);
      // Only set activeStep to 1 if we are still at initial step (activeStep <= 1). Do NOT pull back from Step 2, 3, or 4!
      if (activeStep <= 1 && (authElement || headlessStep === "collecting_phone" || headlessStep === "authenticating")) {
        setActiveStep(1);
      }
    } else if (
      headlessStep === "checking_kyc" ||
      headlessStep === "collecting_kyc" ||
      headlessStep === "submitting_kyc"
    ) {
      setIsSubmittingContact(false);
      setIsSubmittingPayment(false);
      if ((!isL0Approved && !isAllKycCompleted) || showStepUpForm) {
        setActiveStep(2);
      } else {
        setActiveStep((prev) => (prev > 3 ? prev : 3));
      }
    } else if (
      headlessStep === "verifying_identity" ||
      headlessStep === "creating_wallet" ||
      headlessStep === "registering_wallet" ||
      headlessStep === "collecting_payment" ||
      headlessStep === "payment_method_required"
    ) {
      setIsSubmittingContact(false);
      setIsSubmittingIdentity(false);
      if (showStepUpForm && !isL1Approved) {
        setActiveStep(2);
      } else if (headlessStep === "collecting_payment" || headlessStep === "payment_method_required") {
        // Open Step 3 so Stripe payment element is mounted and interactive
        setActiveStep(3);
      } else {
        setActiveStep((prev) => (prev > 3 ? prev : 3));
      }
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
  }, [headlessStep, authElement, isAllKycCompleted, effectiveStatus, paymentConfirmed, isReceiptPaid, propError, localError, detectedCardFunding, activeStep, isL2Requirement, isL2Approved, showStepUpForm, isL1Approved, isL0Approved]);

  // Dedicated KYC Enforcement Guard: If L1 SSN/DOB Step-Up is required and NOT approved, route back to Step 2
  useEffect(() => {
    if (paymentConfirmed || isOrderConfirmed || isReceiptPaid) return;
    if ((showStepUpForm || kycTierRequired === "l1") && !isL1Approved) {
      if (activeStep !== 2) {
        console.log("[ACCORDION] Action required on Step 2 (L1 KYC / Step-Up pending). Routing to Step 2.");
        setIsSubmittingPayment(false);
        setActiveStep(2);
      }
    }
  }, [showStepUpForm, isL1Approved, activeStep, paymentConfirmed, isOrderConfirmed, isReceiptPaid, kycTierRequired]);

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
      isReceiptPaid ||
      propError ||
      localError ||
      (isL2Requirement && !isL2Approved) ||
      (showStepUpForm && !isL1Approved)
    ) {
      return;
    }
    if ((isAllKycCompleted || effectiveStatus === "verified") && headlessStep === "collecting_payment") {
      setIsSubmittingContact(false);
      setIsSubmittingIdentity(false);
      setActiveStep((prev) => (prev <= 2 ? 3 : prev));
    }
  }, [isAllKycCompleted, effectiveStatus, headlessStep, paymentConfirmed, isReceiptPaid, propError, localError, isL2Requirement, isL2Approved, showStepUpForm, isL1Approved]);

  // Step 3 idle recovery: if activeStep is 3, paymentElement is null, and headlessStep is idle, auto-trigger onHeadlessSubmitEmailPhone
  useEffect(() => {
    if (isReceiptPaid) return;
    if (activeStep === 3 && !paymentElement && headlessStep === "idle" && email && onHeadlessSubmitEmailPhone) {
      onHeadlessSubmitEmailPhone(email, phone);
    }
  }, [activeStep, paymentElement, headlessStep, email, phone, isReceiptPaid, onHeadlessSubmitEmailPhone]);

  // Step 1 Submit (Account & Contact)
  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    const fullContactName = (firstName?.trim() && lastName?.trim())
      ? `${firstName.trim()} ${lastName.trim()}`
      : undefined;

    if (headlessStep === "collecting_phone") {
      setIsSubmittingContact(true);
      setLocalError(null);
      try {
        if (onSubmitPhone) {
          await onSubmitPhone(phone, email, country);
        } else if (onHeadlessSubmitEmailPhone) {
          await onHeadlessSubmitEmailPhone(email, phone, country, fullContactName);
        }
      } catch (err: any) {
        console.error("Phone submission error:", err);
        setLocalError(err?.message || "Failed to submit phone number.");
      } finally {
        setIsSubmittingContact(false);
      }
      return;
    }

    setIsSubmittingContact(true);
    setLocalError(null);
    try {
      if (onHeadlessSubmitEmailPhone) {
        // Trigger onramp session without blocking UI spinner indefinitely
        const promise = onHeadlessSubmitEmailPhone(email, phone || "", country, fullContactName);
        if (promise && typeof (promise as any).catch === "function") {
          (promise as any).catch((err: any) => {
            console.error("Contact submission error:", err);
            setLocalError(err?.message || "Failed to submit contact information.");
            setIsSubmittingContact(false);
          });
        }
        // Release the button spinner after a safety buffer if headlessStep hasn't transitioned yet
        setTimeout(() => {
          setIsSubmittingContact(false);
        }, 1800);
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
        setIsSubmittingContact(false);
      }
    } catch (err: any) {
      console.error("Contact submission error:", err);
      setLocalError(err?.message || "Failed to submit contact information.");
      setIsSubmittingContact(false);
    }
  };

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
    if (isUS && !fieldValidation.ssn) missingIdentityFields.push({ key: "ssn", label: ssnDigits.length > 0 ? `SSN (${9 - ssnDigits.length} digits left)` : "9-Digit SSN" });
    if (showFullForm) {
      if (!fieldValidation.firstName) missingIdentityFields.push({ key: "firstName", label: "First Name" });
      if (!fieldValidation.lastName) missingIdentityFields.push({ key: "lastName", label: "Last Name" });
      if (!fieldValidation.line1) missingIdentityFields.push({ key: "line1", label: "Street Address" });
      if (!fieldValidation.city) missingIdentityFields.push({ key: "city", label: "City" });
      if (isUS && !fieldValidation.stateCode) missingIdentityFields.push({ key: "stateCode", label: "State" });
      if (!fieldValidation.zipCode) missingIdentityFields.push({ key: "zipCode", label: isUS ? "Zip Code" : "Postal Code" });
    }
  } else if (showFullForm) {
    if (!fieldValidation.firstName) missingIdentityFields.push({ key: "firstName", label: "First Name" });
    if (!fieldValidation.lastName) missingIdentityFields.push({ key: "lastName", label: "Last Name" });
    if (!fieldValidation.line1) missingIdentityFields.push({ key: "line1", label: "Street Address" });
    if (!fieldValidation.city) missingIdentityFields.push({ key: "city", label: "City" });
    if (isUS && !fieldValidation.stateCode) missingIdentityFields.push({ key: "stateCode", label: "State" });
    if (!fieldValidation.zipCode) missingIdentityFields.push({ key: "zipCode", label: isUS ? "Zip Code" : "Postal Code" });
  }

  const isIdentityComplete = missingIdentityFields.length === 0;

  const hasDobError = Boolean(rawErr && (rawErr.includes("date_of_birth") || rawErr.includes("birth") || rawErr.includes("dob") || rawErr.includes("18 years")));
  const hasSsnError = Boolean(rawErr && (rawErr.includes("ssn") || rawErr.includes("id_number") || rawErr.includes("social security")));

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

      // If customer is already verified in Stripe Link and no step-up is required, advance to Step 3 directly
      if ((isAllKycCompleted || effectiveStatus === "verified") && !showStepUpForm && (!isL2Requirement || isL2Approved)) {
        console.log("[ACCORDION] Customer is already verified. Advancing to Step 3 directly without re-submitting demographics.");
        setIsSubmittingIdentity(false);
        setActiveStep(3);
        return;
      }

      const targetCountry = (country || "US").toUpperCase();
      const isEU = targetCountry !== "US" && targetCountry !== "CA";

      if (onSubmitKycInfo) {
        const fullKycPayload: any = {
          given_name: (firstName || "").trim(),
          first_name: (firstName || "").trim(),
          surname: (lastName || "").trim(),
          last_name: (lastName || "").trim(),
          address: {
            line1: (line1 || "").trim(),
            ...(line2 ? { line2: line2.trim() } : {}),
            city: (city || "").trim(),
            ...(stateCode ? { state: stateCode.trim() } : {}),
            postal_code: (zipCode || "").trim(),
            country: targetCountry,
          },
          ...(parsedDob ? { date_of_birth: parsedDob } : {}),
          ...(isUS && ssnDigits ? { id_number: { type: "us_ssn", value: ssnDigits } } : {}),
          ...(isEU ? {
            nationalities: [targetCountry],
            birth_country: targetCountry,
            nationality: targetCountry,
          } : {}),
        };

        await onSubmitKycInfo(fullKycPayload);
      }

      if (!propError && headlessStep !== "error") {
        setActiveStep(3);
      }
    } catch (err: any) {
      console.error("Identity submission error:", err);
      const errMsg = String(err?.message || err || "").toLowerCase();
      if (
        errMsg.includes("already been verified") ||
        errMsg.includes("cannot be updated") ||
        errMsg.includes("already_verified") ||
        errMsg.includes("invalid request")
      ) {
        console.log("[ACCORDION] Customer is already verified in Stripe. Bypassing KYC step and proceeding to Step 3.");
        setLocalError(null);
        setActiveStep(3);
      } else {
        setLocalError(err?.message || "Failed to submit identity details.");
      }
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
        <div className={`flex items-center gap-1.5 ${isReceiptPaid ? "text-emerald-400 font-bold" : "text-amber-400"}`}>
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold uppercase tracking-wider">
            {isReceiptPaid
              ? (theme?.brandName ? `${theme.brandName} • Paid & Settled` : "Receipt Paid & Settled")
              : (theme?.brandName ? `${theme.brandName} Secure Checkout` : "Secure Checkout")}
          </span>
        </div>
        <div className={`text-[10px] font-semibold flex items-center gap-1.5 ${isReceiptPaid ? "text-emerald-400 font-bold" : (isLightText ? "text-white/60" : "text-black/60")}`}>
          <Lock className="w-3 h-3 text-emerald-400" />
          <span>{isReceiptPaid ? "Paid & Locked" : "256-Bit Encrypted"}</span>
        </div>
      </div>

      {/* Payment Methods Badges Bar - Guaranteed Single Row (Dimmed/Locked when Paid) */}
      <div className={`flex items-center justify-between px-3 py-2 rounded-xl border transition-opacity ${
        isReceiptPaid
          ? isLightText ? 'bg-white/[0.02] border-emerald-500/20 opacity-60' : 'bg-black/[0.02] border-emerald-500/20 opacity-60'
          : isLightText ? 'bg-white/[0.03] border-white/10' : 'bg-black/[0.03] border-black/10'
      }`}>
        <span className={`text-[10px] font-bold uppercase tracking-wider shrink-0 ${isReceiptPaid ? 'text-emerald-400' : (isLightText ? 'text-white/40' : 'text-black/40')}`}>
          {isReceiptPaid ? "Settled" : "Accepted"}
        </span>
        <div className="flex items-center gap-1.5 flex-nowrap shrink-0">
          {/* VISA */}
          <span className="h-5 px-1.5 rounded bg-[#1A1F71] border border-white/10 text-[9px] font-black tracking-widest text-white italic flex items-center select-none shadow-sm shrink-0">
            VISA
          </span>
          {/* Mastercard */}
          <span className="h-5 px-1.5 rounded bg-neutral-950 border border-white/10 flex items-center gap-0.5 select-none shadow-sm shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#EB001B] inline-block" />
            <span className="w-2 h-2 rounded-full bg-[#F79E1B] -ml-1 inline-block mix-blend-screen" />
          </span>
          {/* Official Apple Pay Badge */}
          <span className="h-5 px-1.5 rounded bg-black border border-white/20 flex items-center gap-0.5 select-none shadow-sm shrink-0" title="Apple Pay">
            <svg className="w-2.5 h-2.5 fill-current text-white shrink-0 inline-block -mt-0.5" viewBox="0 0 24 24">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.32c.67-.82 1.12-1.96.99-3.1-.97.04-2.14.65-2.83 1.46-.62.72-1.16 1.88-1.01 3 .01 0 .03 0 .04 0 1.09 0 2.14-.54 2.81-1.36z" />
            </svg>
            <span className="text-[9.5px] font-bold tracking-tight text-white leading-none">Pay</span>
          </span>
          {/* Google Pay Badge */}
          <span className="h-5 px-1.5 rounded bg-neutral-900 border border-white/10 text-[9px] font-bold text-white flex items-center select-none shadow-sm shrink-0">
            <span className="text-blue-400">G</span><span className="text-red-400">P</span><span className="text-yellow-400">a</span><span className="text-green-400">y</span>
          </span>
          {/* ACH Bank Badge */}
          <span className="h-5 px-1.5 rounded bg-emerald-950/80 border border-emerald-500/30 text-[8.5px] font-bold text-emerald-300 flex items-center gap-1 select-none shadow-sm shrink-0" title="ACH Bank Transfer">
            <svg className="w-2.5 h-2.5 fill-current text-emerald-400 shrink-0" viewBox="0 0 24 24">
              <path d="M2 10h20v2H2zm2-7h16l2 4H2zm3 9h2v7H7zm5 0h2v7h-2zm5 0h2v7h-2zm-13 8h16v2H4z" />
            </svg>
            <span>ACH</span>
          </span>
        </div>
      </div>

      {/* Global Error Banner */}
      {activeError && !isReceiptPaid && (
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
          onClick={() => !isReceiptPaid && activeStep > 1 && setActiveStep(1)}
          className={`p-3.5 flex items-center justify-between select-none ${
            !isReceiptPaid && activeStep > 1 ? "cursor-pointer hover:bg-white/[0.04]" : "cursor-default"
          }`}
        >
          <div className="flex items-center gap-2.5">
            {activeStep > 1 || isReceiptPaid ? (
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
              {(activeStep > 1 || isReceiptPaid) && (
                <p className={`text-[11px] font-medium opacity-70 flex items-center gap-1.5 ${isLightText ? "text-white" : "text-black"}`}>
                  <Mail className="w-2.5 h-2.5 opacity-60" />
                  <span>{email}</span>
                  {phone && <span>• {phone}</span>}
                  {country && (
                    <span className="inline-flex items-center gap-1 opacity-90">
                      • {SUPPORTED_COUNTRIES.find((c) => c.code === country)?.flag || ""} {country}
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
          {isReceiptPaid ? (
            <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1 opacity-90 select-none">
              <Lock className="w-3 h-3 text-emerald-400" /> Verified
            </span>
          ) : activeStep > 1 ? (
            <button
              type="button"
              className="text-[11px] font-semibold text-amber-400 flex items-center gap-1 hover:underline"
            >
              <Edit2 className="w-3 h-3" /> Edit
            </button>
          ) : null}
        </div>

        {/* Step 1 Expanded Body */}
        <form onSubmit={handleContactSubmit} className={`p-3.5 pt-0 space-y-3 border-t border-dashed border-white/10 ${activeStep === 1 ? "" : "hidden"}`}>
            {/* Email Address */}
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

            {/* Country of Residence */}
            <div>
              <label className={`flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                <Globe className="w-3 h-3" />
                <span>Country of Residence</span>
              </label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium cursor-pointer ${
                  isLightText
                    ? "bg-neutral-900 border border-white/10 text-white focus:border-amber-400/50"
                    : "bg-white border border-black/10 text-black focus:border-amber-400/50"
                }`}
              >
                {SUPPORTED_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>

            {/* Dynamic Phone Registration Input — ONLY shown when Stripe Link explicitly requires a new account phone number (matching V1) */}
            {headlessStep === "collecting_phone" && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2.5 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-start gap-2 text-amber-300 text-xs font-bold">
                  <Phone className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <div>Stripe Verification Required</div>
                    <p className="text-[11px] font-normal text-amber-300/80 leading-relaxed mt-0.5">
                      Enter your mobile phone number to register your Link account securely.
                    </p>
                  </div>
                </div>

                <div>
                  <input
                    type="tel"
                    required
                    placeholder={
                      SUPPORTED_COUNTRIES.find((c) => c.code === country)?.dial
                        ? `${SUPPORTED_COUNTRIES.find((c) => c.code === country)?.dial} 000 0000`
                        : "+1 (555) 000-0000"
                    }
                    value={phone}
                    onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                    autoFocus
                    className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${
                      isLightText
                        ? "bg-white/10 border border-amber-400/50 text-white placeholder-white/50 focus:ring-1 focus:ring-amber-400"
                        : "bg-black/10 border border-amber-500/50 text-black placeholder-black/50 focus:ring-1 focus:ring-amber-500"
                    }`}
                  />
                </div>
              </div>
            )}

            {/* Inline OTP Element if triggered by Stripe Link and in authentication phase */}
            {authElement && (
              ["authenticating", "collecting_phone", "checking_link"].includes(headlessStep as string) ||
              (activeStep === 1 && effectiveStatus !== "verified" && !isAllKycCompleted)
            ) && (
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
              disabled={
                isReceiptPaid ||
                isSubmittingContact ||
                !email ||
                (headlessStep === "collecting_phone" && (!phone || phone.trim().length < 7)) ||
                Boolean(
                  authElement &&
                  (["authenticating"].includes(headlessStep as string) ||
                   (activeStep === 1 && effectiveStatus !== "verified" && !isAllKycCompleted))
                )
              }
              className="w-full h-10 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-lg"
              style={{ backgroundColor: primaryColor, color: "#fff" }}
            >
              {isSubmittingContact ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{headlessStep === "collecting_phone" ? "Registering Phone Number..." : "Verifying Contact Information..."}</span>
                </>
              ) : authElement && (["authenticating"].includes(headlessStep as string) || (activeStep === 1 && effectiveStatus !== "verified" && !isAllKycCompleted)) ? (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Enter 6-Digit Code Above</span>
                </>
              ) : headlessStep === "collecting_phone" ? (
                <>
                  <span>Confirm Phone & Continue</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  <span>Continue</span>
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
          onClick={() => !isReceiptPaid && activeStep > 2 && setActiveStep(2)}
          className={`p-3.5 flex items-center justify-between select-none ${
            !isReceiptPaid && activeStep > 2 ? "cursor-pointer hover:bg-white/[0.04]" : "cursor-default"
          }`}
        >
          <div className="flex items-center gap-2.5">
            {activeStep > 2 || isReceiptPaid || effectiveStatus === "verified" || isAllKycCompleted ? (
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
                {isReceiptPaid ? (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1">
                    <Check className="w-2.5 h-2.5 stroke-[3]" /> Verified
                  </span>
                ) : ((isL0Approved && !showStepUpForm && (!isL2Requirement || isL2Approved)) || isL2Approved) ? (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1">
                    <Check className="w-2.5 h-2.5 stroke-[3]" /> Verified
                  </span>
                ) : (showStepUpForm || isL2Requirement) ? (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/30 inline-flex items-center gap-1">
                    <Shield className="w-2.5 h-2.5" /> Action Required
                  </span>
                ) : null}
              </div>

              {(activeStep > 2 || isReceiptPaid || effectiveStatus === "verified" || isAllKycCompleted || isL0Approved) && (
                <p className={`text-[11px] font-medium opacity-70 flex items-center gap-1.5 ${isLightText ? "text-white" : "text-black"}`}>
                  <User className="w-2.5 h-2.5 opacity-60" />
                  <span>{firstName} {lastName}</span>
                  {line1 && <span>• {line1}, {city}</span>}
                </p>
              )}
            </div>
          </div>

          {isReceiptPaid ? (
            <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1 opacity-90 select-none">
              <Lock className="w-3 h-3 text-emerald-400" /> Verified
            </span>
          ) : activeStep > 2 ? (
            (isL0Approved && !showStepUpForm && (!isL2Requirement || isL2Approved)) ? (
              <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1 opacity-90 select-none">
                <Lock className="w-3 h-3 text-emerald-400" /> Verified
              </span>
            ) : (
              <button
                type="button"
                className="text-[11px] font-semibold text-amber-400 flex items-center gap-1 hover:underline"
              >
                <Edit2 className="w-3 h-3" /> Edit
              </button>
            )
          ) : null}
        </div>

        {/* Step 2 Expanded Body */}
        <div className={`p-3.5 pt-0 space-y-3 border-t border-dashed border-white/10 ${activeStep === 2 ? "" : "hidden"}`}>
          {(isL0Approved && !showStepUpForm && (!isL2Requirement || isL2Approved)) ? (
            /* Already Verified Locked Summary Card */
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-3 animate-in fade-in duration-200 mt-2">
              <div className="flex items-start gap-2.5 text-emerald-400">
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                    Identity & Residential Verification Approved
                  </h5>
                  <p className="text-[11px] text-emerald-400/80 leading-relaxed">
                    Your identity is verified and securely linked with Stripe. No additional verification or demographic changes are needed.
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-black/20 border border-white/5 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="opacity-60">Verified Name:</span>
                  <span className="font-semibold text-white">{firstName} {lastName}</span>
                </div>
                {line1 && (
                  <div className="flex justify-between">
                    <span className="opacity-60">Residential Address:</span>
                    <span className="font-semibold text-white">{line1}, {city} {stateCode} {zipCode}</span>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setActiveStep(3)}
                className="w-full h-10 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-lg hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
                style={{ backgroundColor: primaryColor, color: "#fff" }}
              >
                <span>Continue to Payment Method</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <form onSubmit={handleIdentitySubmit} className="space-y-3">
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

                {/* Country of Residence Selector */}
                <div>
                  <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                    Country of Residence
                  </label>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${
                      isLightText
                        ? "bg-neutral-900 border border-white/10 text-white focus:border-amber-400/50"
                        : "bg-white border border-black/10 text-black focus:border-amber-400/50"
                    }`}
                  >
                    {SUPPORTED_COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.flag} {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
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
                      <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                        Country
                      </label>
                      <select
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${
                          isLightText
                            ? "bg-neutral-900 border border-white/10 text-white focus:border-amber-400/50"
                            : "bg-white border border-black/10 text-black focus:border-amber-400/50"
                        }`}
                      >
                        {SUPPORTED_COUNTRIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.flag} {c.name} ({c.code})
                          </option>
                        ))}
                      </select>
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
                      <div className={isUS ? "col-span-5" : "col-span-5"}>
                        <label className={`flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                          <span>City <span className="text-red-400">*</span></span>
                          {isFieldValid("city") && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                        </label>
                        <input
                          type="text"
                          placeholder={isUS ? "Los Angeles" : country === "DE" ? "Berlin" : country === "FR" ? "Paris" : country === "GB" ? "London" : "City"}
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
                      <div className={isUS ? "col-span-3" : "col-span-3"}>
                        <label className={`flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                          <span>{isUS ? "State *" : "Region"}</span>
                          {isFieldValid("stateCode") && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                        </label>
                        <input
                          type="text"
                          placeholder={isUS ? "CA" : "State/Region"}
                          maxLength={isUS ? 2 : 50}
                          value={stateCode}
                          onChange={(e) => setStateCode(isUS ? e.target.value.toUpperCase() : e.target.value)}
                          onBlur={() => markFieldTouched("stateCode")}
                          className={`w-full h-10 px-3 rounded-xl focus:outline-none text-xs font-medium ${isUS ? "uppercase text-center" : ""} transition-all ${getFieldInputClass("stateCode")}`}
                        />
                        {isFieldInvalid("stateCode") && (
                          <span className="text-[10px] text-red-400 font-semibold mt-1 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> State
                          </span>
                        )}
                      </div>
                      <div className={isUS ? "col-span-4" : "col-span-4"}>
                        <label className={`flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                          <span>{isUS ? "Zip Code *" : "Postal Code *"}</span>
                          {isFieldValid("zipCode") && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                        </label>
                        <input
                          type="text"
                          placeholder={isUS ? "90210" : country === "DE" ? "10115" : country === "FR" ? "75001" : country === "GB" ? "SW1A 1AA" : "Postal Code"}
                          maxLength={12}
                          value={zipCode}
                          onChange={(e) => setZipCode(e.target.value)}
                          onBlur={() => markFieldTouched("zipCode")}
                          className={`w-full h-10 px-3 rounded-xl focus:outline-none text-xs font-medium font-mono text-center transition-all ${getFieldInputClass("zipCode")}`}
                        />
                        {isFieldInvalid("zipCode") && (
                          <span className="text-[10px] text-red-400 font-semibold mt-1 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> Postal Code
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* L1 Demographic Demands: Date of Birth & SSN (SSN only for US; DOB for all) */}
            {showStepUpForm && (
              <div className={`grid ${isUS ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"} gap-2.5 pt-2 border-t border-white/10 animate-in fade-in duration-200`}>
                <div className="min-w-0">
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
                {isUS && (
                  <div className="min-w-0">
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
                )}
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

            {/* Inline Verification Notice / Error Alert (only for KYC/Identity issues) */}
            {activeError && (
              !activeError.toLowerCase().includes("card") &&
              !activeError.toLowerCase().includes("funds") &&
              !activeError.toLowerCase().includes("cvc") &&
              !activeError.toLowerCase().includes("payment") &&
              !activeError.toLowerCase().includes("bank") &&
              !activeError.toLowerCase().includes("expired")
            ) && (
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

            {/* Save & Continue Button */}
            <button
              type="submit"
              disabled={isReceiptPaid || isSubmittingIdentity || !isIdentityComplete}
              className={`w-full h-11 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-lg mt-2 ${
                isSubmittingIdentity
                  ? "bg-emerald-600 text-white cursor-wait"
                  : !isIdentityComplete
                  ? isLightText
                    ? "bg-white/10 hover:bg-white/15 text-white/50 border border-white/10 cursor-pointer"
                    : "bg-black/10 hover:bg-black/15 text-black/50 border border-black/10 cursor-pointer"
                  : "hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
              }`}
              style={
                isIdentityComplete && !isSubmittingIdentity
                  ? { backgroundColor: primaryColor, color: "#fff" }
                  : {}
              }
            >
              {isSubmittingIdentity ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying Identity Details...</span>
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

            {/* Submitting Identity 2 to 3 minute notice */}
            {isSubmittingIdentity && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 space-y-1 animate-in fade-in duration-300 text-left mt-2">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                  <Clock className="w-4 h-4 shrink-0 text-amber-400" />
                  <span>Verification in Progress</span>
                </div>
                <p className="text-[11.5px] leading-relaxed text-amber-200/90 font-normal">
                  Identity and address checks can take <strong>2 to 3 minutes</strong> to process. Please keep this window open while Stripe verifies your details.
                </p>
              </div>
            )}
          </form>
          )}
        </div>
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
          onClick={() => !isReceiptPaid && activeStep > 3 && setActiveStep(3)}
          className={`p-3.5 flex items-center justify-between select-none ${
            !isReceiptPaid && activeStep > 3 ? "cursor-pointer hover:bg-white/[0.04]" : "cursor-default"
          }`}
        >
          <div className="flex items-center gap-2.5">
            {activeStep > 3 || isReceiptPaid ? (
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
                {headlessStep === "verifying_identity" ? "3. Identity Verification & Payment" : "3. Payment Method"}
              </h4>
              {(activeStep > 3 || isReceiptPaid) && (
                <p className={`text-[11px] font-medium opacity-70 flex items-center gap-1.5 ${isLightText ? "text-white" : "text-black"}`}>
                  <CreditCard className="w-2.5 h-2.5 opacity-60" />
                  <span>
                    {detectedCardBrand && detectedCardLast4
                      ? `${detectedCardBrand} •••• ${detectedCardLast4}`
                      : detectedCardFunding === "us_bank_account" || paymentConfirmed?.funding === "us_bank_account"
                      ? "US Bank Account (ACH)"
                      : "Authorized via Stripe Secure Payment"}
                  </span>
                </p>
              )}
            </div>
          </div>
          {isReceiptPaid ? (
            <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1 opacity-90 select-none">
              <Lock className="w-3 h-3 text-emerald-400" /> Authorized
            </span>
          ) : activeStep > 3 ? (
            <button
              type="button"
              className="text-[11px] font-semibold text-amber-400 flex items-center gap-1 hover:underline"
            >
              <Edit2 className="w-3 h-3" /> Edit
            </button>
          ) : null}
        </div>

        {/* Step 3 Expanded Body */}
        <div className={`p-3.5 pt-0 space-y-3 border-t border-dashed border-white/10 ${activeStep === 3 ? "" : "hidden"}`}>
            {/* Top Error Alert Banner (renders if error is present) */}
            {activeError && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-2.5 text-xs text-amber-300 animate-in fade-in my-1">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="font-semibold leading-relaxed">{activeError}</span>
              </div>
            )}

            {/* Level 2 Document & Selfie Verification Notice (When Stripe Demands L2 Verification) */}
            {headlessStep === "verifying_identity" && (
              <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/30 space-y-1.5 animate-in fade-in duration-300 my-1">
                <div className="flex items-center gap-2 text-purple-300 text-xs font-bold">
                  <Shield className="w-4 h-4 text-purple-400 shrink-0" />
                  <span>Stripe Identity Verification Required</span>
                </div>
                <p className="text-[11px] text-purple-300/80 leading-relaxed">
                  Please follow the secure on-screen instructions below to scan your government-issued ID (or passport) and take a quick selfie to verify your identity.
                </p>
              </div>
            )}

            {/* Embedded Live Stripe Payment / Identity Element Container (Persistent DOM mounting matching V1) */}
            <div className="space-y-2">
              <div
                className={`p-3 rounded-xl bg-white/5 border border-white/10 my-2 ${paymentElement ? "block" : "hidden"}`}
              >
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

              {paymentElement && (
                <div className="flex items-center justify-center gap-1.5 py-1 text-[11px] font-semibold text-amber-400/90 text-center animate-in fade-in">
                  <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>
                    {headlessStep === "verifying_identity"
                      ? "Complete the secure photo verification above to proceed."
                      : "Please confirm your payment method in the secure form above to complete checkout."}
                  </span>
                </div>
              )}

              {/* Live Production Loading State */}
              {!paymentElement && !isSimulationMode && (
                <div className="p-8 flex flex-col items-center justify-center space-y-3 text-center animate-in fade-in">
                  <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
                  <p className={`text-xs font-medium ${isLightText ? "text-white/70" : "text-black/70"}`}>
                    {headlessStep === "verifying_identity"
                      ? "Loading secure Stripe identity verification..."
                      : "Loading secure Stripe payment form..."}
                  </p>
                </div>
              )}
            </div>
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
          {isReceiptPaid && (
            <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1 opacity-90 select-none">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Settled
            </span>
          )}
        </div>

        <div className={`p-3.5 pt-0 space-y-3.5 border-t border-dashed border-white/10 ${activeStep === 4 ? "" : "hidden"}`}>
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

                {/* Identity / Document Verification Notice */}
                {(headlessStep === "verifying_identity" || headlessStep === "checking_kyc" || (headlessStatus || "").toLowerCase().includes("verif") || (headlessStatus || "").toLowerCase().includes("identity") || (headlessStatus || "").toLowerCase().includes("document") || kycLevel === "L2") && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 space-y-1 animate-in fade-in duration-300 mt-2 text-left">
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                      <Clock className="w-4 h-4 shrink-0 text-amber-400" />
                      <span>Identity Verification in Progress</span>
                    </div>
                    <p className="text-[11.5px] leading-relaxed text-amber-200/90 font-normal">
                      Document and identity checks can take <strong>2 to 3 minutes</strong> to process. Please keep this page open while Stripe completes your verification.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              /* Order Success Summary Receipt Card - Prominent Confirmation Hero Matching V1 */
              <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-4 animate-in zoom-in-95 duration-300">
                
                {/* Prominent Hero Header */}
                <div className="flex flex-col items-center justify-center text-center space-y-2.5 pt-1 pb-1">
                  <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500/40 text-emerald-400 flex items-center justify-center shadow-[0_0_35px_-5px_rgba(16,185,129,0.4)] animate-in zoom-in duration-300">
                    <Check className="w-8 h-8 text-emerald-400 stroke-[3]" />
                  </div>
                  <h3 className={`text-xl sm:text-2xl font-black tracking-tight ${isLightText ? "text-white" : "text-black"}`}>
                    Payment Complete!
                  </h3>
                  <div className="flex flex-col items-center justify-center gap-1.5 w-full">
                    {/* Row 1: Prominent Amount Paid */}
                    <div className="text-2xl sm:text-3xl font-mono font-extrabold text-emerald-400 tracking-tight">
                      ${amountUsd.toFixed(2)} <span className="text-xs sm:text-sm font-sans font-bold opacity-80">USD</span>
                    </div>
                    {/* Row 2: Neatly Wrapped Receipt ID */}
                    {receiptId && (
                      <div className={`text-[11px] font-mono font-medium max-w-full px-3 py-1 rounded-lg border break-all select-all tracking-tight leading-relaxed ${
                        isLightText ? 'bg-white/5 border-white/10 text-white/70' : 'bg-black/5 border-black/10 text-black/70'
                      }`}>
                        Receipt #{receiptId.replace(/^receipt:/i, "")}
                      </div>
                    )}
                  </div>
                </div>

                {/* Form Lockdown Security Banner */}
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center gap-2.5 text-xs text-emerald-300 text-left">
                  <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="leading-relaxed font-medium">
                    This receipt is finalized and marked paid. Checkout is locked to prevent duplicate charges.
                  </span>
                </div>

                {/* Proof of Payment Box Matching V1 */}
                <div className={`p-3.5 rounded-xl border text-center ${isLightText ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
                  <div className={`text-[10px] uppercase tracking-wider font-bold mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>
                    Proof of Payment
                  </div>
                  <div className={`text-sm font-mono font-bold ${isLightText ? 'text-white' : 'text-black'}`}>
                    {(() => {
                      const tx = paymentConfirmed?.txHash || (receipt as any)?.transactionHash || (receipt as any)?.txHash;
                      if (tx) return <span className="text-xs break-all">{tx.slice(0, 10)}...{tx.slice(-8)}</span>;
                      return <span className="text-emerald-400">Confirmed • Paid & Settled</span>;
                    })()}
                  </div>
                  <div className="text-[11px] text-emerald-400 font-medium mt-1">
                    Show this confirmation to merchant
                  </div>
                </div>

                {/* Detailed Breakdown */}
                <div className="p-3.5 rounded-xl bg-black/20 border border-white/5 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="opacity-60">Total Paid:</span>
                    <span className="font-bold font-mono">${amountUsd.toFixed(2)} USD</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-60">Contact Email:</span>
                    <span className="font-semibold">{email || (receipt as any)?.customerEmail || (receipt as any)?.buyerEmail || "—"}</span>
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
                        : selectedPaymentType === "bank" || detectedCardFunding === "us_bank_account" || paymentConfirmed?.funding === "us_bank_account" || headlessStep === "awaiting_funds"
                        ? "US Bank Account (ACH)"
                        : "Credit / Debit Card (Stripe)"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-60">Status:</span>
                    <span className="text-emerald-400 font-bold inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        {detectedCardFunding === "us_bank_account" || paymentConfirmed?.funding === "us_bank_account" || headlessStep === "awaiting_funds" || (receipt as any)?.status === "paid - ach pending" || (receipt as any)?.status === "ach_pending"
                          ? "Payment Authorized (ACH Pending)"
                          : "Payment Confirmed"}
                      </span>
                    </span>
                  </div>
                </div>

                {(detectedCardFunding === "us_bank_account" || paymentConfirmed?.funding === "us_bank_account" || headlessStep === "awaiting_funds" || (receipt as any)?.status === "paid - ach pending" || (receipt as any)?.status === "ach_pending") && (
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 leading-relaxed text-left">
                    Funds will be deducted from your bank account within 2–3 business days. USDC settles upon clearance.
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
                      <Mail className="w-3.5 h-3.5" />
                      <span>Email Receipt</span>
                    </button>
                  )}
                </div>
              </div>
            )}
        </div>
      </div>



      {/* ==================================================================== */}
      {/* PROMINENT PAYMENT PROCESSING MODAL / OVERLAY */}
      {/* Specifically active during "Processing payment" & "Reviewing service fee" */}
      {/* Blocks all interactions until complete or failed */}
      {/* ==================================================================== */}
      {isPaymentProcessing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300 select-none">
          <div
            className={`w-full max-w-md p-6 sm:p-8 rounded-3xl border shadow-2xl relative overflow-hidden text-center space-y-5 animate-in zoom-in-95 duration-300 ${
              isLightText
                ? "bg-neutral-900/95 border-emerald-500/30 text-white shadow-[0_0_50px_-10px_rgba(16,185,129,0.25)]"
                : "bg-white border-emerald-500/30 text-black shadow-[0_0_50px_-10px_rgba(16,185,129,0.25)]"
            }`}
          >
            {/* Ambient Background Glow */}
            <div className="absolute -top-24 -left-24 w-48 h-48 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />

            {/* Glowing Spinner Hero Badge */}
            <div className="relative flex items-center justify-center pt-2">
              <div className="relative w-20 h-20 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center shadow-[0_0_40px_-5px_rgba(16,185,129,0.3)]">
                <Loader2 className="w-10 h-10 text-emerald-400 animate-spin stroke-[2.5]" />
                <div className="absolute inset-0 rounded-full border-2 border-dashed border-emerald-400/40 animate-[spin_8s_linear_infinite]" />
              </div>
            </div>

            {/* Title & Subtitle */}
            <div className="space-y-1.5 relative z-10">
              <h3 className={`text-xl sm:text-2xl font-black tracking-tight ${isLightText ? "text-white" : "text-black"}`}>
                Payment Processing
              </h3>
              <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span>Thank you for your patience</span>
              </div>
            </div>

            {/* Do Not Refresh Warning Banner */}
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 space-y-1 text-left relative z-10">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                <span>Do Not Refresh or Close</span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-amber-200/90 font-normal">
                Please do not refresh, navigate back, or close this window while Stripe finalizes your transaction.
              </p>
            </div>

            {/* Live Progress / Status Details */}
            <div className={`p-3 rounded-xl border text-xs text-left space-y-2 relative z-10 ${
              isLightText ? "bg-black/40 border-white/10" : "bg-black/5 border-black/10"
            }`}>
              <div className="flex justify-between items-center text-[11px]">
                <span className="opacity-60">Status:</span>
                <span className="font-semibold text-emerald-400">{processingStatusSubtitle}</span>
              </div>
              <div className="flex justify-between items-center text-[11px]">
                <span className="opacity-60">Amount:</span>
                <span className="font-mono font-bold">${amountUsd.toFixed(2)} USD</span>
              </div>
              {/* Indeterminate Animated Progress Bar */}
              <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden mt-2">
                <div className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-emerald-500 rounded-full animate-pulse w-full" />
              </div>
            </div>

            {/* Security Trust Footnote */}
            <div className="flex items-center justify-center gap-1.5 text-[10.5px] font-semibold opacity-60 relative z-10">
              <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
              <span>256-Bit Encrypted Secure Stripe Transaction</span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

