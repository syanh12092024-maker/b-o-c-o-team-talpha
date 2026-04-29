import { DashboardSummary, formatVND, usdToVnd, localToVnd } from "./types";

interface SummaryCardsProps {
    summary: DashboardSummary;
    isLoading: boolean;
    alreadyVnd?: boolean; // When true, spend & revenue are already VND — skip conversion
}

export function SummaryCards({ summary, isLoading, alreadyVnd = false }: SummaryCardsProps) {
    if (isLoading) {
        return (
            <section className="grid grid-cols-5 gap-0 border-b border-slate-700 bg-slate-900/50 shrink-0 animate-pulse">
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="p-4 border-r border-slate-700 h-24 bg-slate-800/50" />
                ))}
            </section>
        );
    }

    const spendVnd = alreadyVnd ? (summary.total_spend || 0) : usdToVnd(summary.total_spend);
    const revenueVnd = alreadyVnd ? (summary.total_real_revenue || 0) : localToVnd(summary.total_real_revenue);
    const roas = spendVnd > 0 ? revenueVnd / spendVnd : 0;
    const leads = summary.total_real_leads || 0;
    const cplVnd = leads > 0 ? spendVnd / leads : 0;

    return (
        <section className="grid grid-cols-5 gap-0 border-b border-slate-700 bg-slate-900/50 shrink-0">

            {/* 1. Total Spend (VND) */}
            <div className="p-4 border-r border-slate-700">
                <div className="text-slate-400 text-xs font-semibold uppercase mb-1">
                    💰 Chi phí quảng cáo
                </div>
                <div className="text-2xl font-bold font-mono text-white">
                    {formatVND(spendVnd)}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                    {alreadyVnd
                        ? `$${((summary.total_spend || 0) / 25400).toLocaleString('en-US', { maximumFractionDigits: 0 })} USD`
                        : `${(summary.total_spend || 0).toLocaleString('vi-VN')} ₫`}
                </div>
            </div>

            {/* 2. Created Orders (Leads/Orders tạo) */}
            <div className="p-4 border-r border-slate-700 bg-blue-500/5">
                <div className="text-blue-400 text-xs font-semibold uppercase mb-1">
                    📦 Đơn hàng tạo
                </div>
                <div className="text-2xl font-bold font-mono text-blue-400">
                    {leads}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                    CPL: {leads > 0 ? formatVND(cplVnd) : '-'}
                </div>
            </div>

            {/* 3. Messages */}
            <div className="p-4 border-r border-slate-700">
                <div className="text-indigo-400 text-xs font-semibold uppercase mb-1">
                    💬 Messages
                </div>
                <div className="text-2xl font-bold font-mono text-indigo-400">
                    {summary.total_meta_messages || 0}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                    CPA: {(summary.total_meta_messages || 0) > 0
                        ? formatVND(spendVnd / summary.total_meta_messages)
                        : '-'}
                </div>
            </div>

            {/* 4. Revenue (VND) */}
            <div className="p-4 border-r border-slate-700 bg-emerald-500/5">
                <div className="text-emerald-400 text-xs font-semibold uppercase mb-1">
                    💵 Doanh thu
                </div>
                <div className="text-2xl font-bold font-mono text-emerald-400">
                    {formatVND(revenueVnd)}
                </div>
                <div className="text-xs text-emerald-600/70 mt-1">
                    {alreadyVnd
                        ? `${(summary.total_real_revenue || 0).toLocaleString('vi-VN')} ₫`
                        : `${(summary.total_real_revenue || 0).toLocaleString()} VND`}
                </div>
            </div>

            {/* 5. ROAS (VND/VND) */}
            <div className="p-4 bg-indigo-500/5">
                <div className="text-amber-400 text-xs font-semibold uppercase mb-1">
                    📈 ROAS (VND)
                </div>
                <div className={`text-2xl font-bold font-mono ${roas >= 2.5 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {roas.toFixed(2)}
                </div>
                <div className="text-xs text-slate-500 mt-1">Target: &gt; 2.5</div>
            </div>
        </section>
    );
}
