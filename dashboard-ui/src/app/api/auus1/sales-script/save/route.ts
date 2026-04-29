import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export async function POST(req: Request) {
    try {
        const { script, productName } = await req.json();

        if (!script || !productName) {
            return NextResponse.json(
                { error: "Vui lòng cung cấp cả tên sản phẩm và kịch bản để lưu." },
                { status: 400 }
            );
        }

        // Standardize file name
        const cleanName = productName
            .replace(/[^a-zA-Z0-9\s]/g, "")
            .trim()
            .split(/\s+/)
            .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join("");
            
        const fileName = `Kich_Ban_${cleanName || "SanPhamMoi"}_Bilingual.md`;
        
        // Target path: ../docs/sales-scripts/
        const targetDir = path.join(process.cwd(), "..", "docs", "sales-scripts");
        
        // Ensure directory exists
        await fs.mkdir(targetDir, { recursive: true });
        
        const filePath = path.join(targetDir, fileName);
        
        // Write file
        await fs.writeFile(filePath, script, 'utf8');

        return NextResponse.json({ 
            success: true, 
            message: "Lưu thành công!",
            filePath: `docs/sales-scripts/${fileName}`
        });
    } catch (error: any) {
        console.error("Sales script save error:", error);
        return NextResponse.json({ error: error.message || "Failed to save script" }, { status: 500 });
    }
}
