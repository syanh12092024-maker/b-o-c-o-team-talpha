import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

// Path to project root
const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const BQ_KEY = path.join(PROJECT_ROOT, "bigquery_key.json");

export const maxDuration = 120; // 2 minutes max
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    const startTime = Date.now();

    try {
        const pythonPath = path.join(PROJECT_ROOT, ".venv", "bin", "python");
        const scriptPath = path.join(PROJECT_ROOT, "scripts", "sync_auus1_orders.py");
        const cmd = `"${pythonPath}" "${scriptPath}" --orders`;
        
        const { stdout, stderr } = await execAsync(cmd, {
            cwd: PROJECT_ROOT,
            env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: BQ_KEY, PYTHONPATH: PROJECT_ROOT },
            timeout: 120_000, 
        });

        const output = stdout + stderr;
        console.log("[AUUS1 Sync POS]", output);

        const hasError = output.includes("Traceback") || output.includes("Error:") || output.includes("failed:");
        
        if (hasError) {
             return NextResponse.json(
                { status: "error", message: output.split("\n").filter(l => l.includes("Error") || l.includes("failed")).pop() || "Unknown error" },
                { status: 500 }
            );
        }

        return NextResponse.json({
            status: "success",
            message: "Đồng bộ POS thành công",
            duration: Date.now() - startTime,
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        console.error("Sync POS Execution Error:", msg);
        return NextResponse.json(
            { status: "error", message: "Đồng bộ POS thất bại" },
            { status: 500 }
        );
    }
}
