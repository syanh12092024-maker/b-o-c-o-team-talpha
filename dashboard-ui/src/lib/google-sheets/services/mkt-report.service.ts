import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import path from "path";
import fs from "fs";
import { TAlphaAdsModel } from "../../bigquery/models/talpha-ads.model";

function loadCredentials() {
    if (process.env.GOOGLE_CREDENTIALS_BASE64) {
        return JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, "base64").toString("utf-8"));
    }
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    }
    const keyPath = path.resolve(process.cwd(), "config/bigquery-key.json");
    if (fs.existsSync(keyPath)) {
        return JSON.parse(fs.readFileSync(keyPath, "utf-8"));
    }
    throw new Error("No Google credentials found.");
}

const MKT_DISPLAY: Record<string, { num: number; name: string }> = {
    "C.THUY": { num: 1, name: "C.Thuý" },
    "N.THE": { num: 2, name: "N.Thế" },
    "NHUNG": { num: 3, name: "Nhung" },
    "LOC": { num: 4, name: "Lộc" },
    "MANH": { num: 5, name: "Mạnh" },
    "MAI": { num: 6, name: "Mai" },
    "S.ANH": { num: 7, name: "S.Anh" },
};

function normalizeMktKey(raw: string): string {
    return (raw || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toUpperCase().trim();
}

const HEADERS = ["Ngày", "Tiền Tiêu", "Số Mess", "Giá Mess", "Đơn POS", "DT POS", "ROAS"];

/**
 * Writes MKT reports as TABS in the user's existing spreadsheet.
 * Tab naming: "{num}. {MKT} - {MARKET}" (e.g. "4. Lộc - SAUDI")
 * Summary tab: "{num}. {MKT} - TỔNG"
 * Upsert by date: overwrites existing row for same date.
 */
export class MktReportService {
    private auth: JWT;
    private doc: GoogleSpreadsheet;

    constructor(sheetId: string) {
        const creds = loadCredentials();
        this.auth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });
        this.doc = new GoogleSpreadsheet(sheetId, this.auth);
    }

    async syncByMktStructure(date: string, ads: any[], orders: any[]) {
        const report = TAlphaAdsModel.aggregateByMktMarket(ads, orders);
        if (report.length === 0) return { synced: 0 };

        await this.doc.loadInfo();

        // Group by MKT
        const byMkt = new Map<string, typeof report>();
        for (const item of report) {
            const key = normalizeMktKey(item.marketer);
            if (!byMkt.has(key)) byMkt.set(key, []);
            byMkt.get(key)!.push(item);
        }

        let syncCount = 0;
        const errors: string[] = [];

        for (const [mktKey, items] of byMkt) {
            const display = MKT_DISPLAY[mktKey];
            const prefix = display ? `${display.num}. ${display.name}` : mktKey;

            // Write each market tab
            for (const item of items) {
                try {
                    const tabName = `${prefix} - ${item.market.toUpperCase()}`;
                    await this.upsertRow(tabName, date, item);
                    syncCount++;
                } catch (e: any) {
                    errors.push(`${prefix}/${item.market}: ${e.message}`);
                }
            }

            // Write summary tab
            try {
                const totalSpend = items.reduce((s, i) => s + i.spend, 0);
                const totalMessages = items.reduce((s, i) => s + i.messages, 0);
                const totalOrders = items.reduce((s, i) => s + i.pos_orders, 0);
                const totalRevenue = items.reduce((s, i) => s + i.pos_revenue, 0);
                const tabName = `${prefix} - TỔNG`;
                await this.upsertRow(tabName, date, {
                    spend: totalSpend, messages: totalMessages,
                    pos_orders: totalOrders, pos_revenue: totalRevenue,
                });
                syncCount++;
            } catch (e: any) {
                errors.push(`${prefix}/TỔNG: ${e.message}`);
            }
        }

        console.log(`[MktReport] Synced ${syncCount} tabs, ${errors.length} errors`);
        return { synced: syncCount, errors };
    }

    private async upsertRow(tabName: string, date: string, item: {
        spend: number; messages: number; pos_orders: number; pos_revenue: number;
    }) {
        let sheet = this.doc.sheetsByTitle[tabName];
        if (!sheet) {
            sheet = await this.doc.addSheet({ title: tabName, headerValues: HEADERS });
        }

        const pricePerMsg = item.messages > 0 ? Math.round(item.spend / item.messages) : 0;
        const roas = item.spend > 0 ? (item.pos_revenue / item.spend).toFixed(1) + "x" : "0x";

        const rowData: Record<string, string | number> = {
            "Ngày": date,
            "Tiền Tiêu": Math.round(item.spend),
            "Số Mess": item.messages,
            "Giá Mess": pricePerMsg,
            "Đơn POS": item.pos_orders,
            "DT POS": Math.round(item.pos_revenue),
            "ROAS": roas,
        };

        const rows = await sheet.getRows();
        const existing = rows.find(r => r.get("Ngày") === date);

        if (existing) {
            Object.entries(rowData).forEach(([k, v]) => existing.set(k, v));
            await existing.save();
        } else {
            await sheet.addRow(rowData);
        }
    }
}
