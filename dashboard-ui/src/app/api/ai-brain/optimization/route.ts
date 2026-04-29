import { NextResponse } from "next/server";
import { runQuery } from "@/lib/bigquery";
import { exec } from "child_process";
import fs from "fs";
import path from "path";

const SETTINGS_PATH = path.join(process.cwd(), "..", "settings.json");
const VPS_IP = process.env.VPS_IP || "";

// ─── Helpers ────────────────────────────────────────
function readThresholds(project: string) {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
            return data?.thresholds?.[project] || {};
        }
    } catch { /* default */ }
    return { target_roas: 2.5, max_cpl: 15, min_hook_rate: 0.25, max_frequency: 3.0, min_ctr: 0.01 };
}

function saveThresholds(project: string, thresholds: Record<string, number>) {
    let data: Record<string, any> = {};
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            data = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
        }
    } catch { /* start fresh */ }
    if (!data.thresholds) data.thresholds = {};
    data.thresholds[project] = { ...(data.thresholds[project] || {}), ...thresholds };
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), "utf-8");
}

// ─── GET: Sync stats + event log + thresholds ───────
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const project = searchParams.get("project") || "stramark";
    const dataset = project === "stramark" ? "STRAMARK_Dataset" : `${project.toUpperCase()}_Dataset`;

    try {
        // 1. Recent event log entries (last 50)
        const events = await runQuery(`
            SELECT campaign_id, metric_name, metric_value, snapshot_time,
                   sync_batch_id, sync_tier, slope_direction, project_id
            FROM \`levelup-465304.${dataset}.ads_metric_event_log\`
            WHERE snapshot_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
            ORDER BY snapshot_time DESC
            LIMIT 50
        `);

        // 2. Sync tier summary (last sync per tier)
        const syncStats = await runQuery(`
            SELECT sync_tier,
                   COUNT(DISTINCT ad_id) as ad_count,
                   MAX(sync_time) as last_sync,
                   ROUND(SUM(spend), 2) as total_spend
            FROM \`levelup-465304.${dataset}.fact_ads_optimization\`
            WHERE report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
            GROUP BY sync_tier
        `);

        // 3. Daily sync counts (last 7 days)
        const dailyCounts = await runQuery(`
            SELECT report_date, COUNT(*) as row_count, sync_tier
            FROM \`levelup-465304.${dataset}.fact_ads_optimization\`
            WHERE report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
            GROUP BY report_date, sync_tier
            ORDER BY report_date DESC
        `);

        // 4. Thresholds
        const thresholds = readThresholds(project);

        return NextResponse.json({
            events,
            syncStats,
            dailyCounts,
            thresholds,
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error("Optimization API error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// ─── POST: Trigger sync or update thresholds ────────
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { action, project = "stramark" } = body;

        if (action === "trigger_sync") {
            const tier = body.tier || "hot";
            // Run directly on VPS (no SSH needed — dashboard runs on VPS)
            const cmd = `cd /opt/faos && export GOOGLE_APPLICATION_CREDENTIALS=/opt/faos/bigquery_key.json && set -a && source .env && set +a && python3 -c "
import asyncio, sys
sys.path.insert(0,'/opt/faos')
from google.cloud import bigquery
from faos_brain.optimization.sync import SmartSync
bq = bigquery.Client(project='levelup-465304')
sync = SmartSync('${project}', bq_client=bq)
r = asyncio.run(sync.sync_${tier}())
print(str(r.rows_processed) + ' rows synced')
"`;
            return new Promise<Response>((resolve) => {
                exec(cmd, { timeout: 120000, shell: "/bin/bash" }, (error, stdout, stderr) => {
                    resolve(NextResponse.json({
                        success: !error,
                        output: stdout?.trim() || stderr?.trim() || error?.message || "",
                        tier,
                    }));
                });
            });
        }

        if (action === "trigger_analysis") {
            const cmd = `cd /opt/faos && set -a && source .env && set +a && export GOOGLE_APPLICATION_CREDENTIALS=/opt/faos/bigquery_key.json && python3 -m faos_brain.workflows.daily_analysis --project ${project} --dry-run 2>&1 | tail -20`;
            return new Promise<Response>((resolve) => {
                exec(cmd, { timeout: 300000, shell: "/bin/bash" }, (error, stdout, stderr) => {
                    resolve(NextResponse.json({
                        success: !error,
                        output: stdout?.trim() || stderr?.trim() || error?.message || "",
                    }));
                });
            });
        }

        if (action === "update_thresholds") {
            const { thresholds } = body;
            saveThresholds(project, thresholds);
            return NextResponse.json({ success: true, message: "Thresholds updated" });
        }

        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

