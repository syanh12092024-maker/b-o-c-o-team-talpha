import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { withUsersLock, type UserRecord } from "@/lib/users";

// Validate email format cơ bản
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
    try {
        const { name, email, password } = await req.json();

        // Validate đầu vào
        if (!name || !email || !password) {
            return NextResponse.json(
                { error: "Vui lòng điền đầy đủ thông tin" },
                { status: 400 }
            );
        }

        if (!EMAIL_REGEX.test(email)) {
            return NextResponse.json(
                { error: "Email không hợp lệ" },
                { status: 400 }
            );
        }

        if (password.length < 6) {
            return NextResponse.json(
                { error: "Mật khẩu phải có ít nhất 6 ký tự" },
                { status: 400 }
            );
        }

        // Hash password trước khi lock (tốn thời gian)
        const hashedPassword = await bcrypt.hash(password, 10);

        let newUser: Omit<UserRecord, "password"> | null = null;

        // Đọc-ghi với file lock — tránh race condition
        await withUsersLock((users) => {
            // Kiểm tra email đã tồn tại
            if (users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
                throw new Error("EMAIL_EXISTS");
            }

            // Tạo user mới
            const maxId = Math.max(...users.map((u) => parseInt(u.id, 10)), 0);
            const user: UserRecord = {
                id: String(maxId + 1),
                email: email.toLowerCase().trim(),
                name: name.trim(),
                password: hashedPassword,
                role: "viewer",
                projects: [],
                status: "pending",
            };

            newUser = { id: user.id, email: user.email, name: user.name, role: user.role, projects: user.projects, status: user.status };
            users.push(user);
            return users;
        });

        return NextResponse.json({
            message: "Đăng ký thành công! Tài khoản đang chờ Admin duyệt.",
            user: { id: newUser!.id, email: newUser!.email, name: newUser!.name },
        });
    } catch (err: any) {
        if (err?.message === "EMAIL_EXISTS") {
            return NextResponse.json(
                { error: "Email này đã được đăng ký" },
                { status: 409 }
            );
        }
        console.error("Register error:", err);
        return NextResponse.json(
            { error: "Có lỗi xảy ra, vui lòng thử lại" },
            { status: 500 }
        );
    }
}
