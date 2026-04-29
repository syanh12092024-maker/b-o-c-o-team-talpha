import { NextResponse } from "next/server";
import { runQuery, DATASET } from "@/lib/bigquery";

const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "levelup-465304";
const FQN = `${BQ_PROJECT}.${DATASET}`;

// Force dynamic to prevent caching of outdated data
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const from = searchParams.get("from") || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const to = searchParams.get("to") || new Date().toISOString().split('T')[0];

        // 1. Vitals (P&L & Ads)
        const vitalsQuery = `
            WITH pnl AS (
                SELECT 
                    SUM(net_revenue) as revenue,
                    SUM(net_profit) as profit,
                    SAFE_DIVIDE(SUM(net_profit), NULLIF(SUM(net_revenue), 0)) as margin
                FROM \`${FQN}.vw_fact_daily_pnl_v2\`
                WHERE date BETWEEN DATE('${from}') AND DATE('${to}')
            ),
            ads AS (
                SELECT 
                    SUM(ads_spend_usd) as spend,
                    AVG(real_roas) as roas
                FROM \`${FQN}.mart_performance_master\`
                WHERE report_date BETWEEN DATE('${from}') AND DATE('${to}')
            ),
            ops AS (
                SELECT
                    AVG(delivery_rate_pct) as delivery_rate
                FROM \`${FQN}.mart_performance_master\`
                WHERE report_date BETWEEN DATE('${from}') AND DATE('${to}')
            )
            SELECT * FROM pnl, ads, ops
        `;

        // 2. Marketer Leaderboard
        const leaderboardQuery = `
            SELECT 
                marketer_name,
                SUM(ads_spend_usd) as spend,
                SUM(net_profit) as profit,
                AVG(real_roas) as roas,
                AVG(delivery_rate_pct) as delivery_rate,
                CASE 
                    WHEN AVG(real_roas) < 2.0 THEN 'Loss'
                    WHEN AVG(real_roas) >= 3.0 THEN 'Scaling'
                    ELSE 'Stable'
                END as status
            FROM \`${FQN}.mart_performance_master\`
            WHERE report_date BETWEEN DATE('${from}') AND DATE('${to}')
            GROUP BY 1
            ORDER BY profit DESC
            LIMIT 10
        `;

        // 3. Inventory Health
        const inventoryQuery = `
            SELECT 
                product_code,
                product_name,
                SUM(units_sold) / 30.0 as ads_30d,
                100 as current_stock,
                SAFE_DIVIDE(100, NULLIF(SUM(units_sold) / 30.0, 0)) as days_of_cover
            FROM \`${FQN}.mart_product_insights\`
            WHERE report_date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AND CURRENT_DATE()
            GROUP BY 1, 2
            ORDER BY ads_30d DESC
            LIMIT 5
        `;

        // 4. Market Performance
        const marketQuery = `
            SELECT 
                market,
                SUM(total_orders) as orders,
                AVG(delivery_rate_pct) as delivery_rate,
                SUM(gross_profit) as profit
            FROM \`${FQN}.mart_market_intelligence\`
            WHERE report_date BETWEEN DATE('${from}') AND DATE('${to}')
            GROUP BY 1
            ORDER BY profit DESC
        `;

        const [vitals, leaderboard, inventory, market] = await Promise.all([
            runQuery(vitalsQuery),
            runQuery(leaderboardQuery),
            runQuery(inventoryQuery),
            runQuery(marketQuery)
        ]);

        return NextResponse.json({
            vitals: vitals[0] || {},
            leaderboard,
            inventory,
            market
        });

    } catch (error: any) {
        console.error("Executive Report API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

