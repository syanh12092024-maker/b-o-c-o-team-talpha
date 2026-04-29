import { NextResponse } from "next/server";
import { runQuery, bigquery } from "@/lib/bigquery";
import { exec } from "child_process";

const VPS_IP = process.env.VPS_IP || "";

// ─── GET: Pattern library ───────────────────────────
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const project = searchParams.get("project") || "stramark";
    const dataset = project === "stramark" ? "STRAMARK_Dataset" : `${project.toUpperCase()}_Dataset`;
    const statusFilter = searchParams.get("status"); // WIN, FAIL, LEARNING
    const typeFilter = searchParams.get("type"); // CT, HR, SAT, etc.

    try {
        let whereClause = `WHERE 1=1`;
        if (statusFilter) whereClause += ` AND pattern_status = '${statusFilter}'`;
        if (typeFilter) whereClause += ` AND pattern_type = '${typeFilter}'`;

        const patterns = await runQuery(`
            SELECT
                pattern_id,
                pattern_type,
                pattern_status,
                market,
                signal_name,
                signal_value,
                confidence_score,
                sample_size,
                first_seen,
                last_seen,
                observation_count,
                human_validated,
                human_override,
                recommendation,
                related_campaigns,
                created_at,
                updated_at
            FROM \`levelup-465304.${dataset}.ai_pattern_library\`
            ${whereClause}
            ORDER BY updated_at DESC
            LIMIT 100
        `);

        // Stats
        const stats = await runQuery(`
            SELECT
                COUNT(*) as total,
                COUNTIF(human_validated = TRUE) as validated,
                COUNTIF(pattern_status = 'WIN') as wins,
                COUNTIF(pattern_status = 'FAIL') as fails,
                COUNTIF(pattern_status = 'LEARNING') as learning,
                ROUND(AVG(confidence_score), 2) as avg_confidence
            FROM \`levelup-465304.${dataset}.ai_pattern_library\`
        `);

        // Distinct types and markets for filters
        const filters = await runQuery(`
            SELECT
                ARRAY_AGG(DISTINCT pattern_type) as types,
                ARRAY_AGG(DISTINCT market) as markets,
                ARRAY_AGG(DISTINCT pattern_status) as statuses
            FROM \`levelup-465304.${dataset}.ai_pattern_library\`
        `);

        return NextResponse.json({
            patterns,
            stats: stats[0] || {},
            filters: filters[0] || {},
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error("Patterns API error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// ─── POST: Approve/Reject pattern ───────────────────
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { action, patternId, project = "stramark" } = body;
        const dataset = project === "stramark" ? "STRAMARK_Dataset" : `${project.toUpperCase()}_Dataset`;

        if (action === "validate") {
            const { approved } = body; // true = approve, false = reject

            // 1. Update BQ
            await runQuery(`
                UPDATE \`levelup-465304.${dataset}.ai_pattern_library\`
                SET
                    human_validated = ${approved},
                    human_override = ${!approved ? "'REJECTED'" : "NULL"},
                    updated_at = CURRENT_TIMESTAMP()
                WHERE pattern_id = '${patternId}'
            `);

            // 2. Update FalkorDB node (runs directly on VPS — no SSH needed)
            const falkorCmd = `python3 -c "
import redis
r = redis.Redis(host='localhost', port=6379)
r.execute_command('GRAPH.QUERY', 'faos_ads',
    \\"MATCH (p:Pattern {id: '${patternId}'}) SET p.human_validated = ${approved}, p.updated_at = '${new Date().toISOString()}' RETURN p.id\\")
print('FalkorDB updated')
"`;
            exec(falkorCmd, { timeout: 10000, shell: "/bin/bash" }, (err, stdout) => {
                if (err) console.error("FalkorDB update error:", err.message);
                else console.log("FalkorDB:", stdout?.trim());
            });

            return NextResponse.json({
                success: true,
                message: `Pattern ${patternId} ${approved ? "approved" : "rejected"}`,
                bqUpdated: true,
                falkorDbTriggered: true,
            });
        }

        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
