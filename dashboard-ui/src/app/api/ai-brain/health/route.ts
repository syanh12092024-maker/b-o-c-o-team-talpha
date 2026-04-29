import { NextResponse } from "next/server";
import os from "os";

const VPS_IP = process.env.VPS_IP || "";

async function checkService(name: string, port: number, path = "/", timeout = 3000): Promise<{ status: string; details?: string }> {
    for (const host of ["localhost", VPS_IP]) {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);
            const res = await fetch(`http://${host}:${port}${path}`, { signal: controller.signal });
            clearTimeout(id);
            return { status: res.ok ? "healthy" : "degraded", details: `${host}:${port} → ${res.status}` };
        } catch { /* try next host */ }
    }
    return { status: "down" };
}

async function checkTelegram(timeout = 3000): Promise<{ status: string; details?: string }> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return { status: "unconfigured", details: "No bot token" };
    try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: controller.signal });
        clearTimeout(id);
        const data = await res.json();
        return { status: data.ok ? "healthy" : "degraded", details: data.ok ? `@${data.result.username}` : "API error" };
    } catch { return { status: "down" }; }
}

export async function GET() {
    const [falkordb, graphiti, bizclaw, telegram] = await Promise.all([
        checkService("FalkorDB", 3001),
        checkService("Graphiti MCP", 8200, "/health"),
        checkService("BizClaw", 3579, "/"),
        checkTelegram(),
    ]);

    const services = [
        { name: "FalkorDB", status: falkordb.status, icon: "database", port: "3001/6379", description: "Graph database + browser UI", url: `http://${VPS_IP}:3001` },
        { name: "Graphiti MCP", status: graphiti.status, icon: "brain", port: "8200", description: "Temporal knowledge graph MCP server", url: "" },
        { name: "BizClaw AI", status: bizclaw.status, icon: "bot", port: "3579", description: "AI Agent platform — 15 providers, 9 channels", url: `http://${VPS_IP}:3579` },
        { name: "Telegram Bot", status: telegram.status, icon: "send", port: "—", description: telegram.details || "@FaosLvu_bot", url: "https://t.me/FaosLvu_bot" },
    ];

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const system = {
        hostname: os.hostname(),
        cpus: os.cpus().length,
        totalMemGB: (totalMem / 1073741824).toFixed(1),
        usedMemGB: (usedMem / 1073741824).toFixed(1),
        freeMemGB: (freeMem / 1073741824).toFixed(1),
        memUsagePercent: ((usedMem / totalMem) * 100).toFixed(0),
        uptimeHours: (os.uptime() / 3600).toFixed(1),
    };

    return NextResponse.json({ services, system });
}
