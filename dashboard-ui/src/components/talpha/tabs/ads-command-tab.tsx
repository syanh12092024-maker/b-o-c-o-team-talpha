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
    campaigns?: any[]; // Aggregated campaigns with POS data from model
    summary?: any; // Summary stats from model aggregate
}

const ACCOUNT_NAMES: Record<string, string> = {
    // ── Sỹ Lộc (4 TK) ──
    "act_855567553811483": "Sỹ Lộc 01",
    "act_934116652330312": "Sỹ Lộc 02",
    "act_1284981146939856": "Sỹ Lộc 03",
    "act_1614386202936215": "Sỹ Lộc 04",
    // ── Chu Thuý (4 TK) ──
    "act_833593695771745": "Chu Thuý 01",
    "act_848995974322757": "Chu Thuý 02",
    "act_1461543545434816": "Chu Thuý 03",
    "act_1437142241537275": "Chu Thuý 04",
    // ── Nhung (6 TK) ──
    "act_1223948656596727": "Nhung LevelUp - 01",
    "act_1670686890508970": "Nhung 02",
    "act_923574177322682": "Nhung 03",
    "act_2710483295993252": "Nhung 04",
    "act_25706199102388719": "Nhung 05",
    "act_1272638375040037": "Nhung 06",
    // ── N.Thế (5 TK) ──
    "act_1670240591020196": "N.Thế 01",
    "act_946287684758283": "N.Thế 02",
    "act_916423977810241": "N.Thế 03",
    "act_26411407608471378": "N.Thế 04",
    "act_1653063986109325": "N.Thế 05",
    // ── Mạnh (2 TK) ──
    "act_1660923908668482": "Mạnh 01",
    "act_937483619152247": "Mạnh 02",
    // ── Mai (2 TK) ──
    "act_869269479518459": "Mai 01",
    "act_4206311709698762": "Mai 02",
    // ── Sỹ Anh (3 TK) ──
    "act_962218859667133": "S.ANH - 01 - ĐÔNG Á",
    "act_939548861921691": "S.ANH - 02 - ĐÔNG Á",
    "act_2049977905930743": "Sỹ Anh 03",
    // ── Trang Sức & Đặc biệt (6 TK) ──
    "act_3534017756739334": "Kuwait +3",
    "act_703242242813144": "Trang Sức +1",
    "act_4382396978703883": "Trang sức 27/04/2026",
    "act_416558701342048": "Tiểu Alpha 1",
    "act_1249019484033894": "Sỹ Anh 02",
    "act_1670165974333671": "Nhật Bản - 03",
    "act_1420244962877096": "TK ĐÀi",
    "act_976131321619273": "TK ĐKY Page",
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

    // Build campaign_id → POS data lookup from data.campaigns (aggregated with POS attribution)
    const campaignPosMap = useMemo(() => {
        const map = new Map<string, { pos_orders: number; pos_revenue: number; bot_orders: number; bot_revenue: number }>();
        if (data?.campaigns) {
            data.campaigns.forEach((c: any) => {
                map.set(c.campaign_id, {
                    pos_orders: c.orders || 0,
                    pos_revenue: c.revenue_vnd || 0,
                    bot_orders: c.bot_orders || 0,
                    bot_revenue: c.bot_revenue_vnd || 0,
                });
            });
        }
        return map;
    }, [data]);

    const groupedCampaigns = useMemo(() => {
        const groups: Record<string, any[]> = {};
        filteredAds.forEach((ad: any) => {
            const key = `${ad.account_id}_${ad.campaign_id}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(ad);
        });
        const campaignRows = Object.entries(groups).map(([, ads]) => {
            const f = ads[0];
            const posData = campaignPosMap.get(f.campaign_id);
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
                pos_orders: (posData?.pos_orders || 0) + (posData?.bot_orders || 0),
                pos_revenue: (posData?.pos_revenue || 0) + (posData?.bot_revenue || 0),
                bot_orders: posData?.bot_orders || 0,
                bot_revenue: posData?.bot_revenue || 0,
            };
        }).sort((a, b) => b.spend - a.spend);

        // Also add campaigns from data.campaigns that have POS orders but no active ads (inactive campaigns)
        if (data?.campaigns) {
            const existingCampIds = new Set(campaignRows.map(c => c.campaign_id));
            data.campaigns.forEach((c: any) => {
                if (!existingCampIds.has(c.campaign_id) && ((c.orders || 0) + (c.bot_orders || 0)) > 0) {
                    campaignRows.push({
                        account_id: c.account_id, campaign_id: c.campaign_id, campaign_name: c.campaign_name,
                        effective_status: 'INACTIVE',
                        spend: 0, impressions: 0, reach: 0, messages: 0, purchases: 0,
                        conversion_value: 0, comments: 0,
                        pos_orders: (c.orders || 0) + (c.bot_orders || 0),
                        pos_revenue: (c.revenue_vnd || 0) + (c.bot_revenue_vnd || 0),
                        bot_orders: c.bot_orders || 0,
                        bot_revenue: c.bot_revenue_vnd || 0,
                    });
                }
            });
            campaignRows.sort((a, b) => b.spend - a.spend);
        }

        return campaignRows;
    }, [filteredAds, campaignPosMap, data]);

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

    const fmtN = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n));
    const fmtMoney = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n));

    return (
        <div className="space-y-5 animate-fade-in">
            {/* HEADER */}
            <div className="flex items-start justify-between">
                <div>
                    <h2 className="text-xl font-bold text-foreground tracking-tight">TRUNG TÂM QUẢNG CÁO</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">Quản lý và tối ưu hóa hiệu suất chiến dịch quảng cáo toàn diện</p>
                </div>
                <div className="flex items-center gap-3">
                    <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setToDate(e.target.value); }} className="bg-white dark:bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                    <button onClick={fetchData} disabled={loading} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-gray-100 dark:hover:bg-white/5 transition disabled:opacity-50">
                        <RotateCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    </button>
                    <button onClick={syncToSheet} disabled={syncing || !data} className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-lg shadow-emerald-500/20 disabled:opacity-50">
                        <Save className="h-4 w-4" /> Sheet
                    </button>
                </div>
            </div>
            {/* TABLE SECTION */}
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 180px)' }}>

                {/* FILTERS */}
                <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-gray-50/50 dark:bg-white/[0.02] flex-wrap shrink-0">
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-muted-foreground uppercase">Quốc gia</label>
                        <div className="relative" ref={countryRef}>
                            <button onClick={() => setIsCountryOpen(!isCountryOpen)} className={cn("flex items-center gap-1.5 text-sm bg-white dark:bg-card border border-border rounded-lg px-3 py-1.5 min-w-[100px]", selectedCountry !== "all" ? "border-amber-400 text-amber-700" : "text-foreground")}>
                                <Globe className="h-3 w-3" /> {selectedCountry === "all" ? "Tất cả" : selectedCountry} <ChevronDown className="h-3 w-3 ml-auto" />
                            </button>
                            {isCountryOpen && (
                                <div className="absolute top-full left-0 mt-1 w-44 bg-white dark:bg-card border border-border rounded-xl shadow-2xl z-50 max-h-72 overflow-y-auto">
                                    <button onClick={() => { setSelectedCountry("all"); setIsCountryOpen(false); }} className={cn("w-full text-left px-3 py-2 text-xs hover:bg-blue-50 dark:hover:bg-white/5", selectedCountry === "all" && "bg-blue-50 dark:bg-white/10 font-bold")}>🌍 Tất cả</button>
                                    {filterOptions.countries.map(c => (<button key={c} onClick={() => { setSelectedCountry(c); setIsCountryOpen(false); }} className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 dark:hover:bg-white/5", selectedCountry === c && "bg-blue-50 dark:bg-white/10 font-bold")}>{c} ({filterOptions.countryCounts[c]})</button>))}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-muted-foreground uppercase">MKT</label>
                        <div className="relative" ref={marketerRef}>
                            <button onClick={() => setIsMarketerOpen(!isMarketerOpen)} className={cn("flex items-center gap-1.5 text-sm bg-white dark:bg-card border border-border rounded-lg px-3 py-1.5 min-w-[110px]", selectedMarketer !== "all" ? "border-emerald-400 text-emerald-700" : "text-foreground")}>
                                <Users className="h-3 w-3" /> {selectedMarketer === "all" ? "Chọn MKT" : filterOptions.marketers.find(m => m.key === selectedMarketer)?.display || selectedMarketer} <ChevronDown className="h-3 w-3 ml-auto" />
                            </button>
                            {isMarketerOpen && (
                                <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-card border border-border rounded-xl shadow-2xl z-50 max-h-72 overflow-y-auto">
                                    <button onClick={() => { setSelectedMarketer("all"); setIsMarketerOpen(false); }} className={cn("w-full text-left px-3 py-2 text-xs hover:bg-blue-50 dark:hover:bg-white/5", selectedMarketer === "all" && "bg-blue-50 dark:bg-white/10 font-bold")}>👥 Tất cả NV</button>
                                    {filterOptions.marketers.map(m => (<button key={m.key} onClick={() => { setSelectedMarketer(m.key); setIsMarketerOpen(false); }} className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 dark:hover:bg-white/5", selectedMarketer === m.key && "bg-blue-50 dark:bg-white/10 font-bold")}>{m.display} ({m.count})</button>))}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-muted-foreground uppercase">Sản phẩm</label>
                        <div className="relative" ref={productRef}>
                            <button onClick={() => setIsProductOpen(!isProductOpen)} className={cn("flex items-center gap-1.5 text-sm bg-white dark:bg-card border border-border rounded-lg px-3 py-1.5 min-w-[140px]", selectedProduct !== "all" ? "border-purple-400 text-purple-700" : "text-foreground")}>
                                <Package className="h-3 w-3" /> {selectedProduct === "all" ? "Tất cả sản phẩm" : selectedProduct} <ChevronDown className="h-3 w-3 ml-auto" />
                            </button>
                            {isProductOpen && (
                                <div className="absolute top-full left-0 mt-1 w-52 bg-white dark:bg-card border border-border rounded-xl shadow-2xl z-50 max-h-72 overflow-y-auto">
                                    <button onClick={() => { setSelectedProduct("all"); setIsProductOpen(false); }} className={cn("w-full text-left px-3 py-2 text-xs hover:bg-blue-50 dark:hover:bg-white/5", selectedProduct === "all" && "bg-blue-50 dark:bg-white/10 font-bold")}>📦 Tất cả SP</button>
                                    {filterOptions.products.map(p => (<button key={p} onClick={() => { setSelectedProduct(p); setIsProductOpen(false); }} className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 dark:hover:bg-white/5", selectedProduct === p && "bg-blue-50 dark:bg-white/10 font-bold")}>{p} ({filterOptions.productCounts[p]})</button>))}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-muted-foreground uppercase">Trang (Page)</label>
                        <div className="relative" ref={pageRef}>
                            <button onClick={() => setIsPageOpen(!isPageOpen)} className={cn("flex items-center gap-1.5 text-sm bg-white dark:bg-card border border-border rounded-lg px-3 py-1.5 min-w-[120px]", selectedPage !== "all" ? "border-sky-400 text-sky-700" : "text-foreground")}>
                                <FileText className="h-3 w-3" /> {selectedPage === "all" ? "Tất cả trang" : selectedPage} <ChevronDown className="h-3 w-3 ml-auto" />
                            </button>
                            {isPageOpen && (
                                <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-card border border-border rounded-xl shadow-2xl z-50 max-h-72 overflow-y-auto">
                                    <button onClick={() => { setSelectedPage("all"); setIsPageOpen(false); }} className={cn("w-full text-left px-3 py-2 text-xs hover:bg-blue-50 dark:hover:bg-white/5", selectedPage === "all" && "bg-blue-50 dark:bg-white/10 font-bold")}>📱 Tất cả Page</button>
                                    {filterOptions.pages.map(pg => (<button key={pg} onClick={() => { setSelectedPage(pg); setIsPageOpen(false); }} className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 dark:hover:bg-white/5", selectedPage === pg && "bg-blue-50 dark:bg-white/10 font-bold")}>{pg} ({filterOptions.pageCounts[pg]})</button>))}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-col gap-1 ml-auto">
                        <label className="text-[10px] font-semibold text-muted-foreground uppercase">Test/Scale</label>
                        <div className="flex rounded-lg border border-border overflow-hidden bg-white dark:bg-card">
                            {[{ key: "all", label: "TẤT CẢ" }, { key: "test", label: "TEST" }, { key: "live", label: "SCALE" }].map(t => (
                                <button key={t.key} onClick={() => setSelectedTestStatus(t.key)}
                                    className={cn("px-3.5 py-1.5 text-xs font-bold transition-all", selectedTestStatus === t.key ? "bg-slate-800 dark:bg-white/90 text-white dark:text-slate-900" : "text-muted-foreground hover:bg-gray-100 dark:hover:bg-white/10")}>
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* POS breakdown */}
                {posBreakdown.length > 0 && (
                    <div className="px-5 py-2 border-b border-border flex items-center gap-3 text-xs flex-wrap">
                        <span className="text-muted-foreground font-bold uppercase text-[10px]">📦 POS theo thị trường</span>
                        {posBreakdown.map(m => (<span key={m.name} className="text-muted-foreground"><span className="font-semibold">{m.name}</span> <span className="text-red-500 font-bold">{m.count}</span> <span className="text-muted-foreground/60">({new Intl.NumberFormat("vi-VN").format(Math.round(m.revenue))})</span></span>))}
                    </div>
                )}

                {/* TABLE + STICKY SUMMARY in same table for column alignment */}
                <div className="overflow-x-auto flex-1 min-h-0 flex flex-col">
                    <div className="overflow-y-auto flex-1 min-h-0">
                        <table className="w-full text-sm table-fixed">
                            <colgroup>
                                <col style={{width: '22%'}} />
                                <col style={{width: '8%'}} />
                                <col style={{width: '9%'}} />
                                <col style={{width: '7%'}} />
                                <col style={{width: '8%'}} />
                                <col style={{width: '7%'}} />
                                <col style={{width: '10%'}} />
                                <col style={{width: '7%'}} />
                                <col style={{width: '7%'}} />
                                <col style={{width: '8%'}} />
                                <col style={{width: '7%'}} />
                            </colgroup>
                            <thead className="sticky top-0 z-10">
                                <tr className="border-b border-border bg-gray-50/80 dark:bg-white/[0.03]">
                                    <th className="text-left px-5 py-3 text-[11px] font-bold text-muted-foreground uppercase">Chiến dịch / TKQC</th>
                                    <th className="text-center px-3 py-3 text-[11px] font-bold text-muted-foreground uppercase">Trạng thái</th>
                                    <th className="text-right px-3 py-3 text-[11px] font-bold text-blue-500 uppercase">Chi phí</th>
                                    <th className="text-right px-3 py-3 text-[11px] font-bold text-blue-500 uppercase">Lượt mua</th>
                                    <th className="text-right px-3 py-3 text-[11px] font-bold text-blue-500 uppercase">CP/Mua</th>
                                    <th className="text-right px-3 py-3 text-[11px] font-bold text-red-500 uppercase">Đơn POS</th>
                                    <th className="text-right px-3 py-3 text-[11px] font-bold text-red-500 uppercase">DT POS</th>
                                    <th className="text-right px-3 py-3 text-[11px] font-bold text-red-500 uppercase">ROAS POS</th>
                                    <th className="text-right px-3 py-3 text-[11px] font-bold text-muted-foreground uppercase">Tin nhắn</th>
                                    <th className="text-right px-3 py-3 text-[11px] font-bold text-muted-foreground uppercase">CP/nhắn</th>
                                    <th className="text-right px-4 py-3 text-[11px] font-bold text-muted-foreground uppercase">Bình luận</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {groupedCampaigns.length > 0 ? groupedCampaigns.map((c, idx) => {
                                    const cpp = c.purchases > 0 ? c.spend / c.purchases : 0;
                                    const cpcMsg = c.messages > 0 ? c.spend / c.messages : 0;
                                    const posRoas = c.spend > 0 && c.pos_revenue > 0 ? c.pos_revenue / c.spend : 0;
                                    return (
                                        <tr key={idx} className="hover:bg-blue-50/50 dark:hover:bg-white/[0.03] transition-colors">
                                            <td className="px-5 py-3.5"><div className="font-semibold text-foreground text-sm truncate" title={c.campaign_name}>{c.campaign_name}</div><div className="text-[11px] text-muted-foreground mt-0.5">{getAccountName(c.account_id)}</div></td>
                                            <td className="px-3 py-3.5 text-center"><span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold", c.effective_status === 'ACTIVE' ? "bg-emerald-50 text-emerald-600 border border-emerald-200" : "bg-slate-100 text-slate-500 border border-slate-200")}>{c.effective_status === 'ACTIVE' ? 'Hoạt động' : c.effective_status === 'PAUSED' ? 'Tạm dừng' : c.effective_status}</span></td>
                                            <td className="px-3 py-3.5 text-right font-mono text-sm font-medium">{fmtMoney(c.spend)}</td>
                                            <td className="px-3 py-3.5 text-right font-mono text-sm text-blue-600 font-bold">{c.purchases || "—"}</td>
                                            <td className="px-3 py-3.5 text-right"><span className={cn("font-mono text-sm font-bold px-2 py-0.5 rounded", cpp > 45000 ? "text-rose-600 bg-rose-50 dark:bg-rose-500/10" : "text-blue-600 bg-blue-50 dark:bg-blue-500/10")}>{cpp > 0 ? fmtMoney(cpp) : "—"}</span></td>
                                            <td className="px-3 py-3.5 text-right font-mono text-sm text-red-600 font-bold">{c.pos_orders || "—"}</td>
                                            <td className="px-3 py-3.5 text-right font-mono text-sm font-medium">{c.pos_revenue > 0 ? fmtMoney(c.pos_revenue) : "—"}</td>
                                            <td className="px-3 py-3.5 text-right"><span className={cn("font-mono text-sm font-bold", posRoas >= 3 ? "text-emerald-600" : posRoas > 0 ? "text-red-600" : "")}>{posRoas > 0 ? posRoas.toFixed(1) + "x" : "—"}</span></td>
                                            <td className="px-3 py-3.5 text-right font-mono text-sm text-muted-foreground">{c.messages ? fmtN(c.messages) : "—"}</td>
                                            <td className="px-3 py-3.5 text-right font-mono text-sm text-muted-foreground">{cpcMsg > 0 ? fmtMoney(cpcMsg) : "—"}</td>
                                            <td className="px-4 py-3.5 text-right font-mono text-sm text-muted-foreground">{c.comments ? fmtN(c.comments) : "—"}</td>
                                        </tr>
                                    );
                                }) : (
                                    <tr><td colSpan={11} className="py-12 text-center text-muted-foreground italic text-xs">{loading ? "Đang tải dữ liệu..." : "Không có dữ liệu"}</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* STICKY SUMMARY — same col widths via matching table-fixed + colgroup */}
                    <div className="shrink-0 border-t-2 border-slate-700">
                        <table className="w-full text-sm table-fixed">
                            <colgroup>
                                <col style={{width: '22%'}} />
                                <col style={{width: '8%'}} />
                                <col style={{width: '9%'}} />
                                <col style={{width: '7%'}} />
                                <col style={{width: '8%'}} />
                                <col style={{width: '7%'}} />
                                <col style={{width: '10%'}} />
                                <col style={{width: '7%'}} />
                                <col style={{width: '7%'}} />
                                <col style={{width: '8%'}} />
                                <col style={{width: '7%'}} />
                            </colgroup>
                            <tbody>
                                <tr className="bg-gradient-to-r from-slate-800 to-slate-700 text-white font-bold">
                                    <td className="px-5 py-3 uppercase tracking-wider text-xs">⚡ Kết quả từ {groupedCampaigns.length} chiến dịch</td>
                                    <td className="px-3 py-3 text-center font-mono text-xs">{groupedCampaigns.filter(c=>c.effective_status==='ACTIVE').length}/{groupedCampaigns.length}</td>
                                    <td className="px-3 py-3 text-right font-mono">{fmtMoney(dFinal.spend)}</td>
                                    <td className="px-3 py-3 text-right font-mono">{dFinal.purchases || "—"}</td>
                                    <td className="px-3 py-3 text-right font-mono">{dFinal.cost_per_purchase > 0 ? fmtMoney(dFinal.cost_per_purchase) : "—"}</td>
                                    <td className="px-3 py-3 text-right font-mono">{dFinal.pos_orders || "—"}</td>
                                    <td className="px-3 py-3 text-right font-mono">{dFinal.pos_revenue > 0 ? fmtMoney(dFinal.pos_revenue) : "—"}</td>
                                    <td className="px-3 py-3 text-right font-mono">{dFinal.pos_roas > 0 ? dFinal.pos_roas.toFixed(1) + "x" : "—"}</td>
                                    <td className="px-3 py-3 text-right font-mono">{dFinal.messages ? fmtN(dFinal.messages) : "—"}</td>
                                    <td className="px-3 py-3 text-right font-mono">{dFinal.cost_per_message > 0 ? fmtMoney(dFinal.cost_per_message) : "—"}</td>
                                    <td className="px-4 py-3 text-right font-mono">{dFinal.comments ? fmtN(dFinal.comments) : "—"}</td>
                                </tr>
                            </tbody>
                        </table>
                        <div className="flex items-center justify-between px-5 py-2 border-t border-border/30 bg-slate-800 text-xs text-slate-400">
                            <span>Hiển thị {groupedCampaigns.length} chiến dịch</span>
                            <div className="flex items-center gap-3">
                                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Hệ thống ổn định</span>
                                <span className="text-slate-600">•</span>
                                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400"></span> Đang đồng bộ Meta Ads</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
