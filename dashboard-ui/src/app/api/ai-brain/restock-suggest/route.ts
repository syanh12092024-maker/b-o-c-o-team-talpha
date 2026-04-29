import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o";

const SYSTEM_PROMPT = `Bạn là AI chuyên gia quản lý tồn kho cho doanh nghiệp e-commerce COD tại thị trường EU (Romania).
Nhiệm vụ: Phân tích dữ liệu tồn kho, tốc độ bán, xu hướng và đề xuất số lượng cần nhập cho từng SKU.

Bạn sẽ nhận dữ liệu JSON gồm:
- code: Mã sản phẩm
- variant: Phiên bản/SKU (size, màu, v.v.)
- stock: Tồn kho hiện tại (đã nhập kho)
- pending: Hàng có phiếu nhập từ POS nhưng CHƯA nhập kho thực tế (rất quan trọng!)
- sold_7d: Số lượng bán trong 7 ngày gần nhất (từ đơn hàng BigQuery)
- pos_daily_avg: Tốc độ bán trung bình/ngày từ POS (dữ liệu POS gốc, chính xác hơn)
- cost: Giá vốn trung bình (RON)
- price: Giá bán (RON)

Hãy phân tích và đưa ra đề xuất nhập hàng thông minh, CÓ XÉT đến:
1. Tốc độ bán thực tế (7 ngày) — xu hướng tăng/giảm
2. Biên lợi nhuận (retail_price vs avg_cost) — ưu tiên hàng margin cao
3. Mức rủi ro hết hàng — sản phẩm bán chạy cần buffer nhiều hơn
4. Capital efficiency — không nhập quá nhiều hàng bán chậm
5. Mùa vụ và bối cảnh EU e-commerce
6. **HÀNG SẮP VỀ (pending)**: phải trừ khỏi nhu cầu! Công thức bắt buộc:
   - available = stock + pending
   - need_15d = max(0, daily_avg × 15 − available)
   - need_30d = max(0, daily_avg × 30 − available)
   Nếu pending đã đủ cho nhu cầu 15-30 ngày → KHÔNG đề xuất nhập thêm (priority="none", restock=0).

Trả về ĐÚNG FORMAT JSON (không markdown, không code block):
{
  "suggestions": [
    {
      "product_code": "V09",
      "variation_name": "Size L",
      "current_stock": 10,
      "daily_avg": 2.5,
      "restock_15d": 28,
      "restock_30d": 65,
      "priority": "urgent|high|medium|low|none|cut",
      "reason": "Giải thích ngắn gọn lý do"
    }
  ],
  "cut_products": [
    {
      "product_code": "D02",
      "reason": "Giải thích lý do nên cắt mã",
      "remaining_stock": 50,
      "daily_avg": 0.3,
      "days_to_clear": 167,
      "recommendation": "Thanh lý / giảm giá / ngừng nhập"
    }
  ],
  "summary": "Tổng quan 2-3 câu về tình trạng kho và đề xuất chung",
  "insights": ["Nhận xét quan trọng 1", "Nhận xét 2", "Nhận xét 3"],
  "total_cost_15d": 1500,
  "total_cost_30d": 3200
}

Quy tắc:
- priority "urgent": hết hàng hoặc <= 3 ngày tồn kho
- priority "high": 3-7 ngày
- priority "medium": 7-14 ngày
- priority "low": > 14 ngày nhưng nên nhập
- priority "none": đủ hàng, không cần nhập thêm
- priority "cut": ĐỀ XUẤT CẮT MÃ — sản phẩm bán quá chậm, tồn kho đọng vốn, nên ngừng nhập
- restock_15d/restock_30d = SỐ LƯỢNG cần nhập thêm (không phải tổng nhu cầu). Nếu priority="cut" thì đặt = 0
- Nếu sản phẩm margin thấp (<20%) và bán chậm → giảm lượng nhập
- Nếu sản phẩm margin cao (>50%) và bán chạy → tăng buffer thêm 20%
- total_cost = sum(restock_qty × avg_cost) cho toàn bộ SKU

ĐỀ XUẤT CẮT MÃ (rất quan trọng!):
- Sản phẩm bán < 0.5 units/ngày (pos_daily_avg hoặc sold_7d/7) VÀ tồn kho đủ > 30 ngày → xem xét cắt
- Sản phẩm sold_7d = 0 và stock > 0 → đề xuất cắt mạnh
- Sản phẩm margin thấp (<15%) VÀ bán chậm → ưu tiên cắt
- Đặt priority = "cut" cho những SKU này, restock = 0
- Thêm vào mảng "cut_products" với lý do chi tiết và đề xuất xử lý (thanh lý/giảm giá/chuyển kho)
- Tính days_to_clear = stock hiện tại ÷ daily_avg (bao lâu mới bán hết tồn)

- Viết reason, summary, recommendation bằng tiếng Việt`;

export async function POST(req: Request) {
    try {
        const { stockData, productContext } = await req.json();

        if (!stockData || !Array.isArray(stockData) || stockData.length === 0) {
            return NextResponse.json(
                { error: "Không có dữ liệu tồn kho để phân tích" },
                { status: 400 }
            );
        }

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: "OPENAI_API_KEY chưa được cấu hình" },
                { status: 500 }
            );
        }

        // Build compact data payload (limit to essential fields to save tokens)
        const compactData = stockData.map((item: any) => ({
            code: item.product_code,
            variant: item.variation_name || "default",
            stock: item.quantity_on_hand || 0,
            pending: item.pending_quantity || item.incoming_qty || 0,  // Phiếu nhập POS chưa nhập kho
            sold_7d: item.sold_7d || 0,
            pos_daily_avg: item.pos_selling_avg || 0,  // Tốc độ bán TB từ POS
            cost: item.avg_cost || 0,
            price: item.retail_price || 0,
        }));

        // Add product-level P&L context if available
        let productSummary = "";
        if (productContext && Array.isArray(productContext)) {
            productSummary = "\n\nProduct P&L context (product level):\n" +
                JSON.stringify(productContext.map((p: any) => ({
                    code: p.product_code,
                    revenue: p.revenue,
                    margin: p.margin,
                    return_rate: p.return_rate,
                    orders: p.orders,
                })), null, 0);
        }

        const userMessage = `Dữ liệu tồn kho hiện tại (${compactData.length} SKU):\n` +
            JSON.stringify(compactData, null, 0) +
            productSummary +
            `\n\nNgày hôm nay: ${new Date().toISOString().split("T")[0]}` +
            `\nHãy phân tích và đề xuất số lượng nhập cho từng SKU.`;

        const response = await fetch(OPENAI_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: MODEL,
                temperature: 0.3,
                max_tokens: 3000,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: userMessage },
                ],
            }),
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            const errMsg = errBody?.error?.message || `HTTP ${response.status}`;
            console.error("OpenAI API error:", response.status, errMsg);
            return NextResponse.json(
                { error: `OpenAI: ${errMsg}` },
                { status: 502 }
            );
        }

        const data = await response.json();
        const rawContent = data.choices?.[0]?.message?.content?.trim() || "";

        // Parse JSON from response (strip markdown fences if present)
        let result;
        try {
            const cleaned = rawContent
                .replace(/^```[\w]*\n?/gm, "")
                .replace(/\n?```$/gm, "")
                .trim();
            result = JSON.parse(cleaned);
        } catch {
            // If JSON parse fails, return raw text as summary
            result = {
                suggestions: [],
                summary: rawContent,
                insights: [],
                total_cost_15d: 0,
                total_cost_30d: 0,
            };
        }

        return NextResponse.json({
            ...result,
            model: MODEL,
            timestamp: new Date().toISOString(),
            tokens: data.usage?.total_tokens || 0,
        });
    } catch (error: any) {
        console.error("Restock suggest error:", error);
        return NextResponse.json(
            { error: error.message || "AI analysis failed" },
            { status: 500 }
        );
    }
}
