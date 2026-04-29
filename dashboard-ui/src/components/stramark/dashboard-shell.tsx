"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
    Megaphone, Package, DollarSign,
    Users, Brain, Globe, Target, Truck,
    Landmark, ArrowLeft
} from "lucide-react";
import { cn } from "@/lib/utils";
import { subDays } from "date-fns";

// Persist dateRange across tab navigation via sessionStorage.
// Reason: Next.js catch-all route may remount dashboard-shell on slug change,
// resetting local useState. sessionStorage survives the remount.
const DATE_RANGE_STORAGE_KEY = "stramark_dashboard_date_range";

function loadPersistedDateRange(): { from: Date; to: Date } {
    const defaultRange = { from: subDays(new Date(), 59), to: new Date() };
    if (typeof window === "undefined") return defaultRange;
    try {
        const saved = sessionStorage.getItem(DATE_RANGE_STORAGE_KEY);
        if (!saved) return defaultRange;
        const parsed = JSON.parse(saved);
        const from = new Date(parsed.from);
        const to = new Date(parsed.to);
        if (isNaN(from.getTime()) || isNaN(to.getTime())) return defaultRange;
        return { from, to };
    } catch {
        return defaultRange;
    }
}

function savePersistedDateRange(range: { from: Date; to: Date }) {
    if (typeof window === "undefined") return;
    try {
        sessionStorage.setItem(DATE_RANGE_STORAGE_KEY, JSON.stringify({
            from: range.from.toISOString(),
            to: range.to.toISOString(),
        }));
    } catch { /* quota / disabled — silent */ }
}
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
import FulfillmentTab from "./tabs/fulfillment-tab";
import FinancialControlTab from "./tabs/financial-control-tab";

type TabId =
    | "ceo" | "ads-command" | "marketing" | "products"
    | "fulfillment" | "financial" | "pnl" | "customers" | "market-intel";

interface TabItem {
    id: TabId;
    label: string;
    icon: typeof Brain;
    slug: string;
}

const TAB_ITEMS: TabItem[] = [
    { id: "ceo",          label: "CEO Intelligence",    icon: Brain,     slug: "ceo-intelligence" },
    { id: "ads-command",  label: "Ads Command Center",  icon: Target,    slug: "ads-command-center" },
    { id: "marketing",    label: "Marketing & Ads",     icon: Megaphone, slug: "marketing-ads" },
    { id: "products",     label: "Sản phẩm & Kho",      icon: Package,   slug: "san-pham-va-kho" },
    { id: "fulfillment",  label: "Fulfillment",         icon: Truck,     slug: "fulfillment" },
    { id: "financial",    label: "Financial Control",   icon: Landmark,  slug: "financial-control" },
    { id: "pnl",          label: "P&L",                 icon: DollarSign, slug: "pnl" },
    { id: "customers",    label: "Khách hàng",          icon: Users,     slug: "khach-hang" },
    { id: "market-intel", label: "Market Intel",        icon: Globe,     slug: "market-intel" },
];

const DEFAULT_TAB: TabId = "ceo";
const DEFAULT_SLUG = TAB_ITEMS.find(t => t.id === DEFAULT_TAB)!.slug;

interface Props {
    slug?: string[];
}

export default function STRAMARKDashboardShell({ slug }: Props) {
    const router = useRouter();

    const [dateRange, setDateRangeState] = useState<{ from: Date; to: Date }>(
        loadPersistedDateRange
    );

    const setDateRange = useCallback((range: { from: Date; to: Date }) => {
        setDateRangeState(range);
        savePersistedDateRange(range);
    }, []);

    // ── URL → tab resolution ──
    const { activeTab, subSlug } = useMemo(() => {
        const tabSlug = slug?.[0];
        const matched = TAB_ITEMS.find(t => t.slug === tabSlug);
        return {
            activeTab: matched?.id ?? DEFAULT_TAB,
            subSlug: slug?.[1],
        };
    }, [slug]);

    // ── Redirect invalid/empty slug to default ──
    useEffect(() => {
        const tabSlug = slug?.[0];
        if (!tabSlug) {
            router.replace(`/stramark/${DEFAULT_SLUG}`);
            return;
        }
        const matched = TAB_ITEMS.find(t => t.slug === tabSlug);
        if (!matched) {
            router.replace(`/stramark/${DEFAULT_SLUG}`);
        }
    }, [slug, router]);

    // Set STRAMARK dataset cookie on mount
    useEffect(() => {
        document.cookie = "activeDataset=STRAMARK_Dataset; path=/;";
    }, []);

    const handleTabClick = (tabId: TabId) => {
        const item = TAB_ITEMS.find(t => t.id === tabId);
        if (item) router.push(`/stramark/${item.slug}`);
    };

    const handleSubTabChange = (subPath: string) => {
        const item = TAB_ITEMS.find(t => t.id === activeTab);
        if (item) router.push(`/stramark/${item.slug}/${subPath}`);
    };

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
                            <span className="text-lg font-bold brand-gradient-text">STRAMARK</span>
                            <span className="ml-2 rounded-full bg-orange-100 dark:bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold text-orange-600 dark:text-orange-400">Pilot</span>
                        </div>
                    </div>
                    <span className="text-xs text-muted-foreground mt-1 ml-[52px]">Romania / EU</span>
                </div>
                <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
                    {TAB_ITEMS.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => handleTabClick(item.id)}
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
                    {activeTab === "ceo" && <CEOOverviewTab dateRange={dateRange} />}
                    {activeTab === "marketing" && <MarketingTab dateRange={dateRange} />}
                    {activeTab === "products" && (
                        <ProductsTab
                            dateRange={dateRange}
                            subSlug={subSlug}
                            onSubTabChange={handleSubTabChange}
                        />
                    )}
                    {activeTab === "pnl" && <PnLTab dateRange={dateRange} />}
                    {activeTab === "customers" && <CustomerTab dateRange={dateRange} />}
                    {activeTab === "market-intel" && <MarketIntelTab dateRange={dateRange} />}
                    {activeTab === "ads-command" && <AdsCommandTab />}
                    {activeTab === "fulfillment" && <FulfillmentTab dateRange={dateRange} />}
                    {activeTab === "financial" && (
                        <FinancialControlTab
                            dateRange={dateRange}
                            subSlug={subSlug}
                            onSubTabChange={handleSubTabChange}
                        />
                    )}
                </div>
            </main>
        </div>
    );
}
