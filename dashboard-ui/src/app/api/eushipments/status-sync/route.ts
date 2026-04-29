import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

/**
 * Auto Status Sync API
 * 
 * POST /api/eushipments/status-sync    → Trigger status sync (euShipments → POS Cake)
 * GET  /api/eushipments/status-sync     → Check sync log / last results
 */

export const dynamic = "force-dynamic";

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const BQ_KEY = path.join(PROJECT_ROOT, "bigquery_key_t1.json");

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const dryRun = body.dryRun || false;

        const cmd = `python3 sync/t1/auto_status_sync.py${dryRun ? " --dry-run" : ""}`;

        const { stdout, stderr } = await execAsync(cmd, {
            cwd: PROJECT_ROOT,
            env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: BQ_KEY },
            timeout: 180_000, // 3 min timeout
        });

        const output = stdout + stderr;

        // Parse results from output
        const updatedMatch = output.match(/Updated:\s*(\d+)/);
        const checkedMatch = output.match(/checked:\s*(\d+)/);
        const errorsMatch = output.match(/Errors:\s*(\d+)/);

        const updated = updatedMatch ? parseInt(updatedMatch[1]) : 0;
        const checked = checkedMatch ? parseInt(checkedMatch[1]) : 0;
        const errors = errorsMatch ? parseInt(errorsMatch[1]) : 0;

        // Extract update details
        const updates: any[] = [];
        const detailLines = output.split("\n").filter(l =>
            l.includes("→") && (l.includes("Đã nhận") || l.includes("Đã hoàn") ||
                l.includes("Đang hoàn") || l.includes("Đã gửi"))
        );
        for (const line of detailLines.slice(0, 20)) {
            updates.push(line.trim());
        }

        return NextResponse.json({
            success: true,
            dryRun,
            stats: { checked, updated, errors },
            updates,
            output: output.substring(output.lastIndexOf("SUMMARY"), output.length),
            timestamp: new Date().toISOString(),
        });

    } catch (error: any) {
        console.error("Status sync error:", error);

        // Still try to return useful info from stderr
        const output = error.stdout || error.stderr || error.message || "";

        return NextResponse.json(
            {
                success: false,
                error: error.message?.substring(0, 500),
                output: output.substring(0, 1000),
            },
            { status: 500 }
        );
    }
}

export async function GET() {
    try {
        // Return latest status from BigQuery
        const { BigQuery } = await import("@google-cloud/bigquery");
        const bq = new BigQuery({ keyFilename: BQ_KEY });

        const [rows] = await bq.query({
            query: `
                SELECT
                    pos_order_id,
                    tpl_order_id,
                    awb,
                    status,
                    recipient_name,
                    recipient_city,
                    cod_amount,
                    last_status_update,
                    error_message
                FROM \`levelup-465304.T1_Dataset.fulfillment_orders\`
                WHERE tpl_order_id IS NOT NULL
                ORDER BY COALESCE(last_status_update, created_at) DESC
                LIMIT 50
            `,
        });

        // Group by status
        const byStatus: Record<string, number> = {};
        for (const row of rows) {
            const s = row.status || "unknown";
            byStatus[s] = (byStatus[s] || 0) + 1;
        }

        return NextResponse.json({
            orders: rows,
            summary: byStatus,
            total: rows.length,
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        );
    }
}
