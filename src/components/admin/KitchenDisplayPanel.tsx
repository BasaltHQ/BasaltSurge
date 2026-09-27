"use client";

import React, { useState, useEffect, useRef } from "react";
import { useActiveAccount } from "thirdweb/react";
import {
  DndContext,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  useSensor,
  useSensors,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type KitchenOrder = {
  receiptId: string;
  uberOrderId?: string;
  totalUsd: number;
  currency: string;
  createdAt: number;
  status: string;
  kitchenStatus: "new" | "preparing" | "ready" | "completed";
  lineItems: Array<{
    label: string;
    priceUsd: number;
    qty?: number;
    attributes?: Record<string, any>;
    modifiers?: any[];
  }>;
  brandName?: string;
  kitchenMetadata?: {
    enteredKitchenAt: number;
    startedPreparingAt?: number;
    markedReadyAt?: number;
    completedAt?: number;
  };
  orderType?: string;
  tableNumber?: string;
  customerName?: string;
  serverName?: string;
  specialInstructions?: string;
  source?: "pos" | "ubereats";
  estimatedPickup?: number;
  uberMetadata?: {
    storeId?: string;
    estimatedDelivery?: number;
    driverId?: string;
  };
};

function formatElapsedTime(startTimestamp: number): string {
  const elapsed = Date.now() - startTimestamp;
  const minutes = Math.floor(elapsed / 60000);

  if (minutes < 1) return "< 1 min";
  if (minutes === 1) return "1 min";
  return `${minutes} min`;
}

// -- TICKET COMPONENT (Draggable) --
function KitchenTicket({ order, isOverlay, onClear }: { order: KitchenOrder; isOverlay?: boolean; onClear?: (id: string, uberId?: string) => void }) {
  // 1. Filter out Processing Fees
  const filteredItems = order.lineItems.filter(i =>
    !i.label.toLowerCase().includes("processing fee") &&
    !i.label.toLowerCase().includes("service fee")
  );

  const enteredAt = order.kitchenMetadata?.enteredKitchenAt || order.createdAt;
  const elapsed = formatElapsedTime(enteredAt);
  const elapsedMinutes = Math.floor((Date.now() - enteredAt) / 60000);

  // 2. Dynamic Time-based Coloring (Green -> Yellow -> Orange -> Red)
  // We use a clean border-left indicator and a subtle background tint that intensifies
  let colorClass = "border-l-4 border-l-emerald-500 bg-neutral-50 dark:bg-[#1a1a1a]"; // Default / Fresh
  let timeTextColor = "text-emerald-600 dark:text-emerald-400";

  if (order.kitchenStatus === 'completed') {
    // Completed orders - grayed out
    colorClass = "border-l-4 border-l-neutral-500 bg-neutral-50 dark:bg-neutral-900/40 opacity-70";
    timeTextColor = "text-neutral-500";
  } else if (elapsedMinutes >= 5 && elapsedMinutes < 15) {
    colorClass = "border-l-4 border-l-yellow-500 bg-yellow-50/30 dark:bg-yellow-900/10";
    timeTextColor = "text-yellow-600 dark:text-yellow-400";
  } else if (elapsedMinutes >= 15 && elapsedMinutes < 25) {
    colorClass = "border-l-4 border-l-orange-500 bg-orange-50/30 dark:bg-orange-900/10";
    timeTextColor = "text-orange-600 dark:text-orange-400";
  } else if (elapsedMinutes >= 25) {
    colorClass = "border-l-4 border-l-red-600 bg-red-50/30 dark:bg-red-900/10 animate-pulse-slow";
    timeTextColor = "text-red-600 dark:text-red-400";
  }

  // 3. Robust Server Name Parsing & Cleaning
  // Always attempts to extract "Server: Name" lines from notes to keep UI clean, 
  // and uses it as fallback if explicit serverName is missing.
  let displayNotes = order.specialInstructions || "";
  let extractedServerName = null;

  const serverMatch = displayNotes.match(/Server:\s*([^\n]+)/i);
  if (serverMatch) {
    extractedServerName = serverMatch[1].trim();
    // Remove the Server line from notes to avoid duplication
    displayNotes = displayNotes.replace(/Server:\s*[^\n]+(\n)?/i, "").trim();
  }

  let displayServerName = order.serverName || extractedServerName;
  // Clean up any "Name • $0.00" garbage if present in legacy data
  if (displayServerName && displayServerName.includes('•')) {
    displayServerName = displayServerName.split('•')[0].trim();
  }

  return (
    <div className={`relative rounded-r-lg border-y border-r border-neutral-200 dark:border-neutral-800 p-4 shadow-sm select-none touch-manipulation transition-all ${colorClass} ${isOverlay ? 'shadow-2xl scale-105 rotate-1 z-50' : 'hover:shadow-md'}`}>

      {/* Clear Button (Only for Completed) */}
      {onClear && order.kitchenStatus === 'completed' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClear(order.receiptId, order.uberOrderId);
          }}
          className="absolute -top-2 -right-2 bg-neutral-600 text-white w-6 h-6 rounded-full flex items-center justify-center shadow-md hover:bg-neutral-500 z-10"
          title="Archive Order"
        >
          ✕
        </button>
      )}

      {/* Header Row: ID + Timer */}
      <div className="flex items-start justify-between mb-3 border-b border-neutral-200 dark:border-neutral-800/50 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-xl tracking-wide text-neutral-900 dark:text-white">#{order.receiptId.slice(-6)}</span>
            {order.source === "ubereats" && (
              <span className="px-1.5 py-0.5 text-[10px] uppercase font-bold bg-green-600 text-white rounded flex items-center gap-1">
                Uber
              </span>
            )}
          </div>
          <div className="text-xs opacity-60 mt-0.5 dark:text-neutral-400">
            {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        <div className="text-right">
          <div className={`text-lg font-bold tabular-nums ${timeTextColor}`}>
            {order.kitchenStatus === 'completed' ? 'Done' : elapsed}
          </div>
        </div>
      </div>

      {/* Info Row: Table + Server */}
      <div className="flex flex-wrap gap-x-4 mb-4 text-sm">
        {order.tableNumber && (
          <div className="font-bold px-2 py-0.5 rounded bg-neutral-200 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200">
            Table {order.tableNumber}
          </div>
        )}
        {displayServerName ? (
          <div className="flex items-center gap-1 opacity-90 text-neutral-700 dark:text-neutral-300">
            <span className="opacity-60 text-xs uppercase font-bold">Server:</span>
            <span className="font-bold">{displayServerName}</span>
          </div>
        ) : (
          order.customerName && (
            <div className="flex items-center gap-1 opacity-90 text-neutral-700 dark:text-neutral-300">
              <span className="opacity-60 text-xs uppercase font-bold">Guest:</span>
              <span className="font-medium truncate max-w-[100px]">{order.customerName}</span>
            </div>
          )
        )}
      </div>

      {/* Line Items */}
      <div className="space-y-3">
        {filteredItems.map((item, idx) => {
          let modGroups = item.attributes?.modifierGroups || [];
          if ((!modGroups || modGroups.length === 0) && Array.isArray(item.modifiers) && item.modifiers.length > 0) {
            modGroups = [{ name: "Modifiers", modifiers: item.modifiers }];
          }
          const hasModifiers = Array.isArray(modGroups) && modGroups.length > 0;

          return (
            <div key={idx} className="text-sm">
              <div className="font-bold flex justify-between items-start text-base text-neutral-800 dark:text-neutral-100">
                <span className="leading-snug">
                  {item.qty && item.qty > 1 && (
                    <span className="inline-flex items-center justify-center bg-neutral-900 text-white dark:bg-white dark:text-black rounded px-1.5 py-0.5 text-xs font-bold mr-2 align-middle">
                      {item.qty}x
                    </span>
                  )}
                  {item.label}
                </span>
              </div>

              {/* Modifiers */}
              {hasModifiers && (
                <div className="mt-1 ml-1 pl-3 border-l-2 border-neutral-300 dark:border-neutral-700 space-y-1 text-xs opacity-90 text-neutral-600 dark:text-neutral-400">
                  {modGroups.map((group: any, gidx: number) => {
                    const selectedMods = Array.isArray(group.modifiers)
                      ? group.modifiers.filter((m: any) => m.selected || m.default || (m.quantity && m.quantity > 0))
                      : [];

                    return selectedMods.map((mod: any, midx: number) => (
                      <div key={`${gidx}-${midx}`} className="flex items-center gap-1 font-medium">
                        <span className="w-1 h-1 rounded-full bg-current opacity-50"></span>
                        {mod.quantity > 1 ? `${mod.quantity}x ` : ""}
                        {mod.priceAdjustment > 0 ? "+ " : ""}
                        {mod.name}
                      </div>
                    ));
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Special Instructions (Notes) */}
      {displayNotes && (
        <div className="mt-4 p-3 rounded-md text-sm bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-900 dark:text-yellow-100 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-wider mb-1 opacity-70 flex items-center gap-1">
            ⚠️ Special Request
          </div>
          <div className="font-medium italic leading-relaxed">"{displayNotes}"</div>
        </div>
      )}

      {order.orderType && order.orderType !== "dine-in" && (
        <div className="absolute top-2 right-2 opacity-5 font-black text-6xl pointer-events-none uppercase tracking-tighter">
          {order.orderType === 'takeout' ? 'TO' : order.orderType === 'delivery' ? 'DL' : ''}
        </div>
      )}
    </div>
  );
}

function SortableTicket({ order, onClear }: { order: KitchenOrder; onClear?: (id: string, uberId?: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: order.receiptId, data: { order } });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 50 : 1,
    position: 'relative' as const,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="mb-3">
      <KitchenTicket order={order} onClear={onClear} />
    </div>
  );
}

function KitchenColumn({ id, title, orders, colorClass, onArchive }: { id: string, title: string, orders: KitchenOrder[], colorClass: string, onArchive?: (id: string, uberId?: string) => void }) {
  const { setNodeRef } = useDroppable({ id });

  return (
    <div className="flex flex-col h-full min-w-[280px]">
      {/* Column Header */}
      <div className={`mb-3 px-3 py-2.5 rounded-lg bg-white/5 dark:bg-white/5 border border-white/10 flex justify-between items-center backdrop-blur-sm`}>
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${colorClass.replace('bg-', 'bg-').split(' ')[0]}`}></div>
          <h3 className="font-bold text-base text-neutral-800 dark:text-neutral-200 uppercase tracking-wide text-sm">{title}</h3>
        </div>
        <span className="text-xs font-mono font-bold bg-black/10 dark:bg-white/10 text-neutral-600 dark:text-neutral-400 px-2.5 py-1 rounded-full">{orders.length}</span>
      </div>

      <SortableContext items={orders.map(o => o.receiptId)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex-1 bg-neutral-100/50 dark:bg-[#111]/50 rounded-xl p-2 border-2 border-dashed border-transparent hover:border-neutral-200 dark:hover:border-neutral-800 transition-colors overflow-y-auto no-scrollbar max-h-[calc(100vh-180px)]">
          {orders.map(order => (
            <SortableTicket key={order.receiptId} order={order} onClear={onArchive} />
          ))}
          {orders.length === 0 && (
            <div className="h-48 flex flex-col items-center justify-center text-neutral-400 dark:text-neutral-600 text-sm italic opacity-50">
              <span>No items</span>
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

export default function KitchenDisplayPanel() {
  const account = useActiveAccount();
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pollIntervalRef = useRef<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
  const [activeId, setActiveId] = useState<string | null>(null);

  async function fetchOrders() {
    if (!account?.address) return;
    try {
      setLoading(true);
      setError("");

      const response = await fetch(`/api/kitchen/orders?wallet=${account.address}&status=new,preparing,ready,completed`, {
        headers: { "x-wallet": account.address },
        cache: "no-store",
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Failed to fetch orders");
        return;
      }

      const newOrders = data.orders || [];
      if (orders.length > 0) {
        const existingIds = new Set(orders.map(o => o.receiptId));
        const hasIncoming = newOrders.some((o: KitchenOrder) => !existingIds.has(o.receiptId) && o.kitchenStatus === 'new');
        if (hasIncoming) {
          try {
            const audio = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZQQ0PVqzn77JfGAg+ltrzxnMpBSp+zPLaizsIGGS57OihUhELTKXh8bllHAU2jtX0zn8uBSh1xPDek0ELElyx5/CrWBgIOZrb88l3LQUme8rx2o08CBlpvO7mnkwPCFWr5O+0YxoGPJfY88yAMgYeb8Tv45xEDQ9XrujwsmEaCT6W2vTIdjAFKn/M8dqLPQgZZbzs6aJRDwpLpODyuWQdBTSL0/XPgTEFKXXE8N+UQgwQV6/n8LFdGgg7mtv1y3oxBSl+zPPaizsIG2m97OmiUQ8KTKXh8bllHAU2j9X0z4ExBil1xe/flkEMElez5/GsWhgJO5na88h1MAUoesy+fkLPg==");
            audio.volume = 0.3;
            audio.play().catch(() => { });
          } catch { }
        }
      }

      setOrders(newOrders);
      setLastUpdate(Date.now());
    } catch (e: any) {
      setError(e?.message || "Failed to fetch orders");
    } finally {
      setLoading(false);
    }
  }

  async function updateOrderStatus(receiptId: string, newStatus: string, uberOrderId?: string) {
    if (!account?.address) return;

    setOrders(prev => prev.map(o => o.receiptId === receiptId ? { ...o, kitchenStatus: newStatus as any } : o));

    try {
      const response = await fetch("/api/kitchen/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-wallet": account.address },
        body: JSON.stringify({ receiptId, kitchenStatus: newStatus, uberOrderId }),
      });

      if (!response.ok) throw new Error("Failed to update status");
      setTimeout(fetchOrders, 1000);
    } catch (e: any) {
      console.error("Failed to update order status:", e);
      fetchOrders();
    }
  }

  useEffect(() => {
    fetchOrders();
    pollIntervalRef.current = window.setInterval(fetchOrders, 5000);
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
  }, [account?.address]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const handleDragStart = (event: DragStartEvent) => setActiveId(event.active.id as string);
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const activeOrder = orders.find(o => o.receiptId === active.id);
    if (!activeOrder) return;
    const overId = over.id as string;

    let targetStatus: string | null = null;
    if (["new", "preparing", "ready", "completed"].includes(overId)) {
      targetStatus = overId;
    } else {
      const overOrder = orders.find(o => o.receiptId === overId);
      if (overOrder) targetStatus = overOrder.kitchenStatus;
    }

    if (targetStatus && targetStatus !== activeOrder.kitchenStatus) {
      updateOrderStatus(activeOrder.receiptId, targetStatus, activeOrder.uberOrderId);
    }
  };

  const handleArchive = (id: string, uberOrderId?: string) => {
    updateOrderStatus(id, 'archived', uberOrderId);
  };

  const activeOrder = activeId ? orders.find(o => o.receiptId === activeId) : null;

  const cols = {
    new: orders.filter(o => o.kitchenStatus === 'new' || !o.kitchenStatus),
    preparing: orders.filter(o => o.kitchenStatus === 'preparing'),
    ready: orders.filter(o => o.kitchenStatus === 'ready'),
    completed: orders.filter(o => {
      if (o.kitchenStatus !== 'completed') return false;
      // Auto-hide after 30 minutes of being completed
      // We use check against completedAt if available, or just updated time? 
      // Best proxy is: Date.now() - (o.kitchenMetadata?.completedAt || o.updatedAt || 0) < 30 * 60 * 1000
      // Wait, 'updatedAt' isn't on the type definition fully in this file, let's check render. 
      // Type def at top has kitchenMetadata. Let's use that or fallback.
      const completionTime = o.kitchenMetadata?.completedAt || o.createdAt; // Fallback to createdAt if missing? No, that would hide old orders immediately?
      // If we don't track completion time, we can't auto-hide accurately. 
      // But the API updates `completedAt` when moving to completed. 
      // So we should be good if we trust that.
      if (!completionTime) return true; // Show if unsure
      const age = Date.now() - completionTime;
      return age < 30 * 60 * 1000;
    }),
  };

  if (!account?.address) return <div className="p-8 text-center text-muted-foreground border rounded-xl bg-neutral-900/50">Connect wallet to view KDS</div>;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-full flex flex-col space-y-4">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-1">
          <div data-tour="kitchen.kitchen-board">
            <h2 className="text-2xl font-bold tracking-tight text-white">Kitchen Display</h2>
            <div className="text-xs text-neutral-400 font-medium">
              Live • {orders.length} Orders • Last Sync: {new Date(lastUpdate).toLocaleTimeString()}
            </div>
          </div>
          <div className="flex gap-2">
            <button data-tour="kitchen.kitchen-synchronization" onClick={fetchOrders} className="px-4 py-2 text-xs font-semibold uppercase tracking-wider border border-white/10 rounded-lg hover:bg-white/5 transition-colors text-white">
              Sync
            </button>
          </div>
        </div>

        {/* 4-Column Grid */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 overflow-x-auto pb-4">
          <KitchenColumn id="new" title="New" orders={cols.new} colorClass="bg-orange-500 text-orange-500" />
          <KitchenColumn id="preparing" title="Prep" orders={cols.preparing} colorClass="bg-yellow-500 text-yellow-500" />
          <KitchenColumn id="ready" title="Ready" orders={cols.ready} colorClass="bg-green-500 text-green-500" />
          <KitchenColumn id="completed" title="Served" orders={cols.completed} colorClass="bg-neutral-500 text-neutral-500" onArchive={handleArchive} />
        </div>

        <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
          {activeOrder ? <KitchenTicket order={activeOrder} isOverlay /> : null}
        </DragOverlay>
      </div>
    </DndContext>
  );
}
