import { NextRequest, NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";

const BQ_PROJECT = process.env.BQ_PROJECT_ID || "levelup-465304";
const BQ_DATASET = "AUUS1_Dataset";

/** Validate YYYY-MM-DD format to prevent SQL injection */
function isValidDate(d: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { since, until } = body;
        
        if (!since || !until) {
            return NextResponse.json({ error: "since and until dates required" }, { status: 400 });
        }

        if (!isValidDate(since) || !isValidDate(until)) {
            return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD" }, { status: 400 });
        }

        // Simple: group orders by ad_id directly from sale_order
        // No join with fb_ads_data needed - frontend has FB ad_ids already
        const query = `
        SELECT
            CAST(ad_id AS STRING) AS ad_id,
            COUNT(*) AS orders,
            ROUND(SUM(SAFE_CAST(cod AS FLOAT64)), 0) AS total_cod
        FROM \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\`
        WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at)) BETWEEN '${since}' AND '${until}'
          AND SAFE_CAST(cod AS FLOAT64) > 0
          AND ad_id IS NOT NULL
          AND TRIM(CAST(ad_id AS STRING)) != ''
        GROUP BY 1
        `;

        const [rows] = await bigquery.query({ query });
        return NextResponse.json({ posData: rows });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Internal error";
        console.error("[AUUS1 POS Proxy]", message);
        return NextResponse.json({ error: "Query failed" }, { status: 500 });
    }
}
