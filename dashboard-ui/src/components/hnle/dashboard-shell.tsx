"use client";

import { useState, useEffect } from "react";
import {
    Megaphone, Package, DollarSign,
    Users, Brain, Globe, Target, Warehouse,
    ArrowLeft, BarChart2
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

const TAB_ITEMS = [
    { id: "ceo", label: "CEO Intelligence", icon: Brain },
    { id: "ads-command", label: "Ads Command Center", icon: Target },
    { id: "marketing", label: "Marketing & Ads", icon: Megaphone },
    { id: "ads-market", label: "Ads × Thị trường", icon: BarChart2 },
    { id: "products", label: "Sản phẩm & Kho", icon: Package },
    { id: "pnl", label: "P&L", icon: DollarSign },
    { id: "customers", label: "Khách hàng", icon: Users },
    { id: "inventory", label: "Tồn kho", icon: Warehouse },
    { id: "market-intel", label: "Market Intel", icon: Globe },
];

export default function HNLEDashboardShell() {
    const [activeTab, setActiveTab] = useState("ceo");
    const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
        from: subDays(new Date(), 59),
        to: new Date(),
    });

    // Set HNLE dataset cookie on mount
    useEffect(() => {
        document.cookie = "activeDataset=HNLE_Dataset; path=/;";
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
                            <span className="text-lg font-bold brand-gradient-text">HNLE</span>
                            <span className="ml-2 rounded-full bg-indigo-100 dark:bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">New</span>
                        </div>
                    </div>
                    <span className="text-xs text-muted-foreground mt-1 ml-[52px]">Middle East & Australia</span>
                </div>
                <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
                    {TAB_ITEMS.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className={cn(
                                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                                activeTab === item.id
                                    ? "bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-500/10 dark:to-blue-500/10 text-indigo-700 dark:text-indigo-400 shadow-sm border border-indigo-200/60 dark:border-indigo-500/20"
                                    : "text-muted-foreground hover:bg-gray-50 dark:hover:bg-white/[0.04] hover:text-foreground"
                            )}
                        >
                            <item.icon className={cn("h-4 w-4", activeTab === item.id ? "text-indigo-500 dark:text-indigo-400" : "")} />
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
                {activeTab !== "marketing" && activeTab !== "ceo" && activeTab !== "ads-market" && (
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

                <div className={activeTab === "ceo" ? "p-6 pt-4" : "p-6"}>
                    {activeTab === "ceo" && <CEOOverviewTab dateRange={dateRange} />}
                    {activeTab === "marketing" && <MarketingTab dateRange={dateRange} onDateRangeChange={setDateRange} />}
                    {activeTab === "ads-market" && <AdsMarketTab dateRange={dateRange} />}
                    {activeTab === "products" && <ProductsTab dateRange={dateRange} />}
                    {activeTab === "pnl" && <PnLTab dateRange={dateRange} />}
                    {activeTab === "customers" && <CustomerTab dateRange={dateRange} />}
                    {activeTab === "market-intel" && <MarketIntelTab dateRange={dateRange} />}
                    {activeTab === "ads-command" && <AdsCommandTab />}
                    {activeTab === "inventory" && <InventoryTab dateRange={dateRange} />}
                </div>
            </main>
        </div>
    );
}
