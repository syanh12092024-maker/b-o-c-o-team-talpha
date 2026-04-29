import { BigQuery } from "@google-cloud/bigquery";
import path from "path";

// Initialize BigQuery client
// Assumes credentials are in project root (../bigquery_key.json relative to dashboard-ui/)
const keyFilename = path.join(process.cwd(), "../bigquery_key.json");
const projectId = process.env.NEXT_PUBLIC_BQ_PROJECT || "levelup-465304";

export const bigquery = new BigQuery({
    projectId,
    keyFilename,
});

export const DATASET = process.env.DATASET || "STRAMARK_Dataset";

export async function runQuery(query: string, params?: any[]) {
    try {
        const options = {
            query,
            params,
        };
        const [rows] = await bigquery.query(options);
        return rows;
    } catch (error: any) {
        console.error("BigQuery Error:", error?.message || error);
        console.error("SQL (first 300 chars):", query.substring(0, 300));
        throw new Error("Failed to execute query");
    }
}
