import { NextResponse } from "next/server";
import { exec } from "child_process";

const VPS_IP = process.env.VPS_IP || "";
const VPS_USER = process.env.VPS_USER || "root";

function sshCmd(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(
            `ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new ${VPS_USER}@${VPS_IP} '${cmd}'`,
            { timeout: 15000 },
            (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve(stdout.trim());
            }
        );
    });
}

// ─── GET: AI Insights (M2 diagnostic JSON + M3 patterns JSON) ───
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const project = searchParams.get("project") || "stramark";

    try {
        // Fetch both M2 and M3 JSON files from VPS in parallel
        const [diagnosticRaw, patternsRaw] = await Promise.all([
            sshCmd(`cat /opt/faos/data/diagnostic/${project}_latest.json 2>/dev/null || echo '{"error":"not_found"}'`),
            sshCmd(`cat /opt/faos/data/patterns/${project}_latest.json 2>/dev/null || echo '[]'`),
        ]);

        const diagnostic = JSON.parse(diagnosticRaw);
        const patterns = JSON.parse(patternsRaw);

        if (diagnostic.error) {
            return NextResponse.json({
                diagnostic: null,
                patterns: [],
                message: "No AI diagnostic data yet. Run M2 daily diagnostic first.",
            });
        }

        return NextResponse.json({
            diagnostic,
            patterns,
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error("Insights API error:", error.message);
        return NextResponse.json(
            { error: error.message, diagnostic: null, patterns: [] },
            { status: 500 }
        );
    }
}
