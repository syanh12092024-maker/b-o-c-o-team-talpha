import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import path from "path";
import fs from "fs";
import { TAlphaAdsModel } from "../../bigquery/models/talpha-ads.model";

function loadCredentials() {
    // Cloud: base64 env var
    if (process.env.GOOGLE_CREDENTIALS_BASE64) {
        return JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, "base64").toString("utf-8"));
    }
    // Cloud: JSON string env var
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    }
    // Local: read file
    const keyPath = path.resolve(process.cwd(), "config/bigquery-key.json");
    if (fs.existsSync(keyPath)) {
        return JSON.parse(fs.readFileSync(keyPath, "utf-8"));
    }
    throw new Error("No Google credentials found. Set GOOGLE_CREDENTIALS_BASE64 env var.");
}

export class GoogleSheetsSyncService {
    private doc: GoogleSpreadsheet;

    constructor(sheetId: string) {
        const creds = loadCredentials();

        const serviceAccountAuth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });

        this.doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    }

    async syncAdsData(data: any) {
        try {
            await this.doc.loadInfo();

            // 1. Get or Create "2026 auto" tab
            let sheet = this.doc.sheetsByTitle["2026 auto"];
            if (!sheet) {
                sheet = await this.doc.addSheet({
                    title: "2026 auto",
                    headerValues: [
                        "30", "TỔNG TIỀN ADS", "SỐ TIN NHẮN", "Giá Tiền/TN", "CPO",
                        "Tỷ lệ chốt", "Số đơn", "AED", "Tỉ giá AED", "Doanh Số",
                        "Doanh số ship thành công dự kiến", "tỷ lệ Chi phí ads/Doanh Thu",
                        "tỷ lệ Chi phí ads/Thu ship thành", "TB đơn"
                    ]
                });
            }

            // 2. Validate date (March 2026+)
            const syncDate = new Date(data.date);
            const marchFirst = new Date("2026-03-01");
            if (syncDate < marchFirst) {
                throw new Error("Hệ thống chỉ đồng bộ dữ liệu từ tháng 3/2026 trở đi.");
            }

            // 3. Format Row
            const AED_RATE = 7010; // Updated from yaml
            const SUCCESS_RATE = 0.65;

            const row = {
                "30": data.date,
                "TỔNG TIỀN ADS": data.total_spend,
                "SỐ TIN NHẮN": data.total_messages,
                "Giá Tiền/TN": data.total_messages > 0 ? Math.round(data.total_spend / data.total_messages) : 0,
                "CPO": data.total_orders > 0 ? Math.round(data.total_spend / data.total_orders) : 0,
                "Tỷ lệ chốt": data.total_messages > 0 ? (data.total_orders / data.total_messages).toFixed(4) : 0,
                "Số đơn": data.total_orders,
                "AED": Math.round(data.total_spend / AED_RATE),
                "Tỉ giá AED": AED_RATE,
                "Doanh Số": data.total_revenue,
                "Doanh số ship thành công dự kiến": Math.round(data.total_revenue * SUCCESS_RATE),
                "tỷ lệ Chi phí ads/Doanh Thu": data.total_revenue > 0 ? (data.total_spend / data.total_revenue).toFixed(4) : 0,
                "tỷ lệ Chi phí ads/Thu ship thành": (data.total_revenue * SUCCESS_RATE) > 0 ? (data.total_spend / (data.total_revenue * SUCCESS_RATE)).toFixed(4) : 0,
                "TB đơn": data.total_orders > 0 ? Math.round(data.total_revenue / data.total_orders) : 0,
            };

            await sheet.addRow(row);
            return row;
        } catch (err: any) {
            console.error("Sheet Sync Error:", err.message);
            throw err;
        }
    }

    async syncMktReport(date: string, ads: any[], orders: any[]) {
        try {
            await this.doc.loadInfo();
            const report = TAlphaAdsModel.aggregateByMktMarket(ads, orders);

            for (const item of report) {
                // Tab name: "MKT - MARKET"
                const sheetTitle = `${item.marketer} - ${item.market}`;
                let sheet = this.doc.sheetsByTitle[sheetTitle];
                
                if (!sheet) {
                    // Create sheet if it doesn't exist
                    sheet = await this.doc.addSheet({
                        title: sheetTitle,
                        headerValues: ["Ngày", "Tiền Tiêu", "Số Mess", "Giá Mess", "Đơn POS", "DT POS", "ROAS"]
                    });
                }

                const pricePerMsg = item.messages > 0 ? Math.round(item.spend / item.messages) : 0;
                const roas = item.spend > 0 ? (item.pos_revenue / item.spend).toFixed(2) : "0.00";

                await sheet.addRow({
                    "Ngày": date,
                    "Tiền Tiêu": item.spend,
                    "Số Mess": item.messages,
                    "Giá Mess": pricePerMsg,
                    "Đơn POS": item.pos_orders,
                    "DT POS": item.pos_revenue,
                    "ROAS": `${roas}x`
                });
            }
            return true;
        } catch (err: any) {
            console.error("MKT Report Sync Error:", err.message);
            throw err;
        }
    }
}
