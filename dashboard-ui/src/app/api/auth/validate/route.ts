import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

// ─── Types ───
interface UserRecord {
    id: string;
    email: string;
    name: string;
    password: string;
    role: "admin" | "project_lead" | "viewer";
    projects: string[];
    status?: "active" | "pending";
}

// ─── Validate credentials (called from NextAuth authorize callback) ───
export async function POST(req: Request) {
    try {
        const { email, password } = await req.json();

        if (!email || !password) {
            return NextResponse.json(null, { status: 400 });
        }

        // Load users from config file (Node.js runtime)
        const usersPath = path.join(
            process.cwd(),
            "..",
            "config",
            "users.json"
        );

        let users: UserRecord[] = [];
        try {
            const data = fs.readFileSync(usersPath, "utf-8");
            users = JSON.parse(data);
        } catch {
            console.error("Failed to load users.json from:", usersPath);
            return NextResponse.json(null, { status: 500 });
        }

        const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
        if (!user) {
            return NextResponse.json(null, { status: 401 });
        }

        // Kiểm tra tài khoản đang chờ duyệt
        if (user.status === "pending") {
            return NextResponse.json(
                { error: "Tài khoản đang chờ duyệt" },
                { status: 403 }
            );
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return NextResponse.json(null, { status: 401 });
        }

        // Return user without password
        return NextResponse.json({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            projects: user.projects,
        });
    } catch {
        return NextResponse.json(null, { status: 500 });
    }
}
