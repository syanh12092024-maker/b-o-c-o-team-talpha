"use client";

import { VisibilityState } from "@tanstack/react-table";
import { SlidersHorizontal, RotateCcw } from "lucide-react";

interface ColumnSelectorProps {
    visibility: VisibilityState;
    onChange: (newVisibility: VisibilityState) => void;
    isOpen: boolean;
    onToggle: () => void;
}

export function ColumnSelector({ visibility, onChange, isOpen, onToggle }: ColumnSelectorProps) {

    const toggleColumn = (id: string) => {
        onChange({
            ...visibility,
            [id]: typeof visibility[id] === 'boolean' ? !visibility[id] : false // Default true if undefined? No, TanStack default is true.
            // Actually TanStack logic: undefined = visible. So if it's undefined, we want to set it to false to hide it?
            // Wait, visibility state usually tracks what is HIDDEN or explicitly shown. 
            // If we want to toggle, we need to know current state.
            // If undefined, it is visible. So new state should be false.
            // If true, new state false. If false, new state true.
        });
        // Simplified: Just pass the inverse of current *checked* state from UI
    };

    // Helper to check if visible (default true)
    const isVisible = (id: string) => visibility[id] !== false;

    const setCol = (id: string, checked: boolean) => {
        onChange({
            ...visibility,
            [id]: checked
        });
    }

    return (
        <div className="relative">
            <button
                onClick={onToggle}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg text-sm border border-slate-700 flex items-center gap-2"
            >
                <SlidersHorizontal className="h-4 w-4" /> Customize Columns
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-[600px] bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-6 z-50 grid grid-cols-3 gap-6 animate-in fade-in zoom-in-95 duration-200">

                    {/* Col 1: Performance */}
                    <div>
                        <div className="text-xs font-bold text-emerald-400 uppercase mb-3 border-b border-slate-600 pb-1">Performance</div>
                        <div className="space-y-2">
                            <Checkbox label="Spend" checked={isVisible('spend')} onChange={(c) => setCol('spend', c)} />
                            <Checkbox label="Impressions" checked={isVisible('impressions')} onChange={(c) => setCol('impressions', c)} />
                            {/* We don't have columns for Reach/Freq yet in Table, simplified for now based on what we implemented */}
                            <Checkbox label="Meta Efficiency (CPM/CPC)" checked={isVisible('meta_efficiency')} onChange={(c) => setCol('meta_efficiency', c)} />
                        </div>
                    </div>

                    {/* Col 2: Engagement & Conversions (Meta) */}
                    <div>
                        <div className="text-xs font-bold text-blue-400 uppercase mb-3 border-b border-slate-600 pb-1">Meta Results</div>
                        <div className="space-y-2">
                            <Checkbox label="Meta Results (Msgs/Leads)" checked={isVisible('meta_results')} onChange={(c) => setCol('meta_results', c)} />
                        </div>
                    </div>

                    {/* Col 3: Real POS Data */}
                    <div>
                        <div className="text-xs font-bold text-warning uppercase mb-3 border-b border-slate-600 pb-1">Real Data (POS)</div>
                        <div className="space-y-2">
                            <Checkbox label="Real Leads" checked={isVisible('real_leads')} onChange={(c) => setCol('real_leads', c)} isPremium />
                            <Checkbox label="Real Orders (New)" checked={isVisible('real_orders')} onChange={(c) => setCol('real_orders', c)} isPremium />
                            <Checkbox label="Real Revenue" checked={isVisible('real_revenue')} onChange={(c) => setCol('real_revenue', c)} isPremium />
                            <Checkbox label="Real CPA" checked={isVisible('real_cpa')} onChange={(c) => setCol('real_cpa', c)} isPremium />
                            <Checkbox label="Real ROAS" checked={isVisible('real_roas')} onChange={(c) => setCol('real_roas', c)} isPremium />
                            <Checkbox label="🤖 CMO Gợi ý" checked={isVisible('cmo_action')} onChange={(c) => setCol('cmo_action', c)} />
                        </div>
                        <div className="mt-6 text-right">
                            <button
                                onClick={() => onChange({})}
                                className="text-xs text-slate-400 hover:text-white underline flex items-center justify-end gap-1 ml-auto"
                            >
                                <RotateCcw className="h-3 w-3" /> Reset
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function Checkbox({ label, checked, onChange, isPremium }: { label: string, checked: boolean, onChange: (c: boolean) => void, isPremium?: boolean }) {
    return (
        <label className={`flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-700/50 p-1 rounded ${isPremium ? 'text-white bg-slate-700/30' : 'text-slate-300'}`}>
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className={`rounded bg-slate-900 border-slate-600 ${isPremium ? 'accent-emerald-500' : 'accent-indigo-500'}`}
            />
            <span className={isPremium ? 'text-emerald-400' : ''}>{label}</span>
        </label>
    )
}
