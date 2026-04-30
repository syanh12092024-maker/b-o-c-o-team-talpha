"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import axios from "axios";
import {
    RotateCw, Satellite, Layers, ChevronDown,
    Check, Save, Sparkles, Activity, Calendar, Users,
    Globe, Package, FileText, FlaskConical, X, BarChart3
} from "lucide-react";
import { cn, formatVNDCompact } from "@/components/talpha/utils";

interface RealtimeData {
    success: boolean; date: string;
    total_spend: number; total_impressions: number; total_reach: number;
    total_messages: number; total_purchases: number; total_conversion_value: number;
    total_comments: number; total_cpm: number; total_frequency: number;
    total_roas: number; total_cost_per_purchase: number; total_cost_per_message: number;
    pos_orders: number; pos_revenue: number; pos_roas: number;
    ads: any[]; orders: any[];
}

const ACCOUNT_NAMES: Record<string, string> = {
    // Sỹ Lộc
    "act_855567553811483": "Sỹ Lộc 01", "act_934116652330312": "Sỹ Lộc 02",
    "act_1284981146939856": "Sỹ Lộc 03", "act_1614386202936215": "Sỹ Lộc 04",
    // Chu Thuý
    "act_833593695771745": "Chu Thuý 01", "act_848995974322757": "Chu Thuý 02",
    "act_1461543545434816": "Chu Thuý 03", "act_1437142241537275": "Chu Thuý 04",
    // Nhung
    "act_1223948656596727": "Nhung LevelUp - 01", "act_1670686890508970": "Nhung 02",
    "act_923574177322682": "Nhung 03",
    // N.Thế
    "act_1670240591020196": "N.Thế 01", "act_946287684758283": "N.Thế 02",
    "act_916423977810241": "N.Thế 03", "act_26411407608471378": "N.Thế 04",
    "act_1653063986109325": "N.Thế 05",
    // Mạnh
    "act_1660923908668482": "Mạnh 01", "act_937483619152247": "Mạnh 02",
    // Mai
    "act_3534017756739334": "Kuwait +3", "act_703242242813144": "Trang Sức +1",
    // S.ANH
    "act_962218859667133": "S.ANH - 01 - ĐÔNG Á", "act_939548861921691": "S.ANH - 02 - ĐÔNG Á",
    "act_1249019484033894": "Sỹ Anh 02",
    "act_1670165974333671": "Nhật Bản - 03",
};
const getAccountName = (id: string) => ACCOUNT_NAMES[id] || id;

export default function TALPHAAdsCommandTab() {
    const [data, setData] = useState<RealtimeData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    const today = new Date().toISOString().slice(0, 10);
    const [fromDate, setFromDate] = useState(today);
    const [toDate, setToDate] = useState(today);
    const [dateLabel, setDateLabel] = useState("Hôm nay");
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [selectedAccount, setSelectedAccount] = useState<string>("all");
    const [selectedMarketer, setSelectedMarketer] = useState<string>("all");
    const [selectedCountry, setSelectedCountry] = useState<string>("all");
    const [selectedProduct, setSelectedProduct] = useState<string>("all");
    const [selectedPage, setSelectedPage] = useState<string>("all");
    const [selectedTestStatus, setSelectedTestStatus] = useState<string>("all");
    const [isAccountOpen, setIsAccountOpen] = useState(false);
    const [isDateOpen, setIsDateOpen] = useState(false);
    const [isMarketerOpen, setIsMarketerOpen] = useState(false);
    const [isCountryOpen, setIsCountryOpen] = useState(false);
    const [isProductOpen, setIsProductOpen] = useState(false);
    const [isPageOpen, setIsPageOpen] = useState(false);
    const [isTestOpen, setIsTestOpen] = useState(false);
    const [accountSearch, setAccountSearch] = useState("");
    const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
    const accountRef = useRef<HTMLDivElement>(null);
    const dateRef = useRef<HTMLDivElement>(null);
    const marketerRef = useRef<HTMLDivElement>(null);
    const countryRef = useRef<HTMLDivElement>(null);
    const productRef = useRef<HTMLDivElement>(null);
    const pageRef = useRef<HTMLDivElement>(null);
    const testRef = useRef<HTMLDivElement>(null);

    // Click outside handlers
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (accountRef.current && !accountRef.current.contains(e.target as Node)) setIsAccountOpen(false);
            if (dateRef.current && !dateRef.current.contains(e.target as Node)) setIsDateOpen(false);
            if (marketerRef.current && !marketerRef.current.contains(e.target as Node)) setIsMarketerOpen(false);
            if (countryRef.current && !countryRef.current.contains(e.target as Node)) setIsCountryOpen(false);
            if (productRef.current && !productRef.current.contains(e.target as Node)) setIsProductOpen(false);
            if (pageRef.current && !pageRef.current.contains(e.target as Node)) setIsPageOpen(false);
            if (testRef.current && !testRef.current.contains(e.target as Node)) setIsTestOpen(false);
        };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await axios.get("/api/talpha/realtime", { params: { from_date: fromDate, to_date: toDate } });
            setData(res.data);
        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.error || err.message || "Không thể kết nối API");
        }
        finally { setLoading(false); }
    };

    useEffect(() => {
        fetchData();
        if (autoRefresh) { const i = setInterval(fetchData, 60000); return () => clearInterval(i); }
    }, [fromDate, toDate, autoRefresh]);

    // ── Date presets ──
    const getDatePreset = (key: string): [string, string] => {
        const d = new Date();
        const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
        const sub = (days: number) => { const r = new Date(d); r.setDate(r.getDate() - days); return r; };
        switch (key) {
            case "today": return [fmt(d), fmt(d)];
            case "yesterday": return [fmt(sub(1)), fmt(sub(1))];
            case "last7": return [fmt(sub(6)), fmt(d)];
            case "last14": return [fmt(sub(13)), fmt(d)];
            case "last28": return [fmt(sub(27)), fmt(d)];
            case "last30": return [fmt(sub(29)), fmt(d)];
            case "thisWeek": { const s = new Date(d); s.setDate(s.getDate() - s.getDay() + 1); return [fmt(s), fmt(d)]; }
            case "lastWeek": { const e = new Date(d); e.setDate(e.getDate() - e.getDay()); const s = new Date(e); s.setDate(s.getDate() - 6); return [fmt(s), fmt(e)]; }
            case "thisMonth": return [`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, fmt(d)];
            case "lastMonth": { const m = new Date(d.getFullYear(), d.getMonth() - 1, 1); const e = new Date(d.getFullYear(), d.getMonth(), 0); return [fmt(m), fmt(e)]; }
            default: return [fmt(d), fmt(d)];
        }
    };
    const DATE_PRESETS = [
        { key: "today", label: "Hôm nay" }, { key: "yesterday", label: "Hôm qua" },
        { key: "last7", label: "7 ngày qua" }, { key: "last14", label: "14 ngày qua" },
        { key: "last28", label: "28 ngày qua" }, { key: "last30", label: "30 ngày qua" },
        { key: "thisWeek", label: "Tuần này" }, { key: "lastWeek", label: "Tuần trước" },
        { key: "thisMonth", label: "Tháng này" }, { key: "lastMonth", label: "Tháng trước" },
    ];

    // ── Calendar helpers ──
    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfWeek = (year: number, month: number) => { const d = new Date(year, month, 1).getDay(); return d === 0 ? 7 : d; };
    const formatDateVN = (d: string) => { const [y, m, day] = d.split("-"); return `${day}/${m}`; };
    const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
    const MONTHS_VN = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"];

    const renderCalendar = (year: number, month: number) => {
        const days = getDaysInMonth(year, month);
        const firstDay = getFirstDayOfWeek(year, month);
        const cells: React.ReactNode[] = [];
        for (let i = 1; i < firstDay; i++) cells.push(<div key={`e${i}`} />);
        for (let d = 1; d <= days; d++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const isFrom = dateStr === fromDate;
            const isTo = dateStr === toDate;
            const inRange = dateStr >= fromDate && dateStr <= toDate;
            const isToday = dateStr === today;
            cells.push(
                <button key={d} onClick={() => {
                    if (!fromDate || (fromDate && toDate && fromDate !== toDate)) {
                        setFromDate(dateStr); setToDate(dateStr); setDateLabel(`${formatDateVN(dateStr)}`);
                    } else if (dateStr < fromDate) {
                        setFromDate(dateStr); setDateLabel(`${formatDateVN(dateStr)} - ${formatDateVN(toDate)}`);
                    } else {
                        setToDate(dateStr);
                        setDateLabel(dateStr === fromDate ? formatDateVN(dateStr) : `${formatDateVN(fromDate)} - ${formatDateVN(dateStr)}`);
                    }
                }}
                    className={cn("w-7 h-7 text-[10px] font-medium rounded-md transition-all",
                        (isFrom || isTo) ? "bg-blue-600 text-white font-bold" :
                        inRange ? "bg-blue-100 text-blue-700" :
                        isToday ? "border border-blue-400 text-blue-600" :
                        "text-slate-600 hover:bg-slate-100"
                    )}>
                    {d}
                </button>
            );
        }
        return cells;
    };

    // ── Campaign name parser: Country/MKT/Product/PageID/PageName/Date/TEST ──
    // Normalize Vietnamese diacritics for grouping (e.g. "Thế" → "THE", "Thuý" → "THUY")
    const removeDiacritics = (str: string) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd');
    interface CampaignInfo {
        country: string;
        marketer: string;   // normalized uppercase + no-diacritics key
        marketerDisplay: string; // original case for display
        product: string;
        pageId: string;
        pageName: string;
        isTest: boolean;
    }
    const parseCampaign = (campaignName: string): CampaignInfo => {
        const parts = (campaignName || "").split("/").map(s => s.trim());
        const lastPart = parts[parts.length - 1]?.toUpperCase();
        return {
            country: (parts[0] || "").toUpperCase(),
            marketer: removeDiacritics((parts[1] || "").toUpperCase()),
            marketerDisplay: parts[1] || "",
            product: parts[2] || "",
            pageId: parts[3] || "",
            pageName: parts[4] || "",
            isTest: lastPart === "TEST",
        };
    };

    // ── Build filter options from campaign data ──
    const filterOptions = useMemo(() => {
        if (!data?.ads) return { countries: [] as string[], marketers: [] as { key: string; display: string; count: number }[], products: [] as string[], pages: [] as string[], countryCounts: {} as Record<string, number>, productCounts: {} as Record<string, number>, pageCounts: {} as Record<string, number> };
        const countrySet = new Map<string, number>();
        const marketerMap = new Map<string, { display: string; count: number }>();
        const productSet = new Map<string, number>();
        const pageSet = new Map<string, number>();
        data.ads.forEach((a: any) => {
            const info = parseCampaign(a.campaign_name);
            if (info.country) countrySet.set(info.country, (countrySet.get(info.country) || 0) + 1);
            if (info.marketer) {
                const existing = marketerMap.get(info.marketer);
                if (existing) existing.count++;
                else marketerMap.set(info.marketer, { display: info.marketerDisplay, count: 1 });
            }
            if (info.product) productSet.set(info.product.toUpperCase(), (productSet.get(info.product.toUpperCase()) || 0) + 1);
            if (info.pageName) pageSet.set(info.pageName, (pageSet.get(info.pageName) || 0) + 1);
        });
        return {
            countries: [...countrySet.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]),
            marketers: [...marketerMap.entries()].sort((a, b) => b[1].count - a[1].count).map(([key, val]) => ({ key, display: val.display, count: val.count })),
            products: [...productSet.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]),
            pages: [...pageSet.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]),
            countryCounts: Object.fromEntries(countrySet),
            productCounts: Object.fromEntries(productSet),
            pageCounts: Object.fromEntries(pageSet),
        };
    }, [data]);

    const hasActiveFilter = selectedAccount !== "all" || selectedMarketer !== "all" || selectedCountry !== "all" || selectedProduct !== "all" || selectedPage !== "all" || selectedTestStatus !== "all";
    const resetAllFilters = () => {
        setSelectedAccount("all"); setSelectedMarketer("all"); setSelectedCountry("all");
        setSelectedProduct("all"); setSelectedPage("all"); setSelectedTestStatus("all");
    };

    const filteredAds = useMemo(() => {
        if (!data?.ads) return [];
        let ads = data.ads;
        if (selectedAccount !== "all") ads = ads.filter((a: any) => a.account_id === selectedAccount);
        if (selectedCountry !== "all") ads = ads.filter((a: any) => parseCampaign(a.campaign_name).country === selectedCountry);
        if (selectedMarketer !== "all") ads = ads.filter((a: any) => parseCampaign(a.campaign_name).marketer === selectedMarketer);
        if (selectedProduct !== "all") ads = ads.filter((a: any) => parseCampaign(a.campaign_name).product.toUpperCase() === selectedProduct);
        if (selectedPage !== "all") ads = ads.filter((a: any) => parseCampaign(a.campaign_name).pageName === selectedPage);
        if (selectedTestStatus !== "all") {
            const wantTest = selectedTestStatus === "test";
            ads = ads.filter((a: any) => parseCampaign(a.campaign_name).isTest === wantTest);
        }
        return ads;
    }, [data, selectedAccount, selectedMarketer, selectedCountry, selectedProduct, selectedPage, selectedTestStatus]);

    // Map campaign name prefix to POS shop_name
    const MARKET_MAP: Record<string, string> = {
        "JAPAN": "Japan", "TAIWAN": "Taiwan", "SAUDI": "Saudi",
        "UAE": "UAE", "KUWAIT": "Kuwait", "OMAN": "Oman",
        "QATAR": "Qatar", "BAHRAIN": "Bahrain",
    };

    // Map POS marketer name (normalized, no diacritics) → campaign key
    const normName = (s: string) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
    const POS_MARKETER_MAP: Record<string, string> = {
        [normName("Trần Thế")]: "N.THE",   [normName("Nguyễn Thế")]: "N.THE",
        [normName("Trần Ngọc Thế")]: "N.THE",
        [normName("Chu Thuý")]: "C.THUY",   [normName("Chu Thị Thuý")]: "C.THUY",
        [normName("Sỹ Lộc")]: "LOC",      [normName("Hồ Sỹ Lộc")]: "LOC",
        [normName("Sỹ Anh")]: "S.ANH",     [normName("Hồ Sỹ Anh")]: "S.ANH",
        [normName("Thuùy Nhung")]: "NHUNG",  [normName("Hoàng Thị Thuùy Nhung")]: "NHUNG",
        [normName("Thục Mai")]: "MAI",      [normName("Phạm Hà Thục Mai")]: "MAI",
        [normName("Thục Bình")]: "BINH",    [normName("Lê Thục Bình")]: "BINH",
    };

    const metaTotals = useMemo(() => {
        const t = filteredAds.reduce((acc: any, a: any) => ({
            spend: acc.spend + a.spend, impressions: acc.impressions + a.impressions,
            reach: acc.reach + a.reach, messages: acc.messages + a.messages,
            purchases: acc.purchases + a.purchases, conversion_value: acc.conversion_value + a.conversion_value,
            comments: acc.comments + a.comments,
            pos_orders: acc.pos_orders + (a.orders || 0),
            pos_revenue: acc.pos_revenue + (a.revenue_vnd || 0),
        }), { spend: 0, impressions: 0, reach: 0, messages: 0, purchases: 0, conversion_value: 0, comments: 0, pos_orders: 0, pos_revenue: 0 });

        return {
            ...t,
            cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0,
            frequency: t.reach > 0 ? t.impressions / t.reach : 0,
            cost_per_purchase: t.purchases > 0 ? t.spend / t.purchases : 0,
            cost_per_message: t.messages > 0 ? t.spend / t.messages : 0,
            roas: t.spend > 0 ? t.conversion_value / t.spend : 0,
            pos_roas: t.spend > 0 ? t.pos_revenue / t.spend : 0,
        };
    }, [filteredAds]);

    const emptyD = {
        spend: 0, impressions: 0, reach: 0, messages: 0, purchases: 0, conversion_value: 0,
        comments: 0, cpm: 0, frequency: 0, roas: 0, cost_per_purchase: 0, cost_per_message: 0,
        pos_orders: 0, pos_revenue: 0, pos_roas: 0,
    };
    const d = !data ? emptyD : (!hasActiveFilter ? {
        spend: data.total_spend, impressions: data.total_impressions, reach: data.total_reach,
        messages: data.total_messages, purchases: data.total_purchases, conversion_value: data.total_conversion_value,
        comments: data.total_comments, cpm: data.total_cpm, frequency: data.total_frequency,
        roas: data.total_roas, cost_per_purchase: data.total_cost_per_purchase, cost_per_message: data.total_cost_per_message,
        pos_orders: data.pos_orders, pos_revenue: data.pos_revenue, pos_roas: data.pos_roas,
    } : metaTotals);

    const activeAccountIds = useMemo(() => {
        if (!data?.ads) return [];
        return [...new Set(data.ads.map((a: any) => a.account_id))];
    }, [data]);

    const accountIds = Object.keys(ACCOUNT_NAMES);
    const filteredAccountIds = accountSearch
        ? accountIds.filter(id => getAccountName(id).toLowerCase().includes(accountSearch.toLowerCase()))
        : accountIds;

    const groupedCampaigns = useMemo(() => {
        const groups: Record<string, any[]> = {};
        filteredAds.forEach((ad: any) => {
            const key = `${ad.account_id}_${ad.campaign_id}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(ad);
        });
        const campaignRows = Object.entries(groups).map(([, ads]) => {
            const f = ads[0];
            return {
                account_id: f.account_id, campaign_id: f.campaign_id, campaign_name: f.campaign_name,
                effective_status: f.effective_status || 'UNKNOWN',
                spend: ads.reduce((s: number, a: any) => s + a.spend, 0),
                impressions: ads.reduce((s: number, a: any) => s + a.impressions, 0),
                reach: ads.reduce((s: number, a: any) => s + a.reach, 0),
                messages: ads.reduce((s: number, a: any) => s + a.messages, 0),
                purchases: ads.reduce((s: number, a: any) => s + a.purchases, 0),
                conversion_value: ads.reduce((s: number, a: any) => s + a.conversion_value, 0),
                comments: ads.reduce((s: number, a: any) => s + a.comments, 0),
                pos_orders: ads.reduce((s: number, a: any) => s + (a.orders || 0), 0),
                pos_revenue: ads.reduce((s: number, a: any) => s + (a.revenue_vnd || 0), 0),
            };
        }).sort((a, b) => b.spend - a.spend);
        return campaignRows;
    }, [filteredAds]);

    // ═══ posFromTable: Tính từ groupedCampaigns → luôn khớp với table ═══
    // Attribution logic: ad_id (Pass 1) + marketer name (Pass 1.5) đã xử lý ở model
    // Summary box phải bằng tổng table rows để không gây nhầm lẫn
    const posFromTable = useMemo(() => {
        const pos_orders = groupedCampaigns.reduce((s, c) => s + (c.pos_orders || 0), 0);
        const pos_revenue = groupedCampaigns.reduce((s, c) => s + (c.pos_revenue || 0), 0);
        const total_spend = groupedCampaigns.reduce((s, c) => s + (c.spend || 0), 0);
        return { pos_orders, pos_revenue, pos_roas: total_spend > 0 ? pos_revenue / total_spend : 0 };
    }, [groupedCampaigns]);

    // posBreakdown: nhóm theo market từ groupedCampaigns
    const posBreakdown = useMemo(() => {
        const map: Record<string, { count: number; revenue: number }> = {};
        const MARKET_DISPLAY: Record<string, string> = {
            "JAPAN": "Japan", "TAIWAN": "Taiwan", "SAUDI": "Saudi",
            "UAE": "UAE", "KUWAIT": "Kuwait", "OMAN": "Oman",
            "QATAR": "Qatar", "BAHRAIN": "Bahrain",
        };

        groupedCampaigns.forEach((c) => {
            if (!c.pos_orders && !c.pos_revenue) return;
            const prefix = (c.campaign_name || '').split('/')[0]?.trim().toUpperCase();
            const market = MARKET_DISPLAY[prefix] || prefix;
            if (!map[market]) map[market] = { count: 0, revenue: 0 };
            map[market].count += c.pos_orders || 0;
            map[market].revenue += c.pos_revenue || 0;
        });
        return Object.entries(map).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue);
    }, [groupedCampaigns]);

    const dFinal = hasActiveFilter
        ? { ...d, pos_orders: posFromTable.pos_orders, pos_revenue: posFromTable.pos_revenue, pos_roas: posFromTable.pos_roas }
        : d;

    const syncToSheet = async () => {
        if (!data) return;
        setSyncing(true);
        try {
            await axios.post("/api/talpha/realtime", { date: fromDate, sheet_id: "1-kY-bLJUYS_PPogDVydY1T330D67Cj2RK8lF8E1rzoI" });
            alert("Đã đồng bộ thành công lên Google Sheet!");
        } catch (err: any) { alert("Lỗi: " + (err.response?.data?.error || err.message)); }
        finally { setSyncing(false); }
    };

    const nextMonth = calendarMonth.month === 11
        ? { year: calendarMonth.year + 1, month: 0 }
        : { year: calendarMonth.year, month: calendarMonth.month + 1 };

    if (loading && !data) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="flex flex-col items-center gap-3">
                    <RotateCw className="w-6 h-6 text-blue-500 animate-spin" />
                    <p className="text-sm text-slate-500">Đang tải dữ liệu...</p>
                </div>
            </div>
        );
    }

    if (error && !data) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="flex flex-col items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-8 py-6">
                    <p className="text-sm font-semibold text-red-600">⚠️ Lỗi tải dữ liệu</p>
                    <p className="text-xs text-red-500 max-w-sm text-center">{error}</p>
                    <button onClick={fetchData} className="mt-2 px-4 py-1.5 bg-red-500 text-white text-xs font-bold rounded-lg hover:bg-red-600 transition">
                        Thử lại
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col gap-2 w-full overflow-hidden">
            {/* ═══ HEADER ═══ */}
            <header className="flex-shrink-0 flex items-center justify-between bg-white px-4 py-2.5 rounded-xl shadow-sm border border-slate-100">

                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-blue-500/10 rounded-lg text-blue-500"><Satellite className="w-3.5 h-3.5" /></div>
                    <div>
                        <h1 className="text-xs font-bold text-slate-800 uppercase tracking-tight">Ads Command Center</h1>
                        <p className="text-[8px] text-slate-400 flex items-center gap-1">
                            <Sparkles className="w-2 h-2 text-amber-500" /> V5.2 — Meta Ads + POS Real-time
                        </p>
                    </div>

                    {/* ── ACCOUNT SELECTOR (LEFT) ── */}
                    <div className="relative ml-3" ref={accountRef}>
                        <button onClick={() => setIsAccountOpen(!isAccountOpen)}
                            className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5 text-[10px] text-blue-700 font-semibold hover:border-blue-400 transition max-w-[180px]">
                            <Layers className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{selectedAccount === "all" ? `Tất cả (${activeAccountIds.length})` : getAccountName(selectedAccount)}</span>
                            <ChevronDown className={cn("h-2.5 w-2.5 transition flex-shrink-0", isAccountOpen && "rotate-180")} />
                        </button>
                        {isAccountOpen && (
                            <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 overflow-hidden">
                                <div className="p-2 border-b border-slate-100">
                                    <input type="text" value={accountSearch} onChange={(e) => setAccountSearch(e.target.value)}
                                        placeholder="Tìm tài khoản..." autoFocus
                                        className="w-full px-2.5 py-1.5 text-[10px] border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 bg-slate-50" />
                                </div>
                                <div className="max-h-[300px] overflow-y-auto">
                                    <button onClick={() => { setSelectedAccount("all"); setIsAccountOpen(false); setAccountSearch(""); }}
                                        className={cn("w-full flex items-center justify-between px-3 py-2 text-[10px] hover:bg-blue-50 transition border-b border-slate-50",
                                            selectedAccount === "all" ? "bg-blue-50 text-blue-700" : "text-slate-600")}>
                                        <span className="font-semibold">🌐 Tất cả ({accountIds.length} TKQC)</span>
                                        {selectedAccount === "all" && <Check className="h-3 w-3 text-blue-500" />}
                                    </button>
                                    {filteredAccountIds.map(accId => (
                                        <button key={accId} onClick={() => { setSelectedAccount(accId); setIsAccountOpen(false); setAccountSearch(""); }}
                                            className={cn("w-full flex items-center justify-between px-3 py-1.5 text-[10px] hover:bg-blue-50 transition",
                                                selectedAccount === accId ? "bg-blue-50 text-blue-700" : "text-slate-600")}>
                                            <div className="flex items-center gap-1.5">
                                                <span className={cn("w-1.5 h-1.5 rounded-full", activeAccountIds.includes(accId) ? "bg-blue-500" : "bg-slate-300")} />
                                                <span className="font-medium">{getAccountName(accId)}</span>
                                            </div>
                                            {selectedAccount === accId && <Check className="h-3 w-3 text-blue-500" />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* ── DATE RANGE PICKER ── */}
                    <div className="relative" ref={dateRef}>
                        <button onClick={() => setIsDateOpen(!isDateOpen)}
                            className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-700 font-semibold hover:border-slate-400 transition">
                            <Calendar className="h-3 w-3 text-slate-500" />
                            <span>{dateLabel}</span>
                            <ChevronDown className={cn("h-2.5 w-2.5 transition", isDateOpen && "rotate-180")} />
                        </button>
                        {isDateOpen && (
                            <div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 flex" style={{ width: "580px" }}>
                                {/* Presets */}
                                <div className="w-[150px] border-r border-slate-100 py-2 flex-shrink-0">
                                    <p className="px-3 py-1 text-[8px] text-slate-400 uppercase font-bold tracking-wider">Khoảng thời gian</p>
                                    {DATE_PRESETS.map(p => (
                                        <button key={p.key} onClick={() => {
                                            const [f, t] = getDatePreset(p.key);
                                            setFromDate(f); setToDate(t); setDateLabel(p.label); setIsDateOpen(false);
                                        }}
                                            className={cn("w-full text-left px-3 py-1.5 text-[10px] hover:bg-blue-50 transition",
                                                dateLabel === p.label ? "bg-blue-50 text-blue-700 font-semibold" : "text-slate-600")}>
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                                {/* Calendar */}
                                <div className="flex-1 p-3">
                                    <div className="flex gap-4">
                                        {/* Month 1 */}
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between mb-2">
                                                <button onClick={() => setCalendarMonth(m => m.month === 0 ? { year: m.year - 1, month: 11 } : { ...m, month: m.month - 1 })}
                                                    className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-700 text-xs">‹</button>
                                                <span className="text-[10px] font-bold text-slate-700">{MONTHS_VN[calendarMonth.month]} {calendarMonth.year}</span>
                                                <div className="w-5" />
                                            </div>
                                            <div className="grid grid-cols-7 gap-0.5">
                                                {WEEKDAYS.map(w => <div key={w} className="text-center text-[8px] text-slate-400 font-bold py-1">{w}</div>)}
                                                {renderCalendar(calendarMonth.year, calendarMonth.month)}
                                            </div>
                                        </div>
                                        {/* Month 2 */}
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="w-5" />
                                                <span className="text-[10px] font-bold text-slate-700">{MONTHS_VN[nextMonth.month]} {nextMonth.year}</span>
                                                <button onClick={() => setCalendarMonth(m => m.month === 11 ? { year: m.year + 1, month: 0 } : { ...m, month: m.month + 1 })}
                                                    className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-700 text-xs">›</button>
                                            </div>
                                            <div className="grid grid-cols-7 gap-0.5">
                                                {WEEKDAYS.map(w => <div key={`n${w}`} className="text-center text-[8px] text-slate-400 font-bold py-1">{w}</div>)}
                                                {renderCalendar(nextMonth.year, nextMonth.month)}
                                            </div>
                                        </div>
                                    </div>
                                    {/* Selected range display */}
                                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100">
                                        <div className="flex items-center gap-2 text-[10px]">
                                            <span className="px-2 py-1 bg-blue-50 border border-blue-200 rounded text-blue-700 font-mono">{formatDateVN(fromDate)}</span>
                                            <span className="text-slate-400">→</span>
                                            <span className="px-2 py-1 bg-blue-50 border border-blue-200 rounded text-blue-700 font-mono">{formatDateVN(toDate)}</span>
                                        </div>
                                        <button onClick={() => setIsDateOpen(false)}
                                            className="px-3 py-1 bg-blue-600 text-white text-[10px] font-bold rounded-lg hover:bg-blue-700 transition">
                                            Áp dụng
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <label className="flex items-center gap-1 bg-slate-50 px-2 py-1.5 rounded-lg border border-slate-200 cursor-pointer">
                        <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="accent-blue-500 w-3 h-3" />
                        <span className="text-[10px] text-slate-500">60s</span>
                        {autoRefresh && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
                    </label>
                    <button onClick={fetchData} disabled={loading}
                        className="p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-600 transition">
                        <RotateCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
                    </button>
                    <button onClick={syncToSheet} disabled={syncing || !data}
                        className="flex items-center gap-1 bg-red-500 hover:bg-red-600 text-white rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition disabled:opacity-50">
                        {syncing ? <RotateCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        Sheet
                    </button>
                </div>
            </header>

            {/* ═══ FILTER PILL BAR ═══ */}
            <div className="flex-shrink-0 flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-lg shadow-sm border border-slate-100 flex-wrap">

                {/* ── Country Filter ── */}
                <div className="relative" ref={countryRef}>
                    <button onClick={() => setIsCountryOpen(!isCountryOpen)}
                        className={cn("flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold transition border",
                            selectedCountry !== "all" ? "bg-amber-100 border-amber-300 text-amber-800" : "bg-amber-50 border-amber-200 text-amber-600 hover:border-amber-400")}>
                        <Globe className="h-3 w-3" />
                        <span>{selectedCountry === "all" ? "Quốc gia" : selectedCountry}</span>
                        <ChevronDown className={cn("h-2.5 w-2.5 transition", isCountryOpen && "rotate-180")} />
                    </button>
                    {isCountryOpen && (
                        <div className="absolute top-full left-0 mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 max-h-[300px] overflow-y-auto">
                            <button onClick={() => { setSelectedCountry("all"); setIsCountryOpen(false); }}
                                className={cn("w-full flex items-center justify-between px-3 py-1.5 text-[10px] hover:bg-amber-50 transition border-b border-slate-50",
                                    selectedCountry === "all" ? "bg-amber-50 text-amber-700" : "text-slate-600")}>
                                <span className="font-semibold">🌍 Tất cả QG</span>
                                {selectedCountry === "all" && <Check className="h-3 w-3 text-amber-500" />}
                            </button>
                            {filterOptions.countries.map(c => (
                                <button key={c} onClick={() => { setSelectedCountry(c); setIsCountryOpen(false); }}
                                    className={cn("w-full flex items-center justify-between px-3 py-1.5 text-[10px] hover:bg-amber-50 transition",
                                        selectedCountry === c ? "bg-amber-50 text-amber-700" : "text-slate-600")}>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                        <span className="font-medium">{c}</span>
                                        <span className="text-[8px] text-slate-400">({filterOptions.countryCounts[c] || 0})</span>
                                    </div>
                                    {selectedCountry === c && <Check className="h-3 w-3 text-amber-500" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* ── MKT Filter ── */}
                <div className="relative" ref={marketerRef}>
                    <button onClick={() => setIsMarketerOpen(!isMarketerOpen)}
                        className={cn("flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold transition border",
                            selectedMarketer !== "all" ? "bg-emerald-100 border-emerald-300 text-emerald-800" : "bg-emerald-50 border-emerald-200 text-emerald-600 hover:border-emerald-400")}>
                        <Users className="h-3 w-3" />
                        <span>{selectedMarketer === "all" ? "MKT" : filterOptions.marketers.find(m => m.key === selectedMarketer)?.display || selectedMarketer}</span>
                        <ChevronDown className={cn("h-2.5 w-2.5 transition", isMarketerOpen && "rotate-180")} />
                    </button>
                    {isMarketerOpen && (
                        <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 max-h-[300px] overflow-y-auto">
                            <button onClick={() => { setSelectedMarketer("all"); setIsMarketerOpen(false); }}
                                className={cn("w-full flex items-center justify-between px-3 py-1.5 text-[10px] hover:bg-emerald-50 transition border-b border-slate-50",
                                    selectedMarketer === "all" ? "bg-emerald-50 text-emerald-700" : "text-slate-600")}>
                                <span className="font-semibold">👥 Tất cả NV</span>
                                {selectedMarketer === "all" && <Check className="h-3 w-3 text-emerald-500" />}
                            </button>
                            {filterOptions.marketers.map(m => (
                                <button key={m.key} onClick={() => { setSelectedMarketer(m.key); setIsMarketerOpen(false); }}
                                    className={cn("w-full flex items-center justify-between px-3 py-1.5 text-[10px] hover:bg-emerald-50 transition",
                                        selectedMarketer === m.key ? "bg-emerald-50 text-emerald-700" : "text-slate-600")}>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                        <span className="font-medium">{m.display}</span>
                                        <span className="text-[8px] text-slate-400">({m.count})</span>
                                    </div>
                                    {selectedMarketer === m.key && <Check className="h-3 w-3 text-emerald-500" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* ── Product Filter ── */}
                <div className="relative" ref={productRef}>
                    <button onClick={() => setIsProductOpen(!isProductOpen)}
                        className={cn("flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold transition border",
                            selectedProduct !== "all" ? "bg-purple-100 border-purple-300 text-purple-800" : "bg-purple-50 border-purple-200 text-purple-600 hover:border-purple-400")}>
                        <Package className="h-3 w-3" />
                        <span className="truncate max-w-[80px]">{selectedProduct === "all" ? "Sản phẩm" : selectedProduct}</span>
                        <ChevronDown className={cn("h-2.5 w-2.5 transition", isProductOpen && "rotate-180")} />
                    </button>
                    {isProductOpen && (
                        <div className="absolute top-full left-0 mt-1 w-52 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 max-h-[300px] overflow-y-auto">
                            <button onClick={() => { setSelectedProduct("all"); setIsProductOpen(false); }}
                                className={cn("w-full flex items-center justify-between px-3 py-1.5 text-[10px] hover:bg-purple-50 transition border-b border-slate-50",
                                    selectedProduct === "all" ? "bg-purple-50 text-purple-700" : "text-slate-600")}>
                                <span className="font-semibold">📦 Tất cả SP</span>
                                {selectedProduct === "all" && <Check className="h-3 w-3 text-purple-500" />}
                            </button>
                            {filterOptions.products.map(p => (
                                <button key={p} onClick={() => { setSelectedProduct(p); setIsProductOpen(false); }}
                                    className={cn("w-full flex items-center justify-between px-3 py-1.5 text-[10px] hover:bg-purple-50 transition",
                                        selectedProduct === p ? "bg-purple-50 text-purple-700" : "text-slate-600")}>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                                        <span className="font-medium">{p}</span>
                                        <span className="text-[8px] text-slate-400">({filterOptions.productCounts[p] || 0})</span>
                                    </div>
                                    {selectedProduct === p && <Check className="h-3 w-3 text-purple-500" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* ── Page Filter ── */}
                <div className="relative" ref={pageRef}>
                    <button onClick={() => setIsPageOpen(!isPageOpen)}
                        className={cn("flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold transition border",
                            selectedPage !== "all" ? "bg-sky-100 border-sky-300 text-sky-800" : "bg-sky-50 border-sky-200 text-sky-600 hover:border-sky-400")}>
                        <FileText className="h-3 w-3" />
                        <span className="truncate max-w-[100px]">{selectedPage === "all" ? "Page" : selectedPage}</span>
                        <ChevronDown className={cn("h-2.5 w-2.5 transition", isPageOpen && "rotate-180")} />
                    </button>
                    {isPageOpen && (
                        <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 max-h-[300px] overflow-y-auto">
                            <button onClick={() => { setSelectedPage("all"); setIsPageOpen(false); }}
                                className={cn("w-full flex items-center justify-between px-3 py-1.5 text-[10px] hover:bg-sky-50 transition border-b border-slate-50",
                                    selectedPage === "all" ? "bg-sky-50 text-sky-700" : "text-slate-600")}>
                                <span className="font-semibold">📱 Tất cả Page</span>
                                {selectedPage === "all" && <Check className="h-3 w-3 text-sky-500" />}
                            </button>
                            {filterOptions.pages.map(pg => (
                                <button key={pg} onClick={() => { setSelectedPage(pg); setIsPageOpen(false); }}
                                    className={cn("w-full flex items-center justify-between px-3 py-1.5 text-[10px] hover:bg-sky-50 transition",
                                        selectedPage === pg ? "bg-sky-50 text-sky-700" : "text-slate-600")}>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                                        <span className="font-medium truncate max-w-[160px]">{pg}</span>
                                        <span className="text-[8px] text-slate-400">({filterOptions.pageCounts[pg] || 0})</span>
                                    </div>
                                    {selectedPage === pg && <Check className="h-3 w-3 text-sky-500" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* ── Test Filter ── */}
                <div className="relative" ref={testRef}>
                    <button onClick={() => setIsTestOpen(!isTestOpen)}
                        className={cn("flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold transition border",
                            selectedTestStatus !== "all" ? "bg-orange-100 border-orange-300 text-orange-800" : "bg-orange-50 border-orange-200 text-orange-600 hover:border-orange-400")}>
                        <FlaskConical className="h-3 w-3" />
                        <span>{selectedTestStatus === "all" ? "Test" : selectedTestStatus === "test" ? "Test" : "Chạy thật"}</span>
                        <ChevronDown className={cn("h-2.5 w-2.5 transition", isTestOpen && "rotate-180")} />
                    </button>
                    {isTestOpen && (
                        <div className="absolute top-full left-0 mt-1 w-40 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 overflow-hidden">
                            <button onClick={() => { setSelectedTestStatus("all"); setIsTestOpen(false); }}
                                className={cn("w-full flex items-center justify-between px-3 py-1.5 text-[10px] hover:bg-orange-50 transition border-b border-slate-50",
                                    selectedTestStatus === "all" ? "bg-orange-50 text-orange-700" : "text-slate-600")}>
                                <span className="font-semibold">🔬 Tất cả</span>
                                {selectedTestStatus === "all" && <Check className="h-3 w-3 text-orange-500" />}
                            </button>
                            <button onClick={() => { setSelectedTestStatus("test"); setIsTestOpen(false); }}
                                className={cn("w-full flex items-center justify-between px-3 py-1.5 text-[10px] hover:bg-orange-50 transition",
                                    selectedTestStatus === "test" ? "bg-orange-50 text-orange-700" : "text-slate-600")}>
                                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-orange-400" /><span className="font-medium">🧪 Test</span></div>
                                {selectedTestStatus === "test" && <Check className="h-3 w-3 text-orange-500" />}
                            </button>
                            <button onClick={() => { setSelectedTestStatus("live"); setIsTestOpen(false); }}
                                className={cn("w-full flex items-center justify-between px-3 py-1.5 text-[10px] hover:bg-orange-50 transition",
                                    selectedTestStatus === "live" ? "bg-orange-50 text-orange-700" : "text-slate-600")}>
                                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /><span className="font-medium">🚀 Chạy thật</span></div>
                                {selectedTestStatus === "live" && <Check className="h-3 w-3 text-orange-500" />}
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Active filter count + Reset ── */}
                {hasActiveFilter && (
                    <button onClick={resetAllFilters}
                        className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition ml-1">
                        <X className="h-3 w-3" />
                        Xóa lọc
                    </button>
                )}

                <span className="text-[9px] text-slate-400 ml-auto font-mono">{filteredAds.length} / {data?.ads?.length || 0} ads</span>
            </div>

            {/* ── POS Market Breakdown bar ── */}
            {posBreakdown.length > 0 && (
                <div className="bg-white rounded-lg border border-slate-100 shadow-sm px-4 py-1.5 flex items-center gap-3">
                    <span className="text-[8px] text-slate-400 uppercase font-bold tracking-wider whitespace-nowrap">📦 POS theo thị trường</span>
                    <div className="flex flex-wrap gap-x-4 gap-y-0">
                        {posBreakdown.map(m => (
                            <div key={m.name} className="flex items-center gap-1 text-[10px]">
                                <span className="font-semibold text-slate-600">{m.name}</span>
                                <span className="text-red-500 font-bold">{m.count}</span>
                                <span className="text-slate-400">({formatVNDCompact(m.revenue)})</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ═══ CAMPAIGN TABLE ═══ */}
            <section className="bg-white rounded-xl shadow-sm border border-slate-100 flex-1 min-h-0 flex flex-col overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                    <h2 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                        <Activity className="w-3.5 h-3.5 text-blue-500" /> Chi tiết theo chiến dịch
                        {selectedAccount !== "all" && (
                            <span className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[9px] font-bold border border-blue-200">
                                {getAccountName(selectedAccount)}
                            </span>
                        )}
                    </h2>
                    <span className="text-[9px] text-slate-400 font-mono">{groupedCampaigns.length} chiến dịch</span>
                </div>
                <div className="overflow-auto flex-1">
                    <table className="w-full text-[11px] table-fixed" style={{ minWidth: "1080px" }}>
                        <colgroup>
                            <col style={{ width: "20%" }} />
                            <col style={{ width: "6%" }} />
                            <col style={{ width: "8%" }} />
                            <col style={{ width: "6%" }} />
                            <col style={{ width: "7%" }} />
                            <col style={{ width: "11%" }} />
                            <col style={{ width: "6%" }} />
                            <col style={{ width: "8%" }} />
                            <col style={{ width: "7%" }} />
                            <col style={{ width: "7%" }} />
                            <col style={{ width: "7%" }} />
                            <col style={{ width: "7%" }} />
                        </colgroup>
                        <thead className="sticky top-0 z-10">
                            {/* ══ GROUP HEADER ══ */}
                            <tr>
                                <th rowSpan={2} className="text-left pl-4 pr-2 py-2 text-[9px] font-bold text-slate-500 uppercase bg-slate-50 border-b border-slate-200 border-r border-r-slate-200" style={{ width: "20%" }}>
                                    Chiến dịch / TKQC
                                </th>
                                <th rowSpan={2} className="text-center px-1 py-2 text-[9px] font-bold text-slate-500 uppercase bg-slate-50 border-b border-slate-200 border-r border-r-slate-200" style={{ width: "6%" }}>
                                    Trạng thái
                                </th>
                                {/* META ADS — Blue header */}
                                <th colSpan={4} className="text-center px-1 py-1.5 text-[9px] font-extrabold text-white uppercase tracking-wide bg-blue-600 border-b border-blue-700" style={{ borderTopLeftRadius: "4px" }}>
                                    📊 META ADS — QUẢNG CÁO
                                </th>
                                {/* POS — Red/Orange header */}
                                <th colSpan={3} className="text-center px-1 py-1.5 text-[9px] font-extrabold text-white uppercase tracking-wide bg-red-500 border-b border-red-600">
                                    🛒 POS — ĐƠN HÀNG THỰC
                                </th>
                                {/* TƯƠNG TÁC — Slate/Gray header */}
                                <th colSpan={3} className="text-center px-1 py-1.5 text-[9px] font-extrabold text-white uppercase tracking-wide bg-slate-500 border-b border-slate-600" style={{ borderTopRightRadius: "4px" }}>
                                    💬 TƯƠNG TÁC & HIỂN THỊ
                                </th>
                            </tr>
                            {/* ══ COLUMN HEADERS ══ */}
                            <tr className="border-b border-slate-200 text-[8px] uppercase tracking-wider">
                                {/* Meta Ads sub-columns — light blue bg */}
                                <th className="text-right px-1.5 py-1.5 font-bold text-blue-700 bg-blue-50">Chi phí</th>
                                <th className="text-right px-1.5 py-1.5 font-bold text-blue-700 bg-blue-50">Lượt mua</th>
                                <th className="text-right px-1.5 py-1.5 font-bold text-blue-700 bg-blue-50">CP / mua</th>
                                <th className="text-right px-1.5 py-1.5 font-bold text-blue-700 bg-blue-50 border-r border-blue-200">GT chuyển đổi</th>
                                {/* POS sub-columns — light red bg */}
                                <th className="text-right px-1.5 py-1.5 font-bold text-red-700 bg-red-50">Đơn POS</th>
                                <th className="text-right px-1.5 py-1.5 font-bold text-red-700 bg-red-50">DT POS</th>
                                <th className="text-right px-1.5 py-1.5 font-bold text-red-700 bg-red-50 border-r border-red-200">ROAS POS</th>
                                {/* Tương tác sub-columns — light gray bg */}
                                <th className="text-right px-1.5 py-1.5 font-bold text-slate-600 bg-slate-50">Tin nhắn</th>
                                <th className="text-right px-1.5 py-1.5 font-bold text-slate-600 bg-slate-50">CP / nhắn</th>
                                <th className="text-right pr-4 pl-1.5 py-1.5 font-bold text-slate-600 bg-slate-50">Bình luận</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {groupedCampaigns.length > 0 ? groupedCampaigns.map((c, idx) => {
                                const roas = c.spend > 0 ? c.conversion_value / c.spend : 0;
                                const cpp = c.purchases > 0 ? c.spend / c.purchases : 0;
                                const cpcMsg = c.messages > 0 ? c.spend / c.messages : 0;
                                const cpm = c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0;
                                const freq = c.reach > 0 ? c.impressions / c.reach : 0;
                                const posRoas = c.spend > 0 && c.pos_revenue > 0 ? c.pos_revenue / c.spend : 0;
                                return (
                                    <tr key={idx} className="group hover:bg-blue-50/30 transition-colors">
                                        {/* Campaign name */}
                                        <td className="pl-4 pr-2 py-2 border-r border-slate-100">
                                            <div className="font-medium text-slate-700 truncate max-w-[240px]" title={c.campaign_name}>{c.campaign_name}</div>
                                            <div className="text-[9px] text-slate-400">{getAccountName(c.account_id)}</div>
                                        </td>
                                        {/* Status */}
                                        <td className="px-1 py-2 text-center border-r border-slate-100">
                                            <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold whitespace-nowrap",
                                                c.effective_status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                                c.effective_status === 'PAUSED' ? 'bg-slate-100 text-slate-500 border border-slate-200' :

                                                'bg-red-50 text-red-500 border border-red-200'
                                            )}>
                                                <span className={cn("w-1.5 h-1.5 rounded-full",
                                                    c.effective_status === 'ACTIVE' ? 'bg-emerald-500' :
                                                    c.effective_status === 'PAUSED' ? 'bg-slate-400' :
                                                    c.effective_status === 'PAUSED' ? 'bg-slate-400' : 'bg-red-400'
                                                )} />
                                                {c.effective_status === 'ACTIVE' ? 'Hoạt động' :
                                                 c.effective_status === 'PAUSED' ? 'Tạm dừng' :
                                                 c.effective_status === 'DELETED' ? 'Đã xóa' :
                                                 c.effective_status === 'ARCHIVED' ? 'Lưu trữ' :
                                                 c.effective_status === 'ARCHIVED' ? 'Lưu trữ' : c.effective_status}
                                            </span>
                                        </td>
                                        {/* ── META ADS COLUMNS ── */}
                                        <td className="px-1.5 py-2 text-right font-mono text-slate-700 font-semibold whitespace-nowrap">{formatVNDCompact(c.spend)}</td>
                                        <td className="px-1.5 py-2 text-right font-mono font-bold text-blue-600">{c.purchases || "—"}</td>
                                        <td className="px-1.5 py-2 text-right font-mono text-slate-500 whitespace-nowrap">{cpp > 0 ? formatVNDCompact(cpp) : "—"}</td>
                                        <td className="px-1.5 py-2 text-right font-mono text-blue-600 font-medium whitespace-nowrap border-r border-slate-100">{c.conversion_value > 0 ? formatVNDCompact(c.conversion_value) : "—"}</td>
                                        {/* ── POS COLUMNS ── */}
                                        <td className="px-1.5 py-2 text-right font-mono font-bold text-red-600 bg-red-50/30">{c.pos_orders || "—"}</td>
                                        <td className="px-1.5 py-2 text-right font-mono text-red-600 font-medium whitespace-nowrap bg-red-50/30">{c.pos_revenue > 0 ? formatVNDCompact(c.pos_revenue) : "—"}</td>
                                        <td className={cn("px-1.5 py-2 text-right font-mono font-bold whitespace-nowrap bg-red-50/30 border-r border-slate-100",
                                            posRoas >= 3 ? "text-emerald-600" : posRoas >= 1 ? "text-red-600" : "text-red-400")}>
                                            {posRoas > 0 ? `${posRoas.toFixed(1)}x` : "—"}
                                        </td>
                                        {/* ── TƯƠNG TÁC COLUMNS ── */}
                                        <td className="px-1.5 py-2 text-right font-mono text-slate-600">{c.messages || "—"}</td>
                                        <td className="px-1.5 py-2 text-right font-mono text-slate-500 whitespace-nowrap">{cpcMsg > 0 ? formatVNDCompact(cpcMsg) : "—"}</td>
                                        <td className="pr-4 pl-1.5 py-2 text-right font-mono text-slate-500">{c.comments || "—"}</td>
                                    </tr>
                                );
                            }) : (
                                <tr><td colSpan={12} className="py-12 text-center text-slate-400 italic text-xs">
                                    {loading ? "Đang tải dữ liệu..." : `Không có dữ liệu cho ngày ${fromDate}`}
                                </td></tr>
                            )}
                        </tbody>
                        </table>
                        <div className="h-14" />
                </div>
                {/* ── FIXED BOTTOM TOTALS BAR ── */}
                {groupedCampaigns.length > 0 && (
                    <div className="fixed bottom-0 left-[256px] right-0 z-50 bg-white border-t-2 border-slate-300 shadow-[0_-4px_16px_rgba(0,0,0,0.12)] overflow-x-auto">
                        <table className="w-full text-[11px] table-fixed" style={{ minWidth: "1080px" }}>
                            <colgroup>
                                <col style={{ width: "20%" }} />
                                <col style={{ width: "6%" }} />
                                <col style={{ width: "8%" }} />
                                <col style={{ width: "6%" }} />
                                <col style={{ width: "7%" }} />
                                <col style={{ width: "11%" }} />
                                <col style={{ width: "6%" }} />
                                <col style={{ width: "8%" }} />
                                <col style={{ width: "7%" }} />
                                <col style={{ width: "7%" }} />
                                <col style={{ width: "7%" }} />
                                <col style={{ width: "7%" }} />
                            </colgroup>
                            <tbody>
                                <tr className="font-bold text-[11px]">
                                    <td className="pl-4 pr-2 py-1.5 border-r border-slate-200" colSpan={2}>
                                        <div className="text-slate-700 text-[10px] font-extrabold">
                                            ⚡ Kết quả từ {groupedCampaigns.length} chiến dịch
                                        </div>
                                        {posBreakdown.length > 0 && (
                                            <div className="flex flex-wrap gap-x-2 mt-0.5">
                                                {posBreakdown.map(m => (
                                                    <span key={m.name} className="text-[8px] text-red-500 font-semibold">
                                                        {m.name} <span className="font-black">{m.count}</span> <span className="text-slate-400">({formatVNDCompact(m.revenue)})</span>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </td>
                                    {/* META ADS totals */}
                                    <td className="px-1.5 py-1.5 text-right font-mono text-slate-700 whitespace-nowrap">{formatVNDCompact(d.spend)}</td>
                                    <td className="px-1.5 py-1.5 text-right font-mono text-blue-700">{d.purchases || "—"}</td>
                                    <td className="px-1.5 py-1.5 text-right font-mono text-slate-500 whitespace-nowrap">{d.cost_per_purchase > 0 ? formatVNDCompact(d.cost_per_purchase) : "—"}</td>
                                    <td className="px-1.5 py-1.5 text-right font-mono text-blue-700 whitespace-nowrap border-r border-slate-200">
                                        {d.conversion_value > 0 ? formatVNDCompact(d.conversion_value) : "—"}
                                        {d.roas > 0 && <span className="text-[9px] text-blue-500 ml-1">ROAS {d.roas.toFixed(2)}x</span>}
                                    </td>
                                    {/* POS totals */}
                                    <td className="px-1.5 py-1.5 text-right font-mono text-red-600 font-black bg-red-50/50">{dFinal.pos_orders || "—"}</td>
                                    <td className="px-1.5 py-1.5 text-right font-mono text-red-600 whitespace-nowrap bg-red-50/50">{dFinal.pos_revenue > 0 ? formatVNDCompact(dFinal.pos_revenue) : "—"}</td>
                                    <td className={cn("px-1.5 py-1.5 text-right font-mono font-bold whitespace-nowrap bg-red-50/50 border-r border-slate-200",
                                        dFinal.pos_roas >= 3 ? "text-emerald-600" : dFinal.pos_roas >= 1 ? "text-red-600" : "text-slate-400")}>
                                        {dFinal.pos_roas > 0 ? `${dFinal.pos_roas.toFixed(1)}x` : "—"}
                                    </td>
                                    {/* Tương tác totals */}
                                    <td className="px-1.5 py-1.5 text-right font-mono text-slate-600">{d.messages || "—"}</td>
                                    <td className="px-1.5 py-1.5 text-right font-mono text-slate-500 whitespace-nowrap">{d.cost_per_message > 0 ? formatVNDCompact(d.cost_per_message) : "—"}</td>
                                    <td className="pr-4 pl-1.5 py-1.5 text-right font-mono text-slate-500">{d.comments || "—"}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
}

function MiniKPI({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
    const borderColors: Record<string, string> = { blue: "border-l-blue-500", red: "border-l-red-500", slate: "border-l-slate-300" };
    return (
        <div className={cn("bg-white px-3 py-2.5 rounded-lg border border-slate-100 shadow-sm border-l-[3px]", borderColors[color])}>
            <p className="text-[8px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">{label}</p>
            <p className="text-lg font-black font-mono text-slate-800 leading-tight">{value}</p>
            {sub && <p className="text-[9px] text-slate-400 mt-0.5">{sub}</p>}
        </div>
    );
}
