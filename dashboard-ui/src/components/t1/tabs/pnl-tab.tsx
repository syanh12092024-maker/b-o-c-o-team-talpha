"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart, Line, Cell } from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatNumber, COLORS, cn } from "@/lib/utils";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { DollarSign, TrendingDown, TrendingUp, Activity, Package, Phone, Truck, Receipt } from "lucide-react";

const DS = "levelup-465304.T1_Dataset";
const EUR_TO_VND = 28000;   // 1 EUR in VND (cent-based: /100)
const EUR_F = EUR_TO_VND / 100; // multiplier for cent-based EUR prices
const USD_TO_VND = 25000;

// Cost constants
const COGS_PER_UNIT_EUR = 0.90;   // €0.90 per unit import price
const COGS_PER_UNIT_VND = COGS_PER_UNIT_EUR * EUR_TO_VND; // 25,200 VND
const CALL_CENTER_PER_ORDER_USD = 0.40; // $0.40 per confirmed call (Xác nhận tag)
const CALL_CENTER_PER_ORDER_VND = CALL_CENTER_PER_ORDER_USD * USD_TO_VND; // 10,000 VND

async function queryBQ(sql: string) {
    const r = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: sql }) });
    return (await r.json()).data || [];
}
function fmtVND(v: number) { const a = Math.abs(v); const s = v < 0 ? "-" : ""; if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}ty`; if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}tr`; if (a >= 1e3) return `${s}${Math.round(a / 1e3)}K`; return `${s}${Math.round(a)}`; }
function fmtMoney(v: number) { return new Intl.NumberFormat("vi-VN").format(Math.round(v)); }

interface Props { dateRange?: { from: Date; to: Date }; }

export default function PnLTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [daily, setDaily] = useState<any[]>([]);
    const [summary, setSummary] = useState<any>(null);

    useEffect(() => {
        setLoading(true);
        const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
        const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

        Promise.all([
            // Q1: Daily orders - revenue from status=16, qty for COGS (NO JOIN to avoid row multiplication!)
            queryBQ(`SELECT SAFE_CAST(SUBSTR(o.updated_at,1,10) AS STRING) as report_date,
                COUNT(DISTINCT CASE WHEN o.status = 16 THEN o.id END) as paid_orders,
                ROUND(SUM(CASE WHEN o.status = 16 THEN o.total_price ELSE 0 END) * ${EUR_F}, 0) as revenue,
                SUM(CASE WHEN o.status = 16 THEN o.total_quantity ELSE 0 END) as paid_qty,
                COUNT(DISTINCT o.id) as total_orders
            FROM \`${DS}.sale_order\` o
            WHERE SAFE_CAST(SUBSTR(o.updated_at,1,10) AS DATE) BETWEEN '${from}' AND '${to}'
            GROUP BY 1 ORDER BY 1 DESC`),

            // Q2: Daily ads spend (deduped)
            queryBQ(`WITH fb_dedup AS (
                SELECT * FROM \`${DS}.fb_ads_data\`
                WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id, date ORDER BY sync_time DESC) = 1
            )
            SELECT SAFE_CAST(date AS STRING) as report_date, ROUND(SUM(spend) * ${USD_TO_VND}, 0) as ads
            FROM fb_dedup
            GROUP BY 1`),

            // Q3: Daily call center cost (orders with "Xác nhận" tag)
            queryBQ(`SELECT SAFE_CAST(SUBSTR(o.inserted_at,1,10) AS STRING) as report_date,
                COUNT(DISTINCT o.id) as confirmed_calls
            FROM \`${DS}.sale_order\` o,
            UNNEST(JSON_EXTRACT_ARRAY(o.tags)) AS raw_tag,
            UNNEST([STRUCT(JSON_EXTRACT_SCALAR(raw_tag, '$.name') AS tag_name)]) AS t
            WHERE t.tag_name = 'Xác nhận'
                AND SAFE_CAST(SUBSTR(o.updated_at,1,10) AS DATE) BETWEEN '${from}' AND '${to}'
            GROUP BY 1`),

            // Q4: Fulfillment cost from euShipments (synced to BigQuery)
            queryBQ(`SELECT
                ROUND(SUM(IFNULL(total_3pl_cost_eur, 0)) * ${EUR_TO_VND}, 0) as total_ffm_vnd,
                SUM(IFNULL(total_3pl_cost_eur, 0)) as total_ffm_eur,
                SUM(IFNULL(shipping_cost_eur, 0)) as shipping_eur,
                SUM(IFNULL(ffm_cost_eur, 0)) as handling_eur,
                COUNT(*) as ffm_orders
            FROM \`${DS}.fulfillment_orders\`
            WHERE status NOT IN ('validation_failed', 'cancelled')
            `).catch(() => [{ total_ffm_vnd: 0, total_ffm_eur: 0, shipping_eur: 0, handling_eur: 0, ffm_orders: 0 }]),
        ]).then(([orders, ads, calls, ffmData]) => {
            const adsMap = new Map<string, number>();
            ads.forEach((a: any) => adsMap.set(a.report_date, a.ads || 0));
            const callMap = new Map<string, number>();
            calls.forEach((c: any) => callMap.set(c.report_date, c.confirmed_calls || 0));

            // Fulfillment cost from euShipments (total, distributed evenly per day with orders)
            const ffmInfo = ffmData?.[0] || {};
            const totalFfmVND = Number(ffmInfo.total_ffm_vnd || 0);
            const totalFfmEUR = Number(ffmInfo.total_ffm_eur || 0);
            const ffmOrderCount = Number(ffmInfo.ffm_orders || 0);

            let totRev = 0, totAds = 0, totCogs = 0, totCall = 0, totFulfill = totalFfmVND;
            const daysWithOrders = orders.filter((r: any) => (r.paid_orders || 0) > 0).length || 1;
            const ffmPerDay = daysWithOrders > 0 ? totalFfmVND / daysWithOrders : 0;

            const rows = orders.map((r: any) => {
                const rev = r.revenue || 0;
                const qty = r.paid_qty || 0;
                const adsV = adsMap.get(r.report_date) || 0;
                const cogs = qty * COGS_PER_UNIT_VND;
                const callCount = callMap.get(r.report_date) || 0;
                const callCost = callCount * CALL_CENTER_PER_ORDER_VND;
                const fulfillment = (r.paid_orders || 0) > 0 ? ffmPerDay : 0;
                const totalCost = adsV + cogs + callCost + fulfillment;
                const profit = rev - totalCost;

                totRev += rev; totAds += adsV; totCogs += cogs;
                totCall += callCost;

                return {
                    date: r.report_date,
                    revenue: rev,
                    ads: adsV,
                    cogs,
                    callCost,
                    callCount,
                    fulfillment,
                    totalCost,
                    profit,
                    paidOrders: r.paid_orders || 0,
                    paidQty: qty,
                    totalOrders: r.total_orders || 0,
                };
            });
            setDaily(rows);
            const totCost = totAds + totCogs + totCall + totFulfill;
            setSummary({
                revenue: totRev,
                ads: totAds,
                cogs: totCogs,
                callCenter: totCall,
                fulfillment: totFulfill,
                fulfillmentEUR: totalFfmEUR,
                ffmOrders: ffmOrderCount,
                shippingEUR: Number(ffmInfo.shipping_eur || 0),
                handlingEUR: Number(ffmInfo.handling_eur || 0),
                totalCost: totCost,
                profit: totRev - totCost,
                margin: totRev > 0 ? ((totRev - totCost) / totRev * 100) : 0,
            });
        }).catch(() => { }).finally(() => setLoading(false));
    }, [dateRange]);

    if (loading) return <TabSkeleton cards={4} showChart={true} rows={5} />;
    if (!summary) return <div className="text-center py-20 text-slate-400">No data</div>;

    const waterfallData = [
        { name: "Doanh thu", value: summary.revenue, fill: "#34d399" },
        { name: "Giá vốn", value: -summary.cogs, fill: "#f87171" },
        { name: "Ads", value: -summary.ads, fill: "#fbbf24" },
        { name: "Call Center", value: -summary.callCenter, fill: "#60a5fa" },
        { name: "Fulfillment", value: -summary.fulfillment, fill: "#a78bfa" },
        { name: "Lợi nhuận", value: summary.profit, fill: summary.profit >= 0 ? "#34d399" : "#f87171" },
    ];

    return (
        <div className="space-y-6">
            {/* KPI Cards - 2 rows */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <KPICard title="Doanh Thu (Đã thu tiền)" value={fmtVND(summary.revenue)} icon={DollarSign} status="success"
                    subValue="Chỉ status 16" />
                <KPICard title="Tổng Chi Phí" value={fmtVND(summary.totalCost)} icon={TrendingDown} status="danger"
                    subValue={`${summary.revenue > 0 ? (summary.totalCost / summary.revenue * 100).toFixed(1) : 0}% doanh thu`} />
                <KPICard title="Lợi Nhuận Thực" value={fmtVND(summary.profit)} icon={summary.profit >= 0 ? TrendingUp : TrendingDown}
                    status={summary.profit >= 0 ? "success" : "danger"} />
                <KPICard title="Biên LN" value={`${summary.margin.toFixed(1)}%`} icon={Activity}
                    status={summary.margin >= 30 ? "success" : summary.margin >= 10 ? "warning" : "danger"} />
            </div>

            {/* Cost breakdown cards */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Cơ cấu chi phí</h3>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-rose-700 mb-1">
                            <Package className="w-3 h-3" /> Giá vốn (COGS)
                        </div>
                        <div className="text-xl font-bold text-rose-700">{fmtVND(summary.cogs)}</div>
                        <div className="text-[10px] text-muted-foreground">€0.90/sp × {daily.reduce((s, d) => s + d.paidQty, 0)} sp = {fmtVND(summary.cogs)}</div>
                    </div>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 mb-1">
                            <Receipt className="w-3 h-3" /> Chi phí Ads
                        </div>
                        <div className="text-xl font-bold text-amber-700">{fmtVND(summary.ads)}</div>
                        <div className="text-[10px] text-muted-foreground">{summary.revenue > 0 ? (summary.ads / summary.revenue * 100).toFixed(1) : 0}% doanh thu</div>
                    </div>
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-blue-700 mb-1">
                            <Phone className="w-3 h-3" /> Chi phí Call Center
                        </div>
                        <div className="text-xl font-bold text-blue-700">{fmtVND(summary.callCenter)}</div>
                        <div className="text-[10px] text-muted-foreground">$0.40/call × {daily.reduce((s, d) => s + d.callCount, 0)} xác nhận</div>
                    </div>
                    <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-purple-700 mb-1">
                            <Truck className="w-3 h-3" /> Fulfillment
                        </div>
                        <div className="text-xl font-bold text-purple-700">{summary.fulfillment > 0 ? fmtVND(summary.fulfillment) : "—"}</div>
                        <div className="text-[10px] text-muted-foreground">
                            {summary.fulfillmentEUR > 0
                                ? `€${summary.fulfillmentEUR.toFixed(2)} · ${summary.ffmOrders} đơn · euShipments ✅`
                                : "euShipments — chưa có chi phí"}
                        </div>
                    </div>
                </div>
            </div>

            {/* Charts */}
            <div className="grid gap-4 lg:grid-cols-2">
                {/* Waterfall */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">P&L Waterfall</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={waterfallData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => fmtVND(Math.abs(v))} />
                            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
                                formatter={(v: any) => fmtVND(Math.abs(v))} />
                            <ReferenceLine y={0} stroke="#94a3b8" />
                            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                {waterfallData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Daily Revenue vs Total Cost */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Doanh thu vs Chi phí hàng ngày</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={daily.slice().reverse()}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="date" tickFormatter={(v) => String(v).slice(5)} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => fmtVND(v)} />
                            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11 }}
                                formatter={(v: any) => fmtMoney(v) + " đ"} />
                            <Bar dataKey="revenue" name="Doanh thu" fill="#34d399" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="ads" name="Ads" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="cogs" name="Giá vốn" fill="#f87171" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="callCost" name="Call Center" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                            <Line type="monotone" dataKey="profit" name="Lợi nhuận" stroke="#6366f1" strokeWidth={2} dot={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Detail Table */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Chi tiết P&L hàng ngày</h3>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-card z-10">
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-2 pb-2 text-left font-medium">Ngày</th>
                                <th className="px-2 pb-2 text-right font-medium">Đơn TC</th>
                                <th className="px-2 pb-2 text-right font-medium">SL</th>
                                <th className="px-2 pb-2 text-right font-medium text-emerald-600">Doanh thu</th>
                                <th className="px-2 pb-2 text-right font-medium text-rose-500">Giá vốn</th>
                                <th className="px-2 pb-2 text-right font-medium text-amber-500">Ads</th>
                                <th className="px-2 pb-2 text-right font-medium text-blue-500">Call</th>
                                <th className="px-2 pb-2 text-right font-medium text-purple-500">Fulfill</th>
                                <th className="px-2 pb-2 text-right font-medium">Tổng CP</th>
                                <th className="px-2 pb-2 text-right font-medium">Lợi nhuận</th>
                                <th className="px-2 pb-2 text-right font-medium">Biên%</th>
                            </tr>
                        </thead>
                        <tbody>
                            {daily.map((d) => {
                                const margin = d.revenue > 0 ? (d.profit / d.revenue * 100) : 0;
                                return (
                                    <tr key={d.date} className="border-b border-border/30 hover:bg-gray-50/50">
                                        <td className="px-2 py-2 font-mono text-foreground">{d.date}</td>
                                        <td className="px-2 py-2 text-right">{d.paidOrders}</td>
                                        <td className="px-2 py-2 text-right">{d.paidQty}</td>
                                        <td className="px-2 py-2 text-right text-emerald-500 font-semibold">{fmtMoney(d.revenue)}</td>
                                        <td className="px-2 py-2 text-right text-rose-500">{d.cogs > 0 ? fmtMoney(d.cogs) : "—"}</td>
                                        <td className="px-2 py-2 text-right text-amber-500">{d.ads > 0 ? fmtMoney(d.ads) : "—"}</td>
                                        <td className="px-2 py-2 text-right text-blue-500">{d.callCost > 0 ? fmtMoney(d.callCost) : "—"}</td>
                                        <td className="px-2 py-2 text-right text-purple-500">{d.fulfillment > 0 ? fmtMoney(d.fulfillment) : "—"}</td>
                                        <td className="px-2 py-2 text-right text-slate-600">{fmtMoney(d.totalCost)}</td>
                                        <td className={cn("px-2 py-2 text-right font-bold", d.profit >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                            {d.profit >= 0 ? "+" : ""}{fmtMoney(d.profit)}
                                        </td>
                                        <td className={cn("px-2 py-2 text-right", margin >= 30 ? "text-emerald-500" : margin >= 0 ? "text-amber-500" : "text-rose-500")}>
                                            {d.revenue > 0 ? `${margin.toFixed(1)}%` : "—"}
                                        </td>
                                    </tr>
                                );
                            })}
                            {/* TONG row */}
                            <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                <td className="px-2 py-2 text-foreground">TỔNG</td>
                                <td className="px-2 py-2 text-right">{daily.reduce((s, d) => s + d.paidOrders, 0)}</td>
                                <td className="px-2 py-2 text-right">{daily.reduce((s, d) => s + d.paidQty, 0)}</td>
                                <td className="px-2 py-2 text-right text-emerald-500">{fmtMoney(summary.revenue)}</td>
                                <td className="px-2 py-2 text-right text-rose-500">{fmtMoney(summary.cogs)}</td>
                                <td className="px-2 py-2 text-right text-amber-500">{fmtMoney(summary.ads)}</td>
                                <td className="px-2 py-2 text-right text-blue-500">{fmtMoney(summary.callCenter)}</td>
                                <td className="px-2 py-2 text-right text-purple-500">{summary.fulfillment > 0 ? fmtMoney(summary.fulfillment) : "—"}</td>
                                <td className="px-2 py-2 text-right text-slate-600">{fmtMoney(summary.totalCost)}</td>
                                <td className={cn("px-2 py-2 text-right", summary.profit >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                    {summary.profit >= 0 ? "+" : ""}{fmtMoney(summary.profit)}
                                </td>
                                <td className="px-2 py-2 text-right">{summary.margin.toFixed(1)}%</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Cost formula explanation */}
            <div className="rounded-xl border border-dashed border-border bg-slate-50 p-4 text-xs text-muted-foreground">
                <strong className="text-foreground">Công thức P&L:</strong>
                <div className="mt-1 space-y-0.5">
                    <div>📊 <strong>Doanh thu</strong> = Tổng giá đơn Đã thu tiền (status 16) × tỉ giá EUR/VND</div>
                    <div>📦 <strong>Giá vốn</strong> = €0.90/sp × SL sản phẩm đã thu tiền × 28,000 VND</div>
                    <div>📢 <strong>Chi phí Ads</strong> = Facebook Ads spend × 25,000 VND</div>
                    <div>📞 <strong>Call Center</strong> = $0.40/cuộc × số đơn có thẻ "Xác nhận" × 25,000 VND</div>
                    <div>🚚 <strong>Fulfillment</strong> = euShipments 3PL cost (shipping + handling) × tỉ giá EUR/VND</div>
                    <div>💰 <strong>Lợi nhuận</strong> = Doanh thu − (Giá vốn + Ads + Call Center + Fulfillment)</div>
                </div>
            </div>
        </div>
    );
}
