"use client";

import { useState, useEffect } from "react";
import {
    Megaphone, Package, DollarSign,
    Users, Brain, Globe, Target,
    ArrowLeft, Radar, Beaker, Wallet, Trophy, Zap, RefreshCw, PenTool,
    LayoutDashboard, UserCheck, FileBarChart, Warehouse, ShoppingBag
} from "lucide-react";
import { cn } from "@/lib/utils";
import { startOfMonth } from "date-fns";
import DateRangePicker from "@/components/ui/date-range-picker";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import Link from "next/link";

import CEOOverviewTab from "./tabs/ceo-overview-tab";
import MarketingTab from "./tabs/marketing-tab";
import ProductsTab from "./tabs/products-tab";
import PnLTab from "./tabs/pnl-tab";
import CustomerTab from "./tabs/customer-tab";
import MarketIntelTab from "./tabs/market-intel-tab";
import AdsCommandTab from "./tabs/ads-command-tab";
import AdsSpyTab from "./tabs/ads-spy-tab";
import ProductTestTab from "./tabs/product-test-tab";
import BudgetTab from "./tabs/budget-tab";
import ScorecardTab from "./tabs/scorecard-tab";
import ScalingRulesTab from "./tabs/scaling-rules-tab";
import AIInsightsTab from "./tabs/ai-insights-tab";
import SalesScriptTab from "./tabs/sales-script-tab";
import OverviewTab from "./tabs/overview-tab";
import MarketerPerfTab from "./tabs/marketer-perf-tab";
import ExecutiveReportTab from "./tabs/executive-report-tab";
import InventoryTab from "./tabs/inventory-tab";
import ProductPnlTab from "./tabs/product-pnl-tab";

function SyncPOSButton() {
    const [syncing, setSyncing] = useState(false);

    const handleSync = async () => {
        setSyncing(true);
        try {
            const res = await fetch("/api/auus1/sync-pos", { method: "POST" });
            const data = await res.json();
            if (data.status === "success") {
                alert("Đồng bộ POS thành công! Dữ liệu đã được cập nhật.");
                window.location.reload();
            } else {
                alert("Lỗi đồng bộ: " + data.message);
            }
        } catch (e: any) {
            alert("Lỗi kết nối: " + e.message);
        } finally {
            setSyncing(false);
        }
    };

    return (
        <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400 transition"
        >
            <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
            {syncing ? "Đang đồng bộ..." : "Đồng bộ POS"}
        </button>
    );
}

const TAB_ITEMS = [
    // ── Command Center ──
    { id: "ads-command", label: "Ads Command Center", icon: Target },
    { id: "ceo", label: "CEO Intelligence", icon: Brain },
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "executive-report", label: "Executive Report", icon: FileBarChart },
    // ── AI & Tools ──
    { id: "sales-script", label: "Sales Script Maker", icon: PenTool },
    { id: "ai-insights", label: "AI Insights", icon: Brain },
    // ── Ads Operations ──
    { id: "ads-spy", label: "Spy Ads", icon: Radar },
    { id: "product-lab", label: "Product Lab 🧪", icon: Beaker },
    { id: "budget", label: "Budget Optimizer 💰", icon: Wallet },
    { id: "scaling", label: "⚡ Auto Rules", icon: Zap },
    // ── Performance ──
    { id: "scorecard", label: "Scorecard 📊", icon: Trophy },
    { id: "marketer-perf", label: "Marketer Performance", icon: UserCheck },
    { id: "marketing", label: "Marketing & Ads", icon: Megaphone },
    // ── Finance & Products ──
    { id: "pnl", label: "P&L", icon: DollarSign },
    { id: "product-pnl", label: "Product P&L", icon: ShoppingBag },
    { id: "products", label: "Sản phẩm & Kho", icon: Package },
    { id: "inventory", label: "Inventory", icon: Warehouse },
    // ── Customers & Market ──
    { id: "customers", label: "Khách hàng", icon: Users },
    { id: "market-intel", label: "Market Intel", icon: Globe },
];

export default function AUUS1DashboardShell() {
    const [activeTab, setActiveTab] = useState("ads-command");
    const [mountedTabs, setMountedTabs] = useState<Set<string>>(new Set(["ads-command"]));
    const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
        from: startOfMonth(new Date()),
        to: new Date(),
    });

    useEffect(() => {
        setMountedTabs((prev) => {
            if (prev.has(activeTab)) return prev;
            const next = new Set(prev);
            next.add(activeTab);
            return next;
        });
    }, [activeTab]);

    // Set AUUS1 dataset cookie on mount
    useEffect(() => {
        document.cookie = "activeDataset=AUUS1_Dataset; path=/;";
    }, []);

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            {/* Sidebar */}
            <aside className="w-64 border-r border-border bg-white dark:bg-[#0d1117] flex flex-col shadow-sm dark:shadow-none">
                <div className="flex flex-col border-b border-border p-4">
                    <div className="flex items-center justify-between mb-3">
                        <Link href="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
                            <ArrowLeft className="h-3 w-3" /> Trang chủ
                        </Link>
                    </div>
                    <div className="flex items-center gap-3">
                        <img src="/logo.png" alt="Level Up" className="h-10 w-10 object-contain" />
                        <div>
                            <span className="text-lg font-bold brand-gradient-text">AUUS1</span>
                            <span className="ml-2 rounded-full bg-emerald-100 dark:bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Active</span>
                        </div>
                    </div>
                    <span className="text-xs text-muted-foreground mt-1 ml-[52px]">AU / US Markets</span>
                </div>
                <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
                    {TAB_ITEMS.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className={cn(
                                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                                activeTab === item.id
                                    ? "bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-500/10 dark:to-red-500/10 text-orange-700 dark:text-orange-400 shadow-sm border border-orange-200/60 dark:border-orange-500/20"
                                    : "text-muted-foreground hover:bg-gray-50 dark:hover:bg-white/[0.04] hover:text-foreground"
                            )}
                        >
                            <item.icon className={cn("h-4 w-4", activeTab === item.id ? "text-orange-500 dark:text-orange-400" : "")} />
                            {item.label}
                        </button>
                    ))}
                </nav>
                {/* Footer branding */}
                <div className="border-t border-border p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <img src="/logo.png" alt="" className="h-5 w-5 opacity-40" />
                        <span>Level Up Analytics</span>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto bg-background">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-white/80 dark:bg-[#0d1117]/80 px-6 backdrop-blur-xl shadow-sm dark:shadow-none">
            <h1 className="text-xl font-semibold text-foreground">
                {TAB_ITEMS.find((t) => t.id === activeTab)?.label}
            </h1>
            <div className="flex items-center gap-3">
                <SyncPOSButton />
                {["ceo", "marketing", "products", "pnl", "customers", "market-intel", "overview", "marketer-perf", "executive-report", "inventory", "product-pnl"].includes(activeTab) && (
                    <DateRangePicker value={dateRange} onChange={setDateRange} />
                )}
                <ThemeToggle />
            </div>
        </header>

                <div className="p-6">
                    {mountedTabs.has("ceo") && (
                        <div className={activeTab === "ceo" ? "block" : "hidden"}>
                            <CEOOverviewTab dateRange={dateRange} projectId="AUUS1" />
                        </div>
                    )}
                    {mountedTabs.has("marketing") && (
                        <div className={activeTab === "marketing" ? "block" : "hidden"}>
                            <MarketingTab dateRange={dateRange} projectId="AUUS1" />
                        </div>
                    )}
                    {mountedTabs.has("products") && (
                        <div className={activeTab === "products" ? "block" : "hidden"}>
                            <ProductsTab dateRange={dateRange} projectId="AUUS1" />
                        </div>
                    )}
                    {mountedTabs.has("pnl") && (
                        <div className={activeTab === "pnl" ? "block" : "hidden"}>
                            <PnLTab dateRange={dateRange} projectId="AUUS1" />
                        </div>
                    )}
                    {mountedTabs.has("customers") && (
                        <div className={activeTab === "customers" ? "block" : "hidden"}>
                            <CustomerTab dateRange={dateRange} projectId="AUUS1" />
                        </div>
                    )}
                    {mountedTabs.has("market-intel") && (
                        <div className={activeTab === "market-intel" ? "block" : "hidden"}>
                            <MarketIntelTab dateRange={dateRange} projectId="AUUS1" />
                        </div>
                    )}
                    {mountedTabs.has("ads-command") && (
                        <div className={activeTab === "ads-command" ? "block" : "hidden"}>
                            <AdsCommandTab />
                        </div>
                    )}
                    {mountedTabs.has("ads-spy") && (
                        <div className={activeTab === "ads-spy" ? "block" : "hidden"}>
                            <AdsSpyTab />
                        </div>
                    )}
                    {mountedTabs.has("product-lab") && (
                        <div className={activeTab === "product-lab" ? "block" : "hidden"}>
                            <ProductTestTab />
                        </div>
                    )}
                    {mountedTabs.has("budget") && (
                        <div className={activeTab === "budget" ? "block" : "hidden"}>
                            <BudgetTab />
                        </div>
                    )}
                    {mountedTabs.has("scorecard") && (
                        <div className={activeTab === "scorecard" ? "block" : "hidden"}>
                            <ScorecardTab />
                        </div>
                    )}
                    {mountedTabs.has("ai-insights") && (
                        <div className={activeTab === "ai-insights" ? "block" : "hidden"}>
                            <AIInsightsTab dateRange={dateRange} />
                        </div>
                    )}
                    {mountedTabs.has("sales-script") && (
                        <div className={activeTab === "sales-script" ? "block" : "hidden"}>
                            <SalesScriptTab />
                        </div>
                    )}
                    {mountedTabs.has("scaling") && (
                        <div className={activeTab === "scaling" ? "block" : "hidden"}>
                            <ScalingRulesTab />
                        </div>
                    )}
                    {mountedTabs.has("overview") && (
                        <div className={activeTab === "overview" ? "block" : "hidden"}>
                            <OverviewTab dateRange={dateRange} />
                        </div>
                    )}
                    {mountedTabs.has("marketer-perf") && (
                        <div className={activeTab === "marketer-perf" ? "block" : "hidden"}>
                            <MarketerPerfTab dateRange={dateRange} />
                        </div>
                    )}
                    {mountedTabs.has("executive-report") && (
                        <div className={activeTab === "executive-report" ? "block" : "hidden"}>
                            <ExecutiveReportTab dateRange={dateRange} />
                        </div>
                    )}
                    {mountedTabs.has("inventory") && (
                        <div className={activeTab === "inventory" ? "block" : "hidden"}>
                            <InventoryTab dateRange={dateRange} />
                        </div>
                    )}
                    {mountedTabs.has("product-pnl") && (
                        <div className={activeTab === "product-pnl" ? "block" : "hidden"}>
                            <ProductPnlTab dateRange={dateRange} />
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
