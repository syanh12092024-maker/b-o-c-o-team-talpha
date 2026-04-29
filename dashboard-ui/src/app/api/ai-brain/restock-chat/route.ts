import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o";

const SYSTEM_PROMPT = `Bạn là AI chuyên gia quản lý tồn kho cho doanh nghiệp e-commerce COD tại EU (Romania).
Bạn đã đề xuất nhập hàng dựa trên dữ liệu kho hiện tại và đang trao đổi sâu hơn với người dùng (CEO/quản lý).

Người dùng gửi cho bạn dữ liệu tồn kho real-time (đã nhập kho + đang nhập + tốc độ bán + giá vốn + giá bán) và đề xuất AI lần trước.
Hãy trả lời câu hỏi của họ một cách cụ thể, dựa vào số liệu, đưa ra phân tích sâu và actionable.

Quy tắc:
- LUÔN tham chiếu số liệu cụ thể (vd "D04-NEGRU đang còn 12 đơn vị, bán 3.2/ngày")
- HÀNG SẮP VỀ (pending) phải được trừ khỏi nhu cầu khi tính số nhập: available = stock + pending
- Trả lời bằng tiếng Việt, ngắn gọn nhưng đủ ý, dùng bullet points/bảng khi cần
- Nếu user hỏi giả thuyết (vd "nếu tăng spend 30% thì sao?"), tính toán cụ thể
- Nếu thiếu dữ liệu → nói rõ thiếu gì, đừng bịa
- Không trả lời lan man về marketing/đối thủ trừ khi user hỏi
- Có thể đề xuất hành động cụ thể (cắt mã / tăng buffer / thanh lý / tăng giá)`;

interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}

export async function POST(req: Request) {
    try {
        const { messages, stockData, productContext, lastSuggestion } = await req.json();

        if (!Array.isArray(messages) || messages.length === 0) {
            return NextResponse.json({ error: "Thiếu messages" }, { status: 400 });
        }
        if (!Array.isArray(stockData)) {
            return NextResponse.json({ error: "Thiếu stockData" }, { status: 400 });
        }

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: "OPENAI_API_KEY chưa được cấu hình" }, { status: 500 });
        }

        // Compact stock payload (same shape as restock-suggest for consistency)
        const compactStock = stockData.map((it: any) => ({
            code: it.product_code,
            variant: it.variation_name || "default",
            stock: it.quantity_on_hand || 0,
            pending: it.pending_quantity || it.incoming_qty || 0,
            sold_7d: it.sold_7d || 0,
            pos_daily_avg: it.pos_selling_avg || 0,
            cost: it.avg_cost || 0,
            price: it.retail_price || 0,
        }));

        // Inject context as the FIRST user message so AI sees it before chat history
        const contextBlock =
            `📦 Tồn kho hiện tại (${compactStock.length} SKU):\n${JSON.stringify(compactStock, null, 0)}\n\n` +
            (productContext && Array.isArray(productContext)
                ? `📊 P&L sản phẩm:\n${JSON.stringify(productContext.map((p: any) => ({
                    code: p.product_code,
                    revenue: p.revenue,
                    margin: p.margin,
                    return_rate: p.return_rate,
                    orders: p.orders,
                })), null, 0)}\n\n`
                : "") +
            (lastSuggestion
                ? `🤖 Đề xuất AI lần trước:\n${JSON.stringify(lastSuggestion, null, 0)}\n\n`
                : "") +
            `📅 Hôm nay: ${new Date().toISOString().split("T")[0]}\n\nHãy giữ context này khi trả lời các câu hỏi tiếp theo.`;

        const apiMessages = [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: contextBlock },
            { role: "assistant", content: "Đã nhận dữ liệu tồn kho và đề xuất. Anh/chị muốn trao đổi gì?" },
            ...messages.slice(-20).map((m: ChatMessage) => ({ role: m.role, content: m.content })),
        ];

        const response = await fetch(OPENAI_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: MODEL,
                temperature: 0.4,
                max_tokens: 1500,
                messages: apiMessages,
            }),
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            const errMsg = errBody?.error?.message || `HTTP ${response.status}`;
            console.error("OpenAI chat error:", response.status, errMsg);
            return NextResponse.json({ error: `OpenAI: ${errMsg}` }, { status: 502 });
        }

        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content?.trim() || "";

        return NextResponse.json({
            reply,
            model: MODEL,
            tokens: data.usage?.total_tokens || 0,
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error("Restock chat error:", error);
        return NextResponse.json({ error: error.message || "Chat failed" }, { status: 500 });
    }
}
