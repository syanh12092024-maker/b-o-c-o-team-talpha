import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import path from "path";
import fs from "fs";
import { TAlphaAdsModel } from "../../bigquery/models/talpha-ads.model";

function loadCredentials() {
    if (process.env.GOOGLE_CREDENTIALS_BASE64)
        return JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, "base64").toString("utf-8"));
    if (process.env.GOOGLE_CREDENTIALS_JSON)
        return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    const keyPath = path.resolve(process.cwd(), "config/bigquery-key.json");
    if (fs.existsSync(keyPath))
        return JSON.parse(fs.readFileSync(keyPath, "utf-8"));
    throw new Error("No Google credentials found.");
}

const MKT_DISPLAY: Record<string, { num: number; name: string }> = {
    "C.THUY": { num: 1, name: "C.Thuý" },
    "N.THE":  { num: 2, name: "N.Thế" },
    "NHUNG":  { num: 3, name: "Nhung" },
    "LOC":    { num: 4, name: "Lộc" },
    "MANH":   { num: 5, name: "Mạnh" },
    "MAI":    { num: 6, name: "Mai" },
    "S.ANH":  { num: 7, name: "S.Anh" },
};

function normalizeMktKey(raw: string): string {
    return (raw || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toUpperCase().trim();
}

const HEADERS = ["Ngày", "Tiền Tiêu", "Số Mess", "Giá Mess", "Đơn POS", "DT POS", "ROAS"];

// ═══ Shared Drive API helpers ═══
async function driveCall(auth: JWT, endpoint: string, opts?: RequestInit) {
    const token = await auth.getAccessToken();
    if (!token.token) throw new Error("No access token");
    const res = await fetch(`https://www.googleapis.com/drive/v3${endpoint}`, {
        ...opts,
        headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json", ...(opts?.headers || {}) },
    });
    if (!res.ok) throw new Error(`Drive ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
}

async function findOrCreateFolder(auth: JWT, name: string, parentId: string): Promise<string> {
    const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
    const r = await driveCall(auth, `/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`);
    if (r.files?.length > 0) return r.files[0].id;
    const c = await driveCall(auth, "/files?supportsAllDrives=true", {
        method: "POST", body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
    });
    return c.id;
}

async function findOrCreateSheet(auth: JWT, name: string, parentId: string): Promise<string> {
    const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.spreadsheet' and '${parentId}' in parents and trashed=false`;
    const r = await driveCall(auth, `/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`);
    if (r.files?.length > 0) return r.files[0].id;
    const c = await driveCall(auth, "/files?supportsAllDrives=true", {
        method: "POST", body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.spreadsheet", parents: [parentId] }),
    });
    return c.id;
}

// ═══ Service ═══
export class MktReportService {
    private auth: JWT;
    private sheetId: string;

    constructor(sheetId: string) {
        const creds = loadCredentials();
        this.auth = new JWT({
            email: creds.client_email, key: creds.private_key,
            scopes: ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/spreadsheets"],
        });
        this.sheetId = sheetId;
    }

    async syncByMktStructure(date: string, ads: any[], orders: any[]) {
        const parentFolderId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;

        // Aggregate by MKT + Market
        const report = TAlphaAdsModel.aggregateByMktMarket(ads, orders);
        if (report.length === 0) return { synced: 0 };

        const byMkt = new Map<string, typeof report>();
        for (const item of report) {
            const key = normalizeMktKey(item.marketer);
            if (!byMkt.has(key)) byMkt.set(key, []);
            byMkt.get(key)!.push(item);
        }

        const monthNum = new Date(date).getMonth() + 1;
        const monthFolder = `Tháng ${monthNum}`;
        let syncCount = 0;
        const errors: string[] = [];

        // ═══ MODE: Shared Drive folders (if configured) ═══
        if (parentFolderId) {
            for (const [mktKey, items] of byMkt) {
                const display = MKT_DISPLAY[mktKey];
                const folderName = display ? `${display.num}. ${display.name}` : mktKey;
                try {
                    const mktId = await findOrCreateFolder(this.auth, folderName, parentFolderId);
                    const monthId = await findOrCreateFolder(this.auth, monthFolder, mktId);

                    for (const item of items) {
                        try {
                            const sid = await findOrCreateSheet(this.auth, item.market.toUpperCase(), monthId);
                            await this.upsertRow(sid, date, item);
                            syncCount++;
                        } catch (e: any) { errors.push(`${folderName}/${item.market}: ${e.message}`); }
                    }

                    // Summary sheet
                    try {
                        const totalSpend = items.reduce((s, i) => s + i.spend, 0);
                        const totalMessages = items.reduce((s, i) => s + i.messages, 0);
                        const totalOrders = items.reduce((s, i) => s + i.pos_orders, 0);
                        const totalRevenue = items.reduce((s, i) => s + i.pos_revenue, 0);
                        const summaryId = await findOrCreateSheet(this.auth, `TỔNG ADS THÁNG ${monthNum}`, monthId);
                        await this.upsertRow(summaryId, date, { spend: totalSpend, messages: totalMessages, pos_orders: totalOrders, pos_revenue: totalRevenue });
                        syncCount++;
                    } catch (e: any) { errors.push(`${folderName}/TỔNG: ${e.message}`); }
                } catch (e: any) { errors.push(`MKT ${mktKey}: ${e.message}`); }
            }
        }

        // ═══ ALWAYS: Also write tabs in main spreadsheet ═══
        try {
            const doc = new GoogleSpreadsheet(this.sheetId, this.auth);
            await doc.loadInfo();
            for (const [mktKey, items] of byMkt) {
                const display = MKT_DISPLAY[mktKey];
                const prefix = display ? `${display.num}. ${display.name}` : mktKey;
                for (const item of items) {
                    const tabName = `${prefix} - ${item.market.toUpperCase()}`;
                    await this.upsertTab(doc, tabName, date, item);
                }
                // Summary tab
                const totalSpend = items.reduce((s, i) => s + i.spend, 0);
                const totalMessages = items.reduce((s, i) => s + i.messages, 0);
                const totalOrders = items.reduce((s, i) => s + i.pos_orders, 0);
                const totalRevenue = items.reduce((s, i) => s + i.pos_revenue, 0);
                await this.upsertTab(doc, `${prefix} - TỔNG`, date, { spend: totalSpend, messages: totalMessages, pos_orders: totalOrders, pos_revenue: totalRevenue });
            }
        } catch (e: any) { errors.push(`Tabs: ${e.message}`); }

        console.log(`[MktReport] Synced ${syncCount} files, ${errors.length} errors`);
        if (errors.length > 0) console.log(`[MktReport] Errors:`, errors.slice(0, 5));
        return { synced: syncCount, errors };
    }

    private buildRowData(date: string, item: { spend: number; messages: number; pos_orders: number; pos_revenue: number }) {
        const pricePerMsg = item.messages > 0 ? Math.round(item.spend / item.messages) : 0;
        const roas = item.spend > 0 ? (item.pos_revenue / item.spend).toFixed(1) + "x" : "0x";
        return {
            "Ngày": date, "Tiền Tiêu": Math.round(item.spend),
            "Số Mess": item.messages, "Giá Mess": pricePerMsg,
            "Đơn POS": item.pos_orders, "DT POS": Math.round(item.pos_revenue), "ROAS": roas,
        };
    }

    private async upsertRow(spreadsheetId: string, date: string, item: { spend: number; messages: number; pos_orders: number; pos_revenue: number }) {
        const doc = new GoogleSpreadsheet(spreadsheetId, this.auth);
        await doc.loadInfo();
        let sheet = doc.sheetsByIndex[0];
        try { await sheet.loadHeaderRow(); } catch { await sheet.setHeaderRow(HEADERS); }
        const rowData = this.buildRowData(date, item);
        const rows = await sheet.getRows();
        const existing = rows.find(r => r.get("Ngày") === date);
        if (existing) { Object.entries(rowData).forEach(([k, v]) => existing.set(k, v)); await existing.save(); }
        else { await sheet.addRow(rowData); }
    }

    private async upsertTab(doc: GoogleSpreadsheet, tabName: string, date: string, item: { spend: number; messages: number; pos_orders: number; pos_revenue: number }) {
        let sheet = doc.sheetsByTitle[tabName];
        if (!sheet) sheet = await doc.addSheet({ title: tabName, headerValues: HEADERS });
        const rowData = this.buildRowData(date, item);
        const rows = await sheet.getRows();
        const existing = rows.find(r => r.get("Ngày") === date);
        if (existing) { Object.entries(rowData).forEach(([k, v]) => existing.set(k, v)); await existing.save(); }
        else { await sheet.addRow(rowData); }
    }
}
