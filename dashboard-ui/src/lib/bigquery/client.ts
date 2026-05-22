import { BigQuery } from "@google-cloud/bigquery";
import path from "path";
import fs from "fs";

// ═══ Vercel: read credentials from env var (JSON string) ═══
// ═══ Local/VPS: fallback to file on disk ═══
const credentials = (() => {
    if (process.env.BIGQUERY_CREDENTIALS) {
        try {
            return JSON.parse(process.env.BIGQUERY_CREDENTIALS);
        } catch (e) {
            console.error("[BQ] Failed to parse BIGQUERY_CREDENTIALS env var:", e);
        }
    }
    return null;
})();

const keyFilename = (() => {
    if (credentials) return undefined; // Not needed when using env var
    const fromCwd = path.resolve(process.cwd(), "config/bigquery-key.json");
    if (fs.existsSync(fromCwd)) return fromCwd;
    return path.resolve(process.cwd(), "..", "config/bigquery-key.json");
})();

const projectId = "levelup-465304";

export const bigquery = new BigQuery({
    projectId,
    ...(credentials ? { credentials } : { keyFilename }),
});

export const BQ_DATASET = "TALPHA_Dataset";

export async function runQuery(query: string, params?: Record<string, any>) {
    try {
        const [rows] = await bigquery.query({ query, params });
        return rows;
    } catch (error) {
        console.error("BigQuery Error:", error);
        throw error;
    }
}
