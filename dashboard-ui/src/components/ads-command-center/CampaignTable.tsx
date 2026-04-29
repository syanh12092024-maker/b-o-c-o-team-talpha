"use client";

import { useMemo, useState } from "react";
import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
    SortingState,
    VisibilityState,
} from "@tanstack/react-table";
import { CampaignData, usdToVnd, localToVnd, formatVND, formatUSD } from "./types";
import { ArrowUpDown } from "lucide-react";

interface CampaignTableProps {
    data: CampaignData[];
    columnVisibility: VisibilityState;
    alreadyVnd?: boolean;
}

export function CampaignTable({ data, columnVisibility, alreadyVnd = false }: CampaignTableProps) {
    const [sorting, setSorting] = useState<SortingState>([]);

    const columns = useMemo<ColumnDef<CampaignData>[]>(
        () => [
            {
                id: "select",
                header: "S",
                cell: () => (
                    <input type="checkbox" className="accent-emerald-500 w-4 h-4 cursor-pointer" />
                ),
            },
            {
                accessorKey: "name",
                header: "Campaign Name",
                cell: ({ row }) => (
                    <div className="text-xs text-white max-w-[320px] whitespace-normal leading-tight" title={row.original.name}>
                        {row.original.name}
                        <div className="text-[10px] text-slate-500 mt-0.5">{row.original.status}</div>
                    </div>
                ),
            },
            // ═══ SPEND: VND ═══
            {
                accessorFn: (row) => row.metrics_meta.spend,
                id: "spend",
                header: ({ column }) => (
                    <div
                        className="text-right cursor-pointer flex justify-end items-center gap-1"
                        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    >
                        SPEND (₫) ↕ <ArrowUpDown className="h-3 w-3" />
                    </div>
                ),
                cell: ({ getValue }) => {
                    const raw = (getValue() as number) || 0;
                    const vnd = alreadyVnd ? raw : usdToVnd(raw);
                    return (
                        <div className="text-right font-mono">
                            <div className="text-slate-300">{formatVND(vnd)}</div>
                        </div>
                    );
                },
            },
            // ═══ META EFFICIENCY ═══
            {
                id: "meta_efficiency",
                header: () => <div className="text-right">CPM/CPC/CTR</div>,
                cell: ({ row }) => {
                    const m = row.original.metrics_meta;
                    const cpmVnd = alreadyVnd ? m.cpm : usdToVnd(m.cpm);
                    const cpcVnd = alreadyVnd ? m.cpc : usdToVnd(m.cpc);
                    return (
                        <div className="text-right font-mono text-xs space-y-0.5">
                            <div className="text-slate-400 flex justify-end gap-2"><span>CPM:</span> <span className="text-white">{formatVND(cpmVnd)}</span></div>
                            <div className="text-slate-500 flex justify-end gap-2"><span>CPC:</span> <span>{formatVND(cpcVnd)}</span></div>
                            <div className="text-indigo-400 flex justify-end gap-2"><span>CTR:</span> <span>{(m.ctr || 0).toFixed(2)}%</span></div>
                        </div>
                    )
                }
            },
            // ═══ META RESULTS ═══
            {
                id: "meta_results",
                header: () => <div className="text-right">Meta Results</div>,
                cell: ({ row }) => {
                    const m = row.original.metrics_meta;
                    return (
                        <div className="text-right font-mono text-xs space-y-0.5">
                            <div className="text-indigo-400">{m.messages || 0} Msgs</div>
                            {(m.leads || 0) > 0 && <div className="text-slate-300">{m.leads} Leads</div>}
                            {(m.purchases || 0) > 0 && <div className="text-emerald-400 font-bold">{m.purchases} Purchases</div>}
                            <div className="border-t border-slate-700 my-0.5 pt-0.5"></div>
                            <div className="text-slate-500">CPA: {formatVND(alreadyVnd ? m.cost_per_msg : usdToVnd(m.cost_per_msg))}</div>
                            {(m.purchases || 0) > 0 && <div className="text-emerald-500">CPO: {formatVND(alreadyVnd ? m.cost_per_purchase : usdToVnd(m.cost_per_purchase))}</div>}
                        </div>
                    )
                }
            },
            // ═══ REAL: ORDERS (Created — for decisions) ═══
            {
                accessorFn: (row) => row.metrics_real.created_orders,
                id: "real_orders",
                header: ({ column }) => (
                    <div
                        className="text-right cursor-pointer flex justify-end items-center gap-1 bg-emerald-500/10 text-emerald-300 px-2 py-1 rounded-t"
                        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    >
                        📦 ĐƠN TẠO <ArrowUpDown className="h-3 w-3" />
                    </div>
                ),
                cell: ({ getValue }) => {
                    const val = (getValue() as number) || 0;
                    return (
                        <div className={`text-right font-mono font-bold text-lg bg-emerald-500/5 px-2 py-3 h-full ${val > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                            {val}
                        </div>
                    );
                },
            },
            // ═══ REAL: REVENUE (RON → VND) ═══
            {
                accessorFn: (row) => row.metrics_real.revenue,
                id: "real_revenue",
                header: ({ column }) => (
                    <div
                        className="text-right cursor-pointer flex justify-end items-center gap-1 bg-emerald-500/10 text-emerald-300 px-2 py-1 rounded-t"
                        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    >
                        💰 DOANH THU <ArrowUpDown className="h-3 w-3" />
                    </div>
                ),
                cell: ({ getValue }) => {
                    const raw = (getValue() as number) || 0;
                    const vnd = alreadyVnd ? raw : localToVnd(raw);
                    return (
                        <div className="text-right font-mono bg-emerald-500/5 px-2 py-3 h-full">
                            <div className={`font-bold ${raw > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>{formatVND(vnd)}</div>
                            {raw > 0 && <div className="text-xs text-slate-500">{raw.toLocaleString()} VND</div>}
                        </div>
                    );
                },
            },
            // ═══ REAL: CPA (VND) ═══
            {
                accessorFn: (row) => row.metrics_real.created_orders,
                id: "real_cpa",
                header: () => <div className="text-right bg-emerald-500/10 text-emerald-300 px-2 py-1 rounded-t">📉 CPA (₫)</div>,
                cell: ({ row }) => {
                    const orders = row.original.metrics_real.created_orders || 0;
                    const spendVnd = alreadyVnd ? row.original.metrics_meta.spend : usdToVnd(row.original.metrics_meta.spend);
                    const cpa = orders > 0 ? spendVnd / orders : 0;
                    return (
                        <div className={`text-right font-mono font-bold bg-emerald-500/5 px-2 py-3 h-full ${cpa > 500000 ? "text-rose-400" : "text-amber-400"}`}>
                            {orders > 0 ? formatVND(cpa) : '-'}
                        </div>
                    );
                },
            },
            // ═══ REAL: ROAS (revenue_vnd / spend_vnd) ═══
            {
                accessorFn: (row) => {
                    const spendVnd = alreadyVnd ? row.metrics_meta.spend : usdToVnd(row.metrics_meta.spend);
                    const revVnd = alreadyVnd ? row.metrics_real.revenue : localToVnd(row.metrics_real.revenue);
                    return spendVnd > 0 ? revVnd / spendVnd : 0;
                },
                id: "real_roas",
                header: ({ column }) => (
                    <div
                        className="text-right cursor-pointer flex justify-end items-center gap-1 bg-emerald-500/10 text-emerald-300 px-2 py-1 rounded-t border-r border-emerald-500/20"
                        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    >
                        📈 ROAS <ArrowUpDown className="h-3 w-3" />
                    </div>
                ),
                cell: ({ getValue }) => {
                    const val = (getValue() as number) || 0;
                    const color = val > 2.5 ? "text-emerald-400" : val > 0 ? "text-rose-400" : "text-slate-600";
                    return (
                        <div className={`text-right font-mono font-bold ${color} text-lg bg-emerald-500/5 px-2 py-3 h-full border-r border-emerald-500/10`}>
                            {val > 0 ? val.toFixed(2) : '-'}
                        </div>
                    );
                },
            },
            // ═══ CMO RECOMMENDATION ═══
            {
                id: "cmo_action",
                header: "🤖 CMO Gợi ý",
                cell: ({ row }) => {
                    const insight = row.original.ai_insight;
                    if (!insight) return <span className="text-slate-600">-</span>;

                    const signal = insight.signal || '';
                    const action = insight.action;
                    const todo = insight.todo || '';
                    const roas = insight.roas || 0;

                    // Signal badge color
                    const badgeClass = signal.includes('SCALE') ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        : signal.includes('DUNG') || signal.includes('DỪNG') ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                            : signal.includes('THEO') ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                                : 'bg-slate-500/20 text-slate-400 border-slate-500/30';

                    // Action button
                    const actionBtn = action === 'SCALE' ? (
                        <button className="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-0.5 rounded text-[10px] font-bold shadow-lg shadow-emerald-500/20 border border-emerald-500 mt-1">
                            🚀 SCALE
                        </button>
                    ) : action === 'KILL' ? (
                        <button className="bg-rose-600 hover:bg-rose-500 text-white px-2.5 py-0.5 rounded text-[10px] font-bold shadow-lg shadow-rose-500/20 border border-rose-500 mt-1">
                            ⛔ TẮT
                        </button>
                    ) : null;

                    return (
                        <div className="w-[200px]">
                            {/* Signal Badge + ROAS */}
                            <div className="flex items-center gap-1 flex-wrap">
                                <span className={`text-[9px] font-bold px-1 py-0.5 rounded border leading-none ${badgeClass}`}>
                                    {signal}
                                </span>
                                {roas > 0 && (
                                    <span className="text-[9px] text-slate-500">{roas}x</span>
                                )}
                                {actionBtn}
                            </div>
                            {/* Todo — full wrap */}
                            {todo && (
                                <div className="text-[10px] text-slate-400 leading-snug mt-1 break-words whitespace-normal">
                                    {todo}
                                </div>
                            )}
                        </div>
                    );
                },
            },
        ],
        [alreadyVnd]
    );

    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        onSortingChange: setSorting,
        state: {
            sorting,
            columnVisibility,
        },
    });

    return (
        <div className="overflow-auto max-h-[600px] relative">
            <table className="w-full text-sm text-left">
                {/* ═══ STICKY HEADER ═══ */}
                <thead className="text-xs font-semibold uppercase text-slate-400 bg-slate-800 sticky top-0 z-10">
                    {table.getHeaderGroups().map((headerGroup) => (
                        <tr key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                                <th key={header.id} className="px-3 py-3 text-left whitespace-nowrap bg-slate-800">
                                    {header.isPlaceholder
                                        ? null
                                        : flexRender(header.column.columnDef.header, header.getContext())}
                                </th>
                            ))}
                        </tr>
                    ))}
                </thead>
                <tbody className="divide-y divide-slate-700">
                    {table.getRowModel().rows?.length ? (
                        table.getRowModel().rows.map((row) => (
                            <tr key={row.id} className="transition hover:bg-slate-700/30 group">
                                {row.getVisibleCells().map((cell) => (
                                    <td key={cell.id} className="px-3 py-3 border-b border-slate-700/50 whitespace-nowrap">
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                ))}
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={columns.length} className="h-24 text-center text-slate-500">
                                No results.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}
