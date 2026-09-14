"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useMerchantOrders(wallet: string, query: string) {
  const scope = `${wallet}:${query}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const active = useRef<AbortController | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailRequests = useRef(new Map<string, { controller: AbortController; promise: Promise<any> }>());
  const [state, setState] = useState<{ scope: string; receipts: any[]; next: string | null; cursors: (string | null)[]; error: string; loading: boolean }>({
    scope, receipts: [], next: null, cursors: [null], error: "", loading: Boolean(wallet),
  });
  const visible = state.scope === scope;
  const cancelDetails = useCallback(() => {
    for (const request of detailRequests.current.values()) request.controller.abort();
    detailRequests.current.clear();
  }, []);

  const load = useCallback(async (cursors: (string | null)[] = [null]) => {
    if (debounce.current) clearTimeout(debounce.current);
    active.current?.abort();
    cancelDetails();
    if (!wallet) return;
    const controller = new AbortController();
    active.current = controller;
    setState(previous => ({ ...previous, scope, receipts: [], next: null, error: "", loading: true }));
    const timeout = setTimeout(() => {
      if (!controller.signal.aborted && active.current === controller && currentScope.current === scope) {
        controller.abort();
        setState(previous => ({ ...previous, error: "Orders timed out. Please retry.", loading: false }));
      }
    }, 15000);
    try {
      const params = new URLSearchParams(query);
      const cursor = cursors.at(-1);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/merchant/orders?${params}`, {
        headers: { "x-wallet": wallet }, credentials: "include", cache: "no-store", signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok || !body.ok || !Array.isArray(body.receipts)) throw new Error(body.error || "Orders could not be loaded. Please retry.");
      if (!controller.signal.aborted && active.current === controller && currentScope.current === scope) {
        setState({ scope, receipts: body.receipts, next: body.pagination?.nextCursor || null, cursors, error: "", loading: false });
      }
    } catch (error: any) {
      if (!controller.signal.aborted && active.current === controller && currentScope.current === scope) {
        setState(previous => ({ ...previous, scope, error: error?.message || "Orders could not be loaded. Please retry.", loading: false }));
      }
    } finally {
      clearTimeout(timeout);
    }
  }, [wallet, query, scope, cancelDetails]);

  useEffect(() => {
    active.current?.abort();
    cancelDetails();
    // Debounce searches and amount inputs before starting database work.
    const timer = setTimeout(() => { debounce.current = null; void load(); }, 400);
    debounce.current = timer;
    return () => { clearTimeout(timer); active.current?.abort(); cancelDetails(); };
  }, [load, cancelDetails]);

  const getDetails = useCallback(async (receipt: any) => {
    const requestScope = scope;
    const id = String(receipt.receiptId);
    const existing = detailRequests.current.get(id);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException("Order details timed out. Please retry.", "TimeoutError")), 15000);
    const promise = (async () => {
      const response = await fetch(`/api/merchant/orders?receiptId=${encodeURIComponent(id)}`, {
        headers: { "x-wallet": wallet }, credentials: "include", cache: "no-store", signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok || !body.ok || !body.receipt) throw new Error(body.error || "Order details could not be loaded.");
      if (controller.signal.aborted || currentScope.current !== requestScope) throw new DOMException("Request cancelled", "AbortError");
      setState(previous => previous.scope === requestScope ? { ...previous, receipts: previous.receipts.map(row => row.receiptId === id ? { ...row, ...body.receipt } : row) } : previous);
      return body.receipt;
    })();
    detailRequests.current.set(id, { controller, promise });
    try { return await promise; }
    finally {
      clearTimeout(timeout);
      if (detailRequests.current.get(id)?.controller === controller) detailRequests.current.delete(id);
    }
  }, [wallet, scope]);

  return {
    receipts: visible ? state.receipts : [], loading: Boolean(wallet) && (!visible || state.loading), error: visible ? state.error : "",
    page: visible ? state.cursors.length : 1, hasMore: visible && Boolean(state.next),
    refresh: () => load(),
    nextPage: () => visible && state.next && !state.loading ? load([...state.cursors, state.next]) : undefined,
    previousPage: () => visible && state.cursors.length > 1 && !state.loading ? load(state.cursors.slice(0, -1)) : undefined,
    getDetails,
  };
}
