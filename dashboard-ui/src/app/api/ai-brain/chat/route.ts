import { NextResponse } from "next/server";
import https from "https";

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const MODEL = "gpt-4o-mini";

function callOpenAI(message: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            model: MODEL,
            messages: [
                { role: "system", content: "Bạn là FAOS Assistant, trợ lý AI cho doanh nghiệp. Trả lời bằng tiếng Việt, ngắn gọn và chuyên nghiệp." },
                { role: "user", content: message }
            ],
            max_tokens: 512,
            temperature: 0.7,
        });
        const req = https.request({
            hostname: "api.openai.com",
            path: "/v1/chat/completions",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_KEY}`,
                "Content-Length": Buffer.byteLength(payload),
            },
            timeout: 20000,
        }, (res) => {
            let data = "";
            res.on("data", (c: Buffer) => data += c.toString());
            res.on("end", () => {
                try {
                    const j = JSON.parse(data);
                    if (j.error) { resolve("API error: " + j.error.message); return; }
                    resolve(j?.choices?.[0]?.message?.content || "Không có phản hồi.");
                } catch { resolve("Parse error: " + data.substring(0, 200)); }
            });
        });
        req.on("error", (e: Error) => reject(e));
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
        req.write(payload);
        req.end();
    });
}

export async function POST(request: Request) {
    try {
        const { message } = await request.json();
        if (!message?.trim()) return NextResponse.json({ error: "Message required" }, { status: 400 });
        const reply = await callOpenAI(message);
        return NextResponse.json({ reply, provider: "openai", model: MODEL });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ reply: "Lỗi: " + msg, provider: "error" });
    }
}
