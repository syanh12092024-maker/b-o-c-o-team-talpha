import { NextResponse } from "next/server";
import { runQuery } from "@/lib/bigquery";

/* ─── Schema context for GPT-4o ─────────────────────── */
function getSchemaContext(project: string) {
    const dataset = project === "stramark" ? "STRAMARK_Dataset" : `${project.toUpperCase()}_Dataset`;
    const fullPrefix = `levelup-465304.${dataset}`;

    return `You are a BigQuery SQL assistant for FAOS e-commerce ads analytics.
Project: ${project} | Dataset: ${fullPrefix}

AVAILABLE TABLES:

1. \`${fullPrefix}.fact_ads_optimization\` — Primary ads performance (daily × ad_id)
   Columns: report_date DATE, ad_id STRING, ad_name STRING, adset_id STRING, adset_name STRING,
   campaign_id STRING, campaign_name STRING, account_id STRING,
   spend FLOAT64, impressions INT64, reach INT64, clicks INT64, leads INT64,
   ctr FLOAT64, cpm FLOAT64, cpc FLOAT64, frequency FLOAT64, cost_per_lead FLOAT64,
   video_views_p25 INT64, video_views_p50 INT64, video_views_p75 INT64, video_views_p100 INT64,
   hook_rate FLOAT64, hold_rate FLOAT64,
   real_orders INT64, confirmed_revenue FLOAT64, confirmed_roas FLOAT64, cpo FLOAT64,
   creative_type STRING (VIDEO/IMAGE/CAROUSEL), creative_url STRING, thumbnail_url STRING,
   campaign_status STRING, is_active BOOL, sync_tier STRING, marketer STRING, market STRING

2. \`${fullPrefix}.sale_order\` — All orders
   ⚠ NO "order_date" column — use inserted_at for date filtering
   ⚠ Primary key is "id", NOT "order_id"
   Columns: id STRING (primary key, order ID), shop_id STRING,
   status STRING (numeric status code), status_name STRING (canceled/confirmed/shipped/delivered/returned),
   total_price FLOAT, shipping_fee FLOAT, cod FLOAT, total_discount FLOAT,
   partner_fee FLOAT, return_fee FLOAT, surcharge FLOAT, money_to_collect FLOAT,
   total_quantity STRING, marketer STRING (⚠ JSON object string — must use JSON_EXTRACT_SCALAR),
   ad_id STRING, adset_id STRING, ads_source STRING, page_id STRING, post_id STRING,
   p_utm_source STRING, p_utm_campaign STRING, p_utm_medium STRING,
   customer_id STRING, customer_name STRING, bill_full_name STRING, bill_phone_number STRING,
   shipping_address STRING, shipping_province STRING, shipping_district STRING,
   partner STRING (carrier), warehouse_id STRING,
   inserted_at STRING (ISO-8601 datetime, e.g. "2026-03-08T10:30:00.123456" — THIS IS THE ORDER DATE),
   updated_at STRING, time_send_partner STRING, estimate_delivery_date STRING,
   tags STRING, status_category STRING, status_sub STRING

3. \`${fullPrefix}.mart_performance_master\` — Aggregated daily × marketer
   Columns: report_date DATE, marketer_name STRING,
   total_orders INT64, success_orders INT64, returned_orders INT64,
   delivered_revenue FLOAT64, cogs FLOAT64, fulfillment_cost FLOAT64, return_fulfillment_cost FLOAT64,
   ads_spend_ron FLOAT64, net_profit FLOAT64, roas_l3 FLOAT64

4. \`${fullPrefix}.vw_fact_daily_pnl_flex\` — P&L daily summary
   Columns: report_date DATE, total_orders, success_orders, returned_orders,
   revenue_confirmed FLOAT64, revenue_success FLOAT64,
   ads_spend_ron FLOAT64, cogs FLOAT64, shipping_cost FLOAT64, net_profit FLOAT64, roas_l3 FLOAT64

5. \`${fullPrefix}.ai_pattern_library\` — AI learned patterns
   Columns: pattern_id STRING, pattern_type STRING (CREATIVE/MARKETER/FATIGUE/FUNNEL),
   pattern_status STRING (WIN/FAIL/LEARNING), market, signal_name, signal_value FLOAT64,
   confidence_score FLOAT64, sample_size INT64, recommendation STRING,
   human_validated BOOL, first_seen DATE, last_seen DATE, observation_count INT64

6. \`${fullPrefix}.fb_ads_data\` — Raw FB ads data (daily × campaign)
   Columns: report_date DATE, campaign_id, campaign_name, adset_id, adset_name,
   spend FLOAT64, impressions INT64, clicks INT64, reach INT64

CRITICAL RULES:
1. sale_order has NO "order_date" column. For date filtering, use:
   WHERE TIMESTAMP(inserted_at) >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
2. sale_order primary key is "id", NEVER use "order_id" (it does not exist)
3. For marketer name in sale_order: JSON_EXTRACT_SCALAR(marketer, '$.name')
   For marketer in fact_ads_optimization: use marketer column directly (plain string)
4. When using SUM(x) as alias, NEVER use SUM(x) again in ORDER BY or HAVING.
   Use the alias instead: ORDER BY total_spend DESC (not ORDER BY SUM(spend) DESC)
5. Always use backticks for table references: \`project.dataset.table\`
6. Use IFNULL for nullable numeric columns
7. LIMIT results to 50 max
8. Only generate SELECT queries (no INSERT/UPDATE/DELETE)
9. Return ONLY the SQL query, no explanation

EXAMPLE QUERIES:
-- Marketer performance from sale_order:
SELECT DATE(TIMESTAMP(inserted_at)) as order_date, JSON_EXTRACT_SCALAR(marketer, '$.name') as marketer_name, COUNT(DISTINCT id) as total_orders, SUM(CASE WHEN status_name = 'delivered' THEN 1 ELSE 0 END) as success_orders FROM \`${fullPrefix}.sale_order\` WHERE TIMESTAMP(inserted_at) >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY) GROUP BY order_date, marketer_name ORDER BY total_orders DESC LIMIT 50

-- Campaign ads performance:
SELECT campaign_name, ROUND(SUM(spend),2) as total_spend, SUM(impressions) as total_imp, SUM(clicks) as total_clicks, SUM(IFNULL(real_orders,0)) as total_orders, ROUND(SUM(IFNULL(confirmed_revenue,0)),2) as total_rev FROM \`${fullPrefix}.fact_ads_optimization\` WHERE report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND spend > 0 GROUP BY campaign_name ORDER BY total_spend DESC LIMIT 20`;
}

/* ─── POST: Ask AI ──────────────────────────────────── */
export async function POST(req: Request) {
    try {
        const { question, project = "stramark" } = await req.json();

        if (!question || typeof question !== "string" || question.trim().length < 3) {
            return NextResponse.json({ error: "Câu hỏi quá ngắn" }, { status: 400 });
        }

        // Read at runtime, NOT module level (Next.js standalone bakes top-level reads at build time)
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
        }

        const schemaCtx = getSchemaContext(project);

        // Step 1: GPT-4o generates SQL
        const sqlRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: "gpt-4o",
                temperature: 0,
                max_tokens: 1000,
                messages: [
                    { role: "system", content: schemaCtx },
                    { role: "user", content: question },
                ],
            }),
        });
        const sqlData = await sqlRes.json();
        let sql = sqlData.choices?.[0]?.message?.content?.trim() || "";

        // Clean SQL (remove markdown fences)
        sql = sql.replace(/^```[\w]*\n?/gm, "").replace(/\n?```$/gm, "").trim();

        // Validate: only SELECT
        if (!sql.toUpperCase().startsWith("SELECT")) {
            return NextResponse.json({ error: "AI chỉ được phép chạy SELECT queries", sql }, { status: 400 });
        }

        // Step 2: Execute SQL on BigQuery
        let rows: any[];
        try {
            rows = await runQuery(sql) as any[];
        } catch (bqErr: any) {
            // If SQL fails, return error with the generated SQL for debugging
            return NextResponse.json({
                error: `BQ Error: ${bqErr.message}`,
                sql,
                answer: null,
            }, { status: 400 });
        }

        // Step 3: GPT-4o summarizes the result in Vietnamese
        const resultPreview = JSON.stringify(rows.slice(0, 20), null, 2);
        const summaryRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: "gpt-4o",
                temperature: 0.3,
                max_tokens: 800,
                messages: [
                    {
                        role: "system",
                        content: `Bạn là AI marketing analyst cho dự án ${project} e-commerce COD.
Hãy phân tích dữ liệu trả về và đưa ra nhận xét bằng tiếng Việt, ngắn gọn, súc tích.
Dùng emoji và bullet points. Highlight số liệu quan trọng bằng **bold**.
Nếu có insights hay recommendations, hãy đề xuất.
Tối đa 300 từ.`,
                    },
                    {
                        role: "user",
                        content: `Câu hỏi: "${question}"\n\nKết quả query (${rows.length} rows):\n${resultPreview}`,
                    },
                ],
            }),
        });
        const summaryData = await summaryRes.json();
        const answer = summaryData.choices?.[0]?.message?.content?.trim() || "Không thể tóm tắt.";

        return NextResponse.json({
            answer,
            sql,
            rowCount: rows.length,
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error("Copilot error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
