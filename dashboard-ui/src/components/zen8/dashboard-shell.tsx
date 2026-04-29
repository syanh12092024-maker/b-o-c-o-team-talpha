"use client";

import { useState, useEffect } from "react";
import {
    Megaphone, Package, DollarSign,
    Users, Brain, Globe, Target, Warehouse,
    ArrowLeft, LayoutDashboard
} from "lucide-react";
import { cn } from "@/lib/utils";
import { subDays } from "date-fns";
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
import InventoryTab from "./tabs/inventory-tab";
import AdsMarketTab from "./tabs/ads-market-tab";
import ProjectOverviewTab from "./tabs/project-overview-tab";

const TAB_ITEMS = [
    { id: "ceo", label: "CEO Intelligence", icon: Brain },
    { id: "ads-command", label: "Ads Command Center", icon: Target },
    { id: "ads-market", label: "Check CPQC", icon: Globe },
    { id: "marketing", label: "Marketing & Ads", icon: Megaphone },
    { id: "products", label: "Sản phẩm & Kho", icon: Package },
    { id: "pnl", label: "P&L", icon: DollarSign },
    { id: "customers", label: "Khách hàng", icon: Users },
    { id: "inventory", label: "Tồn kho", icon: Warehouse },
    { id: "market-intel", label: "Market Intel", icon: Globe },
];

export default function ZEN8DashboardShell() {
    const [activeTab, setActiveTab] = useState("ceo");
    const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
        from: subDays(new Date(), 59),
        to: new Date(),
    });

    // Set ZEN8 dataset cookie + force dark mode on mount
    useEffect(() => {
        document.cookie = "activeDataset=ZEN8_Dataset; path=/;";
        document.documentElement.classList.add("dark");
    }, []);

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            {/* Sidebar */}
            <aside className="w-64 border-r border-border bg-white dark:bg-[#0d1117] flex flex-col shadow-sm dark:shadow-none">
                {/* Logo + Project Header */}
                <div className="flex flex-col border-b border-border p-4">
                    <div className="flex items-center justify-between mb-3">
                        <Link href="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
                            <ArrowLeft className="h-3 w-3" /> Trang chủ
                        </Link>
                    </div>
                    <div className="flex items-center gap-3">
                        <img src="/logo.png" alt="Level Up" className="h-10 w-10 object-contain" />
                        <div>
                            <span className="text-lg font-bold brand-gradient-text">ZEN8</span>
                            <span className="ml-2 rounded-full bg-rose-100 dark:bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">Active</span>
                        </div>
                    </div>
                    <span className="text-xs text-muted-foreground mt-1 ml-[52px]">Middle East</span>
                </div>
                <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
                    {TAB_ITEMS.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className={cn(
                                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                                activeTab === item.id
                                    ? "bg-gradient-to-r from-rose-50 to-pink-50 dark:from-rose-500/10 dark:to-pink-500/10 text-rose-700 dark:text-rose-400 shadow-sm border border-rose-200/60 dark:border-rose-500/20"
                                    : "text-muted-foreground hover:bg-gray-50 dark:hover:bg-white/[0.04] hover:text-foreground"
                            )}
                        >
                            <item.icon className={cn("h-4 w-4", activeTab === item.id ? "text-rose-500 dark:text-rose-400" : "")} />
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
                {activeTab !== "overview" && activeTab !== "marketing" && activeTab !== "ceo" && activeTab !== "ads-market" && (
                    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-white/80 dark:bg-[#0d1117]/80 px-6 backdrop-blur-xl shadow-sm dark:shadow-none">
                        <h1 className="text-xl font-semibold text-foreground">
                            {TAB_ITEMS.find((t) => t.id === activeTab)?.label}
                        </h1>
                        <div className="flex items-center gap-3">
                            <DateRangePicker value={dateRange} onChange={setDateRange} />
                            <ThemeToggle />
                        </div>
                    </header>
                )}

                <div className={activeTab === "overview" ? "p-0" : "p-6"} style={activeTab === "ceo" ? { paddingTop: "1rem" } : undefined}>
                    {activeTab === "overview" && <ProjectOverviewTab dateRange={dateRange} />}
                    {activeTab === "ceo" && <CEOOverviewTab dateRange={dateRange} />}
                    {activeTab === "marketing" && <MarketingTab dateRange={dateRange} onDateRangeChange={setDateRange} />}
                    {activeTab === "products" && <ProductsTab dateRange={dateRange} />}
                    {activeTab === "pnl" && <PnLTab dateRange={dateRange} />}
                    {activeTab === "customers" && <CustomerTab dateRange={dateRange} />}
                    {activeTab === "market-intel" && <MarketIntelTab dateRange={dateRange} />}
                    {activeTab === "ads-command" && <AdsCommandTab />}
                    {activeTab === "ads-market" && <AdsMarketTab dateRange={dateRange} />}
                    {activeTab === "inventory" && <InventoryTab dateRange={dateRange} />}
                </div>
            </main>
        </div>
    );
}
