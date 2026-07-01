"use client";

import { useEffect, useRef } from "react";

export type PortalLoggerProps = {
  receiptId?: string;
  wallet?: string | null;
  sessionId?: string | null;
};

export function usePortalLogger({
  receiptId,
  wallet,
  sessionId,
}: PortalLoggerProps) {
  const stateRef = useRef({ receiptId, wallet, sessionId });

  // Sync state values into a ref to avoid console override re-bindings on state changes
  useEffect(() => {
    stateRef.current = { receiptId, wallet, sessionId };
  }, [receiptId, wallet, sessionId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const disabled = String(process.env.NEXT_PUBLIC_PAY_LOGGING || "").toUpperCase() === "FALSE";
    if (disabled) return;

    // Capture the mount-time console functions
    // pp-init.js silences console.log by default and saves the original in console._log
    const silencedLog = console.log;
    const originalLog = (console as any)._log || console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    let isSending = false;
    let logCount = 0;
    const MAX_LOGS = 100;

    const sendLogToServer = async (level: "log" | "warn" | "error", args: any[]) => {
      // Only capture errors
      if (level !== "error") return;

      // Basic protection: do not recursively log if we are already sending, or if we hit the cap
      if (isSending || logCount >= MAX_LOGS) return;

      try {
        isSending = true;
        logCount++;

        // Convert all arguments to a readable string representation
        const message = args
          .map((arg) => {
            if (arg instanceof Error) {
              return `${arg.message}\n${arg.stack}`;
            }
            if (typeof arg === "object") {
              try {
                return JSON.stringify(arg);
              } catch {
                return String(arg);
              }
            }
            return String(arg);
          })
          .join(" ");

        // Filter out harmless/transient network errors or third-party telemetry failures
        const lowerMsg = message.toLowerCase();
        const isTransient = lowerMsg.includes("failed to fetch") || 
                            lowerMsg.includes("load failed") ||
                            lowerMsg.includes("networkerror") ||
                            lowerMsg.includes("reportsserver") ||
                            lowerMsg.includes("stripe.com/crypto-onramp") ||
                            lowerMsg.includes("stripe.js");

        if (isTransient) {
          isSending = false;
          return;
        }

        // Extract error stack if available
        let stack: string | undefined = undefined;
        const errObj = args.find((a) => a instanceof Error);
        if (errObj) {
          stack = errObj.stack;
        }

        const payload = {
          level,
          message,
          stack,
          receiptId: stateRef.current.receiptId,
          wallet: stateRef.current.wallet || "anonymous",
          sessionId: stateRef.current.sessionId || undefined,
          host: window.location.host,
          userAgent: window.navigator.userAgent,
          ts: Date.now(),
        };

        // Fire-and-forget POST to logging API
        fetch("/api/portal/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch((fetchErr) => {
          // Log using the raw original console error function to avoid recursive capture loops
          originalError.apply(console, ["[PORTAL LOGGER ERROR] Failed to POST log to server:", fetchErr]);
        });
      } catch (err) {
        originalError.apply(console, ["[PORTAL LOGGER ERROR] Failed to serialize log:", err]);
      } finally {
        isSending = false;
      }
    };

    // Override console.log (this also un-silences it for the portal page so developers can see it in devtools)
    console.log = (...args: any[]) => {
      originalLog.apply(console, args);
      // Suppress noisy hydration and standard CSS warnings
      const firstArg = String(args[0] || "");
      if (
        !firstArg.includes("validatedomnesting") &&
        !firstArg.includes("hydration")
      ) {
        sendLogToServer("log", args);
      }
    };

    // Override console.warn
    console.warn = (...args: any[]) => {
      originalWarn.apply(console, args);
      sendLogToServer("warn", args);
    };

    // Override console.error
    console.error = (...args: any[]) => {
      originalError.apply(console, args);
      sendLogToServer("error", args);
    };

    // Global uncaught errors
    const handleGlobalError = (event: ErrorEvent) => {
      const errorMsg = event.message || "Unknown runtime error";
      const errorObj = event.error || new Error(errorMsg);
      sendLogToServer("error", [`Unhandled runtime error: ${errorMsg}`, errorObj]);
    };

    // Global unhandled promise rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const errorObj = reason instanceof Error ? reason : new Error(String(reason || "Promise rejected"));
      sendLogToServer("error", [
        `Unhandled promise rejection: ${errorObj.message}`,
        errorObj,
      ]);
    };

    window.addEventListener("error", handleGlobalError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      // Restore standard console behaviors on unmount
      console.log = silencedLog;
      console.warn = originalWarn;
      console.error = originalError;
      window.removeEventListener("error", handleGlobalError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);
}
