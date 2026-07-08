"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { isDualSplitEnabled } from "@/lib/env";

/**
 * useStripeEmbeddedOnramp
 * 
 * Full client-side orchestrator for the Stripe Embedded Components Crypto Onramp.
 * Uses the @stripe/crypto SDK with headless `ui_mode` for complete UI control.
 * 
 * Architecture: Smart Wallet Bridge Pattern
 * ──────────────────────────────────────────
 * 1. Buyer enters email → Stripe Link verifies via OTP (single OTP)
 * 2. Server marks email as verified → Thirdweb auth_endpoint trusts it (no 2nd OTP)
 * 3. Thirdweb creates/retrieves deterministic EIP-4337 smart wallet for that email
 * 4. Smart wallet address registered with Stripe as buyer's wallet (unique per buyer)
 * 5. Stripe onramp delivers USDC to smart wallet
 * 6. Gasless USDC.transfer() moves funds from smart wallet → split contract
 * 7. Split contract auto-distributes to merchant + platform
 * 
 * Key properties:
 * - Each buyer email = unique wallet (no shared-address compliance issues)
 * - Buyer never sees a wallet, never pays gas, never signs anything
 * - Single OTP total (Stripe Link), no Thirdweb OTP
 * - Smart wallet is persistent: same email = same wallet forever
 */

export type OnrampStep =
  | "idle"
  | "initializing"
  | "checking_link"
  | "registering_link"
  | "collecting_phone"
  | "authenticating"
  | "exchanging_tokens"
  | "checking_kyc"
  | "collecting_kyc"
  | "submitting_kyc"
  | "verifying_identity"
  | "creating_wallet"
  | "registering_wallet"
  | "collecting_payment"
  | "creating_session"
  | "confirming_fees"
  | "checking_out"
  | "awaiting_funds"
  | "transferring"
  | "completed"
  | "error";

type OnrampCoordinator = {
  registerLinkUser: (
    email: string,
    phone: string,
    country: string,
    fullName?: string
  ) => Promise<{ created: boolean }>;
  authenticate: (
    linkAuthIntentId: string,
    onCompletion: (result: {
      result: "success" | "abandoned" | "declined";
      crypto_customer_id?: string;
    }) => void
  ) => Promise<HTMLElement | null>;
  submitKycInfo: (params: any) => Promise<void>;
  verifyDocuments: () => Promise<{ result: "success" | "abandoned" }>;
  registerWalletAddress: (
    walletAddress: string,
    network: string
  ) => Promise<{ id: string; wallet_address: string; network: string }>;
  collectPaymentMethod: (
    options: {
      payment_method_types: string[];
      wallets: { applePay: string; googlePay: string };
    },
    onCompletion: (result: { cryptoPaymentToken: string }) => void
  ) => Promise<HTMLElement>;
  performCheckout: (
    onrampSessionId: string,
    checkout: (sessionId: string) => Promise<string>
  ) => Promise<{ successful: boolean }>;
  destroy: () => void;
};

export type UseStripeEmbeddedOnrampProps = {
  /** Buyer's email */
  email?: string;
  /** Buyer's phone (E.164) */
  phone?: string;
  /** Buyer's full/legal name */
  fullName?: string;
  /** Split contract address — final destination for funds */
  splitAddress?: string;
  /** Credit split contract address */
  splitAddressCredit?: string;
  /** USD amount to onramp */
  amount?: number;
  /** Fee minus mode enabled */
  feeMinusEnabled?: boolean;
  /** Debit Stripe fee component percentage (e.g. 2.9) */
  debitFeePct?: number;
  /** Credit Stripe fee component percentage (e.g. 3.9) */
  creditFeePct?: number;
  /** Total USD customer is charged */
  totalUsd?: number;
  /** Network for destination */
  network?: string;
  /** Destination currency */
  destinationCurrency?: string;
  /** Receipt ID for metadata */
  receiptId?: string;
  /** Merchant wallet for metadata */
  merchantWallet?: string;
  /** Brand key for metadata */
  brandKey?: string;
  /** Enable/disable */
  enabled?: boolean;
  /**
   * If the buyer is already connected with a Thirdweb wallet, pass their address here.
   * This skips the auth_endpoint wallet creation entirely — no extra OTP, no new wallet.
   */
  connectedWalletAddress?: string;
  /**
   * If the buyer is already connected, pass their active Thirdweb account object.
   * Enables automatic/manual signing fallback depending on wallet type.
   */
  connectedWallet?: any;
  /** Callbacks */
  onSuccess?: (result: { sessionId: string; txHash?: string }) => void;
  /** Error callback */
  onError?: (error: Error) => void;
  /** Step change callback */
  onStepChange?: (step: OnrampStep) => void;
  /** Card detected callback */
  onCardDetected?: (card: { funding: "credit" | "debit"; brand: string; last4: string } | null) => void;
  /** eCommerce mode flag */
  isEcommerceMode?: boolean;
};

export type UseStripeEmbeddedOnrampReturn = {
  /** Current step in the onramp flow */
  step: OnrampStep;
  /** Human-readable status message */
  statusMessage: string;
  /** Error message if any */
  error: string | null;
  /** The auth element to render (OTP modal) */
  authElement: HTMLElement | null;
  /** The payment method element to render */
  paymentElement: HTMLElement | null;
  /** Start the full onramp flow */
  startOnramp: (overrideEmail?: string, overridePhone?: string, overrideName?: string) => Promise<void>;
  /** Reset state */
  reset: () => void;
  /** Submit phone number to resume registration */
  submitPhone: (phoneNumber: string) => void;
  /** Submit KYC details to recover from missing_kyc error */
  submitKycInfo: (kycInfo: any) => Promise<void>;
  /** Whether the flow is actively running */
  isActive: boolean;
  /** The crypto customer ID after auth */
  cryptoCustomerId: string | null;
  /** The buyer's smart wallet address (deterministic from email) */
  buyerWalletAddress: string | null;
  /** Expose detected card funding type (credit vs. debit) */
  detectedCardFunding: "credit" | "debit" | null;
  /** Expose detected card brand */
  detectedCardBrand: string | null;
  /** Expose detected card last 4 digits */
  detectedCardLast4: string | null;
  /** The Stripe checkout session ID */
  sessionId: string | null;
};

const STEP_MESSAGES: Record<OnrampStep, string> = {
  idle: "Ready to start",
  initializing: "Initializing Stripe...",
  checking_link: "Checking account...",
  registering_link: "Creating account...",
  collecting_phone: "Enter phone number for Link...",
  authenticating: "Verifying identity...",
  exchanging_tokens: "Securing session...",
  checking_kyc: "Checking verification...",
  collecting_kyc: "Collecting identity info...",
  submitting_kyc: "Submitting identity info...",
  verifying_identity: "Verifying identity documents...",
  creating_wallet: "Setting up your wallet...",
  registering_wallet: "Registering wallet...",
  collecting_payment: "Select payment method...",
  creating_session: "Preparing transaction...",
  confirming_fees: "Reviewing payment fee...",
  checking_out: "Processing payment...",
  awaiting_funds: "Waiting for funds...",
  transferring: "Completing transfer...",
  completed: "Payment complete!",
  error: "Something went wrong",
};

// ─── Base USDC contract address ───
const BASE_USDC_ADDRESS = process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/**
 * Formats a phone number string to E.164 standard format.
 * E.164 format is: +[country_code][national_number] with no symbols, spaces, or dashes.
 * Defaults to "+1" (US/CA) if no country code prefix is present and length is 10 digits.
 */
export function formatToE164(phone: string, defaultCountryCode = "1"): string {
  if (!phone) return "";
  // Strip all non-digit characters except "+"
  let cleaned = phone.replace(/[^\d+]/g, "");

  // If already starts with "+", keep it
  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  // If starts with "00", replace with "+"
  if (cleaned.startsWith("00")) {
    return "+" + cleaned.slice(2);
  }

  // Handle standard 10-digit North American number
  if (cleaned.length === 10) {
    return `+${defaultCountryCode}${cleaned}`;
  }

  // Handle 11-digit starting with the default country code
  if (cleaned.length === 11 && cleaned.startsWith(defaultCountryCode)) {
    return `+${cleaned}`;
  }

  // Fallback: prepend "+"
  return `+${cleaned}`;
}

export function useStripeEmbeddedOnramp({
  email,
  phone,
  fullName,
  splitAddress,
  splitAddressCredit,
  amount,
  network = "base",
  destinationCurrency = "usdc",
  receiptId,
  merchantWallet,
  brandKey,
  enabled = true,
  connectedWalletAddress,
  connectedWallet,
  onSuccess,
  onError,
  onStepChange,
  onCardDetected,
  isEcommerceMode = false,
  feeMinusEnabled = false,
  debitFeePct = 0,
  creditFeePct = 0,
  totalUsd,
}: UseStripeEmbeddedOnrampProps): UseStripeEmbeddedOnrampReturn {
  const [step, setStep] = useState<OnrampStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [authElement, setAuthElement] = useState<HTMLElement | null>(null);
  const [paymentElement, setPaymentElement] = useState<HTMLElement | null>(null);
  const [cryptoCustomerId, setCryptoCustomerId] = useState<string | null>(() => {
    if (typeof window !== "undefined") return sessionStorage.getItem("stripe_onramp_customer_id");
    return null;
  });
  const [buyerWalletAddress, setBuyerWalletAddress] = useState<string | null>(() => {
    if (typeof window !== "undefined") return sessionStorage.getItem("stripe_onramp_buyer_wallet");
    return null;
  });
  const [localPhone, setLocalPhone] = useState<string>("");
  const [detectedCardFunding, setDetectedCardFunding] = useState<"credit" | "debit" | null>(null);
  const [detectedCardBrand, setDetectedCardBrand] = useState<string | null>(null);
  const [detectedCardLast4, setDetectedCardLast4] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(() => {
    if (typeof window !== "undefined") return sessionStorage.getItem("stripe_onramp_session_id");
    return null;
  });

  const onrampRef = useRef<OnrampCoordinator | null>(null);
  const mountedRef = useRef(true);
  const stepRef = useRef<OnrampStep>("idle");
  const oauthTokenRef = useRef<string | null>(null);
  const paymentTokenRef = useRef<string | null>(null);
  const verificationTokenRef = useRef<string | null>(null);
  const buyerAccountRef = useRef<any>(null);
  const isRunningRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const activeEmailRef = useRef<string | null>(null);
  const customerIdRef = useRef<string | null>(null);
  const buyerWalletRef = useRef<string | null>(null);
  const isVerifyingRef = useRef(false);
  const startOnrampRef = useRef<any>(null);
  const paymentRejectRef = useRef<any>(null);

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";

  const updateStep = useCallback((newStep: OnrampStep) => {
    if (!mountedRef.current) return;
    stepRef.current = newStep;
    setStep(newStep);
    onStepChange?.(newStep);
  }, [onStepChange]);

  useEffect(() => {
    mountedRef.current = true;

    // Restore refs from sessionStorage to survive page reloads/hot reloads
    if (typeof window !== "undefined") {
      const storedCustId = sessionStorage.getItem("stripe_onramp_customer_id");
      const storedToken = sessionStorage.getItem("stripe_onramp_oauth_token");
      const storedWallet = sessionStorage.getItem("stripe_onramp_buyer_wallet");
      const storedSessionId = sessionStorage.getItem("stripe_onramp_session_id");

      if (storedCustId) customerIdRef.current = storedCustId;
      if (storedToken) oauthTokenRef.current = storedToken;
      if (storedWallet) buyerWalletRef.current = storedWallet;
      if (storedSessionId) sessionIdRef.current = storedSessionId;
    }

    // Window message monitor to log security/OTP/3DS triggers inside the Stripe/Link iframes
    const handleWindowMessage = (e: MessageEvent) => {
      try {
        const isStripe = e.origin.includes("stripe.com") || e.origin.includes("link.com") || e.origin.includes("stripe.network");
        if (!isStripe) return;

        let msgData = e.data;
        if (typeof msgData === "string" && msgData.startsWith("{")) {
          msgData = JSON.parse(msgData);
        }

        const eventName = String(msgData?.event || msgData?.type || "").toLowerCase();
        const actionName = String(msgData?.action || "").toLowerCase();

        // Skip common layout/interaction/lifecycle events to avoid false-positive OTP logging
        if (
          eventName === "resize" || 
          eventName === "focus" || 
          eventName === "blur" || 
          eventName === "load" || 
          eventName === "ready" ||
          eventName === "change" ||
          eventName === "click" ||
          eventName === "parent" ||
          actionName === "resize"
        ) {
          return;
        }

        // Search for verification-related trigger keywords in action and event fields
        const isOtpTrigger = eventName.includes("otp") || 
                            eventName.includes("challenge") || 
                            eventName.includes("3ds") || 
                            eventName.includes("sms") || 
                            eventName.includes("code") ||
                            actionName.includes("otp") || 
                            actionName.includes("challenge") || 
                            actionName.includes("3ds") || 
                            actionName.includes("sms") || 
                            actionName.includes("code") ||
                            actionName.includes("verification") ||
                            actionName.includes("auth");

        const dataStr = JSON.stringify(msgData).toLowerCase();

        const isErrorPayload = dataStr.includes("error") || 
                              dataStr.includes("onramperror") || 
                              msgData?.$__rpc === "call-error" ||
                              msgData?.$__data?.name === "OnrampError";

        if (isErrorPayload && paymentRejectRef.current) {
          let errorMsg = "";
          let errorCode = "";
          if (msgData?.error) {
            errorMsg = msgData.error.message || msgData.error.code || "";
            errorCode = msgData.error.code || "";
          } else if (msgData?.$__data) {
            errorMsg = msgData.$__data.message || msgData.$__data.code || "";
            errorCode = msgData.$__data.code || "";
          } else if (typeof msgData === "object") {
            errorMsg = msgData.message || "";
            errorCode = msgData.code || "";
          }
          console.warn("[EMBEDDED ONRAMP] Iframe error payload identified. Rejecting active payment method collection promise:", errorMsg || errorCode);
          const err = new Error(errorMsg || "crypto_onramp_missing_minimum_identity_verification");
          (err as any).code = errorCode || "crypto_onramp_missing_minimum_identity_verification";
          const rejectFn = paymentRejectRef.current;
          paymentRejectRef.current = null;
          rejectFn(err);
        }

        if (isOtpTrigger && !isErrorPayload) {
          const currentStep = stepRef.current;
          console.warn("[STRIPE SDK MONITOR] Security/OTP trigger detected inside iframe:", {
            origin: e.origin,
            event: msgData?.event || msgData?.type || "unknown",
            action: msgData?.action || "unknown",
            status: msgData?.status || "unknown",
            step: currentStep
          });

          // Check if this is the second OTP (user is already logged in/has a customerId, and is in payment/checkout steps)
          const isSecondOtp = !!customerIdRef.current && (
            currentStep === "collecting_payment" ||
            currentStep === "checking_out" ||
            currentStep === "awaiting_funds"
          );

          if (isSecondOtp) {
            console.warn("[STRIPE SDK MONITOR] Second OTP / 3DS challenge identified. Logging to MongoDB...");

            const logPayload = {
              level: "error",
              type: "stripe_double_otp",
              errorId: "STRIPE_DOUBLE_OTP",
              message: `[STRIPE SECURE OTP] Double OTP or 3DS security challenge triggered. Step: ${currentStep}. Event: ${msgData?.event || msgData?.type || "unknown"}. Action: ${msgData?.action || "unknown"}. Status: ${msgData?.status || "unknown"}`,
              stack: JSON.stringify({
                eventPayload: msgData,
                origin: e.origin,
                currentStep,
                customerId: customerIdRef.current,
                sessionId: sessionIdRef.current,
                buyerWallet: buyerWalletRef.current,
                receiptId,
                brandKey
              }, null, 2),
              receiptId,
              wallet: buyerWalletRef.current || "anonymous",
              sessionId: sessionIdRef.current,
              host: window.location.host,
              userAgent: window.navigator.userAgent,
              ts: Date.now()
            };

            fetch("/api/portal/log", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(logPayload)
            }).catch(err => {
              console.error("[STRIPE SDK MONITOR] Failed to POST log to database:", err);
            });
          }
        }
      } catch {}
    };

    window.addEventListener("message", handleWindowMessage);

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      // Only intercept global KYC errors during active payment collection step
      if (stepRef.current !== "collecting_payment") {
        return;
      }
      const err = event.reason;
      const errMessage = String(err?.message || err || "").toLowerCase();
      if (errMessage.includes("identity verification") || errMessage.includes("verification_required") || errMessage.includes("kyc")) {
        event.preventDefault(); // Stop default browser console logging
        
        if (isVerifyingRef.current) {
          console.log("[EMBEDDED ONRAMP] Identity verification already in progress. Ignoring duplicate global event.");
          return;
        }
        
        console.log("[EMBEDDED ONRAMP] Intercepted identity verification requirement globally. Launching verifyDocuments...");
        isVerifyingRef.current = true;
        updateStep("verifying_identity");
        
        if (onrampRef.current) {
          const runVerify = async () => {
            try {
              const isTestMode = !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith("pk_test_");
              
              if (isTestMode) {
                console.log("[EMBEDDED ONRAMP] Submitting test KYC demographics globally...");
                await onrampRef.current!.submitKycInfo({
                  given_name: "John",
                  surname: "Verified",
                  date_of_birth: { day: 1, month: 1, year: 1901 },
                  address: {
                    line1: "address_full_match",
                    city: "Seattle",
                    state: "WA",
                    postal_code: "12345",
                    country: "US"
                  },
                  id_number: {
                    value: "000000000",
                    type: "us_ssn"
                  }
                });
              } else {
                console.log("[EMBEDDED ONRAMP] Live mode detected. Skipping mock demographics submission.");
              }
            } catch (kycSubmitErr: any) {
              console.warn("[EMBEDDED ONRAMP] Global submitKycInfo failed:", kycSubmitErr?.message);
              fetch("/api/portal/log", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  level: "warn",
                  message: `[EMBEDDED ONRAMP] Global submitKycInfo failed: ${kycSubmitErr?.message || kycSubmitErr}`,
                  meta: { error: String(kycSubmitErr?.stack || kycSubmitErr) }
                })
              }).catch(() => {});
            }
            return await onrampRef.current!.verifyDocuments();
          };

          runVerify()
            .then(async (res) => {
              console.log("[EMBEDDED ONRAMP] Global verifyDocuments completed:", res);
              isVerifyingRef.current = false;
              if (res.result === "abandoned") {
                handleError("Identity verification was abandoned");
                return;
              }

              console.log("[EMBEDDED ONRAMP] Document verification successful. Polling status...");
              updateStep("checking_kyc");
              let success = false;
              if (customerIdRef.current) {
                success = await pollKycStatus(customerIdRef.current);
              }
              
              if (!success) {
                handleError("Identity verification was not approved. Please try again.");
                return;
              }

              setPaymentElement(null);
              isRunningRef.current = false;
              if (startOnrampRef.current && activeEmailRef.current) {
                await startOnrampRef.current(activeEmailRef.current, undefined, undefined);
              }
            })
            .catch((verifyErr) => {
              console.error("[EMBEDDED ONRAMP] Global verifyDocuments error:", verifyErr);
              isVerifyingRef.current = false;
              handleError(verifyErr?.message || "Identity verification failed");
            });
        } else {
          isVerifyingRef.current = false;
          updateStep("collecting_payment");
        }
      }
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      mountedRef.current = false;
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("message", handleWindowMessage);
      try { onrampRef.current?.destroy(); } catch {}
    };
  }, [updateStep]);

  const handleError = useCallback((message: string, err?: any) => {
    if (!mountedRef.current) return;
    console.error(`[EMBEDDED ONRAMP] ${message}`, err);
    isRunningRef.current = false;
    setError(message);
    setAuthElement(null);
    setPaymentElement(null);
    if (onrampRef.current) {
      try {
        console.log("[EMBEDDED ONRAMP] Destroying onramp coordinator on error to remove lingering modals...");
        onrampRef.current.destroy();
      } catch (e) {
        console.warn("[EMBEDDED ONRAMP] Error destroying onramp on error:", e);
      }
      onrampRef.current = null;
    }
    updateStep("error");
    onError?.(new Error(message));
  }, [onError, updateStep]);

  const pollKycStatus = useCallback(async (custId: string): Promise<boolean> => {
    console.log("[EMBEDDED ONRAMP] Polling KYC status for completion...");
    for (let i = 0; i < 90; i++) {
      if (!mountedRef.current) return false;
      if (!isRunningRef.current) {
        console.log("[EMBEDDED ONRAMP] Polling aborted because run was stopped/reset.");
        return false;
      }
      let isRejected = false;
      try {
        const res = await fetch(`/api/stripe/crypto-customer/${encodeURIComponent(custId)}`, {
          headers: {
            "x-stripe-oauth-token": oauthTokenRef.current || "",
          },
        });
        if (res.ok) {
          const kycData = await res.json();
          console.log(`[EMBEDDED ONRAMP] Polled KYC status (attempt ${i + 1}/90): kycStatus=${kycData.kycStatus}, idDocStatus=${kycData.idDocStatus}`);
          
          const isKycRejected = kycData.kycStatus === "rejected" || kycData.kycStatus === "failed";
          const isDocRejected = kycData.idDocStatus === "rejected" || kycData.idDocStatus === "failed";
          
          if (isKycRejected || isDocRejected) {
            console.warn("[EMBEDDED ONRAMP] Identity verification failed or was rejected by Stripe.");
            isRejected = true;
          } else {
            const isKycApproved = kycData.kycStatus === "approved" || kycData.kycStatus === "verified" || kycData.kycStatus === "completed";
            const isDocApproved = kycData.idDocStatus === "approved" || kycData.idDocStatus === "verified" || kycData.idDocStatus === "completed";
            
            if (isKycApproved || isDocApproved) {
              console.log("[EMBEDDED ONRAMP] KYC status is approved on Stripe's end!");
              return true;
            }
          }
        }
      } catch (err) {
        console.warn("[EMBEDDED ONRAMP] Error polling KYC status:", err);
      }
      if (isRejected) {
        throw new Error("Identity verification was rejected. Please check your document and try again.");
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    console.warn("[EMBEDDED ONRAMP] Polling KYC status timed out after 180 seconds.");
    return false;
  }, []);

  const reset = useCallback(() => {
    if (onrampRef.current) {
      try {
        console.log("[EMBEDDED ONRAMP] Destroying onramp coordinator on reset...");
        onrampRef.current.destroy();
      } catch (e) {
        console.warn("[EMBEDDED ONRAMP] Error destroying onramp on reset:", e);
      }
      onrampRef.current = null;
    }
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("stripe_onramp_customer_id");
      sessionStorage.removeItem("stripe_onramp_oauth_token");
      sessionStorage.removeItem("stripe_onramp_buyer_wallet");
      sessionStorage.removeItem("stripe_onramp_session_id");
    }
    isRunningRef.current = false;
    stepRef.current = "idle";
    setStep("idle");
    setError(null);
    setAuthElement(null);
    setPaymentElement(null);
    setCryptoCustomerId(null);
    setBuyerWalletAddress(null);
    oauthTokenRef.current = null;
    paymentTokenRef.current = null;
    verificationTokenRef.current = null;
    sessionIdRef.current = null;
    setSessionId(null);
    activeEmailRef.current = null;
    customerIdRef.current = null;
    buyerWalletRef.current = null;
    setLocalPhone("");
    buyerAccountRef.current = null;
    setDetectedCardFunding(null);
    setDetectedCardBrand(null);
    setDetectedCardLast4(null);
    onCardDetected?.(null);
  }, [onCardDetected]);

  // ─── Create/retrieve Thirdweb EOA wallet for buyer email ───
  // Uses auth_endpoint strategy — no OTP (email already verified by Stripe Link)
  const createBuyerWallet = useCallback(async (buyerEmail: string): Promise<string | null> => {
    try {
      const { createThirdwebClient } = await import("thirdweb");
      const { inAppWallet } = await import("thirdweb/wallets");
      const { base } = await import("thirdweb/chains");

      let clientId = "";
      if (typeof window !== "undefined") {
        clientId = document.documentElement?.getAttribute("data-pp-thirdweb-client-id") || "";
      }
      if (!clientId) {
        const bKey = brandKey ? String(brandKey).trim().toUpperCase() : "";
        const envClientId = bKey ? process.env[`NEXT_PUBLIC_THIRDWEB_CLIENT_ID_${bKey}`] : undefined;
        clientId = envClientId || process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "";
      }

      const twClient = createThirdwebClient({
        clientId,
      });

      // Create in-app wallet with auth_endpoint strategy and EIP-7702 gasless sponsored mode!
      const wallet = inAppWallet({
        auth: {
          options: ["auth_endpoint" as any],
        },
        executionMode: {
          mode: "EIP7702",
          sponsorGas: true,
        },
      });

      // Connect using auth_endpoint — sends payload to our /api/auth/thirdweb-verify
      const account = await wallet.connect({
        client: twClient,
        chain: base,
        strategy: "auth_endpoint" as any,
        payload: JSON.stringify({
          email: buyerEmail,
          verificationToken: verificationTokenRef.current || "",
        }),
      });

      const address = account.address;
      console.log("[EMBEDDED ONRAMP] Guest EOA created/retrieved:", address?.slice(0, 10) + "...");

      buyerAccountRef.current = account;

      return address || null;
    } catch (err: any) {
      console.error("[EMBEDDED ONRAMP] Wallet creation failed:", err);
      return null;
    }
  }, []);

  // ─── Execute gasless USDC transfer from smart wallet → split contract ───
  const executeGaslessTransfer = useCallback(async (
    fromWalletEmail: string,
    toAddress: string,
    usdcAmount: number
  ): Promise<string | null> => {
    try {
      const { createThirdwebClient, getContract, prepareContractCall, sendTransaction, readContract } = await import("thirdweb");
      const { base } = await import("thirdweb/chains");

      let clientId = "";
      if (typeof window !== "undefined") {
        clientId = document.documentElement?.getAttribute("data-pp-thirdweb-client-id") || "";
      }
      if (!clientId) {
        const bKey = brandKey ? String(brandKey).trim().toUpperCase() : "";
        const envClientId = bKey ? process.env[`NEXT_PUBLIC_THIRDWEB_CLIENT_ID_${bKey}`] : undefined;
        clientId = envClientId || process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "";
      }

      const twClient = createThirdwebClient({
        clientId,
      });

      let account: any;

      if (buyerAccountRef.current) {
        console.log("[EMBEDDED ONRAMP] Using active guest EOA account (EIP-7702 mode):", buyerAccountRef.current.address);
        account = buyerAccountRef.current;
      } else {
        const { inAppWallet } = await import("thirdweb/wallets");
        // Re-connect the wallet as EOA with EIP-7702 gasless sponsored execution
        console.log("[EMBEDDED ONRAMP] Re-connecting guest EOA wallet for EIP-7702 gasless transfer...");
        const wallet = inAppWallet({
          auth: {
            options: ["auth_endpoint" as any],
          },
          executionMode: {
            mode: "EIP7702",
            sponsorGas: true,
          },
        });

        account = await wallet.connect({
          client: twClient,
          chain: base,
          strategy: "auth_endpoint" as any,
          payload: JSON.stringify({
            email: fromWalletEmail,
            verificationToken: verificationTokenRef.current || "",
            brandKey: brandKey || "",
          }),
        });
        console.log("[EMBEDDED ONRAMP] Guest EOA re-connected:", account.address);
      }

      // Prepare ERC-20 transfer: USDC has 6 decimals
      const usdcContract = getContract({
        client: twClient,
        chain: base,
        address: BASE_USDC_ADDRESS,
      });

      // Query the actual USDC balance in the wallet on-chain to handle decimals / dust/ slippage perfectly
      let balance = BigInt(0);
      try {
        balance = await readContract({
          contract: usdcContract,
          method: "function balanceOf(address account) view returns (uint256)",
          params: [account.address],
        });
        console.log(`[EMBEDDED ONRAMP] Target address: ${account.address}, USDC balance: ${balance.toString()}`);
      } catch (balErr) {
        console.warn("[EMBEDDED ONRAMP] Failed to query USDC balance on-chain:", balErr);
      }

      const requiredUnits = BigInt(Math.floor(usdcAmount * 1_000_000)); // 6 decimals
      
      // Sweep full balance only if balance is less than required (slippage/fee adjustment) or if guest smart wallet.
      // If balance is sufficient and they have personal funds, only transfer the requiredUnits to protect their extra balance.
      let amountInUnits = requiredUnits;
      if (balance > BigInt(0)) {
        if (balance < requiredUnits) {
          console.log(`[EMBEDDED ONRAMP] Balance ${balance.toString()} is less than required ${requiredUnits.toString()}. Sweeping full balance.`);
          amountInUnits = balance;
        } else {
          // If it's a guest smart wallet (buyerAccountRef was created deterministically), we can sweep everything to keep it clean.
          // But if it's a user's personal connected wallet (inAppWallet or EOA), we MUST only transfer requiredUnits to avoid taking their personal funds.
          const isGuestWallet = !connectedWallet;
          if (isGuestWallet) {
            console.log(`[EMBEDDED ONRAMP] Balance is sufficient: ${balance.toString()}. Sweeping guest wallet to clear dust.`);
            amountInUnits = balance;
          } else {
            console.log(`[EMBEDDED ONRAMP] Balance is sufficient: ${balance.toString()}. Transferring exactly required amount: ${requiredUnits.toString()}`);
            amountInUnits = requiredUnits;
          }
        }
      }

      const tx = prepareContractCall({
        contract: usdcContract,
        method: "function transfer(address to, uint256 amount) returns (bool)",
        params: [toAddress, amountInUnits],
      });

      console.log("[EMBEDDED ONRAMP] Preparing USDC transfer:", amountInUnits.toString(), "→", toAddress.slice(0, 10) + "...");

      const result = await sendTransaction({
        account,
        transaction: tx,
      });

      console.log("[EMBEDDED ONRAMP] ✓ Transfer complete, tx:", result.transactionHash);
      return result.transactionHash;
    } catch (err: any) {
      console.error("[EMBEDDED ONRAMP] Transfer failed:", err);
      return null;
    }
  }, []);

  const getOnrampAmount = useCallback((funding: "credit" | "debit" | null): number => {
    if (totalUsd !== undefined) {
      if (feeMinusEnabled) {
        const rate = funding === "credit" ? 3.5 : 2.25;
        return +(totalUsd / (1 + rate / 100)).toFixed(2);
      }
      const rate = funding === "credit" ? (creditFeePct ?? 0) : (debitFeePct ?? 0);
      return +(totalUsd - (totalUsd * rate / 100)).toFixed(2);
    }
    return amount || 0;
  }, [totalUsd, debitFeePct, creditFeePct, amount, feeMinusEnabled]);

  const createSessionHelper = useCallback(async (
    customerId: string,
    pmToken: string,
    buyerWallet: string,
    overrideAmount?: number
  ): Promise<{ sessionId: string; paymentDetails: any; paymentMethod?: string | null } | null> => {
    updateStep("creating_session");
    
    const execute = async (amt?: number): Promise<{ sessionId: string; paymentDetails: any; paymentMethod?: string | null } | null> => {
      try {
        const sessionRes = await fetch("/api/stripe/onramp-session-v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cryptoCustomerId: customerId,
            cryptoPaymentToken: pmToken,
            sourceAmount: amt ?? amount,
            sourceCurrency: "usd",
            destinationCurrency,
            destinationNetwork: network,
            walletAddress: buyerWallet,
            oauthToken: oauthTokenRef.current,
            receiptId,
            merchantWallet,
            brandKey,
            splitMode: isDualSplitEnabled() ? "dual" : "single",
          }),
        });

        if (!sessionRes.ok) {
          const errData = await sessionRes.json().catch(() => ({}));
          const errMessage = String(errData.error || "").toLowerCase();
          const errCode = String(errData.code || "").toLowerCase();

          if (
            errMessage.includes("verification") || 
            errMessage.includes("kyc") || 
            errCode.includes("verification") || 
            errCode.includes("kyc")
          ) {
            console.log("[EMBEDDED ONRAMP] Document verification required during session creation. Launching verifyDocuments...");
            updateStep("verifying_identity");
            if (!onrampRef.current) throw new Error("Onramp coordinator not initialized");
            
            try {
              isVerifyingRef.current = true;
              await onrampRef.current.verifyDocuments();
              isVerifyingRef.current = false;
              console.log("[EMBEDDED ONRAMP] Document verification completed. Retrying session creation...");
              return await execute(amt);
            } catch (verifyErr: any) {
              isVerifyingRef.current = false;
              throw new Error(verifyErr?.message || "Identity verification failed or was cancelled");
            }
          } else {
            throw new Error(errData.error || "Session creation failed");
          }
        }

        const successData = await sessionRes.json().catch(() => ({}));
        if (!successData.id) {
          throw new Error("No session ID returned");
        }
        return {
          sessionId: successData.id,
          paymentDetails: successData.paymentDetails,
          paymentMethod: successData.paymentMethod,
        };
      } catch (err: any) {
        handleError(err?.message || "Session creation failed");
        return null;
      }
    };

    return execute(overrideAmount);
  }, [
    amount,
    destinationCurrency,
    network,
    receiptId,
    merchantWallet,
    brandKey,
    updateStep,
    handleError
  ]);

  const postCheckoutHandler = useCallback(async (
    sessionId: string,
    activeEmail: string,
    overrideFunding?: "credit" | "debit" | null
  ) => {
    const fundingTypeToUse = overrideFunding !== undefined ? overrideFunding : detectedCardFunding;
    console.log("[EMBEDDED ONRAMP] Checking eCommerce mode before Step 11. isEcommerceMode:", isEcommerceMode, "fundingTypeToUse:", fundingTypeToUse);
    if (isEcommerceMode) {
      console.log("[EMBEDDED ONRAMP] eCommerce mode active. Launching background task and completing client flow.");
      fetch("/api/stripe/background-poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          receiptId,
          merchantWallet,
          email: activeEmail,
          amount: getOnrampAmount(fundingTypeToUse),
          splitAddress,
          splitAddressCredit,
          brandKey,
          detectedCardFunding: fundingTypeToUse,
        }),
      }).catch((err) => {
        console.error("[EMBEDDED ONRAMP] Failed to kick off background poll:", err);
      });

      isRunningRef.current = false;
      updateStep("completed");
      onSuccess?.({ sessionId, txHash: "ecommerce_pending" });
      return;
    }

    updateStep("awaiting_funds");

    let fundsDelivered = false;
    let isCreditCard = false;
    console.log(`[EMBEDDED ONRAMP] Starting to poll status for session: ${sessionId}`);
    for (let poll = 0; poll < 60; poll++) {
      await new Promise(r => setTimeout(r, 5000));
      if (!mountedRef.current) return;

      try {
        const statusHeaders: any = {
          "x-stripe-oauth-token": oauthTokenRef.current || "",
        };
        if (customerIdRef.current) {
          statusHeaders["x-crypto-customer-id"] = customerIdRef.current;
        }
        const statusRes = await fetch(`/api/stripe/onramp-status?sessionId=${encodeURIComponent(sessionId)}`, {
          headers: statusHeaders
        });
        if (!statusRes.ok) {
          console.warn(`[EMBEDDED ONRAMP] Status endpoint returned error status: ${statusRes.status}`);
          continue;
        }
        const statusData = await statusRes.json();
        if (statusData.refreshedToken) {
          console.log("[EMBEDDED ONRAMP] Status poll returned refreshed OAuth token, updating ref...");
          oauthTokenRef.current = statusData.refreshedToken;
          if (typeof window !== "undefined") {
            sessionStorage.setItem("stripe_onramp_oauth_token", statusData.refreshedToken);
          }
        }
        console.log(`[EMBEDDED ONRAMP] Polled status (attempt ${poll + 1}):`, statusData?.status, statusData);

        if (statusData && statusData.status === "fulfillment_complete") {
          fundsDelivered = true;
          const method = statusData.paymentMethod || null;
          const funding = statusData.paymentDetails?.card?.funding || null;
          const resolvedFunding = funding || detectedCardFunding || (method === "debit_card" ? "debit" : null);
          isCreditCard = resolvedFunding === "credit" || resolvedFunding === null;
          console.log("[EMBEDDED ONRAMP] ✓ USDC delivered to buyer's smart wallet. Credit card:", isCreditCard, "Resolved funding:", resolvedFunding);
          break;
        }
      } catch (pollErr) {
        console.warn("[EMBEDDED ONRAMP] Exception while polling status:", pollErr);
      }
    }

    if (!fundsDelivered) {
      handleError("Timed out waiting for funds delivery");
      return;
    }

    if (!mountedRef.current) return;

    updateStep("transferring");

    const targetSplitAddress = (isCreditCard || fundingTypeToUse === "credit")
      ? (splitAddress || "")
      : (splitAddressCredit || splitAddress || "");

    const finalAmount = getOnrampAmount(fundingTypeToUse || (isCreditCard ? "credit" : "debit"));
    const txHash = await executeGaslessTransfer(activeEmail, targetSplitAddress, finalAmount);

    if (!txHash) {
      handleError("Failed to transfer funds to merchant");
      return;
    }

    isRunningRef.current = false;
    updateStep("completed");
    onSuccess?.({ sessionId, txHash });
  }, [
    isEcommerceMode,
    receiptId,
    merchantWallet,
    amount,
    splitAddress,
    splitAddressCredit,
    brandKey,
    detectedCardFunding,
    updateStep,
    onSuccess,
    handleError,
    executeGaslessTransfer,
    getOnrampAmount
  ]);

  const runCheckoutLoop = useCallback(async (
    activeEmail: string,
    customerId: string,
    pmToken: string,
    buyerWallet: string,
    initialFunding?: "credit" | "debit" | null
  ) => {
    updateStep("checking_out");
    isRunningRef.current = true;

    const MAX_ATTEMPTS = 5;
    let checkoutSucceeded = false;
    let resolvedFunding = initialFunding || detectedCardFunding || null;

    let currentSessionId = sessionIdRef.current;
    if (!currentSessionId) {
      const initialAmount = getOnrampAmount(initialFunding || null);
      const sessionResult = await createSessionHelper(customerId, pmToken, buyerWallet, initialAmount);
      if (!sessionResult) return;
      currentSessionId = sessionResult.sessionId;
      sessionIdRef.current = currentSessionId;
      setSessionId(currentSessionId);
      if (typeof window !== "undefined") {
        sessionStorage.setItem("stripe_onramp_session_id", currentSessionId);
      }

      const hasCardInfo = !!(sessionResult.paymentDetails?.card || sessionResult.paymentMethod);
      if (hasCardInfo) {
        const funding = sessionResult.paymentDetails?.card?.funding || null;
        const brand = sessionResult.paymentDetails?.card?.brand || null;
        const last4 = sessionResult.paymentDetails?.card?.last4 || null;
        const method = sessionResult.paymentMethod || null;
        
        const isDebit = method === "debit_card" || funding === "debit" || funding === "prepaid";
        const fundingType = isDebit ? "debit" : "credit";
        resolvedFunding = fundingType;
        setDetectedCardFunding(fundingType);
        if (brand) setDetectedCardBrand(brand);
        if (last4) setDetectedCardLast4(last4);
        onCardDetected?.({ funding: fundingType, brand: brand || "", last4: last4 || "" });
        
        console.log(`[EMBEDDED ONRAMP] Card detected: method=${method}, funding=${funding}, brand=${brand} (${last4}). Pausing for fee review.`);

        const targetAmount = getOnrampAmount(fundingType);
        if (targetAmount !== initialAmount) {
          console.log(`[EMBEDDED ONRAMP] ${fundingType} card detected. Re-creating session with target amount: ${targetAmount} (was ${initialAmount})`);
          const newSessionResult = await createSessionHelper(customerId, pmToken, buyerWallet, targetAmount);
          if (!newSessionResult) return;
          currentSessionId = newSessionResult.sessionId;
          sessionIdRef.current = currentSessionId;
          setSessionId(currentSessionId);
          if (typeof window !== "undefined") {
            sessionStorage.setItem("stripe_onramp_session_id", currentSessionId);
          }
        }
        
        updateStep("confirming_fees");
        await new Promise(r => setTimeout(r, 2500));
        if (!mountedRef.current) return;
      }
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        if (!onrampRef.current) throw new Error("Onramp coordinator not initialized");

        const result = await onrampRef.current.performCheckout(currentSessionId, async (onrampSessionId: string) => {
          const checkoutRes = await fetch(`/api/stripe/onramp-checkout/${encodeURIComponent(onrampSessionId)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              oauthToken: oauthTokenRef.current,
              cryptoCustomerId: customerId,
            }),
          });

          const checkoutData = await checkoutRes.json();

          if (checkoutData.refreshedToken) {
            console.log("[EMBEDDED ONRAMP] Checkout returned refreshed OAuth token, updating ref...");
            oauthTokenRef.current = checkoutData.refreshedToken;
            if (typeof window !== "undefined") {
              sessionStorage.setItem("stripe_onramp_oauth_token", checkoutData.refreshedToken);
            }
          }

          if (!checkoutData.client_secret) {
            // If the checkout is already in a final successful state, we don't need a client_secret.
            // Return empty string to let Stripe SDK performCheckout know the flow is complete.
            const isFinalStatus = ["awaiting_funds", "fulfillment_processing", "fulfillment_complete"].includes(checkoutData.status);
            if (checkoutData.ok !== false && isFinalStatus) {
              console.log("[EMBEDDED ONRAMP] Checkout completed with status:", checkoutData.status);
              return "";
            }
            throw new Error(checkoutData.error || "No client_secret returned");
          }

          return checkoutData.client_secret;
        });

        if (result.successful) {
          checkoutSucceeded = true;
          break;
        } else {
          throw new Error("checkout_unsuccessful");
        }
      } catch (checkoutErr: any) {
        console.warn(`[EMBEDDED ONRAMP] Checkout attempt ${attempt + 1} failed, checking error state...`, checkoutErr);
        
        try {
          const statusHeaders: any = {
            "x-stripe-oauth-token": oauthTokenRef.current || "",
          };
          if (customerId) {
            statusHeaders["x-crypto-customer-id"] = customerId;
          }
          const statusRes = await fetch(`/api/stripe/onramp-status?sessionId=${encodeURIComponent(currentSessionId)}`, {
            headers: statusHeaders
          });
          const statusData = await statusRes.json();

          // Short-circuit: If the transaction is already successful, do not retry checkout
          const isFinalStatus = ["awaiting_funds", "fulfillment_processing", "fulfillment_complete"].includes(statusData.status);
          if (statusData.ok !== false && isFinalStatus) {
            console.log("[EMBEDDED ONRAMP] Transaction was already authorized/succeeded. Completing checkout flow.");
            checkoutSucceeded = true;
            break;
          }

          if (statusData.refreshedToken) {
            console.log("[EMBEDDED ONRAMP] Status check returned refreshed OAuth token, updating ref...");
            oauthTokenRef.current = statusData.refreshedToken;
          }
          const lastError = statusData.transactionDetails?.last_error;

          console.log(`[EMBEDDED ONRAMP] Inspecting lastError from session status:`, lastError);

          const errMessage = String(checkoutErr?.message || "").toLowerCase();
          const errCode = String(checkoutErr?.code || "").toLowerCase();
          const isKycError = errMessage.includes("identity verification") || 
                             errMessage.includes("verification_required") || 
                             errMessage.includes("kyc") ||
                             errCode.includes("identity_verification") ||
                             errCode.includes("kyc") ||
                             errCode === "crypto_onramp_missing_minimum_identity_verification";

          if (
            isKycError || 
            lastError === "missing_kyc" || 
            lastError === "missing_document_verification" ||
            lastError === "crypto_onramp_missing_minimum_identity_verification"
          ) {
            if (isVerifyingRef.current) {
              console.log("[EMBEDDED ONRAMP] Verification already in progress. Awaiting completion...");
              while (isVerifyingRef.current) {
                await new Promise(r => setTimeout(r, 500));
              }
              console.log("[EMBEDDED ONRAMP] Verification completed/closed. Retrying checkout...");
              updateStep("checking_out");
              continue;
            } else {
              console.log("[EMBEDDED ONRAMP] KYC/Identity verification required during checkout. Launching verifyDocuments...");
              isVerifyingRef.current = true;
              updateStep("verifying_identity");
              
              if (!onrampRef.current) throw new Error("Onramp coordinator not initialized");
              
              try {
                const verifyResult = await onrampRef.current.verifyDocuments();
                isVerifyingRef.current = false;
                if (verifyResult.result === "abandoned") {
                  handleError("Identity verification was abandoned");
                  return;
                }
                console.log("[EMBEDDED ONRAMP] Document verification successful. Polling status...");
                updateStep("checking_kyc");
                const kycApproved = await pollKycStatus(customerId);
                if (!kycApproved) {
                  throw new Error("Identity verification was not approved. Please try again.");
                }
                console.log("[EMBEDDED ONRAMP] Document verification successful, retrying checkout...");
                updateStep("checking_out");
                continue;
              } catch (verifyErr: any) {
                isVerifyingRef.current = false;
                handleError(verifyErr?.message || "Identity verification failed");
                return;
              }
            }
          } else if (lastError === "missing_consumer_wallet") {
            console.log("[EMBEDDED ONRAMP] Wallet not registered. Attempting wallet registration...");
            updateStep("registering_wallet");
            if (!onrampRef.current) throw new Error("Onramp coordinator not initialized");
            
            try {
              await onrampRef.current.registerWalletAddress(buyerWallet, network);
              console.log("[EMBEDDED ONRAMP] Wallet registered successfully, retrying checkout...");
              updateStep("checking_out");
              continue;
            } catch (regErr: any) {
              handleError(regErr?.message || "Wallet registration failed during recovery");
              return;
            }
          } else if (lastError === "charged_with_expired_quote") {
            console.log("[EMBEDDED ONRAMP] Quote expired. Refreshing quote...");
            updateStep("creating_session");
            try {
              const refreshRes = await fetch("/api/stripe/onramp-quote-refresh", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sessionId: currentSessionId,
                  oauthToken: oauthTokenRef.current,
                }),
              });
              if (!refreshRes.ok) {
                const refreshErrData = await refreshRes.json().catch(() => ({}));
                throw new Error(refreshErrData.error || "Failed to refresh quote");
              }
              console.log("[EMBEDDED ONRAMP] Quote refreshed successfully, retrying checkout...");
              updateStep("checking_out");
              continue;
            } catch (refreshErr: any) {
              handleError(refreshErr?.message || "Quote refresh failed");
              return;
            }
          } else if (lastError === "quote_rate_drifted") {
            console.log("[EMBEDDED ONRAMP] Quote rate drifted. Recreating session with fresh quote...");
            sessionIdRef.current = null;
            setSessionId(null);
            const targetAmount = getOnrampAmount(detectedCardFunding);
            const sessionResult = await createSessionHelper(customerId, pmToken, buyerWallet, targetAmount);
            if (!sessionResult) return;
            currentSessionId = sessionResult.sessionId;
            sessionIdRef.current = currentSessionId;
            setSessionId(currentSessionId);
            console.log("[EMBEDDED ONRAMP] New session created with fresh quote. Retrying checkout...");
            updateStep("checking_out");
            continue;
          } else if (
            lastError === "transaction_limit_reached" ||
            lastError === "location_not_supported" ||
            lastError === "transaction_failed"
          ) {
            handleError(`Transaction failed with error: ${lastError}`);
            return;
          }
        } catch (statusErr: any) {
          console.warn("[EMBEDDED ONRAMP] Failed to fetch session status after checkout error:", statusErr);
        }

        if (attempt === MAX_ATTEMPTS - 1) {
          handleError(checkoutErr?.message || "Checkout failed after max attempts");
          return;
        }
      }
    }

    if (!checkoutSucceeded || !mountedRef.current) {
      isRunningRef.current = false;
      return;
    }

    await postCheckoutHandler(currentSessionId, activeEmail, resolvedFunding);
  }, [
    createSessionHelper,
    postCheckoutHandler,
    network,
    updateStep,
    handleError,
    onCardDetected,
    getOnrampAmount,
    detectedCardFunding
  ]);

  const submitKycInfo = useCallback(async (kycInfo: any) => {
    if (!onrampRef.current) {
      throw new Error("Onramp not initialized");
    }
    console.log("[EMBEDDED ONRAMP] Submitting KYC info...");
    updateStep("submitting_kyc");
    isRunningRef.current = true;
    try {
      await onrampRef.current.submitKycInfo(kycInfo);
      console.log("[EMBEDDED ONRAMP] KYC demographics submitted successfully! Checking if document verification is needed...");
      
      const checkRes = await fetch(`/api/stripe/crypto-customer/${encodeURIComponent(customerIdRef.current || "")}`, {
        headers: {
          "x-stripe-oauth-token": oauthTokenRef.current || "",
        },
      });

      if (!mountedRef.current) return;

      let needsDocumentVerify = false;
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        console.log("[EMBEDDED ONRAMP] KYC status after demographics submission:", checkData);
        needsDocumentVerify = checkData.kycStatus === "requires_action" ||
                              checkData.kycStatus === "failed" ||
                              checkData.idDocStatus === "requires_action" ||
                              checkData.idDocStatus === "failed" ||
                              checkData.idDocStatus === "rejected";
      }

      if (needsDocumentVerify) {
        console.log("[EMBEDDED ONRAMP] L2 document verification is required. Launching verifyDocuments...");
        updateStep("verifying_identity");
        const verifyResult = await onrampRef.current.verifyDocuments();
        if (verifyResult.result === "abandoned") {
          handleError("Identity verification was abandoned");
          return;
        }
        console.log("[EMBEDDED ONRAMP] L2 document flow completed by user. Polling for approval status...");
        updateStep("checking_kyc");
        const kycApproved = await pollKycStatus(customerIdRef.current || "");
        if (!kycApproved) {
          throw new Error("Identity verification was not approved. Please try again.");
        }
      }

      console.log("[EMBEDDED ONRAMP] KYC check passed! Resuming checkout flow...");
      if (activeEmailRef.current && customerIdRef.current && buyerWalletRef.current) {
        if (paymentTokenRef.current) {
          runCheckoutLoop(
            activeEmailRef.current,
            customerIdRef.current,
            paymentTokenRef.current,
            buyerWalletRef.current,
            detectedCardFunding
          ).catch((err) => {
            handleError(err?.message || "Checkout failed after KYC submission");
          });
        } else {
          // Reset isRunning flag so startOnramp can start again
          // Reset isRunning flag so startOnramp can start again
          isRunningRef.current = false;
          if (startOnrampRef.current) {
            startOnrampRef.current(activeEmailRef.current).catch((err: any) => {
              handleError(err?.message || "Flow resumption failed after KYC submission");
            });
          }
        }
      } else {
        throw new Error("Missing checkout state to resume flow");
      }
    } catch (err: any) {
      console.error("[EMBEDDED ONRAMP] KYC submission failed:", err);
      handleError(err?.message || "KYC submission failed");
      throw err;
    }
  }, [updateStep, handleError, runCheckoutLoop, pollKycStatus, detectedCardFunding]);

  const startOnramp = useCallback(async (overrideEmail?: string, overridePhone?: string, overrideName?: string) => {
    if (isRunningRef.current) {
      console.warn("[EMBEDDED ONRAMP] Onramp flow is already running. Ignoring duplicate trigger.");
      return;
    }
    isRunningRef.current = true;
    console.log("[EMBEDDED ONRAMP] startOnramp triggered. isEcommerceMode prop:", isEcommerceMode, "window.location.search:", typeof window !== "undefined" ? window.location.search : "SSR");

    const activeEmail = overrideEmail || email;
    let activePhone = overridePhone || phone || localPhone;
    if (activePhone && activePhone.includes("*")) {
      activePhone = "";
    }
    const activeName = overrideName || fullName;
    const formattedPhone = activePhone ? formatToE164(activePhone) : "";

    if (!enabled || !activeEmail || !splitAddress || !publishableKey) {
      handleError("Missing required fields (email, split address, or API key)");
      return;
    }

    if (!amount || amount <= 0) {
      handleError("Invalid amount");
      return;
    }

    try {
      let onramp = onrampRef.current;
      let customerId = customerIdRef.current;
      let buyerWallet = buyerWalletRef.current;

      if (onramp && customerId && oauthTokenRef.current && buyerWallet) {
        console.log("[EMBEDDED ONRAMP] Reusing active authenticated onramp coordinator and customer session:", customerId);
      } else {
        if (onrampRef.current) {
          try {
            console.log("[EMBEDDED ONRAMP] Destroying previous stale onramp coordinator instance...");
            onrampRef.current.destroy();
          } catch (e) {
            console.warn("[EMBEDDED ONRAMP] Error destroying previous onramp instance:", e);
          }
          onrampRef.current = null;
        }

        // ─── Step 1: Initialize Stripe SDK with native Dark theme ───
        // @ts-ignore - beta SDK method missing from types
        const stripeCryptoModule = (await import("@stripe/crypto")) as any;
        const loadCryptoOnrampAndInitialize = stripeCryptoModule.loadCryptoOnrampAndInitialize || stripeCryptoModule.loadStripeOnramp;

        onramp = await loadCryptoOnrampAndInitialize(publishableKey, {
          theme: "dark",
          wallets: {
            applePay: "auto",
            googlePay: "auto",
          },
        });

        if (!mountedRef.current) return;
        onrampRef.current = onramp as unknown as OnrampCoordinator;
      }

      if (!onramp) {
        handleError("Stripe Onramp not initialized");
        return;
      }

      let authIntentId = "";

      if (!customerId || !oauthTokenRef.current || !buyerWallet) {
        // ─── Step 2: Check for Link account ───
        updateStep("checking_link");

        const linkRes = await fetch("/api/stripe/link-auth-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: activeEmail }),
        });

        if (!mountedRef.current) return;

        if (linkRes.status === 404) {
        // No Link account — register
        if (!formattedPhone) {
          console.log("[EMBEDDED ONRAMP] Fresh Link account detected, but no phone number provided. Transitioning to collecting_phone.");
          isRunningRef.current = false;
          updateStep("collecting_phone");
          return;
        }

        updateStep("registering_link");

        try {
          console.log("[EMBEDDED ONRAMP] Registering Link user with formatted phone:", formattedPhone);
          const registerResult = await onramp.registerLinkUser(
            activeEmail,
            formattedPhone,
            "US",
            activeName ? activeName.trim() : undefined
          );

          if (!registerResult.created) {
            throw new Error("Registration returned created: false");
          }
        } catch (regErr: any) {
          console.warn("[EMBEDDED ONRAMP] Link registration failed, asking for phone number:", regErr);
          isRunningRef.current = false;
          updateStep("collecting_phone");
          return;
        }

        const retryRes = await fetch("/api/stripe/link-auth-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: activeEmail }),
        });

        if (!retryRes.ok) {
          const retryData = await retryRes.json();
          handleError(retryData.error || "Failed to create auth intent after registration");
          return;
        }

        const retryData = await retryRes.json();
        authIntentId = retryData.authIntentId;
      } else if (linkRes.ok) {
        const linkData = await linkRes.json();
        authIntentId = linkData.authIntentId;
      } else {
        const linkData = await linkRes.json();
        handleError(linkData.error || "Link auth check failed");
        return;
      }

      if (!mountedRef.current) return;

      // ─── Step 3: Authenticate via Stripe Link (buyer does OTP here) ───
      updateStep("authenticating");

      const authPromise = new Promise<string>((resolve, reject) => {
        onramp.authenticate(authIntentId, (result: any) => {
          if (result.result === "success" && result.crypto_customer_id) {
            resolve(result.crypto_customer_id);
          } else if (result.result === "abandoned") {
            reject(new Error("Authentication cancelled"));
          } else if (result.result === "declined") {
            reject(new Error("OAuth consent declined"));
          } else {
            reject(new Error("Authentication failed"));
          }
        }).then((element: HTMLElement | null) => {
          if (element && mountedRef.current) {
            setAuthElement(element);
          }
        });
      });

      customerId = await authPromise;
      if (!mountedRef.current) return;

      setCryptoCustomerId(customerId);
      customerIdRef.current = customerId;
      if (typeof window !== "undefined") {
        sessionStorage.setItem("stripe_onramp_customer_id", customerId);
      }
      setAuthElement(null);

      // ─── Step 4: Exchange tokens ───
      updateStep("exchanging_tokens");

      const tokenRes = await fetch("/api/stripe/link-auth-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authIntentId,
          cryptoCustomerId: customerId,
        }),
      });

      if (!tokenRes.ok) {
        const tokenData = await tokenRes.json();
        handleError(tokenData.error || "Token exchange failed");
        return;
      }

      const tokenData = await tokenRes.json();
      oauthTokenRef.current = tokenData.accessToken;
      if (typeof window !== "undefined") {
        sessionStorage.setItem("stripe_onramp_oauth_token", tokenData.accessToken);
      }

      if (!mountedRef.current) return;

      // ─── Step 5: Cryptographically verify email via Stripe Link Session Token ───
      const markRes = await fetch("/api/auth/mark-verified", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: activeEmail,
          customerId,
          oauthToken: oauthTokenRef.current,
          brandKey: brandKey || "",
        }),
      });

      if (!markRes.ok) {
        const markData = await markRes.json();
        handleError(markData.error || "Secure email verification failed");
        return;
      }

      const markData = await markRes.json();
      verificationTokenRef.current = markData.verificationToken;
      console.log("[EMBEDDED ONRAMP] SECURE: Email verification token retrieved successfully");

      // ─── Step 6: Create/resolve Thirdweb Guest Wallet safely ───
      updateStep("creating_wallet");

      // Always create/use the guest EOA wallet for Stripe Onramp to ensure gasless execution and server-side recovery
      const createdWallet = await createBuyerWallet(activeEmail);

      if (!createdWallet) {
        handleError("Failed to create buyer wallet");
        return;
      }

      buyerWallet = createdWallet;
      console.log("[EMBEDDED ONRAMP] Created/retrieved guest EOA wallet:", buyerWallet);

      try {
        fetch("/api/users/profile", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-wallet": buyerWallet,
            ...(brandKey ? { "x-brand-key": brandKey } : {}),
          },
          body: JSON.stringify({
            wallet: buyerWallet,
            contact: {
              email: activeEmail,
            },
          }),
        }).then(res => {
          if (res.ok) {
            console.log("[EMBEDDED ONRAMP] Email linked to guest EOA profile successfully:", activeEmail);
          }
        }).catch(err => {
          console.warn("[EMBEDDED ONRAMP] Failed to link email to guest EOA profile:", err);
        });
      } catch (linkErr) {
        console.warn("[EMBEDDED ONRAMP] Error in profile link attempt for guest wallet:", linkErr);
      }

      setBuyerWalletAddress(buyerWallet);
      buyerWalletRef.current = buyerWallet;
      if (typeof window !== "undefined") {
        sessionStorage.setItem("stripe_onramp_buyer_wallet", buyerWallet);
      }
      }

      // ─── Step 6b: Check KYC ───
      activeEmailRef.current = activeEmail;
      customerIdRef.current = customerId;
      buyerWalletRef.current = buyerWallet;

      updateStep("checking_kyc");

      const kycRes = await fetch(`/api/stripe/crypto-customer/${encodeURIComponent(customerId)}`, {
        headers: {
          "x-stripe-oauth-token": oauthTokenRef.current || "",
        },
      });

      if (!mountedRef.current) return;

      if (kycRes.ok) {
        const kycData = await kycRes.json();

        const needsKycSubmit = kycData.kycStatus === "not_started" ||
                               kycData.kycStatus === "requires_action" ||
                               kycData.kycStatus === "failed" ||
                               kycData.kycStatus === "rejected" ||
                               kycData.idDocStatus === "failed" ||
                               kycData.idDocStatus === "rejected";

        if (needsKycSubmit) {
          console.log("[EMBEDDED ONRAMP] Demographics KYC submission required. Transitioning to collecting_kyc.");
          updateStep("collecting_kyc");
          isRunningRef.current = false; // allow starting onramp again to resume
          return;
        }

        const needsDocumentVerify = kycData.kycStatus === "requires_action" ||
                                   kycData.kycStatus === "failed" ||
                                   kycData.idDocStatus === "requires_action" ||
                                   kycData.idDocStatus === "failed" ||
                                   kycData.idDocStatus === "rejected";

        if (needsDocumentVerify && onramp) {
          console.log("[EMBEDDED ONRAMP] Proactive KYC document verification required. Launching verifyDocuments...");
          updateStep("verifying_identity");
          try {
            const verifyResult = await onramp.verifyDocuments();
            if (verifyResult.result === "abandoned") {
              handleError("Identity verification was abandoned");
              return;
            }
            console.log("[EMBEDDED ONRAMP] Proactive document verification complete. Polling for approval status...");
            updateStep("checking_kyc");
            const kycApproved = await pollKycStatus(customerId);
            if (!kycApproved) {
              throw new Error("Identity verification was not approved. Please try again.");
            }
          } catch (verifyErr: any) {
            handleError(verifyErr?.message || "Identity verification failed");
            return;
          }
        }
      }

      // ─── Step 7: Register buyer's wallet with Stripe ───
      updateStep("registering_wallet");

      try {
        await onramp.registerWalletAddress(buyerWallet, network);
        console.log("[EMBEDDED ONRAMP] Buyer wallet registered with Stripe:", buyerWallet.slice(0, 10) + "...");
      } catch (walletErr: any) {
        console.log("[EMBEDDED ONRAMP] Wallet registration (may already exist):", walletErr?.message);
      }

      if (!mountedRef.current) return;

      // ─── Step 8: Collect payment method ───
      updateStep("collecting_payment");

      const paymentPromise = new Promise<{ token: string; funding: "credit" | "debit" | null; brand: string; last4: string }>((resolve, reject) => {
        paymentRejectRef.current = reject;

        onramp.collectPaymentMethod(
          {
            payment_method_types: ["card"],
            wallets: { applePay: "auto", googlePay: "auto" },
          },
          (result: any) => {
            console.log("[EMBEDDED ONRAMP] collectPaymentMethod callback result:", result);
            if (result) {
              const newToken = result.oauthToken || 
                               result.accessToken || 
                               result.oauth_token || 
                               result.access_token ||
                               result.paymentDetails?.oauthToken ||
                               result.paymentDetails?.accessToken ||
                               result.paymentMethod?.oauthToken ||
                               result.payment_details?.oauthToken;
              if (newToken) {
                console.log("[EMBEDDED ONRAMP] Updated OAuth token detected in collectPaymentMethod result:", newToken.slice(0, 10) + "...");
                oauthTokenRef.current = newToken;
                if (typeof window !== "undefined") {
                  sessionStorage.setItem("stripe_onramp_oauth_token", newToken);
                }
              }
            }
            if (result.cryptoPaymentToken) {
              let fundingType: "credit" | "debit" | null = null;
              let brandStr = "";
              let last4Str = "";
              
              const details = result.paymentDetails || result.payment_details || result;
              const card = details?.card || details?.payment_method_details?.card;
              if (card) {
                const isDebit = card.funding === "debit" || card.funding === "prepaid";
                fundingType = isDebit ? "debit" : "credit";
                brandStr = card.brand || "";
                last4Str = card.last4 || "";
              } else if (result.paymentMethod === "debit_card" || result.payment_method === "debit_card") {
                fundingType = "debit";
              } else if (result.paymentMethod === "credit_card" || result.payment_method === "credit_card") {
                fundingType = "credit";
              }
              paymentRejectRef.current = null;
              resolve({ token: result.cryptoPaymentToken, funding: fundingType, brand: brandStr, last4: last4Str });
            } else {
              paymentRejectRef.current = null;
              reject(new Error("Payment method collection failed"));
            }
          }
        ).then((element: HTMLElement) => {
          if (mountedRef.current) {
            setPaymentElement(element);
          }
        }).catch((err) => {
          paymentRejectRef.current = null;
          reject(err);
        });
      });

      const { token: pmToken, funding: collectedFunding, brand: collectedBrand, last4: collectedLast4 } = await paymentPromise;
      paymentRejectRef.current = null;
      if (!mountedRef.current) return;

      paymentTokenRef.current = pmToken;
      setPaymentElement(null);

      if (collectedFunding) {
        setDetectedCardFunding(collectedFunding);
        if (collectedBrand) setDetectedCardBrand(collectedBrand);
        if (collectedLast4) setDetectedCardLast4(collectedLast4);
        onCardDetected?.({ funding: collectedFunding, brand: collectedBrand || "", last4: collectedLast4 || "" });
      }

      // Save state in refs for KYC/error recovery
      activeEmailRef.current = activeEmail;
      customerIdRef.current = customerId;
      paymentTokenRef.current = pmToken;
      buyerWalletRef.current = buyerWallet;

      // ─── Step 9-10: Run the headless checkout process ───
      await runCheckoutLoop(activeEmail, customerId, pmToken, buyerWallet, collectedFunding);

    } catch (err: any) {
      const errMessage = String(err?.message || "").toLowerCase();
      const errCode = String(err?.code || "").toLowerCase();
      const isKycError = errMessage.includes("identity verification") || 
                         errMessage.includes("verification_required") || 
                         errMessage.includes("kyc") ||
                         errCode.includes("identity_verification") ||
                         errCode.includes("kyc") ||
                         errCode === "crypto_onramp_missing_minimum_identity_verification";

      if (isKycError && onrampRef.current) {
        console.log("[EMBEDDED ONRAMP] KYC error caught during payment collection. Triggering verifyDocuments...");
        try {
          updateStep("verifying_identity");
          try {
            const isTestMode = !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith("pk_test_");
            
            if (isTestMode) {
              console.log("[EMBEDDED ONRAMP] Submitting test KYC demographics on payment collection catch...");
              await onrampRef.current.submitKycInfo({
                given_name: "John",
                surname: "Verified",
                date_of_birth: { day: 1, month: 1, year: 1901 },
                address: {
                  line1: "address_full_match",
                  city: "Seattle",
                  state: "WA",
                  postal_code: "12345",
                  country: "US"
                },
                id_number: {
                  value: "000000000",
                  type: "us_ssn"
                }
              });
            } else {
              console.log("[EMBEDDED ONRAMP] Live mode detected. Skipping mock demographics submission.");
            }
          } catch (kycSubmitErr: any) {
            console.warn("[EMBEDDED ONRAMP] submitKycInfo failed:", kycSubmitErr?.message);
            fetch("/api/portal/log", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                level: "warn",
                message: `[EMBEDDED ONRAMP] submitKycInfo failed: ${kycSubmitErr?.message || kycSubmitErr}`,
                meta: { error: String(kycSubmitErr?.stack || kycSubmitErr) }
              })
            }).catch(() => {});
          }
          const verifyResult = await onrampRef.current.verifyDocuments();
          if (verifyResult.result === "abandoned") {
            handleError("Identity verification was abandoned");
            return;
          }
          console.log("[EMBEDDED ONRAMP] KYC/Document verification completed. Polling status...");
          updateStep("checking_kyc");
          const success = await pollKycStatus(customerIdRef.current || "");
          if (!success) {
            handleError("Identity verification was not approved. Please try again.");
            return;
          }

          setPaymentElement(null);
          isRunningRef.current = false;
          if (startOnrampRef.current) {
            await startOnrampRef.current(activeEmail, activePhone, activeName);
          }
          return;
        } catch (verifyErr: any) {
          handleError(verifyErr?.message || "Identity verification failed");
          return;
        }
      }

      handleError(err?.message || "Onramp flow failed");
    }
  }, [
    enabled, email, phone, localPhone, splitAddress, splitAddressCredit, amount, network,
    destinationCurrency, receiptId, merchantWallet, brandKey,
    publishableKey, connectedWalletAddress, connectedWallet, onSuccess, handleError,
    updateStep, createBuyerWallet, runCheckoutLoop, pollKycStatus,
  ]);

  useEffect(() => {
    startOnrampRef.current = startOnramp;
  }, [startOnramp]);

  const submitPhone = useCallback((phoneNumber: string) => {
    if (!phoneNumber || phoneNumber.includes("*")) {
      console.warn("[EMBEDDED ONRAMP] Rejected invalid/masked phone input:", phoneNumber);
      return;
    }
    const formatted = formatToE164(phoneNumber);
    setLocalPhone(formatted);
    console.log("[EMBEDDED ONRAMP] Phone number submitted, resuming flow (original/formatted):", phoneNumber, "->", formatted);
    startOnramp(undefined, formatted);
  }, [startOnramp]);

  const statusMessage = useMemo(() => STEP_MESSAGES[step], [step]);

  const isActive = useMemo(() =>
    step !== "idle" && step !== "completed" && step !== "error",
    [step]
  );

  return {
    step,
    statusMessage,
    error,
    authElement,
    paymentElement,
    startOnramp,
    reset,
    submitPhone,
    submitKycInfo,
    isActive,
    cryptoCustomerId,
    buyerWalletAddress,
    detectedCardFunding,
    detectedCardBrand,
    detectedCardLast4,
    sessionId,
  };
}
