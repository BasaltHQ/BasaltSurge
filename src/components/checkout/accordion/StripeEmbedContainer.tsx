"use client";

import React, { useEffect, useRef, useState, useImperativeHandle } from "react";
import { Loader2, RefreshCw, AlertCircle, ShieldCheck } from "lucide-react";

export interface StripeEmbedContainerProps {
  /** The Stripe element (raw HTMLElement from Stripe SDK, React node from simulation, or null) */
  element?: HTMLElement | React.ReactNode | null;
  /** Whether the accordion step hosting this container is currently expanded */
  isVisible?: boolean;
  /** Optional external ref to pass back the host DOM node */
  containerRef?: React.Ref<HTMLDivElement>;
  /** Custom loading text displayed while element initializes */
  loadingMessage?: string;
  /** Watchdog timeout in seconds before displaying a retry banner (default: 12s) */
  timeoutSeconds?: number;
  /** Callback triggered when user clicks retry after timeout */
  onTimeoutRetry?: () => void;
  /** UI theme token */
  isLightText?: boolean;
  /** Additional CSS class names */
  className?: string;
  /** Minimum height placeholder to prevent accordion layout jump */
  minHeight?: string | number;
}

/**
 * Dedicated Modular Host Container for Stripe Embedded Elements & Iframes
 *
 * Solves:
 * 1. Mounting race conditions & idempotent DOM attachment.
 * 2. 0px height collapse when revealed from hidden states.
 * 3. Double-mounting protection (never clears active user inputs).
 * 4. Polymorphic support for raw HTMLElement iframes & React simulated components.
 * 5. Built-in shimmer loading skeleton & stall timeout watchdog.
 */
export function StripeEmbedContainer({
  element,
  isVisible = true,
  containerRef,
  loadingMessage = "Initializing secure Stripe form...",
  timeoutSeconds = 30,
  onTimeoutRetry,
  isLightText = true,
  className = "",
  minHeight,
}: StripeEmbedContainerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [isStalled, setIsStalled] = useState(false);
  const timeoutTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync internal hostRef with external containerRef
  useEffect(() => {
    if (!containerRef) return;
    if (typeof containerRef === "function") {
      containerRef(hostRef.current);
    } else if ("current" in containerRef) {
      (containerRef as any).current = hostRef.current;
    }
  }, [containerRef]);

  // Single-source-of-truth DOM attachment for raw HTMLElement instances
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !element || !isVisible) return;

    if (typeof element === "object" && "nodeType" in element) {
      const domNode = element as HTMLElement;
      host.innerHTML = "";
      host.appendChild(domNode);
      setIsStalled(false);
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
    }
  }, [element, isVisible]);

  // Layout recalibration whenever the container becomes visible
  useEffect(() => {
    if (isVisible) {
      const animId = requestAnimationFrame(() => {
        // Dispatch standard window resize event so Stripe iframes re-evaluate container height
        window.dispatchEvent(new Event("resize"));
      });
      return () => cancelAnimationFrame(animId);
    }
  }, [isVisible]);

  // Stall watchdog timer
  useEffect(() => {
    if (!element && isVisible) {
      setIsStalled(false);
      if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = setTimeout(() => {
        if (!element) {
          setIsStalled(true);
        }
      }, timeoutSeconds * 1000);
    } else {
      setIsStalled(false);
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
    }

    return () => {
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
    };
  }, [element, isVisible, timeoutSeconds]);

  // Background auto-recovery trigger if stalled for more than 4 seconds
  useEffect(() => {
    if (isStalled && !element && onTimeoutRetry) {
      const autoRetryId = setTimeout(() => {
        if (!element) {
          setIsStalled(false);
          onTimeoutRetry();
        }
      }, 4000);
      return () => clearTimeout(autoRetryId);
    }
  }, [isStalled, element, onTimeoutRetry]);

  const isRawDomElement = element && typeof element === "object" && "nodeType" in element;
  const isReactNode = element && !isRawDomElement;

  return (
    <div
      className={`relative w-full transition-all duration-200 ${className}`}
      style={minHeight ? { minHeight } : undefined}
    >
      {/* Raw DOM Attachment Host (Always in DOM for persistence) */}
      <div
        ref={hostRef}
        className={`w-full ${isRawDomElement ? "block" : "hidden"}`}
      />

      {/* React Node Host (Simulation mode or custom React elements) */}
      {isReactNode && (
        <div className="w-full animate-in fade-in duration-200">
          {element as React.ReactNode}
        </div>
      )}

      {/* Loading Skeleton & Stall Notice (Shown when element is null) */}
      {!element && (
        <div className="w-full space-y-3 py-2 animate-in fade-in duration-200">
          {isStalled ? (
            /* Timeout / Stalled Fallback Notice */
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm space-y-2 text-left">
              <div className="flex items-center gap-2 font-bold text-amber-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Taking longer than expected to connect</span>
              </div>
              <p className="text-xs text-amber-200/80 leading-relaxed">
                Stripe is finalizing your secure payment session. You can wait or click below to refresh the connection.
              </p>
              {onTimeoutRetry && (
                <button
                  type="button"
                  onClick={() => {
                    setIsStalled(false);
                    onTimeoutRetry();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh Connection</span>
                </button>
              )}
            </div>
          ) : (
            /* Shimmer Loading Skeleton */
            <div
              className={`p-4 rounded-xl border space-y-3 ${
                isLightText
                  ? "bg-white/5 border-white/10 text-white"
                  : "bg-black/5 border-black/10 text-black"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
                  <span className="text-sm font-semibold opacity-90">{loadingMessage}</span>
                </div>
                <div className="flex items-center gap-1 text-xs opacity-70">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Stripe 256-bit Encrypted</span>
                </div>
              </div>

              {/* Shimmer Placeholder Fields */}
              <div className="space-y-2 pt-1">
                <div
                  className={`h-9 w-full rounded-lg animate-pulse ${
                    isLightText ? "bg-white/10" : "bg-black/10"
                  }`}
                />
                <div className="grid grid-cols-2 gap-2">
                  <div
                    className={`h-9 w-full rounded-lg animate-pulse ${
                      isLightText ? "bg-white/10" : "bg-black/10"
                    }`}
                  />
                  <div
                    className={`h-9 w-full rounded-lg animate-pulse ${
                      isLightText ? "bg-white/10" : "bg-black/10"
                    }`}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
