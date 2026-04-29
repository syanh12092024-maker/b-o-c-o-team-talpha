import { NextRequest, NextResponse } from "next/server";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

export async function POST(req: NextRequest) {
    const { message } = await req.json();

    if (!BOT_TOKEN || !CHAT_ID) {
        return NextResponse.json({ error: "Telegram not configured" }, { status: 500 });
    }

    try {
        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: message || "🌳 Test from FAOS Dashboard",
                parse_mode: "Markdown",
            }),
        });

        const data = await res.json();
        return NextResponse.json({ success: data.ok, data });
    } catch (error) {
        return NextResponse.json({ error: "Failed to send" }, { status: 500 });
    }
}

export async function GET() {
    if (!BOT_TOKEN) {
        return NextResponse.json({ configured: false });
    }

    try {
        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
        const data = await res.json();
        return NextResponse.json({ configured: true, bot: data.result });
    } catch {
        return NextResponse.json({ configured: false });
    }
}
