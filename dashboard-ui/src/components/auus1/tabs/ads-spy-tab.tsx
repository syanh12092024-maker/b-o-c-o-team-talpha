"use client";

import { useEffect, useState, useCallback } from "react";
import {
    Search, Filter, TrendingUp, Zap, Eye, ExternalLink,
    RefreshCw, Sparkles, Clock, ThumbsUp, MessageCircle, Share2,
    Globe, Flame, Loader2, Copy, Check, ChevronDown, ChevronUp,
    BookmarkPlus, Lightbulb, Target, Users, Video, Tag,
    LayoutGrid, List, SlidersHorizontal, X, Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import TabSkeleton from "@/components/ui/tab-skeleton";

const DATASET = "AUUS1_Dataset";
const BACKEND = "http://localhost:8000";

// ═══ Types ═══
interface SpyAd {
    ad_id: string;
    page_name: string;
    ad_text: string;
    ad_url: string;
    headline: string;
    started_at: string;
    is_active: boolean;
    duration_days: number;
    num_adsets: number;
    platforms: string;
    niche: string;
    market: string;
    likes: number;
    comments: number;
    shares: number;
    hot_score: number;
    creative_type: string;
    sync_date: string;
    source: string;
    video_url?: string;
    cover_url?: string;
    cta_text?: string;
    landing_url?: string;
}

interface SpyStats {
    total_tracked: number;
    hot_count: number;
    new_today: number;
    top_niche: string;
    avg_score: number;
    max_score: number;
}

interface CloneBrief {
    hook_idea?: string;
    hook_type?: string;
    body_structure?: string;
    cta_text?: string;
    target_audience?: string;
    caption_template?: string;
    key_message?: string;
    video_concept?: string;
    why_it_works?: string;
}

// ═══ Utility ═══
function useCopy() {
    const [copied, setCopied] = useState(false);
    const copy = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };
    return { copied, copy };
}

function formatNum(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
}

// ═══ Micro Components ═══
function HotBadge({ score }: { score: number }) {
    if (score >= 80) return <span className="inline-flex items-center gap-0.5 rounded-full bg-gradient-to-r from-red-500 to-orange-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm"><Flame className="h-2.5 w-2.5" />{formatNum(score)}</span>;
    if (score >= 50) return <span className="inline-flex items-center gap-0.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-400 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm"><Zap className="h-2.5 w-2.5" />{formatNum(score)}</span>;
    if (score >= 20) return <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-600 dark:bg-blue-900/40 dark:text-blue-400"><TrendingUp className="h-2.5 w-2.5" />{formatNum(score)}</span>;
    return <span className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">{score}</span>;
}

function NicheTag({ niche }: { niche: string }) {
    const cfg: Record<string, { bg: string; icon: string }> = {
        jewelry: { bg: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400", icon: "💎" },
        beauty: { bg: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400", icon: "✨" },
        health: { bg: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", icon: "💊" },
    };
    const c = cfg[niche] || { bg: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400", icon: "📦" };
    return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", c.bg)}>{c.icon} {niche}</span>;
}

function SourceBadge({ source }: { source: string }) {
    const cfg: Record<string, { bg: string; label: string }> = {
        fb_library: { bg: "bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-200 dark:ring-blue-800", label: "Facebook" },
        tiktok_cc: { bg: "bg-gray-900 text-white dark:bg-gray-700", label: "TikTok" },
    };
    const c = cfg[source] || { bg: "bg-gray-100 text-gray-600", label: source };
    return <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold", c.bg)}>{c.label}</span>;
}

function buildAdLibraryUrl(pageName: string, market: string) {
    const q = encodeURIComponent(pageName || "");
    return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${market || "US"}&q=${q}&search_type=keyword_unordered&media_type=all`;
}

// ═══ Clone Brief Panel ═══
function CloneBriefPanel({ ad }: { ad: SpyAd }) {
    const [loading, setLoading] = useState(false);
    const [brief, setBrief] = useState<CloneBrief | null>(null);
    const [error, setError] = useState<string | null>(null);
    const { copied, copy } = useCopy();

    const fetchBrief = async () => {
        setLoading(true);
        setError(null);
        try {
            const isLiveAd = ad.source === "tiktok_cc" || ad.ad_id?.startsWith("tt_") || ad.ad_id?.startsWith("fb_lib_");
            let res;
            if (isLiveAd) {
                res = await fetch(`${BACKEND}/api/ads-spy/clone-brief`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(ad),
                });
            } else {
                res = await fetch(`${BACKEND}/api/ads-spy/clone-brief/${ad.ad_id}`);
            }
            if (!res.ok) throw new Error(`API error ${res.status}`);
            const data = await res.json();
            setBrief(data.clone_brief || {});
        } catch (e: any) {
            setError(e.message || "Failed to generate brief");
        } finally {
            setLoading(false);
        }
    };

    const copyAll = () => {
        if (!brief) return;
        const text = [
            `🎯 CLONE BRIEF: ${ad.page_name}`, ``,
            `💡 Hook: ${brief.hook_idea || "—"}`,
            `🔖 Hook Type: ${brief.hook_type || "—"}`,
            `📝 Body: ${brief.body_structure || "—"}`,
            `🔑 Key Message: ${brief.key_message || "—"}`,
            `📣 CTA: ${brief.cta_text || "—"}`,
            `👥 Target: ${brief.target_audience || "—"}`,
            `📋 Caption:\n${brief.caption_template || "—"}`,
            `🎬 Video: ${brief.video_concept || "—"}`,
            `✅ Why: ${brief.why_it_works || "—"}`,
        ].join("\n");
        copy(text);
    };

    return (
        <div className="mt-3 rounded-lg border border-orange-200 dark:border-orange-500/30 bg-orange-50/50 dark:bg-orange-900/10 p-3">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-orange-700 dark:text-orange-400 flex items-center gap-1">
                    <Lightbulb className="h-3 w-3" /> AI Clone Brief
                </span>
                {!brief && !loading && (
                    <button onClick={fetchBrief}
                        className="text-[10px] font-medium bg-orange-500 text-white px-2.5 py-1 rounded-md hover:bg-orange-600 transition-colors flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> Generate
                    </button>
                )}
                {brief && (
                    <button onClick={copyAll}
                        className="text-[10px] font-medium bg-emerald-500 text-white px-2.5 py-1 rounded-md hover:bg-emerald-600 transition-colors flex items-center gap-1">
                        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copied ? "Copied!" : "Copy All"}
                    </button>
                )}
            </div>

            {loading && (
                <div className="flex items-center gap-2 py-3 justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                    <span className="text-xs text-muted-foreground">AI đang phân tích ad...</span>
                </div>
            )}
            {error && <p className="text-xs text-red-500 text-center py-2">{error}</p>}

            {brief && !loading && (
                <div className="space-y-2 text-[11px]">
                    {brief.hook_idea && (
                        <div className="rounded-md bg-white dark:bg-gray-800/50 p-2">
                            <p className="font-semibold text-orange-600 dark:text-orange-400 flex items-center gap-1 mb-0.5"><Zap className="h-3 w-3" /> Hook</p>
                            <p className="text-foreground">{brief.hook_idea}</p>
                            {brief.hook_type && <span className="inline-block mt-1 rounded bg-orange-100 dark:bg-orange-900/30 px-1.5 py-0.5 text-[10px] text-orange-600 dark:text-orange-400 font-medium">{brief.hook_type}</span>}
                        </div>
                    )}
                    {brief.key_message && (
                        <div className="rounded-md bg-white dark:bg-gray-800/50 p-2">
                            <p className="font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 mb-0.5"><Tag className="h-3 w-3" /> Key Message</p>
                            <p className="text-foreground">{brief.key_message}</p>
                        </div>
                    )}
                    {brief.caption_template && (
                        <div className="rounded-md bg-white dark:bg-gray-800/50 p-2">
                            <div className="flex items-center justify-between mb-0.5">
                                <p className="font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1"><Copy className="h-3 w-3" /> Caption</p>
                                <button onClick={() => copy(brief.caption_template || "")} className="text-[9px] bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded hover:bg-blue-200 transition-colors">Copy</button>
                            </div>
                            <p className="text-foreground italic">{brief.caption_template}</p>
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                        {brief.target_audience && (
                            <div className="rounded-md bg-white dark:bg-gray-800/50 p-2">
                                <p className="font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1 mb-0.5"><Users className="h-3 w-3" /> Target</p>
                                <p className="text-foreground">{brief.target_audience}</p>
                            </div>
                        )}
                        {brief.cta_text && (
                            <div className="rounded-md bg-white dark:bg-gray-800/50 p-2">
                                <p className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mb-0.5"><Target className="h-3 w-3" /> CTA</p>
                                <p className="text-foreground font-medium">{brief.cta_text}</p>
                            </div>
                        )}
                    </div>
                    {brief.video_concept && (
                        <div className="rounded-md bg-white dark:bg-gray-800/50 p-2">
                            <p className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1 mb-0.5"><Video className="h-3 w-3" /> Video Concept</p>
                            <p className="text-foreground">{brief.video_concept}</p>
                        </div>
                    )}
                    {brief.why_it_works && (
                        <div className="rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/30 p-2">
                            <p className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1 mb-0.5">✅ Why it works</p>
                            <p className="text-foreground">{brief.why_it_works}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ═══ Ad Card — Redesigned ═══
function AdSpyCard({ ad, layout }: { ad: SpyAd; layout: "grid" | "list" }) {
    const [showBrief, setShowBrief] = useState(false);
    const isTikTok = ad.source === "tiktok_cc" || ad.platforms === "tiktok";

    const tiktokUrl = ad.video_url && ad.video_url.startsWith("http")
        ? ad.video_url
        : ad.ad_id?.startsWith("tt_")
            ? `https://ads.tiktok.com/business/creativecenter/topads/detail/${ad.ad_id.replace("tt_", "")}?countryCode=${ad.market || "US"}`
            : `https://ads.tiktok.com/business/creativecenter/inspiration/topads/pad/en?period=30&region=${ad.market || "US"}`;

    const adLibUrl = ad.ad_url && ad.ad_url.startsWith("http")
        ? ad.ad_url
        : isTikTok ? tiktokUrl : buildAdLibraryUrl(ad.page_name, ad.market);

    if (layout === "list") {
        // ── List layout: horizontal row ──
        return (
            <div className="group relative flex items-stretch gap-4 rounded-xl border border-border/60 bg-white dark:bg-gray-900/40 p-3 overflow-hidden transition-all hover:border-orange-300 hover:shadow-md dark:hover:border-orange-500/40">
                {/* Thumbnail */}
                <div className="relative w-28 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700">
                    {ad.cover_url ? (
                        <img src={ad.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                            {ad.creative_type === "video" ? <Play className="h-6 w-6" /> : <Eye className="h-6 w-6" />}
                        </div>
                    )}
                    <span className="absolute top-1 right-1 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white font-medium">
                        {ad.creative_type === "video" ? "🎬" : "🖼️"}
                    </span>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-semibold text-foreground truncate">{ad.page_name}</span>
                            <HotBadge score={ad.hot_score} />
                            <SourceBadge source={ad.source} />
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1">{ad.headline || ad.ad_text || "—"}</p>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-1">
                        <span className="flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{ad.duration_days}d</span>
                        <span>🌍 {ad.market}</span>
                        <NicheTag niche={ad.niche} />
                        <span className="flex items-center gap-0.5 text-rose-500"><ThumbsUp className="h-2.5 w-2.5" />{formatNum(ad.likes || 0)}</span>
                        <span className="flex items-center gap-0.5 text-blue-500"><MessageCircle className="h-2.5 w-2.5" />{formatNum(ad.comments || 0)}</span>
                        {ad.cta_text && <span className="truncate max-w-[120px] rounded bg-emerald-100 dark:bg-emerald-900/30 px-1 py-0.5 text-emerald-700 dark:text-emerald-400 font-medium" title={ad.cta_text}>{ad.cta_text}</span>}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-1.5 justify-center flex-shrink-0">
                    <a href={adLibUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-orange-200 dark:border-orange-500/30 bg-orange-50 dark:bg-orange-900/20 p-1.5 text-orange-600 dark:text-orange-400 hover:bg-orange-100 transition-colors" title="Spy">
                        <Search className="h-3.5 w-3.5" />
                    </a>
                    {ad.landing_url && (
                        <a href={ad.landing_url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-900/20 p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 transition-colors" title="Landing">
                            <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    )}
                    <button onClick={() => setShowBrief(!showBrief)} className={cn("rounded-lg border p-1.5 transition-colors", showBrief ? "border-indigo-300 bg-indigo-100 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-900/30 dark:text-indigo-400" : "border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100")} title="Clone Brief">
                        <Lightbulb className="h-3.5 w-3.5" />
                    </button>
                </div>

                {showBrief && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-10">
                        <CloneBriefPanel ad={ad} />
                    </div>
                )}
            </div>
        );
    }

    // ── Grid layout: card ──
    const hasImage = !!ad.cover_url;

    return (
        <div className="group relative rounded-xl border border-border/60 bg-white dark:bg-gray-900/40 overflow-hidden transition-all hover:border-orange-300 hover:shadow-lg hover:shadow-orange-100/50 dark:hover:shadow-orange-900/20 hover:-translate-y-0.5">
            {/* Creative Preview — only when image exists */}
            {hasImage ? (
                <div className="relative aspect-[16/10] bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 overflow-hidden">
                    <img src={ad.cover_url} alt="" className="w-full h-full object-cover transition-transform group-hover:scale-105" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <div className="absolute top-2 left-2 flex items-center gap-1.5">
                        <HotBadge score={ad.hot_score} />
                    </div>
                    <div className="absolute top-2 right-2">
                        <span className="rounded-md bg-black/60 backdrop-blur-sm px-1.5 py-0.5 text-[10px] text-white font-medium">
                            {ad.creative_type === "video" ? "🎬 Video" : "🖼️ Image"}
                        </span>
                    </div>
                    <div className="absolute bottom-2 left-2 flex items-center gap-1">
                        <span className="rounded-md bg-black/60 backdrop-blur-sm px-1.5 py-0.5 text-[10px] text-white font-medium flex items-center gap-0.5">
                            <Clock className="h-2.5 w-2.5" /> {ad.duration_days}d
                        </span>
                        <span className="rounded-md bg-black/60 backdrop-blur-sm px-1.5 py-0.5 text-[10px] text-white font-medium">
                            🌍 {ad.market}
                        </span>
                    </div>
                    {ad.cta_text && (
                        <div className="absolute bottom-2 right-2 max-w-[75%] pointer-events-none">
                            <span className="block truncate rounded-md bg-emerald-500/90 backdrop-blur-sm px-1.5 py-0.5 text-[10px] text-white font-medium">{ad.cta_text}</span>
                        </div>
                    )}
                </div>
            ) : (
                /* No-image: compact colored header bar */
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800/60 dark:to-gray-800/30 border-b border-border/40">
                    <div className="flex items-center gap-1.5">
                        <HotBadge score={ad.hot_score} />
                        <span className="rounded-md bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 text-[10px] text-muted-foreground font-medium">
                            {ad.creative_type === "video" ? "🎬 Video" : "🖼️ Image"}
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" /> {ad.duration_days}d</span>
                        <span>🌍 {ad.market}</span>
                        {ad.cta_text && <span className="rounded bg-emerald-100 dark:bg-emerald-900/30 px-1 py-0.5 text-emerald-700 dark:text-emerald-400 font-medium">{ad.cta_text}</span>}
                    </div>
                </div>
            )}

            {/* Card body */}
            <div className="p-3 min-w-0 overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[13px] font-semibold text-foreground truncate flex-1">{ad.page_name || "Unknown"}</span>
                    <SourceBadge source={ad.source} />
                    <NicheTag niche={ad.niche} />
                </div>

                {/* Headline */}
                {ad.headline && <p className="text-xs font-medium text-foreground mb-1 line-clamp-1">{ad.headline}</p>}

                {/* Ad text */}
                <p className={cn("text-[11px] text-muted-foreground mb-2", hasImage ? "line-clamp-2" : "line-clamp-3")}>{ad.ad_text || "No text"}</p>

                {/* Engagement row */}
                <div className="flex items-center gap-3 text-[10px] mb-3">
                    <span className="flex items-center gap-0.5 text-rose-500 font-medium"><ThumbsUp className="h-2.5 w-2.5" /> {formatNum(ad.likes || 0)}</span>
                    <span className="flex items-center gap-0.5 text-blue-500 font-medium"><MessageCircle className="h-2.5 w-2.5" /> {formatNum(ad.comments || 0)}</span>
                    <span className="flex items-center gap-0.5 text-emerald-500 font-medium"><Share2 className="h-2.5 w-2.5" /> {formatNum(ad.shares || 0)}</span>
                    <span className="flex items-center gap-0.5 text-muted-foreground ml-auto"><Eye className="h-2.5 w-2.5" /> {ad.num_adsets} sets</span>
                </div>

                {/* Actions */}
                <div className={cn("grid gap-1.5", ad.landing_url ? "grid-cols-3" : "grid-cols-2")}>
                    <a href={adLibUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1 rounded-lg bg-orange-500 px-2 py-1.5 text-[11px] font-medium text-white hover:bg-orange-600 transition-colors shadow-sm">
                        <Search className="h-3 w-3" /> Spy
                    </a>
                    {ad.landing_url && (
                        <a href={ad.landing_url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center justify-center gap-1 rounded-lg border border-border/60 bg-white dark:bg-gray-800 px-2 py-1.5 text-[11px] font-medium text-foreground hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                            <ExternalLink className="h-3 w-3" /> Landing
                        </a>
                    )}
                    <button onClick={() => setShowBrief(!showBrief)}
                        className={cn("flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors",
                            showBrief ? "border-indigo-300 bg-indigo-100 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-900/30 dark:text-indigo-400" : "border-border/60 text-foreground hover:bg-gray-50 dark:hover:bg-gray-800")}>
                        <Lightbulb className="h-3 w-3" /> Brief
                    </button>
                </div>
            </div>

            {showBrief && <div className="px-3 pb-3"><CloneBriefPanel ad={ad} /></div>}
        </div>
    );
}

// ═══ AI Trend Summary (Collapsible) ═══
function TrendSummaryPanel({ niche, market, days, source, searchKeyword, ads }: { niche: string; market: string; days: number; source: string; searchKeyword: string; ads: SpyAd[] }) {
    const [loading, setLoading] = useState(false);
    const [summary, setSummary] = useState<string | null>(null);
    const [adsAnalyzed, setAdsAnalyzed] = useState(0);
    const [collapsed, setCollapsed] = useState(true);

    const fetchSummary = async () => {
        setLoading(true);
        setCollapsed(false);
        try {
            if (source === "fb_library" || source === "tiktok_cc") {
                const topAds = [...ads].sort((a, b) => (b.hot_score || 0) - (a.hot_score || 0)).slice(0, 15);
                const res = await fetch(`${BACKEND}/api/live-ads/trend-summary`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ads: topAds, keyword: searchKeyword })
                });
                if (!res.ok) throw new Error("API error");
                const data = await res.json();
                setSummary(data.summary || "Không có dữ liệu xu hướng.");
                setAdsAnalyzed(data.ads_analyzed || 0);
            } else {
                const params = new URLSearchParams({ days: String(days) });
                if (niche !== "all") params.set("niche", niche);
                if (market !== "all") params.set("market", market);
                const res = await fetch(`${BACKEND}/api/ads-spy/trend-summary?${params}`);
                if (!res.ok) throw new Error("API error");
                const data = await res.json();
                setSummary(data.summary || "Không có dữ liệu xu hướng.");
                setAdsAnalyzed(data.ads_analyzed || 0);
            }
        } catch {
            setSummary("Không thể tải phân tích xu hướng.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-gradient-to-r from-indigo-50/60 to-purple-50/60 dark:from-indigo-900/15 dark:to-purple-900/10 overflow-hidden">
            <button onClick={() => summary ? setCollapsed(!collapsed) : fetchSummary()}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-colors">
                <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-indigo-500" />
                    <span className="text-sm font-semibold text-foreground">AI Trend Analysis</span>
                    {adsAnalyzed > 0 && <span className="text-[10px] text-muted-foreground bg-white dark:bg-gray-800 px-2 py-0.5 rounded-full border border-border">{adsAnalyzed} ads</span>}
                </div>
                <div className="flex items-center gap-2">
                    {!summary && !loading && (
                        <span className="text-[11px] font-medium text-indigo-500 flex items-center gap-1"><Sparkles className="h-3 w-3" /> Generate</span>
                    )}
                    {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />}
                    {summary && (collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />)}
                </div>
            </button>
            {!collapsed && summary && (
                <div className="px-4 pb-3 border-t border-indigo-100 dark:border-indigo-800/30">
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-line pt-2">{summary}</p>
                </div>
            )}
        </div>
    );
}

// ═══ View mode ═══
type ViewMode = "feed" | "swipe-file";
type CardLayout = "grid" | "list";

// ═══ Main Ads Spy Tab ═══
export default function AdsSpyTab() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [ads, setAds] = useState<SpyAd[]>([]);
    const [stats, setStats] = useState<SpyStats | null>(null);
    const [topToday, setTopToday] = useState<SpyAd[]>([]);
    const [swipeFile, setSwipeFile] = useState<SpyAd[]>([]);

    const [niche, setNiche] = useState<string>("all");
    const [market, setMarket] = useState<string>("all");
    const [source, setSource] = useState<string>("all");
    const [days, setDays] = useState(7);
    const [viewMode, setViewMode] = useState<ViewMode>("feed");
    const [cardLayout, setCardLayout] = useState<CardLayout>("grid");
    const [searchKeyword, setSearchKeyword] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [mediaType, setMediaType] = useState<string>("all");
    const [showFilters, setShowFilters] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // ═══ Live API for TikTok ═══
            if (source === "tiktok_cc") {
                const params = new URLSearchParams({
                    country: market !== "all" ? market : "US",
                    niche: niche !== "all" ? niche : "all",
                    limit: "30",
                });
                const liveRes = await fetch(`${BACKEND}/api/live-ads/tiktok?${params}`)
                    .then(r => r.json())
                    .catch(() => ({ ads: [] }));

                const liveAds = (liveRes.ads || []).map((a: any) => ({
                    ...a,
                    hot_score: (a.likes || 0) + (a.comments || 0) * 3 + (a.shares || 0) * 5,
                    niche: a.niche || niche,
                    market: a.market || market,
                    source: "tiktok_cc",
                }));

                if (liveAds.length === 0) {
                    setAds([]); setTopToday([]); setSwipeFile([]);
                    setStats({ total_tracked: 0, hot_count: 0, new_today: 0, top_niche: "—", avg_score: 0, max_score: 0 });
                    setError("🎵 TikTok Ads đang được tích hợp. Chọn Facebook để xem ads.");
                    return;
                }

                setAds(liveAds);
                setTopToday(liveAds.slice(0, 5));
                setSwipeFile(liveAds.filter((a: any) => a.duration_days >= 3));
                setStats({
                    total_tracked: liveAds.length,
                    hot_count: liveAds.filter((a: any) => (a.hot_score || 0) >= 80).length,
                    new_today: 0,
                    top_niche: niche !== "all" ? niche : liveAds[0]?.niche || "—",
                    avg_score: liveAds.length > 0 ? Math.round(liveAds.reduce((s: number, a: any) => s + (a.hot_score || 0), 0) / liveAds.length) : 0,
                    max_score: liveAds.length > 0 ? Math.max(...liveAds.map((a: any) => a.hot_score || 0)) : 0,
                });
                return;
            }

            // ═══ Live API for Facebook Ad Library ═══
            if (source === "fb_library" && searchKeyword) {
                const params = new URLSearchParams({
                    keyword: searchKeyword,
                    country: market !== "all" ? market : "US",
                    limit: "50",
                    media_type: mediaType,
                    scroll_rounds: "5",
                });
                const liveRes = await fetch(`${BACKEND}/api/live-ads/facebook?${params}`)
                    .then(r => r.json())
                    .catch(() => ({ ads: [] }));

                const liveAds = (liveRes.ads || []).map((a: any) => ({
                    ...a,
                    niche: a.niche || niche,
                    market: a.market || market,
                    source: "fb_library",
                }));

                // Client-side relevance filter — FB Library returns broad matches
                const kw = searchKeyword.toLowerCase();
                const relevant = liveAds.filter((a: any) => {
                    const text = `${a.page_name || ""} ${a.headline || ""} ${a.ad_text || ""}`.toLowerCase();
                    return text.includes(kw);
                });
                const finalAds = relevant.length > 0 ? relevant : liveAds; // fallback to all if filter too aggressive

                if (finalAds.length === 0) {
                    setAds([]); setTopToday([]); setSwipeFile([]);
                    setStats({ total_tracked: 0, hot_count: 0, new_today: 0, top_niche: "—", avg_score: 0, max_score: 0 });
                    setError(`Không tìm thấy ads cho "${searchKeyword}". Thử keyword khác.`);
                    return;
                }

                setViewMode("feed");
                const sorted = [...finalAds].sort((a: any, b: any) => (b.hot_score || 0) - (a.hot_score || 0));
                setAds(sorted);
                setTopToday(sorted.slice(0, 5));
                setSwipeFile(sorted);
                setStats({
                    total_tracked: finalAds.length,
                    hot_count: finalAds.filter((a: any) => (a.hot_score || 0) >= 80).length,
                    new_today: 0,
                    top_niche: niche !== "all" ? niche : "—",
                    avg_score: finalAds.length > 0 ? Math.round(finalAds.reduce((s: number, a: any) => s + (a.hot_score || 0), 0) / finalAds.length) : 0,
                    max_score: finalAds.length > 0 ? Math.max(...finalAds.map((a: any) => a.hot_score || 0)) : 0,
                });
                return;
            }

            // ═══ BQ query (default) ═══
            const nicheFilter = niche !== "all" ? `AND niche = '${niche}'` : "";
            const marketFilter = market !== "all" ? `AND market = '${market}'` : "";
            const sourceFilter = source !== "all" ? `AND source = '${source}'` : "";

            const qAds = `SELECT * FROM ${DATASET}.fb_library_ads WHERE sync_date >= DATE_SUB(CURRENT_DATE(), INTERVAL ${days} DAY) ${nicheFilter} ${marketFilter} ${sourceFilter} ORDER BY hot_score DESC LIMIT 60`;
            const qStats = `SELECT COUNT(*) as total_tracked, COUNTIF(hot_score >= 80) as hot_count, COUNTIF(sync_date = CURRENT_DATE()) as new_today, APPROX_TOP_COUNT(niche, 1)[OFFSET(0)].value as top_niche, ROUND(AVG(hot_score), 1) as avg_score, ROUND(MAX(hot_score), 1) as max_score FROM ${DATASET}.fb_library_ads WHERE sync_date >= DATE_SUB(CURRENT_DATE(), INTERVAL ${days} DAY) ${nicheFilter} ${marketFilter} ${sourceFilter}`;
            const qTop5 = `SELECT * FROM ${DATASET}.fb_library_ads WHERE sync_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) ORDER BY hot_score DESC LIMIT 5`;
            const qSwipe = `SELECT * FROM ${DATASET}.fb_library_ads WHERE duration_days >= 7 AND hot_score > 0 ${marketFilter} ORDER BY hot_score DESC, duration_days DESC LIMIT 30`;

            const [adsRes, statsRes, top5Res, swipeRes] = await Promise.all([
                fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: qAds }) }).then(r => r.json()).catch(() => ({ data: [] })),
                fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: qStats }) }).then(r => r.json()).catch(() => ({ data: [] })),
                fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: qTop5 }) }).then(r => r.json()).catch(() => ({ data: [] })),
                fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: qSwipe }) }).then(r => r.json()).catch(() => ({ data: [] })),
            ]);

            const mapBqAd = (a: any) => ({ ...a, cover_url: a.cover_url || a.thumbnail_url || "", source: a.source || "fb_library" });
            setAds((adsRes.data || []).map(mapBqAd));
            setTopToday((top5Res.data || []).map(mapBqAd));
            setSwipeFile((swipeRes.data || []).map(mapBqAd));

            const s = (statsRes.data || [])[0];
            if (s) {
                setStats({
                    total_tracked: s.total_tracked || 0, hot_count: s.hot_count || 0,
                    new_today: s.new_today || 0, top_niche: s.top_niche || "—",
                    avg_score: s.avg_score || 0, max_score: s.max_score || 0,
                });
            }
        } catch (err: any) {
            setError(err.message || "Query error");
        } finally {
            setLoading(false);
        }
    }, [niche, market, source, days, searchKeyword, mediaType]);

    useEffect(() => { fetchData(); }, [fetchData]);

    if (loading) return <TabSkeleton />;

    const displayAds = viewMode === "swipe-file" ? swipeFile : ads;
    const rankEmoji = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

    return (
        <div className="space-y-4">
            {/* ══════ Sticky Toolbar ══════ */}
            <div className="sticky top-0 z-20 -mx-1 px-1 pt-1 pb-3 bg-gradient-to-b from-background via-background to-transparent">
                {/* Row 1: View toggle + Search + Actions */}
                <div className="flex items-center gap-2 mb-2">
                    {/* View mode toggle */}
                    <div className="flex items-center rounded-lg border border-border/60 bg-white dark:bg-gray-900/60 overflow-hidden shadow-sm">
                        <button onClick={() => setViewMode("feed")}
                            className={cn("px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1",
                                viewMode === "feed" ? "bg-orange-500 text-white" : "text-muted-foreground hover:text-foreground hover:bg-gray-50 dark:hover:bg-gray-800")}>
                            <Flame className="h-3 w-3" /> Feed
                        </button>
                        <button onClick={() => setViewMode("swipe-file")}
                            className={cn("px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1",
                                viewMode === "swipe-file" ? "bg-indigo-500 text-white" : "text-muted-foreground hover:text-foreground hover:bg-gray-50 dark:hover:bg-gray-800")}>
                            <BookmarkPlus className="h-3 w-3" /> Swipe
                        </button>
                    </div>

                    {/* Search */}
                    <div className="flex-1 max-w-md flex items-center gap-1 rounded-lg border border-border/60 bg-white dark:bg-gray-900/60 px-2.5 py-1.5 shadow-sm">
                        <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <input
                            type="text"
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === "Enter" && searchInput.trim()) {
                                    setSearchKeyword(searchInput.trim());
                                    if (source === "all") setSource("fb_library");
                                }
                            }}
                            placeholder="Search ads (Enter to search FB Library)..."
                            className="bg-transparent text-xs outline-none text-foreground placeholder:text-muted-foreground flex-1 min-w-0"
                        />
                        {searchInput && (
                            <button onClick={() => { setSearchKeyword(searchInput.trim()); if (source === "all") setSource("fb_library"); }}
                                className="flex-shrink-0 rounded bg-orange-500 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-orange-600 transition-colors">Go</button>
                        )}
                    </div>

                    {/* Layout toggle */}
                    <div className="hidden sm:flex items-center rounded-lg border border-border/60 bg-white dark:bg-gray-900/60 overflow-hidden shadow-sm">
                        <button onClick={() => setCardLayout("grid")} className={cn("p-1.5 transition-colors", cardLayout === "grid" ? "bg-gray-100 dark:bg-gray-800 text-foreground" : "text-muted-foreground hover:text-foreground")}><LayoutGrid className="h-3.5 w-3.5" /></button>
                        <button onClick={() => setCardLayout("list")} className={cn("p-1.5 transition-colors", cardLayout === "list" ? "bg-gray-100 dark:bg-gray-800 text-foreground" : "text-muted-foreground hover:text-foreground")}><List className="h-3.5 w-3.5" /></button>
                    </div>

                    {/* Filter toggle (mobile) */}
                    <button onClick={() => setShowFilters(!showFilters)}
                        className={cn("sm:hidden rounded-lg border border-border/60 bg-white dark:bg-gray-900/60 p-1.5 shadow-sm transition-colors", showFilters ? "bg-orange-50 text-orange-600 border-orange-200" : "text-muted-foreground")}>
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                    </button>

                    {/* Refresh */}
                    <button onClick={fetchData}
                        className="rounded-lg bg-gradient-to-r from-orange-500 to-red-500 p-1.5 text-white hover:opacity-90 transition-opacity shadow-sm">
                        <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                </div>

                {/* Row 2: Filters (desktop always, mobile togglable) */}
                <div className={cn("flex flex-wrap items-center gap-2", showFilters ? "flex" : "hidden sm:flex")}>
                    <select value={source} onChange={e => setSource(e.target.value)} className="rounded-lg border border-border/60 bg-white dark:bg-gray-900/60 px-2.5 py-1.5 text-xs outline-none text-foreground shadow-sm">
                        <option value="all">All Sources</option>
                        <option value="fb_library">🔵 Facebook</option>
                        <option value="tiktok_cc">🎵 TikTok</option>
                    </select>

                    <select value={market} onChange={e => setMarket(e.target.value)} className="rounded-lg border border-border/60 bg-white dark:bg-gray-900/60 px-2.5 py-1.5 text-xs outline-none text-foreground shadow-sm">
                        <option value="all">All Markets</option>
                        <optgroup label="English">
                            <option value="US">🇺🇸 US</option>
                            <option value="AU">🇦🇺 AU</option>
                            <option value="GB">🇬🇧 UK</option>
                            <option value="CA">🇨🇦 CA</option>
                            <option value="NZ">🇳🇿 NZ</option>
                        </optgroup>
                        <optgroup label="Europe">
                            <option value="DE">🇩🇪 DE</option>
                            <option value="FR">🇫🇷 FR</option>
                            <option value="IT">🇮🇹 IT</option>
                            <option value="ES">🇪🇸 ES</option>
                        </optgroup>
                    </select>
                    {source === "fb_library" && (
                        <select value={mediaType} onChange={e => setMediaType(e.target.value)} className="rounded-lg border border-border/60 bg-white dark:bg-gray-900/60 px-2.5 py-1.5 text-xs outline-none text-foreground shadow-sm">
                            <option value="all">All Media</option>
                            <option value="video">🎬 Video</option>
                            <option value="image">🖼️ Image</option>
                        </select>
                    )}
                    <div className="flex items-center rounded-lg border border-border/60 bg-white dark:bg-gray-900/60 overflow-hidden shadow-sm">
                        {[7, 14, 30].map(d => (
                            <button key={d} onClick={() => setDays(d)}
                                className={cn("px-2.5 py-1.5 text-xs font-medium transition-colors",
                                    days === d ? "bg-orange-500 text-white" : "text-muted-foreground hover:text-foreground hover:bg-gray-50 dark:hover:bg-gray-800")}>
                                {d}d
                            </button>
                        ))}
                    </div>

                    {/* Inline mini stats */}
                    {stats && (
                        <div className="flex items-center gap-3 ml-auto text-[11px] text-muted-foreground">
                            <span className="font-medium text-foreground">{formatNum(stats.total_tracked)} ads</span>
                            <span className="text-red-500 font-medium">🔥 {stats.hot_count}</span>
                            <span className="text-emerald-500">🆕 {stats.new_today}</span>
                            <span>⭐ {stats.avg_score}</span>
                            <span className="text-orange-500 font-medium">👑 {formatNum(stats.max_score)}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
                    <span>⚠️</span> {error}
                    <button onClick={() => setError(null)} className="ml-auto text-amber-400 hover:text-amber-600"><X className="h-4 w-4" /></button>
                </div>
            )}

            {/* AI Trend Analysis (collapsible) */}
            <TrendSummaryPanel niche={niche} market={market} days={days} source={source} searchKeyword={searchKeyword} ads={ads} />

            {/* ── 🏆 Top 5 Today (horizontal scroll) ── */}
            {viewMode === "feed" && topToday.length > 0 && (
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="h-4 w-4 text-amber-500" />
                        <h3 className="text-sm font-bold text-foreground">Top 5 Hôm Nay</h3>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-700">
                        {topToday.map((ad, idx) => {
                            const url = ad.ad_url && ad.ad_url.startsWith("http") ? ad.ad_url : buildAdLibraryUrl(ad.page_name, ad.market);
                            return (
                                <a key={ad.ad_id} href={url} target="_blank" rel="noopener noreferrer"
                                    className={cn("flex-shrink-0 w-52 rounded-lg border p-3 transition-all hover:shadow-md hover:-translate-y-0.5",
                                        idx === 0 ? "border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/10 dark:border-amber-500/40 shadow-sm" : "border-border/60 bg-white dark:bg-gray-900/40")}>
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <span className="text-base">{rankEmoji[idx]}</span>
                                        <span className="text-xs font-bold text-foreground truncate flex-1">{ad.page_name}</span>
                                        <HotBadge score={ad.hot_score} />
                                    </div>
                                    <p className="text-[10px] text-muted-foreground line-clamp-2 mb-1.5">{ad.headline || ad.ad_text}</p>
                                    <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                                        <span><Clock className="h-2.5 w-2.5 inline" /> {ad.duration_days}d</span>
                                        <NicheTag niche={ad.niche} />
                                    </div>
                                </a>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Ad Grid / List ── */}
            {displayAds.length > 0 ? (
                <div className={cn(
                    cardLayout === "grid"
                        ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                        : "space-y-2"
                )}>
                    {displayAds.map(ad => <AdSpyCard key={ad.ad_id} ad={ad} layout={cardLayout} />)}
                </div>
            ) : !error && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Search className="h-12 w-12 text-muted-foreground/30 mb-4" />
                    <p className="text-sm font-medium text-muted-foreground mb-1">Không có ads</p>
                    <p className="text-xs text-muted-foreground">Thử thay đổi filter hoặc search keyword mới</p>
                </div>
            )}
        </div>
    );
}
