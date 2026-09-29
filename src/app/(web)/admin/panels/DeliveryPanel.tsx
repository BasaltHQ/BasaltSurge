
"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
    Truck, ShoppingBag, RefreshCw, CheckCircle, AlertCircle, Unplug,
    Store, Clock, DollarSign, Package, TrendingUp, MapPin, Activity,
    Wifi, WifiOff, Calendar, ChevronRight, ExternalLink, Settings,
    Circle, Timer, Users, Star, ArrowUpRight, ArrowDownRight
} from "lucide-react";

type ConnectionData = {
    connected: boolean;
    storeId?: string;
    connectedAt?: number;
    storeName?: string;
    storeAddress?: string;
};

type OrderStats = {
    activeOrders: number;
    completedToday: number;
    pendingOrders: number;
    cancelledToday: number;
    revenueToday: number;
    averageDeliveryTime: number;
    ordersThisWeek: number;
    revenueThisWeek: number;
};

type RecentOrder = {
    id: string;
    orderNumber: string;
    customerName: string;
    items: number;
    total: number;
    status: "pending" | "preparing" | "ready" | "picked_up" | "delivered" | "cancelled";
    createdAt: number;
    estimatedDelivery?: number;
};

const STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    pending: { bg: "bg-yellow-100", text: "text-yellow-700", icon: <Clock className="w-3 h-3" /> },
    preparing: { bg: "bg-blue-100", text: "text-blue-700", icon: <RefreshCw className="w-3 h-3" /> },
    ready: { bg: "bg-purple-100", text: "text-purple-700", icon: <Package className="w-3 h-3" /> },
    picked_up: { bg: "bg-indigo-100", text: "text-indigo-700", icon: <Truck className="w-3 h-3" /> },
    delivered: { bg: "bg-green-100", text: "text-green-700", icon: <CheckCircle className="w-3 h-3" /> },
    cancelled: { bg: "bg-red-100", text: "text-red-700", icon: <AlertCircle className="w-3 h-3" /> },
};

// Mock data for demo - in production this would come from API
const MOCK_STATS: OrderStats = {
    activeOrders: 3,
    completedToday: 12,
    pendingOrders: 2,
    cancelledToday: 1,
    revenueToday: 487.50,
    averageDeliveryTime: 28,
    ordersThisWeek: 67,
    revenueThisWeek: 3245.80,
};

const MOCK_ORDERS: RecentOrder[] = [
    { id: "1", orderNumber: "UE-7823", customerName: "John D.", items: 3, total: 42.50, status: "preparing", createdAt: Date.now() - 15 * 60000 },
    { id: "2", orderNumber: "UE-7822", customerName: "Sarah M.", items: 2, total: 28.99, status: "ready", createdAt: Date.now() - 25 * 60000 },
    { id: "3", orderNumber: "UE-7821", customerName: "Mike R.", items: 5, total: 67.25, status: "picked_up", createdAt: Date.now() - 35 * 60000, estimatedDelivery: Date.now() + 10 * 60000 },
    { id: "4", orderNumber: "UE-7820", customerName: "Emily K.", items: 1, total: 15.99, status: "delivered", createdAt: Date.now() - 60 * 60000 },
    { id: "5", orderNumber: "UE-7819", customerName: "David L.", items: 4, total: 55.00, status: "delivered", createdAt: Date.now() - 90 * 60000 },
];

export default function DeliveryPanel() {
    const [mode, setMode] = useState<"dashboard" | "wizard" | "menu">("dashboard");
    const [storeId, setStoreId] = useState("");
    const [isConnected, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isCheckingStatus, setIsCheckingStatus] = useState(true);
    const [status, setStatus] = useState("");
    const [syncResult, setSyncResult] = useState<any>(null);
    const [connectionData, setConnectionData] = useState<ConnectionData | null>(null);
    const [stats, setStats] = useState<OrderStats>(MOCK_STATS);
    const [recentOrders, setRecentOrders] = useState<RecentOrder[]>(MOCK_ORDERS);
    const [lastSync, setLastSync] = useState<number | null>(null);

    // Load connection status on mount
    useEffect(() => {
        async function checkStatus() {
            try {
                const res = await fetch("/api/integrations/delivery/connect");
                const data = await res.json();
                if (data.connected) {
                    setIsConnected(true);
                    setStoreId(data.storeId || "");
                    setConnectionData(data);
                }
            } catch (e) {
                console.error("Failed to check connection status:", e);
            } finally {
                setIsCheckingStatus(false);
            }
        }
        checkStatus();
    }, []);

    // Fetch real data from orders API
    const refreshData = useCallback(async () => {
        if (!isConnected || !storeId) return;

        try {
            const res = await fetch(`/api/integrations/delivery/orders?storeId=${storeId}`);
            const data = await res.json();

            if (res.ok && data.orders) {
                // Map API response to our state shape
                setRecentOrders(data.orders.map((order: any) => ({
                    id: order.id,
                    orderNumber: order.orderNumber,
                    customerName: order.customerName,
                    items: order.items,
                    total: order.total,
                    status: order.status,
                    createdAt: order.createdAt,
                    estimatedDelivery: order.estimatedDelivery
                })));

                if (data.stats) {
                    setStats({
                        activeOrders: data.stats.activeOrders || 0,
                        completedToday: data.stats.completedToday || 0,
                        pendingOrders: data.stats.pendingOrders || 0,
                        cancelledToday: data.stats.cancelledToday || 0,
                        revenueToday: data.stats.revenueToday || 0,
                        averageDeliveryTime: data.stats.averageDeliveryTime || 0,
                        ordersThisWeek: data.stats.ordersThisWeek || 0,
                        revenueThisWeek: data.stats.revenueThisWeek || 0,
                    });
                }
            }

            setLastSync(Date.now());
        } catch (e) {
            console.error("Failed to refresh order data:", e);
        }
    }, [isConnected, storeId]);

    useEffect(() => {
        if (isConnected) {
            refreshData();
            const interval = setInterval(refreshData, 60000); // Refresh every minute
            return () => clearInterval(interval);
        }
    }, [isConnected, refreshData]);

    // -- Actions --

    async function handleConnect() {
        if (!storeId) {
            setStatus("Please enter your Store ID.");
            return;
        }
        setIsLoading(true);
        setStatus("Connecting...");
        try {
            const authRes = await fetch("/api/integrations/delivery/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ storeId })
            });
            const authData = await authRes.json();
            if (!authRes.ok) throw new Error(authData.error || "Connection failed");

            const connectRes = await fetch("/api/integrations/delivery/connect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "connect", storeId })
            });
            const connectData = await connectRes.json();
            if (!connectRes.ok) throw new Error(connectData.error || "Failed to save connection");

            setIsConnected(true);
            setConnectionData({ connected: true, storeId, connectedAt: Date.now() });
            setStatus("Connected successfully!");
            setTimeout(() => setMode("dashboard"), 1500);
        } catch (e: any) {
            setStatus("Error: " + e.message);
        } finally {
            setIsLoading(false);
        }
    }

    async function handleDisconnect() {
        if (!confirm("Are you sure you want to disconnect from Uber Eats? You can reconnect at any time.")) {
            return;
        }

        setIsLoading(true);
        setStatus("Disconnecting...");
        try {
            const res = await fetch("/api/integrations/delivery/connect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "disconnect" })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Disconnect failed");

            setIsConnected(false);
            setStoreId("");
            setConnectionData(null);
            setStatus("Disconnected from Uber Eats");
        } catch (e: any) {
            setStatus("Error: " + e.message);
        } finally {
            setIsLoading(false);
        }
    }

    async function handleMenuSync() {
        setIsLoading(true);
        setSyncResult(null);
        try {
            const sid = storeId || "demo-store-123";
            const res = await fetch("/api/integrations/delivery/menu", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ storeId: sid })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Sync failed");

            setSyncResult(data);
            setLastSync(Date.now());
        } catch (e: any) {
            setSyncResult({ error: e.message });
        } finally {
            setIsLoading(false);
        }
    }

    function formatCurrency(amount: number) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
    }

    function formatTime(timestamp: number) {
        const mins = Math.floor((Date.now() - timestamp) / 60000);
        if (mins < 1) return "Just now";
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        return new Date(timestamp).toLocaleDateString();
    }

    // -- Sub-Components --

    function renderWizard() {
        return (
            <div className="max-w-xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="text-center space-y-2">
                    <div className="mx-auto w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl flex items-center justify-center shadow-lg">
                        <Truck className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight">Connect Uber Eats</h2>
                    <p className="text-muted-foreground">
                        Link your store to sync orders and menu in real-time.
                    </p>
                </div>

                <div className="bg-gradient-to-br from-background to-muted/30 border border-border/50 p-6 rounded-2xl space-y-5 shadow-sm">
                    <div className="space-y-2">
                        <label className="text-sm font-semibold flex items-center gap-2">
                            <Store className="w-4 h-4 text-muted-foreground" />
                            Uber Eats Store UUID
                        </label>
                        <input
                            type="text"
                            className="w-full px-4 py-3 border rounded-xl bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                            placeholder="e.g. 963d3f4a-b234-5678-..."
                            value={storeId}
                            onChange={e => setStoreId(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">Found in your Uber Eats Manager dashboard URL.</p>
                    </div>

                    <button
                        onClick={handleConnect}
                        disabled={isLoading || !storeId}
                        className="w-full py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-semibold hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md flex items-center justify-center gap-2"
                    >
                        {isLoading ? (
                            <><RefreshCw className="w-4 h-4 animate-spin" /> Connecting...</>
                        ) : (
                            <><Wifi className="w-4 h-4" /> Connect Store</>
                        )}
                    </button>

                    {status && (
                        <div className={`text-center text-sm p-3 rounded-lg ${status.includes("Error") ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"}`}>
                            {status}
                        </div>
                    )}
                </div>

                <div className="text-center">
                    <button onClick={() => setMode("dashboard")} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                        ← Back to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    function renderMenuSync() {
        return (
            <div className="space-y-6 animate-in fade-in">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold">Menu Synchronization</h2>
                        <p className="text-muted-foreground">Push your inventory items to Uber Eats.</p>
                    </div>
                    <button onClick={() => setMode("dashboard")} className="text-sm border px-4 py-2 rounded-lg hover:bg-muted transition-colors">
                        ← Back
                    </button>
                </div>

                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border p-8 rounded-2xl text-center space-y-5">
                    <div className="mx-auto w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                        <RefreshCw className={`w-10 h-10 text-white ${isLoading ? "animate-spin" : ""}`} />
                    </div>
                    <div>
                        <h3 className="text-xl font-semibold">Ready to Sync</h3>
                        <p className="text-sm text-muted-foreground max-w-md mx-auto mt-2">
                            This will update your Uber Eats menu with items from your inventory tagged with <span className="font-semibold">Restaurant Pack</span>.
                        </p>
                    </div>

                    <button
                        onClick={handleMenuSync}
                        disabled={isLoading}
                        className="px-8 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-semibold hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 transition-all shadow-md"
                    >
                        {isLoading ? "Syncing..." : "Push Menu Update"}
                    </button>

                    {syncResult && (
                        <div className={`mt-4 p-4 rounded-xl text-left text-sm ${syncResult.error ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                            {syncResult.error ? (
                                <div className="flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4" />
                                    <span>Error: {syncResult.error}</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4" />
                                    <span>
                                        Successfully synced {syncResult.syncedItems || 0} items
                                        {syncResult.details && ` - ${syncResult.details}`}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    function renderDashboard() {
        if (!isConnected && !isCheckingStatus) {
            // Not connected - show onboarding view
            return (
                <div className="space-y-8 animate-in fade-in">
                    <div data-tour="delivery.connect-a-delivery-store" className="text-center max-w-2xl mx-auto py-12">
                        <div className="mx-auto w-20 h-20 bg-gradient-to-br from-green-500/10 to-emerald-500/10 rounded-3xl flex items-center justify-center mb-6">
                            <Truck className="w-10 h-10 text-green-600" />
                        </div>
                        <h1 className="text-3xl font-bold tracking-tight mb-3">Connect to Uber Eats</h1>
                        <p className="text-muted-foreground text-lg mb-8">
                            Sync your menu, receive orders, and track deliveries all in one place.
                        </p>
                        <button
                            onClick={() => setMode("wizard")}
                            className="px-8 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-semibold hover:from-green-600 hover:to-emerald-700 transition-all shadow-lg flex items-center gap-2 mx-auto"
                        >
                            <Wifi className="w-5 h-5" /> Get Started
                        </button>
                    </div>

                    {/* Features Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
                        <div className="p-6 rounded-2xl border bg-card/50">
                            <Package className="w-8 h-8 text-blue-500 mb-3" />
                            <h3 className="font-semibold mb-1">Menu Sync</h3>
                            <p className="text-sm text-muted-foreground">Automatically sync your inventory to Uber Eats</p>
                        </div>
                        <div className="p-6 rounded-2xl border bg-card/50">
                            <Activity className="w-8 h-8 text-purple-500 mb-3" />
                            <h3 className="font-semibold mb-1">Real-time Orders</h3>
                            <p className="text-sm text-muted-foreground">Receive and manage orders instantly</p>
                        </div>
                        <div className="p-6 rounded-2xl border bg-card/50">
                            <TrendingUp className="w-8 h-8 text-green-500 mb-3" />
                            <h3 className="font-semibold mb-1">Analytics</h3>
                            <p className="text-sm text-muted-foreground">Track revenue and delivery performance</p>
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="space-y-6 animate-in fade-in">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div data-tour="delivery.delivery-dashboard">
                        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                            Delivery
                            {isConnected && (
                                <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-bold flex items-center gap-1">
                                    <Circle className="w-2 h-2 fill-current" /> Live
                                </span>
                            )}
                        </h1>
                        <p className="text-muted-foreground">Manage your Uber Eats orders and integration.</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {isCheckingStatus ? (
                            <span className="px-3 py-1.5 bg-muted rounded-lg text-xs font-medium flex items-center gap-2">
                                <RefreshCw className="w-3 h-3 animate-spin" /> Checking status...
                            </span>
                        ) : (
                            <>
                                <button
                                    onClick={refreshData}
                                    className="px-3 py-1.5 border rounded-lg text-xs font-medium flex items-center gap-1.5 hover:bg-muted transition-colors"
                                >
                                    <RefreshCw className="w-3 h-3" /> Refresh
                                </button>
                                <button
                                    onClick={() => setMode("menu")}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm flex items-center gap-2 hover:bg-blue-700 transition-colors"
                                >
                                    <ShoppingBag className="w-4 h-4" /> Sync Menu
                                </button>
                                <button
                                    onClick={handleDisconnect}
                                    disabled={isLoading}
                                    className="px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                                >
                                    <Unplug className="w-3 h-3" /> Disconnect
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Store Info Card */}
                {isConnected && connectionData && (
                    <div className="bg-gradient-to-r from-green-500/5 via-emerald-500/5 to-teal-500/5 border border-green-200/50 rounded-2xl p-5">
                        <div className="flex items-start justify-between">
                            <div className="flex items-center gap-4">
                                <div className="w-14 h-14 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-md">
                                    <Store className="w-7 h-7 text-white" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-lg">Connected Store</h3>
                                    <p className="text-sm text-muted-foreground font-mono">{storeId}</p>
                                    {connectionData.connectedAt && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Connected {formatTime(connectionData.connectedAt)}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="flex items-center gap-1.5 text-xs text-green-600 bg-green-100 px-2 py-1 rounded-full">
                                    <Wifi className="w-3 h-3" /> Connected
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-card border rounded-xl p-5 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground font-medium">Active Orders</span>
                            <Clock className="w-4 h-4 text-yellow-500" />
                        </div>
                        <div className="text-3xl font-bold">{stats.activeOrders}</div>
                        <div className="text-xs text-muted-foreground">{stats.pendingOrders} pending</div>
                    </div>

                    <div className="bg-card border rounded-xl p-5 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground font-medium">Today's Revenue</span>
                            <DollarSign className="w-4 h-4 text-green-500" />
                        </div>
                        <div className="text-3xl font-bold">{formatCurrency(stats.revenueToday)}</div>
                        <div className="text-xs text-green-600 flex items-center gap-1">
                            <ArrowUpRight className="w-3 h-3" /> +12% vs yesterday
                        </div>
                    </div>

                    <div className="bg-card border rounded-xl p-5 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground font-medium">Completed</span>
                            <CheckCircle className="w-4 h-4 text-emerald-500" />
                        </div>
                        <div className="text-3xl font-bold">{stats.completedToday}</div>
                        <div className="text-xs text-muted-foreground">{stats.cancelledToday} cancelled</div>
                    </div>

                    <div className="bg-card border rounded-xl p-5 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground font-medium">Avg. Delivery</span>
                            <Timer className="w-4 h-4 text-blue-500" />
                        </div>
                        <div className="text-3xl font-bold">{stats.averageDeliveryTime}<span className="text-lg font-normal">m</span></div>
                        <div className="text-xs text-muted-foreground">avg delivery time</div>
                    </div>
                </div>

                {/* Recent Orders */}
                <div className="border rounded-2xl overflow-hidden">
                    <div data-tour="delivery.recent-delivery-orders" className="px-5 py-4 border-b bg-muted/30 flex items-center justify-between">
                        <h3 className="font-semibold flex items-center gap-2">
                            <Package className="w-4 h-4" /> Recent Orders
                        </h3>
                        {lastSync && (
                            <span className="text-xs text-muted-foreground">
                                Last updated {formatTime(lastSync)}
                            </span>
                        )}
                    </div>
                    <div className="divide-y">
                        {recentOrders.map((order) => {
                            const statusStyle = STATUS_COLORS[order.status] || STATUS_COLORS.pending;
                            return (
                                <div key={order.id} className="px-5 py-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${statusStyle.bg}`}>
                                            {statusStyle.icon}
                                        </div>
                                        <div>
                                            <div className="font-medium flex items-center gap-2">
                                                {order.orderNumber}
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                                                    {order.status.replace("_", " ")}
                                                </span>
                                            </div>
                                            <div className="text-sm text-muted-foreground">
                                                {order.customerName} • {order.items} items
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-semibold">{formatCurrency(order.total)}</div>
                                        <div className="text-xs text-muted-foreground">{formatTime(order.createdAt)}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="px-5 py-3 border-t bg-muted/20 text-center">
                        <button className="text-sm text-primary hover:underline flex items-center gap-1 mx-auto">
                            View all orders <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Weekly Summary */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="border rounded-2xl p-6">
                        <h3 className="font-semibold mb-4 flex items-center gap-2">
                            <Calendar className="w-4 h-4" /> This Week
                        </h3>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Total Orders</span>
                                <span className="font-semibold">{stats.ordersThisWeek}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Total Revenue</span>
                                <span className="font-semibold text-green-600">{formatCurrency(stats.revenueThisWeek)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Avg. Order Value</span>
                                <span className="font-semibold">{formatCurrency(stats.revenueThisWeek / stats.ordersThisWeek)}</span>
                            </div>
                        </div>
                    </div>

                    <div data-tour="delivery.integration-health" className="border rounded-2xl p-6">
                        <h3 className="font-semibold mb-4 flex items-center gap-2">
                            <Activity className="w-4 h-4" /> Integration Health
                        </h3>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="flex items-center gap-2 text-sm">
                                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                    API Connection
                                </span>
                                <span className="text-xs text-green-600 font-medium">Healthy</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="flex items-center gap-2 text-sm">
                                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                    Webhook Receiver
                                </span>
                                <span className="text-xs text-green-600 font-medium">Active</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="flex items-center gap-2 text-sm">
                                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                    Menu Sync
                                </span>
                                <span className="text-xs text-muted-foreground font-medium">Last synced {lastSync ? formatTime(lastSync) : "never"}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Use simple conditional rendering
    return (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 w-full space-y-6 pb-24">
            {mode === 'wizard' && renderWizard()}
            {mode === 'menu' && renderMenuSync()}
            {mode === 'dashboard' && renderDashboard()}
        </div>
    );
}
