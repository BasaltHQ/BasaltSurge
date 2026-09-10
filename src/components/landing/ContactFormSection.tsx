"use client";

import React, { useState, useRef, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTheme } from "@/contexts/ThemeContext";
import { X, CheckCircle2, Loader2, Send } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Merchant Onboarding Contact Form – Surge-themed                    */
/* ------------------------------------------------------------------ */

const FORM_SLUG = "basaltsurge-merchant-onboarding-form-e860e8ef";
const API_ENDPOINT = "https://crm.basalthq.com//api/forms/submit";

const BUSINESS_TYPES = [
  "Retail",
  "Restaurant / Food Service",
  "E-Commerce",
  "Professional Services",
  "Hospitality / Hotels",
  "Health & Wellness",
  "Entertainment & Events",
  "Cannabis / Dispensary",
  "Freelancer / Creator",
  "SaaS / Technology",
  "Other",
];

type FieldDef = {
  name: string;
  label: string;
  type: "text" | "email" | "tel" | "textarea" | "select" | "checkbox";
  required: boolean;
  placeholder?: string;
  half?: boolean;           // render at 50 % width on md+
  options?: string[];       // for select
};

const FIELDS: FieldDef[] = [
  { name: "first_name",       label: "First Name",       type: "text",     required: true,  placeholder: "John",                       half: true },
  { name: "last_name",        label: "Last Name",        type: "text",     required: true,  placeholder: "Doe",                        half: true },
  { name: "email",            label: "Email",            type: "email",    required: true,  placeholder: "john@example.com" },
  { name: "phone",            label: "Phone Number",     type: "tel",      required: false, placeholder: "+1 (555) 123-4567",          half: true },
  { name: "company",          label: "Business Name",    type: "text",     required: true,  placeholder: "Acme Retail Co.",             half: true },
  { name: "website",          label: "Website URL",      type: "text",     required: false, placeholder: "https://www.yourstore.com" },
  { name: "address",          label: "Business Address",  type: "text",     required: false, placeholder: "123 Main Street, City, State" },
  { name: "city",             label: "City",             type: "text",     required: false, placeholder: "New York",                   half: true },
  { name: "state",            label: "State / Province", type: "text",     required: false, placeholder: "NY",                         half: true },
  { name: "zip",              label: "ZIP / Postal Code",type: "text",     required: false, placeholder: "10001",                      half: true },
  { name: "country",          label: "Country",          type: "text",     required: false, placeholder: "United States",               half: true },
  { name: "business_type",    label: "Type of Business", type: "select",   required: true,  placeholder: "Select one",                 options: BUSINESS_TYPES },
  { name: "integration_goals",label: "What are your main goals for adopting Web3 payments?", type: "textarea", required: false, placeholder: "e.g., Reduce processing fees, Accept crypto, Offer token rewards, Improve international sales" },
  { name: "agree_to_terms",   label: "I agree to BasaltSurge's Terms of Service and Privacy Policy", type: "checkbox", required: true },
];

/* Themed input class factory */
const inputCls =
  "w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-white/20 focus:border-white/30 transition-colors font-mono";

/* ------------------------------------------------------------------ */
/*  SUCCESS MODAL                                                      */
/* ------------------------------------------------------------------ */
function ContactModalShell({ onClose, children, className }: { onClose: () => void; children: React.ReactNode; className: string }) {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[11000] bg-black/80 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className={`fixed left-1/2 top-1/2 z-[11001] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-neutral-900/95 backdrop-blur-xl shadow-2xl custom-scrollbar ${className}`}
        >
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SuccessModal({ onClose, accentColor }: { onClose: () => void; accentColor: string }) {
  return (
    <ContactModalShell onClose={onClose} className="max-w-md p-8 text-center">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div
          className="mx-auto mb-6 w-16 h-16 rounded-full flex items-center justify-center"
          style={{ backgroundColor: `${accentColor}20` }}
        >
          <CheckCircle2 className="w-8 h-8" style={{ color: accentColor }} />
        </div>

        <Dialog.Title asChild><h3 className="text-2xl font-bold text-white mb-2">Submission Received!</h3></Dialog.Title>
        <p className="text-gray-400 text-sm leading-relaxed mb-6">
          Thank you for your interest in BasaltSurge. Our team will review your application and reach out within
          1–2 business days.
        </p>

        <button
          onClick={onClose}
          className="px-8 py-3 rounded-lg text-white text-sm font-mono tracking-wider font-bold transition-all hover:opacity-90"
          style={{ backgroundColor: accentColor }}
        >
          GOT IT
        </button>
    </ContactModalShell>
  );
}

/* ------------------------------------------------------------------ */
/*  SHARED FORM INNER (used by both inline section and modal)          */
/* ------------------------------------------------------------------ */
function ContactFormInner({
  accentColor,
  onSuccess,
}: {
  accentColor: string;
  onSuccess: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError("");
      setSubmitting(true);

      try {
        const formData = new FormData(e.currentTarget);
        formData.append("form_slug", FORM_SLUG);
        formData.append("source_url", window.location.href);
        if (document.referrer) formData.append("referrer", document.referrer);

        const params = new URLSearchParams(window.location.search);
        if (params.has("utm_source")) formData.append("utm_source", params.get("utm_source")!);
        if (params.has("utm_medium")) formData.append("utm_medium", params.get("utm_medium")!);
        if (params.has("utm_campaign")) formData.append("utm_campaign", params.get("utm_campaign")!);

        const res = await fetch(API_ENDPOINT, { method: "POST", body: formData });

        // The API may return 200 with no body – treat any 200 as success
        if (res.ok) {
          formRef.current?.reset();
          onSuccess();
        } else {
          let msg = "Submission failed. Please try again.";
          try {
            const json = await res.json();
            if (json?.error) msg = json.error;
          } catch { /* empty body */ }
          setError(msg);
        }
      } catch {
        setError("Network error. Please check your connection and try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [onSuccess]
  );

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
      {/* Generate field rows, pairing adjacent "half" fields */}
      {(() => {
        const rows: React.ReactNode[] = [];
        let i = 0;
        while (i < FIELDS.length) {
          const f = FIELDS[i];
          if (f.half && i + 1 < FIELDS.length && FIELDS[i + 1].half) {
            const f2 = FIELDS[i + 1];
            rows.push(
              <div key={f.name} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FieldRenderer field={f} />
                <FieldRenderer field={f2} />
              </div>
            );
            i += 2;
          } else {
            rows.push(<FieldRenderer key={f.name} field={f} />);
            i += 1;
          }
        }
        return rows;
      })()}

      {/* Error message */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 font-mono">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting}
        className="w-full md:w-auto flex items-center justify-center gap-2 px-10 py-4 rounded-lg text-white text-sm font-mono tracking-wider font-bold transition-all hover:opacity-90 hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        style={{ backgroundColor: accentColor }}
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            SUBMITTING...
          </>
        ) : (
          <>
            <Send className="w-4 h-4" />
            SUBMIT APPLICATION
          </>
        )}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  CONTACT FORM MODAL (opened by navbar button)                       */
/* ------------------------------------------------------------------ */
export function ContactFormModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { theme } = useTheme();
  const secondaryColor = theme.secondaryColor || "#F54029";
  const [showSuccess, setShowSuccess] = useState(false);

  // Reset success state when modal re-opens
  React.useEffect(() => {
    if (isOpen) setShowSuccess(false);
  }, [isOpen]);

  if (!isOpen) return null;

  if (showSuccess) {
    return (
      <SuccessModal
        onClose={onClose}
        accentColor={secondaryColor}
      />
    );
  }

  return (
    <ContactModalShell onClose={onClose} className="max-w-2xl">
        {/* Top accent */}
        <div
          className="sticky top-0 z-10 h-[2px]"
          style={{ background: `linear-gradient(90deg, transparent, ${secondaryColor}, transparent)` }}
        />

        <div className="p-6 sm:p-8 md:p-10">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-20 text-gray-500 hover:text-white transition-colors p-1"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Header */}
          <div className="mb-6 pr-8">
            <span
              className="inline-block text-xs font-mono tracking-widest uppercase mb-3"
              style={{ color: secondaryColor }}
            >
              /// MERCHANT ONBOARDING
            </span>
            <Dialog.Title asChild><h2 className="text-2xl sm:text-3xl font-black text-white mb-2">
              Ready to Accept Web3 Payments?
            </h2></Dialog.Title>
            <p className="text-gray-400 text-sm leading-relaxed">
              Fill out the form and our team will help you get onboarded onto the BasaltSurge network.
            </p>
          </div>

          {/* Free Tier Banner */}
          <div className="relative p-4 rounded-xl bg-gradient-to-br from-emerald-500/15 via-emerald-600/10 to-cyan-500/10 border border-emerald-500/30 overflow-hidden mb-6">
            <div className="absolute top-2 right-3 px-2 py-0.5 rounded text-[9px] font-bold tracking-widest bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono">FOREVER FREE</div>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-2xl font-black text-white">$0</span>
              <span className="text-sm text-gray-400">/mo — No subscription, no setup fees</span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">
              All industry packs included free. Platform funded through a small processing fee on transactions, <span className="text-emerald-400 font-medium">paid by the customer</span>.
            </p>
          </div>

          <ContactFormInner
            accentColor={secondaryColor}
            onSuccess={() => setShowSuccess(true)}
          />
        </div>
    </ContactModalShell>
  );
}

/* ------------------------------------------------------------------ */
/*  CONTACT FORM SECTION (inline, used on landing / get-started pages) */
/* ------------------------------------------------------------------ */
export default function ContactFormSection({ id = "contact" }: { id?: string }) {
  const { theme } = useTheme();
  const secondaryColor = theme.secondaryColor || "#F54029";
  const [showSuccess, setShowSuccess] = useState(false);

  return (
    <>
      {showSuccess && (
        <SuccessModal
          onClose={() => setShowSuccess(false)}
          accentColor={secondaryColor}
        />
      )}

      <section id={id} className="scroll-mt-24">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-sm">
          {/* Top accent */}
          <div
            className="absolute top-0 inset-x-0 h-[2px]"
            style={{ background: `linear-gradient(90deg, transparent, ${secondaryColor}, transparent)` }}
          />

          <div className="p-8 md:p-12">
            {/* Header */}
            <div className="max-w-2xl mx-auto mb-10">
              <span
                className="inline-block text-xs font-mono tracking-widest uppercase mb-3"
                style={{ color: secondaryColor }}
              >
                /// MERCHANT ONBOARDING
              </span>
              <h2 className="text-3xl md:text-4xl font-black text-white mb-3">
                Ready to Accept Web3 Payments?
              </h2>
              <p className="text-gray-400 text-sm leading-relaxed">
                Fill out the form below and our team will help you get onboarded onto the BasaltSurge network.
                Start accepting crypto at the point of sale in as little as 24 hours.
              </p>
            </div>

            <div className="max-w-2xl mx-auto">
              <ContactFormInner
                accentColor={secondaryColor}
                onSuccess={() => setShowSuccess(true)}
              />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  INDIVIDUAL FIELD RENDERER                                          */
/* ------------------------------------------------------------------ */
function FieldRenderer({ field }: { field: FieldDef }) {
  const { name, label, type, required, placeholder, options } = field;

  if (type === "checkbox") {
    return (
      <label className="flex items-start gap-3 cursor-pointer group">
        <input
          type="checkbox"
          name={name}
          required={required}
          className="mt-0.5 rounded border-white/20 bg-white/5 checked:bg-[var(--pp-secondary)] focus:ring-1 focus:ring-white/20 transition-colors"
        />
        <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
          {label} {required && <span className="text-red-400">*</span>}
        </span>
      </label>
    );
  }

  return (
    <div>
      <label className="block text-xs font-mono tracking-wider text-gray-400 mb-1.5 uppercase">
        {label} {required && <span className="text-red-400">*</span>}
      </label>

      {type === "textarea" ? (
        <textarea
          name={name}
          required={required}
          placeholder={placeholder}
          rows={4}
          className={inputCls + " resize-none"}
        />
      ) : type === "select" ? (
        <select
          name={name}
          required={required}
          defaultValue=""
          className={inputCls + " cursor-pointer"}
          style={{ colorScheme: "dark" }}
        >
          <option value="" disabled>
            {placeholder || "Select…"}
          </option>
          {(options || []).map((opt) => (
            <option key={opt} value={opt} className="bg-neutral-900 text-gray-200">
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          name={name}
          required={required}
          placeholder={placeholder}
          className={inputCls}
        />
      )}
    </div>
  );
}
