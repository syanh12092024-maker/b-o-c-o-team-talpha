"use client";

import { useState, useEffect } from "react";
import {
    Megaphone, Package, DollarSign,
    Users, Brain, Globe, Target,
    ArrowLeft, Search, Send, Truck,
    Settings, HelpCircle, FileText, ShoppingBag
} from "lucide-react";
import { cn } from "@/lib/utils";
import { subDays } from "date-fns";
import DateRangePicker from "@/components/ui/date-range-picker";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import Link from "next/link";

import TALPHACeoOverviewTab from "./tabs/ceo-overview-tab";
import TALPHAAdsCommandTab from "./tabs/ads-command-tab";
import TALPHAMarketingTab from "./tabs/marketing-tab";
import TALPHAProductsTab from "./tabs/products-tab";
import TALPHAPnLTab from "./tabs/pnl-tab";
import TALPHACustomerTab from "./tabs/customer-tab";
import TALPHAMarketIntelTab from "./tabs/market-intel-tab";

const TAB_ITEMS = [
    { id: "ceo", label: "Tổng quan CEO", icon: Brain },
    { id: "ads-command", label: "Trung tâm Quảng cáo", icon: Target },
    { id: "marketing", label: "Marketing & QC", icon: Megaphone },
    { id: "products", label: "Sản phẩm & Kho", icon: Package },
    { id: "pnl", label: "Lãi / Lỗ", icon: DollarSign },
    { id: "customers", label: "Khách hàng", icon: Users },
    { id: "market-intel", label: "Thị trường", icon: Globe },
];

export default function TALPHADashboardShell() {
    const [activeTab, setActiveTab] = useState("ads-command");
    const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
        from: subDays(new Date(), 59),
        to: new Date(),
    });

    useEffect(() => {
        document.cookie = "activeDataset=TALPHA_Dataset; path=/;";
    }, []);

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            {/* Sidebar */}
            <aside className="w-64 border-r border-border bg-white dark:bg-[#0d1117] backdrop-blur-xl flex flex-col shadow-sm dark:shadow-none">
                <div className="flex flex-col border-b border-border p-4">
                    <div className="flex items-center justify-between mb-2">
                        <Link href="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-xs">
                            <ArrowLeft className="h-3 w-3" /> Trang chủ
                        </Link>
                    </div>
                    <div className="flex items-center gap-3">
                        <img src="/logo.png" alt="Level Up" className="h-10 w-10 object-contain" />
                        <div>
                            <span className="text-lg font-bold brand-gradient-text">TALPHA</span>
                            <span className="ml-2 rounded-full bg-amber-100 dark:bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">Active</span>
                        </div>
                    </div>
                    <span className="text-xs text-muted-foreground mt-0.5 ml-[52px]">Tiểu Alpha — Middle East</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5 ml-[52px]">🇸🇦 🇦🇪 🇰🇼 🇴🇲 🇶🇦 🇧🇭</span>
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
                        {activeTab !== "ads-command" && (
                            <DateRangePicker value={dateRange} onChange={setDateRange} />
                        )}
                        <ThemeToggle />
                    </div>
                </header>

                <div className="p-6">
                    {activeTab === "ceo" && <TALPHACeoOverviewTab dateRange={dateRange} projectId="TALPHA" />}
                    {activeTab === "ads-command" && <TALPHAAdsCommandTab />}
                    {activeTab === "marketing" && <TALPHAMarketingTab dateRange={dateRange} projectId="TALPHA" />}
                    {activeTab === "products" && <TALPHAProductsTab dateRange={dateRange} projectId="TALPHA" />}
                    {activeTab === "pnl" && <TALPHAPnLTab dateRange={dateRange} projectId="TALPHA" />}
                    {activeTab === "customers" && <TALPHACustomerTab dateRange={dateRange} projectId="TALPHA" />}
                    {activeTab === "market-intel" && <TALPHAMarketIntelTab dateRange={dateRange} projectId="TALPHA" />}
                </div>
            </main>
        </div>
    );
}
