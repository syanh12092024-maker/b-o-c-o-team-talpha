import { BigQuery } from "@google-cloud/bigquery";
import path from "path";
import fs from "fs";

// Support both: cwd=dashboard-ui (local dev) and cwd=project-root (server/PM2)
const keyFilename = (() => {
    const fromCwd = path.resolve(process.cwd(), "config/bigquery-key.json");
    if (fs.existsSync(fromCwd)) return fromCwd;
    return path.resolve(process.cwd(), "..", "config/bigquery-key.json");
})();
const projectId = "levelup-465304";

export const bigquery = new BigQuery({
    projectId,
    keyFilename,
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
