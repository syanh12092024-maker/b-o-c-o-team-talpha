"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    TrendingUp, TrendingDown, Minus, AlertTriangle,
    Skull, CheckCircle, Smartphone, Globe, Package
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface ExecutiveData {
    vitals: {
        revenue: number;
        profit: number;
        margin: number;
        spend: number;
        roas: number;
        delivery_rate: number;
    };
    leaderboard: any[];
    inventory: any[];
    market: any[];
}

export default function ExecutiveReportTab({ dateRange }: { dateRange: { from: Date; to: Date } }) {
    const [data, setData] = useState<ExecutiveData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const query = new URLSearchParams({
                    from: format(dateRange.from, 'yyyy-MM-dd'),
                    to: format(dateRange.to, 'yyyy-MM-dd')
                });
                const res = await fetch(`/api/executive-report?${query}`);
                const json = await res.json();
                setData(json);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [dateRange]);

    if (loading) return <div className="p-10 text-center text-foreground">Loading Intelligence Core...</div>;
    if (!data || (data as any).error) return <div className="p-10 text-center text-red-400">Failed to load data: {(data as any)?.error || "Unknown Error"}</div>;

    const vitals = data.vitals || {};
    const leaderboard = data.leaderboard || [];
    const inventory = data.inventory || [];
    const market = data.market || [];

    return (
        <div className="space-y-6">
            {/* Section 1: Vitals */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
                <MetricCard
                    label="Net Revenue"
                    value={formatCurrency(vitals.revenue)}
                    trend="up"
                    subvalue="vs last month"
                />
                <MetricCard
                    label="Net Profit"
                    value={formatCurrency(vitals.profit)}
                    trend="up"
                    color="text-green-400"
                    subvalue={`${(vitals.margin * 100).toFixed(1)}% Margin`}
                />
                <MetricCard
                    label="Ads Spend"
                    value={`$${(vitals.spend || 0).toLocaleString()}`}
                    trend="down"
                    subvalue="USD"
                />
                <MetricCard
                    label="Real ROAS"
                    value={vitals.roas?.toFixed(2)}
                    trend={vitals.roas >= 3 ? 'up' : 'neutral'}
                    subvalue="Target > 3.0"
                />
                <MetricCard
                    label="Delivery Rate"
                    value={`${vitals.delivery_rate?.toFixed(1)}%`}
                    trend={vitals.delivery_rate >= 85 ? 'up' : 'down'}
                    subvalue="Target > 85%"
                />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Section 2: Marketer Leaderboard */}
                <div className="rounded-xl border border-border bg-gray-50 p-6 backdrop-blur">
                    <div className="mb-4 flex items-center justify-between">
                        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                            🦁 Marketer Leaderboard
                        </h2>
                        <span className="text-xs text-foreground/50">Sorted by Profit</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-foreground/80">
                            <thead className="bg-gray-50 text-xs uppercase text-foreground/50">
                                <tr>
                                    <th className="px-3 py-2">Name</th>
                                    <th className="px-3 py-2">Spend</th>
                                    <th className="px-3 py-2">ROAS</th>
                                    <th className="px-3 py-2">Profit</th>
                                    <th className="px-3 py-2">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {leaderboard.map((m: any, i: number) => (
                                    <tr key={i}>
                                        <td className="px-3 py-3 font-medium text-foreground">
                                            {i === 0 ? '🥇' : i === 1 ? '🥈' : ''} {m.marketer_name}
                                        </td>
                                        <td className="px-3 py-3">${m.spend?.toLocaleString()}</td>
                                        <td className={`px-3 py-3 font-bold ${getRoasColor(m.roas)}`}>
                                            {m.roas?.toFixed(2)}
                                        </td>
                                        <td className="px-3 py-3">{formatCurrency(m.profit)}</td>
                                        <td className="px-3 py-3">
                                            <Badge status={m.status} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Section 6: Inventory Health */}
                <div className="rounded-xl border border-border bg-gray-50 p-6 backdrop-blur">
                    <div className="mb-4 flex items-center justify-between">
                        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                            🏭 Inventory Health
                        </h2>
                        <span className="text-xs text-red-400">Mock Data (Stock=100)</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-foreground/80">
                            <thead className="bg-gray-50 text-xs uppercase text-foreground/50">
                                <tr>
                                    <th className="px-3 py-2">Product</th>
                                    <th className="px-3 py-2">ADS (30d)</th>
                                    <th className="px-3 py-2">Cover</th>
                                    <th className="px-3 py-2">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {inventory.map((p: any, i: number) => (
                                    <tr key={i} className={p.days_of_cover < 7 ? "bg-red-500/10" : ""}>
                                        <td className="px-3 py-3 font-medium text-foreground">{p.product_code}</td>
                                        <td className="px-3 py-3">{p.ads_30d?.toFixed(1)}</td>
                                        <td className={`px-3 py-3 font-bold ${p.days_of_cover < 7 ? 'text-red-400' : 'text-green-400'}`}>
                                            {p.days_of_cover?.toFixed(1)} days
                                        </td>
                                        <td className="px-3 py-3">
                                            {p.days_of_cover < 7 ? (
                                                <button className="rounded bg-red-600 px-2 py-1 text-xs font-bold text-foreground hover:bg-red-700">Refill NOW</button>
                                            ) : (
                                                <span className="text-xs text-foreground/50">Monitor</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Section 4: Market Performance */}
            <div className="rounded-xl border border-border bg-gray-50 p-6 backdrop-blur">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                        🌍 Market Performance
                    </h2>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {market.map((m: any, i: number) => (
                        <div key={i} className="rounded bg-gray-50 p-4">
                            <h3 className="text-sm font-medium text-foreground/70">{m.market}</h3>
                            <div className="mt-2 flex items-baseline gap-2">
                                <span className="text-xl font-bold text-foreground">{formatCurrency(m.profit)}</span>
                                <span className="text-xs text-foreground/50">profit</span>
                            </div>
                            <div className="mt-1 text-sm">
                                Deliv: <span className={m.delivery_rate >= 85 ? "text-green-400" : "text-red-400"}>{m.delivery_rate?.toFixed(1)}%</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function MetricCard({ label, value, trend, subvalue, color = "text-foreground" }: any) {
    return (
        <div className="rounded-xl border border-border bg-gray-50 p-4 backdrop-blur">
            <div className="text-xs font-medium text-foreground/50">{label}</div>
            <div className={`mt-2 text-2xl font-bold ${color}`}>{value}</div>
            <div className="mt-1 flex items-center gap-1 text-xs">
                {trend === 'up' && <TrendingUp className="h-3 w-3 text-green-400" />}
                {trend === 'down' && <TrendingDown className="h-3 w-3 text-red-400" />}
                {trend === 'neutral' && <Minus className="h-3 w-3 text-foreground/30" />}
                <span className="text-foreground/50">{subvalue}</span>
            </div>
        </div>
    );
}

function Badge({ status }: { status: string }) {
    if (status === 'Scaling') return <span className="rounded bg-green-500/20 px-2 py-0.5 text-xs font-bold text-green-400">Scaling</span>;
    if (status === 'Loss') return <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs font-bold text-red-400">Loss</span>;
    return <span className="rounded bg-white/10 px-2 py-0.5 text-xs font-medium text-foreground/50">Stable</span>;
}

// formatCurrency imported from @/lib/utils — converts RON→VND with compact format

function getRoasColor(roas: number) {
    if (roas >= 3) return "text-green-400";
    if (roas < 2) return "text-red-400";
    return "text-foreground";
}
