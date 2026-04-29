import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { exec } from "child_process";

// ─── Types ───
interface SyncRecord {
    id: string;
    project: string;
    project_id: string;
    description: string;
    started_at: string;
    finished_at: string | null;
    status: "success" | "error" | "running";
    duration_seconds: number;
    error_message: string | null;
    details: Record<string, number>;
    trigger: "cron" | "manual";
}

interface SyncScript {
    id: string;
    name: string;
    file: string;
    description: string;
    schedule: string;
    tables: string[];
    status: "success" | "error" | "scheduled" | "running" | "unknown";
    lastRun: string | null;
    lastStatus: "success" | "error" | "unknown";
    nextRun: string;
    successRate: number;
    totalRuns: number;
    lastError: string | null;
}

// Sync script definitions
const SYNC_SCRIPTS = [
    {
        id: "stramark",
        name: "STRAMARK Sync",
        file: "sync/stramark_sync.py",
        description: "Aurelia Wear — Romania, Croatia, Italy",
        schedule: "Every 15 min (cron)",
        tables: ["sale_order", "order_items", "fb_ads_data", "fb_adset_data", "product_stock", "product_cogs"],
    },
    {
        id: "auus1",
        name: "AUUS1 Sync",
        file: "sync/auus1_sync.py",
        description: "AU / US Markets — e-commerce",
        schedule: "Every 15 min (cron)",
        tables: ["fb_ads_data", "fb_adset_data"],
    },
    {
        id: "talpha",
        name: "TALPHA Sync",
        file: "sync/talpha_sync.py",
        description: "Middle East — Saudi, UAE, Kuwait, Oman",
        schedule: "Every 15 min (cron)",
        tables: ["fb_ads_data", "fb_adset_data"],
    },
];

// Path to sync history file
const PROJECT_ROOT = join(process.cwd(), "..");
const HISTORY_FILE = join(PROJECT_ROOT, "logs", "sync_history.json");

function loadHistory(): SyncRecord[] {
    try {
        if (existsSync(HISTORY_FILE)) {
            const data = readFileSync(HISTORY_FILE, "utf-8");
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        }
    } catch (e) {
        console.error("Error reading sync history:", e);
    }
    return [];
}

export async function GET() {
    const history = loadHistory();

    // Build per-project stats
    const scripts: SyncScript[] = SYNC_SCRIPTS.map((s) => {
        const projectHistory = history
            .filter((h) => h.project_id === s.id)
            .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

        const lastRun = projectHistory[0] || null;
        const successRuns = projectHistory.filter((h) => h.status === "success").length;
        const totalRuns = projectHistory.length;

        return {
            ...s,
            status: lastRun?.status || "unknown",
            lastRun: lastRun?.started_at || null,
            lastStatus: (lastRun?.status as "success" | "error") || "unknown",
            nextRun: getNextRun(),
            successRate: totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 0,
            totalRuns,
            lastError: lastRun?.status === "error" ? lastRun.error_message : null,
        };
    });

    // Recent history (last 50)
    const recentHistory = history
        .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
        .slice(0, 50);

    // Overall stats
    const last24h = history.filter(
        (h) => new Date(h.started_at).getTime() > Date.now() - 24 * 60 * 60 * 1000
    );
    const stats = {
        totalSyncs: history.length,
        last24h: last24h.length,
        successRate: history.length > 0
            ? Math.round((history.filter((h) => h.status === "success").length / history.length) * 100)
            : 0,
        lastSync: recentHistory[0]?.started_at || null,
        lastSyncStatus: recentHistory[0]?.status || "unknown",
    };

    return NextResponse.json({
        scripts,
        history: recentHistory,
        stats,
        timestamp: new Date().toISOString(),
    });
}

function getNextRun(): string {
    // Next 15-minute interval
    const now = new Date();
    const minutes = now.getMinutes();
    const nextMinute = Math.ceil((minutes + 1) / 15) * 15;
    const next = new Date(now);
    next.setMinutes(nextMinute, 0, 0);
    if (next <= now) next.setMinutes(next.getMinutes() + 15);
    return next.toISOString();
}

// POST handler — trigger manual sync
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const project = body.project || null; // null = all projects

        const syncScript = join(PROJECT_ROOT, "sync", "sync_with_history.py");
        let cmd = `python3 "${syncScript}" --trigger manual --days ${body.days || 1}`;
        if (project) {
            cmd += ` --project ${project}`;
        }

        // Run async (don't wait for completion)
        exec(cmd, { cwd: PROJECT_ROOT, timeout: 660000 }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Sync error: ${error.message}`);
            }
            if (stdout) console.log(`Sync output: ${stdout.slice(-200)}`);
        });

        return NextResponse.json({
            success: true,
            message: `Sync triggered for ${project || "all projects"}`,
            command: cmd,
        });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}
