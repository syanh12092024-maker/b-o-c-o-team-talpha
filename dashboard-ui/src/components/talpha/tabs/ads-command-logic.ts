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
