import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Middleware: chặn guest truy cập project dashboards.
 * - Trang chủ `/` và `/login` → public
 * - API routes → public (auth check bên trong API)
 * - Project routes (`/stramark`, `/auus1`, ...) → cần login
 */

// Routes cần login để truy cập
const PROTECTED_PREFIXES = [
    "/stramark",
    "/auus1",
    "/talpha",
    "/t1",
    "/zen8",
    "/trendify",
    "/hnle",
    "/admin",
    "/agent-control",
];

export default auth((req) => {
    const { pathname } = req.nextUrl;

    // Kiểm tra có phải route cần bảo vệ không
    const isProtected = PROTECTED_PREFIXES.some((prefix) =>
        pathname.startsWith(prefix)
    );

    if (!isProtected) return NextResponse.next();

    // Chưa login → redirect về /login
    if (!req.auth) {
        const loginUrl = new URL("/login", req.url);
        loginUrl.searchParams.set("callbackUrl", pathname);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
});

export const config = {
    // Chỉ chạy middleware cho page routes, bỏ qua static files và API
    matcher: [
        "/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$|.*\\.png$|.*\\.jpg$).*)",
    ],
};
