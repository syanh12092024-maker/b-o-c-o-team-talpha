"use client";

import { RON_TO_VND, USD_TO_VND, EUR_TO_VND } from "@/lib/utils";

export default function ExchangeRateBanner() {
    return (
        <div className="flex items-center gap-4 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-600 dark:text-slate-300">Tỷ giá:</span>
            <span>1 USD = <b className="text-blue-600 dark:text-blue-400">{USD_TO_VND.toLocaleString("vi-VN")}</b> VND</span>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <span>1 RON = <b className="text-emerald-600 dark:text-emerald-400">{RON_TO_VND.toLocaleString("vi-VN")}</b> VND</span>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <span>1 EUR = <b className="text-amber-600 dark:text-amber-400">{EUR_TO_VND.toLocaleString("vi-VN")}</b> VND</span>
        </div>
    );
}
