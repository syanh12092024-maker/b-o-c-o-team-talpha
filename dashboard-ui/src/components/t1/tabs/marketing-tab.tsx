"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Line, Cell, PieChart, Pie,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatNumber, cn } from "@/lib/utils";
import TabSkeleton from "@/components/ui/tab-skeleton";
import {
    Megaphone, MousePointer, Eye, Percent, Coins,
    TrendingUp, Target, DollarSign, Trophy,
} from "lucide-react";

const DS = "levelup-465304.T1_Dataset";

async function queryBQ(sql: string) {
    const res = await fetch("/api/query", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql }),
    });
    const data = await res.json();
    return data.data || [];
}

function fmtUSD(v: number) { return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`; }

const PIE_COLORS = ["#34d399", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7"];

interface MarketingTabProps { dateRange?: { from: Date; to: Date }; }

export default function MarketingTab({ dateRange }: MarketingTabProps) {
    const [loading, setLoading] = useState(true);
    const [adsKpis, setAdsKpis] = useState({ spend: 0, impressions: 0, clicks: 0, ctr: 0, purchases: 0 });
    const [dailyTrend, setDailyTrend] = useState<any[]>([]);
    const [campaigns, setCampaigns] = useState<any[]>([]);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const [kpis, daily, camps] = await Promise.all([
                    queryBQ(`WITH fb_dedup AS (
                        SELECT * FROM \`${DS}.fb_ads_data\`
                        WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                        QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id, date ORDER BY sync_time DESC) = 1
                    )
                    SELECT ROUND(SUM(spend),2) as spend, SUM(impressions) as impressions,
                        SUM(clicks) as clicks, SUM(purchases) as purchases,
                        ROUND(SAFE_DIVIDE(SUM(clicks)*100, NULLIF(SUM(impressions),0)),2) as ctr
                    FROM fb_dedup`),
                    queryBQ(`WITH fb_dedup AS (
                        SELECT * FROM \`${DS}.fb_ads_data\`
                        WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                        QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id, date ORDER BY sync_time DESC) = 1
                    )
                    SELECT SAFE_CAST(date AS STRING) as report_date,
                        ROUND(SUM(spend),2) as spend, SUM(impressions) as impressions,
                        SUM(clicks) as clicks, SUM(purchases) as purchases
                    FROM fb_dedup
                    GROUP BY 1 ORDER BY 1`),
                    queryBQ(`WITH fb_dedup AS (
                        SELECT * FROM \`${DS}.fb_ads_data\`
                        WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                        QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id, date ORDER BY sync_time DESC) = 1
                    )
                    SELECT campaign_name, campaign_id,
                        ROUND(SUM(spend),2) as spend, SUM(impressions) as impressions,
                        SUM(clicks) as clicks, SUM(purchases) as purchases,
                        ROUND(SAFE_DIVIDE(SUM(clicks)*100, NULLIF(SUM(impressions),0)),2) as ctr,
                        ROUND(SAFE_DIVIDE(SUM(spend), NULLIF(SUM(clicks),0)),2) as cpc,
                        ROUND(SAFE_DIVIDE(SUM(spend)*1000, NULLIF(SUM(impressions),0)),2) as cpm
                    FROM fb_dedup
                    GROUP BY 1,2 ORDER BY spend DESC`),
                ]);

                setAdsKpis(kpis[0] || { spend: 0, impressions: 0, clicks: 0, ctr: 0, purchases: 0 });
                setDailyTrend(daily);
                setCampaigns(camps);
            } catch (e) { console.error(e); } finally { setLoading(false); }
        }
        if (dateRange?.from && dateRange?.to) fetchData();
    }, [dateRange]);

    if (loading) return <TabSkeleton cards={4} showChart={true} rows={5} />;

    const totalSpend = adsKpis.spend;
    const spendPie = campaigns.filter(c => c.spend > 0).slice(0, 8).map(c => ({ name: c.campaign_name?.substring(0, 20), value: c.spend }));

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
                <KPICard title="Total Ads Spend" value={fmtUSD(totalSpend)} icon={Megaphone} />
                <KPICard title="Impressions" value={formatNumber(adsKpis.impressions)} icon={Eye} />
                <KPICard title="Clicks" value={formatNumber(adsKpis.clicks)} icon={MousePointer} />
                <KPICard title="CTR" value={`${(adsKpis.ctr || 0).toFixed(2)}%`} icon={Percent}
                    status={adsKpis.ctr > 3 ? "success" : "warning"} />
                <KPICard title="Purchases" value={formatNumber(adsKpis.purchases)} icon={Target}
                    subValue={`CPA: ${adsKpis.purchases > 0 ? fmtUSD(totalSpend / adsKpis.purchases) : "---"}`} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Daily Ads Trend</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={dailyTrend}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="report_date" tickFormatter={(v) => String(v).slice(5)} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
                            <Legend />
                            <Bar dataKey="spend" name="Spend ($)" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                            <Line type="monotone" dataKey="purchases" name="Purchases" stroke="#6366f1" strokeWidth={2} dot={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Spend Distribution</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                            <Pie data={spendPie} dataKey="value" nameKey="name" cx="50%" cy="50%"
                                outerRadius={100} innerRadius={45}
                                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}>
                                {spendPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                            </Pie>
                            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">All Campaigns ({campaigns.length})</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-2 pb-2 text-left font-medium">Campaign</th>
                                <th className="px-2 pb-2 text-right font-medium">Spend</th>
                                <th className="px-2 pb-2 text-right font-medium">Impr.</th>
                                <th className="px-2 pb-2 text-right font-medium">Clicks</th>
                                <th className="px-2 pb-2 text-right font-medium">CTR</th>
                                <th className="px-2 pb-2 text-right font-medium">CPM</th>
                                <th className="px-2 pb-2 text-right font-medium">CPC</th>
                                <th className="px-2 pb-2 text-right font-medium">Purchases</th>
                                <th className="px-2 pb-2 text-right font-medium">CPA</th>
                            </tr>
                        </thead>
                        <tbody>
                            {campaigns.map((c, i) => (
                                <tr key={i} className="border-b border-border/30 hover:bg-gray-50/50">
                                    <td className="px-2 py-2.5 font-medium text-foreground max-w-[200px] truncate">{c.campaign_name}</td>
                                    <td className="px-2 py-2.5 text-right text-amber-500">{fmtUSD(c.spend)}</td>
                                    <td className="px-2 py-2.5 text-right">{formatNumber(c.impressions)}</td>
                                    <td className="px-2 py-2.5 text-right">{formatNumber(c.clicks)}</td>
                                    <td className="px-2 py-2.5 text-right">{c.ctr?.toFixed(2)}%</td>
                                    <td className="px-2 py-2.5 text-right">{c.cpm ? `$${c.cpm.toFixed(2)}` : "---"}</td>
                                    <td className="px-2 py-2.5 text-right">{c.cpc ? `$${c.cpc.toFixed(2)}` : "---"}</td>
                                    <td className="px-2 py-2.5 text-right font-semibold">{c.purchases || 0}</td>
                                    <td className="px-2 py-2.5 text-right">{c.purchases > 0 ? fmtUSD(c.spend / c.purchases) : "---"}</td>
                                </tr>
                            ))}
                            <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                <td className="px-2 py-2.5">TONG</td>
                                <td className="px-2 py-2.5 text-right text-amber-500">{fmtUSD(totalSpend)}</td>
                                <td className="px-2 py-2.5 text-right">{formatNumber(adsKpis.impressions)}</td>
                                <td className="px-2 py-2.5 text-right">{formatNumber(adsKpis.clicks)}</td>
                                <td className="px-2 py-2.5 text-right">{(adsKpis.ctr || 0).toFixed(2)}%</td>
                                <td className="px-2 py-2.5" colSpan={2}></td>
                                <td className="px-2 py-2.5 text-right">{formatNumber(adsKpis.purchases)}</td>
                                <td className="px-2 py-2.5 text-right">{adsKpis.purchases > 0 ? fmtUSD(totalSpend / adsKpis.purchases) : "---"}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
