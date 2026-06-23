"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";

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
}: UseStripeEmbeddedOnrampProps): UseStripeEmbeddedOnrampReturn {
  const [step, setStep] = useState<OnrampStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [authElement, setAuthElement] = useState<HTMLElement | null>(null);
  const [paymentElement, setPaymentElement] = useState<HTMLElement | null>(null);
  const [cryptoCustomerId, setCryptoCustomerId] = useState<string | null>(null);
  const [buyerWalletAddress, setBuyerWalletAddress] = useState<string | null>(null);
  const [localPhone, setLocalPhone] = useState<string>("");
  const [detectedCardFunding, setDetectedCardFunding] = useState<"credit" | "debit" | null>(null);
  const [detectedCardBrand, setDetectedCardBrand] = useState<string | null>(null);
  const [detectedCardLast4, setDetectedCardLast4] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const onrampRef = useRef<OnrampCoordinator | null>(null);
  const mountedRef = useRef(true);
  const oauthTokenRef = useRef<string | null>(null);
  const paymentTokenRef = useRef<string | null>(null);
  const verificationTokenRef = useRef<string | null>(null);
  const buyerAccountRef = useRef<any>(null);
  const isRunningRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const activeEmailRef = useRef<string | null>(null);
  const customerIdRef = useRef<string | null>(null);
  const buyerWalletRef = useRef<string | null>(null);

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";

  const updateStep = useCallback((newStep: OnrampStep) => {
    if (!mountedRef.current) return;
    setStep(newStep);
    onStepChange?.(newStep);
  }, [onStepChange]);

  useEffect(() => {
    mountedRef.current = true;

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const err = event.reason;
      const errMessage = String(err?.message || err || "").toLowerCase();
      if (errMessage.includes("identity verification") || errMessage.includes("verification_required")) {
        event.preventDefault(); // Stop default browser console logging
        console.log("[EMBEDDED ONRAMP] Intercepted identity verification requirement. Launching verifyDocuments...");
        
        updateStep("verifying_identity");
        
        if (onrampRef.current) {
          onrampRef.current.verifyDocuments()
            .then((res) => {
              console.log("[EMBEDDED ONRAMP] verifyDocuments completed:", res);
              updateStep("collecting_payment");
            })
            .catch((verifyErr) => {
              console.error("[EMBEDDED ONRAMP] verifyDocuments error:", verifyErr);
              updateStep("collecting_payment");
            });
        } else {
          updateStep("collecting_payment");
        }
      }
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      mountedRef.current = false;
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
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
    updateStep("error");
    onError?.(new Error(message));
  }, [onError, updateStep]);

  const reset = useCallback(() => {
    isRunningRef.current = false;
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

      const twClient = createThirdwebClient({
        clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "",
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
    usdcAmount: number,
    connectedWallet?: any
  ): Promise<string | null> => {
    try {
      const { createThirdwebClient, getContract, prepareContractCall, sendTransaction, readContract } = await import("thirdweb");
      const { base } = await import("thirdweb/chains");

      const twClient = createThirdwebClient({
        clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "",
      });

      let account: any;

      if (buyerAccountRef.current) {
        console.log("[EMBEDDED ONRAMP] Using active guest EOA account (EIP-7702 mode):", buyerAccountRef.current.address);
        account = buyerAccountRef.current;
      } else if (connectedWallet) {
        if (connectedWallet.personalAccount) {
          console.log("[EMBEDDED ONRAMP] Using connected Smart Account directly:", connectedWallet.address);
          account = connectedWallet;
        } else {
          console.log("[EMBEDDED ONRAMP] Wrapping EOA connected wallet with Smart Wallet for EIP-4337/7702 gasless execution...");
          const { smartWallet } = await import("thirdweb/wallets");
          const wallet = smartWallet({
            chain: base,
            gasless: true,
          });

          account = await wallet.connect({
            client: twClient,
            personalAccount: connectedWallet,
          });
          console.log("[EMBEDDED ONRAMP] Smart Account active for EOA:", account.address);
        }
      } else {
        const { inAppWallet } = await import("thirdweb/wallets");
        // Re-connect the wallet as EOA with EIP-7702 gasless sponsored execution
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

  const createSessionHelper = useCallback(async (
    customerId: string,
    pmToken: string,
    buyerWallet: string
  ): Promise<{ sessionId: string; paymentDetails: any } | null> => {
    updateStep("creating_session");
    try {
      const sessionRes = await fetch("/api/stripe/onramp-session-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cryptoCustomerId: customerId,
          cryptoPaymentToken: pmToken,
          sourceAmount: amount,
          sourceCurrency: "usd",
          destinationCurrency,
          destinationNetwork: network,
          walletAddress: buyerWallet,
          oauthToken: oauthTokenRef.current,
          receiptId,
          merchantWallet,
          brandKey,
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
            await onrampRef.current.verifyDocuments();
            console.log("[EMBEDDED ONRAMP] Document verification completed. Retrying session creation...");
            return await createSessionHelper(customerId, pmToken, buyerWallet);
          } catch (verifyErr: any) {
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
      };
    } catch (err: any) {
      handleError(err?.message || "Session creation failed");
      return null;
    }
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
    activeEmail: string
  ) => {
    console.log("[EMBEDDED ONRAMP] Checking eCommerce mode before Step 11. isEcommerceMode:", isEcommerceMode);
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
          amount,
          splitAddress,
          splitAddressCredit,
          brandKey,
          detectedCardFunding,
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
        const statusRes = await fetch(`/api/stripe/onramp-status?sessionId=${encodeURIComponent(sessionId)}`, {
          headers: {
            "x-stripe-oauth-token": oauthTokenRef.current || "",
          }
        });
        if (!statusRes.ok) {
          console.warn(`[EMBEDDED ONRAMP] Status endpoint returned error status: ${statusRes.status}`);
          continue;
        }
        const statusData = await statusRes.json();
        console.log(`[EMBEDDED ONRAMP] Polled status (attempt ${poll + 1}):`, statusData?.status, statusData);

        if (statusData && statusData.status === "fulfillment_complete") {
          fundsDelivered = true;
          isCreditCard = statusData.paymentDetails?.card?.funding === "credit";
          console.log("[EMBEDDED ONRAMP] ✓ USDC delivered to buyer's smart wallet. Credit card:", isCreditCard);
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

    const targetSplitAddress = (isCreditCard || detectedCardFunding === "credit") && splitAddressCredit
      ? splitAddressCredit
      : (splitAddress || "");

    const txHash = await executeGaslessTransfer(activeEmail, targetSplitAddress, amount || 0, connectedWallet);

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
    connectedWallet
  ]);

  const runCheckoutLoop = useCallback(async (
    activeEmail: string,
    customerId: string,
    pmToken: string,
    buyerWallet: string
  ) => {
    updateStep("checking_out");
    isRunningRef.current = true;

    const MAX_ATTEMPTS = 5;
    let checkoutSucceeded = false;

    let currentSessionId = sessionIdRef.current;
    if (!currentSessionId) {
      const sessionResult = await createSessionHelper(customerId, pmToken, buyerWallet);
      if (!sessionResult) return;
      currentSessionId = sessionResult.sessionId;
      sessionIdRef.current = currentSessionId;
      setSessionId(currentSessionId);

      if (sessionResult.paymentDetails?.card) {
        const funding = sessionResult.paymentDetails.card.funding;
        const brand = sessionResult.paymentDetails.card.brand;
        const last4 = sessionResult.paymentDetails.card.last4;
        
        const isDebit = funding === "debit" || funding === "prepaid";
        const fundingType = isDebit ? "debit" : "credit";
        setDetectedCardFunding(fundingType);
        setDetectedCardBrand(brand);
        setDetectedCardLast4(last4);
        onCardDetected?.({ funding: fundingType, brand, last4 });
        
        console.log(`[EMBEDDED ONRAMP] Card detected: ${brand} ${funding} (${last4}). Pausing for fee review.`);
        
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
            }),
          });

          const checkoutData = await checkoutRes.json();

          if (!checkoutData.client_secret) {
            throw new Error(checkoutData.error || "No client_secret returned");
          }

          return checkoutData.client_secret;
        });

        if (result.successful) {
          checkoutSucceeded = true;
          break;
        }
      } catch (checkoutErr: any) {
        console.warn(`[EMBEDDED ONRAMP] Checkout attempt ${attempt + 1} failed, checking error state...`, checkoutErr);
        
        try {
          const statusRes = await fetch(`/api/stripe/onramp-status?sessionId=${encodeURIComponent(currentSessionId)}`, {
            headers: {
              "x-stripe-oauth-token": oauthTokenRef.current || "",
            }
          });
          const statusData = await statusRes.json();
          const lastError = statusData.transactionDetails?.last_error;

          console.log(`[EMBEDDED ONRAMP] Inspecting lastError from session status:`, lastError);

          if (lastError === "missing_kyc") {
            console.log("[EMBEDDED ONRAMP] KYC info required. Transitioning to collecting_kyc and pausing loop.");
            updateStep("collecting_kyc");
            isRunningRef.current = false;
            return;
          } else if (lastError === "missing_document_verification") {
            console.log("[EMBEDDED ONRAMP] Identity document verification required. Launching verifyDocuments...");
            updateStep("verifying_identity");
            if (!onrampRef.current) throw new Error("Onramp coordinator not initialized");
            
            try {
              const verifyResult = await onrampRef.current.verifyDocuments();
              if (verifyResult.result === "abandoned") {
                handleError("Identity verification was abandoned");
                return;
              }
              console.log("[EMBEDDED ONRAMP] Document verification successful, retrying checkout...");
              updateStep("checking_out");
              continue;
            } catch (verifyErr: any) {
              handleError(verifyErr?.message || "Identity verification failed");
              return;
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
            const sessionResult = await createSessionHelper(customerId, pmToken, buyerWallet);
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

    await postCheckoutHandler(currentSessionId, activeEmail);
  }, [
    createSessionHelper,
    postCheckoutHandler,
    network,
    updateStep,
    handleError,
    onCardDetected
  ]);

  const submitKycInfo = useCallback(async (kycInfo: any) => {
    if (!onrampRef.current) {
      throw new Error("Onramp not initialized");
    }
    console.log("[EMBEDDED ONRAMP] Submitting KYC info...");
    updateStep("collecting_kyc");
    try {
      await onrampRef.current.submitKycInfo(kycInfo);
      console.log("[EMBEDDED ONRAMP] KYC submitted successfully! Resuming checkout loop...");
      
      if (activeEmailRef.current && customerIdRef.current && paymentTokenRef.current && buyerWalletRef.current) {
        runCheckoutLoop(
          activeEmailRef.current,
          customerIdRef.current,
          paymentTokenRef.current,
          buyerWalletRef.current
        ).catch((err) => {
          handleError(err?.message || "Checkout failed after KYC submission");
        });
      } else {
        throw new Error("Missing checkout state to resume flow");
      }
    } catch (err: any) {
      console.error("[EMBEDDED ONRAMP] KYC submission failed:", err);
      handleError(err?.message || "KYC submission failed");
      throw err;
    }
  }, [updateStep, handleError, runCheckoutLoop]);

  const startOnramp = useCallback(async (overrideEmail?: string, overridePhone?: string, overrideName?: string) => {
    if (isRunningRef.current) {
      console.warn("[EMBEDDED ONRAMP] Onramp flow is already running. Ignoring duplicate trigger.");
      return;
    }
    isRunningRef.current = true;
    console.log("[EMBEDDED ONRAMP] startOnramp triggered. isEcommerceMode prop:", isEcommerceMode, "window.location.search:", typeof window !== "undefined" ? window.location.search : "SSR");

    const activeEmail = overrideEmail || email;
    const activePhone = overridePhone || phone || localPhone;
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
      // ─── Step 1: Initialize Stripe SDK with native Dark theme ───
      // @ts-ignore - beta SDK method missing from types
      const stripeCryptoModule = (await import("@stripe/crypto")) as any;
      const loadCryptoOnrampAndInitialize = stripeCryptoModule.loadCryptoOnrampAndInitialize || stripeCryptoModule.loadStripeOnramp;

      const onramp = await loadCryptoOnrampAndInitialize(publishableKey, {
        theme: "dark",
      });

      if (!mountedRef.current) return;
      onrampRef.current = onramp as unknown as OnrampCoordinator;

      // ─── Step 2: Check for Link account ───
      updateStep("checking_link");

      const linkRes = await fetch("/api/stripe/link-auth-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: activeEmail }),
      });

      if (!mountedRef.current) return;

      let authIntentId: string;

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

      const customerId = await authPromise;
      if (!mountedRef.current) return;

      setCryptoCustomerId(customerId);
      customerIdRef.current = customerId;
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

      if (!mountedRef.current) return;

      // ─── Step 5: Cryptographically verify email via Stripe Link Session Token ───
      const markRes = await fetch("/api/auth/mark-verified", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: activeEmail,
          customerId,
          oauthToken: oauthTokenRef.current,
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

      let buyerWallet: string;

      if (connectedWalletAddress && connectedWallet) {
        try {
          fetch("/api/users/profile", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "x-wallet": connectedWalletAddress,
              ...(brandKey ? { "x-brand-key": brandKey } : {}),
            },
            body: JSON.stringify({
              wallet: connectedWalletAddress,
              contact: {
                email: activeEmail,
              },
            }),
          }).then(res => {
            if (res.ok) {
              console.log("[EMBEDDED ONRAMP] Email linked to connected EOA profile successfully:", activeEmail);
            }
          }).catch(err => {
            console.warn("[EMBEDDED ONRAMP] Failed to link email to EOA profile:", err);
          });
        } catch (linkErr) {
          console.warn("[EMBEDDED ONRAMP] Error in profile link attempt:", linkErr);
        }

        buyerWallet = connectedWalletAddress;
        buyerAccountRef.current = connectedWallet;
        console.log("[EMBEDDED ONRAMP] Using connected EOA wallet:", buyerWallet);
      } else {
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
      }

      setBuyerWalletAddress(buyerWallet);
      buyerWalletRef.current = buyerWallet;

      // ─── Step 6b: Check KYC ───
      updateStep("checking_kyc");

      const kycRes = await fetch(`/api/stripe/crypto-customer/${encodeURIComponent(customerId)}`, {
        headers: {
          "x-stripe-oauth-token": oauthTokenRef.current || "",
        },
      });

      if (!mountedRef.current) return;

      if (kycRes.ok) {
        const kycData = await kycRes.json();

        if (kycData.kycStatus === "not_started") {
          console.log("[EMBEDDED ONRAMP] KYC not started — will handle during checkout");
        }

        if (kycData.idDocStatus === "not_started") {
          console.log("[EMBEDDED ONRAMP] Identity doc not started — will handle during checkout");
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

      const paymentPromise = new Promise<string>((resolve, reject) => {
        onramp.collectPaymentMethod(
          {
            payment_method_types: ["card"],
            wallets: { applePay: "auto", googlePay: "auto" },
          },
          (result: any) => {
            if (result.cryptoPaymentToken) {
              resolve(result.cryptoPaymentToken);
            } else {
              reject(new Error("Payment method collection failed"));
            }
          }
        ).then((element: HTMLElement) => {
          if (mountedRef.current) {
            setPaymentElement(element);
          }
        }).catch(reject);
      });

      const pmToken = await paymentPromise;
      if (!mountedRef.current) return;

      paymentTokenRef.current = pmToken;
      setPaymentElement(null);

      // Save state in refs for KYC/error recovery
      activeEmailRef.current = activeEmail;
      customerIdRef.current = customerId;
      paymentTokenRef.current = pmToken;
      buyerWalletRef.current = buyerWallet;

      // ─── Step 9-10: Run the headless checkout process ───
      await runCheckoutLoop(activeEmail, customerId, pmToken, buyerWallet);

    } catch (err: any) {
      handleError(err?.message || "Onramp flow failed");
    }
  }, [
    enabled, email, phone, localPhone, splitAddress, splitAddressCredit, amount, network,
    destinationCurrency, receiptId, merchantWallet, brandKey,
    publishableKey, connectedWalletAddress, connectedWallet, onSuccess, handleError,
    updateStep, createBuyerWallet, runCheckoutLoop,
  ]);

  const submitPhone = useCallback((phoneNumber: string) => {
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
