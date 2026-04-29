import { NextResponse } from "next/server";

const AGENTS = [
    {
        id: "guardian",
        name: "FAOS Guardian",
        nameVi: "Bảo vệ",
        description: "Health check hệ thống mỗi sáng 8:00 AM",
        schedule: "0 8 * * *",
        scheduleLabel: "Daily 8:00 AM",
        llm: "gemini",
        channels: ["discord", "telegram"],
        icon: "shield",
        color: "emerald",
    },
    {
        id: "watchdog",
        name: "FAOS Watchdog",
        nameVi: "Canh gác",
        description: "Theo dõi quảng cáo và phát hiện vấn đề 24/7",
        schedule: "*/30 * * * *",
        scheduleLabel: "Every 30 min",
        llm: "gpt-4o-mini",
        channels: ["discord"],
        icon: "eye",
        color: "amber",
    },
    {
        id: "briefer",
        name: "FAOS Briefer",
        nameVi: "Báo cáo",
        description: "Tổng hợp dữ liệu, tạo báo cáo executive",
        schedule: "0 9 * * 1",
        scheduleLabel: "Monday 9:00 AM",
        llm: "gemini",
        channels: ["discord", "telegram"],
        icon: "file-text",
        color: "blue",
    },
    {
        id: "collector",
        name: "FAOS Collector",
        nameVi: "Thu thập",
        description: "Tự động thu thập dữ liệu từ các nguồn",
        schedule: "0 6 * * *",
        scheduleLabel: "Daily 6:00 AM",
        llm: "gpt-4o-mini",
        channels: ["discord"],
        icon: "download",
        color: "violet",
    },
    {
        id: "researcher",
        name: "FAOS Researcher",
        nameVi: "Nghiên cứu",
        description: "Nghiên cứu thị trường, đối thủ, trends",
        schedule: "0 10 * * 3",
        scheduleLabel: "Wednesday 10:00 AM",
        llm: "gemini",
        channels: ["discord", "telegram"],
        icon: "search",
        color: "rose",
    },
];

export async function GET() {
    // Simulate agent status (in production, this would read from OpenFang API)
    const agents = AGENTS.map((agent) => ({
        ...agent,
        status: "idle" as "idle" | "running" | "error",
        lastRun: null as string | null,
        nextRun: getNextRun(agent.schedule),
    }));

    return NextResponse.json({ agents, timestamp: new Date().toISOString() });
}

function getNextRun(cron: string): string {
    // Simple cron parser for display
    const now = new Date();
    const parts = cron.split(" ");
    if (parts[0].startsWith("*/")) {
        const interval = parseInt(parts[0].slice(2));
        const next = new Date(now.getTime() + interval * 60000);
        return next.toISOString();
    }
    const hour = parseInt(parts[1]);
    const minute = parseInt(parts[0]);
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toISOString();
}
