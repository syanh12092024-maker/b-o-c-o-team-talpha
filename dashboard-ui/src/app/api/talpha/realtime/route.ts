import { NextRequest, NextResponse } from "next/server";
import { TAlphaAdsModel } from "@/lib/bigquery/models/talpha-ads.model";
import { GoogleSheetsSyncService } from "@/lib/google-sheets/services/talpha-sync.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Pro: up to 60s for 21 ad accounts

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get("from_date") || new Date().toISOString().slice(0, 10);
    const toDate = searchParams.get("to_date") || fromDate;
    const mode = searchParams.get("mode");

    try {
        if (mode === "test") {
            const config = TAlphaAdsModel.loadConfig();
            return NextResponse.json({
                success: true,
                message: "TALPHA V5.1 API CONNECTION OK",
                details: {
                    meta_ads: `${config.meta_ads.ad_account_ids.length} Accounts Connected`,
                    pos_cake: `${config.poscake.shops.length} Shops Connected`,
                    report_range: "March 2026+"
                }
            });
        }

        const [{ ads, errors: metaErrors }, orders] = await Promise.all([
            TAlphaAdsModel.fetchMetaAds(fromDate, toDate),
            TAlphaAdsModel.fetchPOSHybrid(fromDate, toDate),
        ]);
        const result = TAlphaAdsModel.aggregate(ads, orders);

        return NextResponse.json({
            success: true,
            ...result,
            date: fromDate,
            from_date: fromDate,
            to_date: toDate,
            _debug: { ads_raw: ads.length, meta_errors: metaErrors || [] }
        });
    } catch (error: any) {
        console.error("API ROUTE ERROR:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { date, sheet_id } = body;

        if (!date || !sheet_id) {
            return NextResponse.json({ success: false, error: "Missing date or sheet_id" }, { status: 400 });
        }

        const [metaResult, orders] = await Promise.all([
            TAlphaAdsModel.fetchMetaAds(date, date),
            TAlphaAdsModel.fetchPOSHybrid(date, date),
        ]);
        const { ads } = metaResult;
        const result = TAlphaAdsModel.aggregate(ads, orders);

        const syncService = new GoogleSheetsSyncService(sheet_id);
        
        // Sync both general metrics and MKT-Market detailed breakdown
        const [syncedData] = await Promise.all([
            syncService.syncAdsData({ date, ...result }),
            syncService.syncMktReport(date, ads, orders)
        ]);

        return NextResponse.json({
            success: true,
            message: "Sync Successful to '2026 auto'",
            data: syncedData
        });
    } catch (error: any) {
        console.error("POST SYNC ERROR:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
