"use client";
import { useCallback, useEffect, useState } from "react";
import { type CheckoutAssignment, type CheckoutVersion } from "@/lib/checkout-experiment";

export function useReceiptCheckoutVersion({ receiptId, wallet, requested, fallback, enabled }: {
  receiptId: string; wallet: string; requested?: CheckoutVersion; fallback: CheckoutVersion; enabled: boolean;
}) {
  const scope = `${receiptId}:${wallet}`;
  const [selection, setSelection] = useState<{ scope: string; assignment: CheckoutAssignment } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const [presented, setPresented] = useState("");
  useEffect(() => {
    if (!enabled || !wallet || !receiptId) return;
    const controller = new AbortController();
    setFailure(null);
    if (receiptId.toUpperCase() === "TEST") {
      setSelection({ scope, assignment: { checkoutVersion: requested || fallback, checkoutAssignmentSource: requested ? "url" : "default", checkoutAssignedAt: Date.now() } });
      return;
    }
    fetch(`/api/receipts/${encodeURIComponent(receiptId)}/checkout`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, version: requested, defaultVersion: fallback, action: "assign" }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not prepare checkout.");
      if (!controller.signal.aborted) setSelection({ scope, assignment: data.assignment });
    }).catch(error => { if (!controller.signal.aborted) setFailure({ scope, message: error.message }); });
    return () => controller.abort();
  }, [enabled, wallet, receiptId, requested, fallback, scope, retry]);
  const assignment = selection?.scope === scope ? selection.assignment : null;
  const markPresented = useCallback(() => setPresented(scope), [scope]);
  useEffect(() => {
    if (presented !== scope || !assignment || receiptId.toUpperCase() === "TEST") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expose = async (attempt: number) => {
      try {
        const response = await fetch(`/api/receipts/${encodeURIComponent(receiptId)}/checkout`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet, version: assignment.checkoutVersion, defaultVersion: assignment.checkoutVersion, action: "expose" }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok && response.status >= 500) throw new Error("Exposure observation unavailable");
      } catch {
        if (!controller.signal.aborted && attempt < 2) timer = setTimeout(() => void expose(attempt + 1), 2000 * (attempt + 1));
      }
    };
    void expose(0);
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [presented, scope, assignment?.checkoutVersion, receiptId, wallet]);
  return { assignment, markPresented, ready: !enabled || Boolean(assignment), error: failure?.scope === scope ? failure.message : null, retry: () => setRetry(value => value + 1) };
}
