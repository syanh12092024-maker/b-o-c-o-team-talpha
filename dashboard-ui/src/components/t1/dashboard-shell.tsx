"use client";

import { useState, useEffect } from "react";
import {
    Megaphone, Package, DollarSign,
    Brain, Truck,
    ArrowLeft, CheckCircle2, AlertCircle, ShoppingCart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { subDays, format } from "date-fns";
import DateRangePicker from "@/components/ui/date-range-picker";
import Link from "next/link";

import OverviewTab from "./tabs/overview-tab";
import AdsTab from "./tabs/ads-tab";
import OrdersTab from "./tabs/orders-tab";
import FulfillmentTab from "./tabs/fulfillment-tab";
import AIInsightsTab from "./tabs/ai-insights-tab";

const TAB_ITEMS = [
    { id: "overview", label: "Tổng quan P&L", icon: DollarSign },
    { id: "ads", label: "Quảng cáo", icon: Megaphone },
    { id: "orders", label: "Đơn hàng & Kho", icon: ShoppingCart },
    { id: "fulfillment", label: "Fulfillment", icon: Truck },
    { id: "ai-insights", label: "AI Insights", icon: Brain },
];

// Auto-refresh interval — every 1 minute (matches sync runner)
const AUTO_REFRESH_MS = 60_000;
// Sync status polling — every 30 seconds
const SYNC_POLL_MS = 30_000;

export default function T1DashboardShell() {
    const [activeTab, setActiveTab] = useState("overview");
    const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
        from: subDays(new Date(), 59),
        to: new Date(),
    });

    // Auto-sync status (from background runner)
    const [syncStatus, setSyncStatus] = useState<any>(null);
    // refreshKey: increment to force all child tabs to re-fetch
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        document.cookie = "activeDataset=T1_Dataset; path=/;";
    }, []);

    // Poll sync status every 30 seconds
    useEffect(() => {
        const fetchSyncStatus = () => {
            fetch("/api/sync-status")
                .then(r => r.json())
                .then(data => setSyncStatus(data))
                .catch(() => { });
        };
        fetchSyncStatus(); // Initial fetch
        const interval = setInterval(fetchSyncStatus, SYNC_POLL_MS);
        return () => clearInterval(interval);
    }, []);

    // Auto-refresh: re-trigger tabs every 1 minute (matches sync frequency)
    useEffect(() => {
        const interval = setInterval(() => {
            setRefreshKey(k => k + 1);
        }, AUTO_REFRESH_MS);
        return () => clearInterval(interval);
    }, []);

    const isFresh = syncStatus?.is_fresh;
    const lastSyncTime = syncStatus?.last_sync
        ? new Date(syncStatus.last_sync).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
        : null;

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            {/* Sidebar */}
            <aside className="w-64 border-r border-border bg-white flex flex-col shadow-sm">
                <div className="flex flex-col border-b border-border p-4">
                    <div className="flex items-center justify-between mb-3">
                        <Link href="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
                            <ArrowLeft className="h-3 w-3" /> Trang chu
                        </Link>
                    </div>
                    <div className="flex items-center gap-3">
                        <img src="/logo.png" alt=" " className="h-10 w-10 object-contain" />
                        <div>
                            <span className="text-lg font-bold text-sky-600">T1</span>
                            <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-600">Live</span>
                        </div>
                    </div>
                    <span className="text-xs text-muted-foreground mt-1 ml-[52px]">EU Market / VND</span>
                </div>
                <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
                    {TAB_ITEMS.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className={cn(
                                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                                activeTab === item.id
                                    ? "bg-gradient-to-r from-sky-50 to-blue-50 text-sky-700 shadow-sm border border-sky-200/60"
                                    : "text-muted-foreground hover:bg-gray-50 hover:text-foreground"
                            )}
                        >
                            <item.icon className={cn("h-4 w-4", activeTab === item.id ? "text-sky-500" : "")} />
                            {item.label}
                        </button>
                    ))}
                </nav>

                {/* Auto-Sync Status Panel */}
                <div className="border-t border-border p-3 space-y-2">
                    {/* Live sync indicator */}
                    <div className={cn(
                        "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold",
                        isFresh
                            ? "bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-700 border border-emerald-200"
                            : syncStatus?.running === false
                                ? "bg-gray-50 text-gray-500 border border-gray-200"
                                : "bg-amber-50 text-amber-600 border border-amber-200"
                    )}>
                        <span className={cn(
                            "h-2 w-2 rounded-full",
                            isFresh ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
                        )} />
                        {isFresh
                            ? `🟢 Auto-sync — ${lastSyncTime || "..."}`
                            : syncStatus?.running === false
                                ? "⚪ Sync chưa chạy"
                                : `🟡 Sync cũ — ${syncStatus?.seconds_ago || "?"}s ago`
                        }
                    </div>

                    {/* Per-source status */}
                    {syncStatus?.sources && Object.keys(syncStatus.sources).length > 0 && (
                        <div className="text-[10px] text-muted-foreground space-y-0.5 pl-2">
                            {Object.entries(syncStatus.sources).map(([key, src]: [string, any]) => (
                                <div key={key} className={cn(
                                    "flex items-center gap-1",
                                    src.status === "success" ? "text-emerald-600" : "text-red-500"
                                )}>
                                    {src.status === "success"
                                        ? <CheckCircle2 className="h-2.5 w-2.5" />
                                        : <AlertCircle className="h-2.5 w-2.5" />
                                    }
                                    <span className="font-medium">{key}:</span>
                                    <span>{src.time || "—"}</span>
                                    {src.status === "error" && (
                                        <span className="text-red-400 truncate max-w-[120px]" title={src.message}>
                                            {src.message?.substring(0, 30)}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                        <img src="/logo.png" alt="" className="h-5 w-5 opacity-40" />
                        <span>Level Up Analytics</span>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto bg-background">
                <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-white/80 px-6 backdrop-blur-xl shadow-sm">
                    <h1 className="text-xl font-semibold text-foreground">
                        {TAB_ITEMS.find((t) => t.id === activeTab)?.label}
                    </h1>
                    <div className="flex items-center gap-3">
                        {/* Auto-refresh indicator */}
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Auto-refresh 1m
                        </div>
                        <DateRangePicker value={dateRange} onChange={setDateRange} />
                    </div>
                </header>

                <div className="p-6">
                    {activeTab === "overview" && <OverviewTab key={`ov-${refreshKey}`} dateRange={dateRange} />}
                    {activeTab === "ads" && <AdsTab key={`ads-${refreshKey}`} dateRange={dateRange} />}
                    {activeTab === "orders" && <OrdersTab key={`ord-${refreshKey}`} dateRange={dateRange} />}
                    {activeTab === "fulfillment" && <FulfillmentTab key={`ffm-${refreshKey}`} dateRange={dateRange} />}
                    {activeTab === "ai-insights" && <AIInsightsTab key={`ai-${refreshKey}`} dateRange={dateRange} />}
                </div>
            </main>
        </div>
    );
}
