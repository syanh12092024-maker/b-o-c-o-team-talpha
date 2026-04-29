"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
    Zap, Mail, Lock, Eye, EyeOff, AlertCircle, Loader2,
    User, CheckCircle2, ArrowLeft, UserPlus, LogIn
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════
   Tab Đăng nhập
   ═══════════════════════════════════════════════════════════ */
function LoginForm({ onSwitch }: { onSwitch: () => void }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/";

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const result = await signIn("credentials", {
                email,
                password,
                redirect: false,
            });

            if (result?.error) {
                // Phân biệt lỗi pending vs sai credentials
                const err = result.error || "";
                if (err.includes("chờ duyệt") || err.includes("pending") || err.includes("403")) {
                    setError("Tài khoản đang chờ Admin duyệt. Vui lòng liên hệ Admin.");
                } else {
                    setError("Email hoặc mật khẩu không đúng");
                }
            } else {
                router.push(callbackUrl);
                router.refresh();
            }
        } catch {
            setError("Có lỗi xảy ra. Vui lòng thử lại.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-bold text-slate-800 dark:text-white">
                    Đăng nhập
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Nhập thông tin để truy cập dashboard
                </p>
            </div>

            {error && (
                <div className="flex items-start gap-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Email */}
                <div>
                    <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        Email
                    </label>
                    <div className="relative">
                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                            id="login-email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="email@example.com"
                            required
                            className="w-full rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] pl-10 pr-4 py-3 text-sm text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 dark:focus:border-indigo-500/50 transition-all"
                        />
                    </div>
                </div>

                {/* Password */}
                <div>
                    <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        Mật khẩu
                    </label>
                    <div className="relative">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                            id="login-password"
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            className="w-full rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] pl-10 pr-12 py-3 text-sm text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 dark:focus:border-indigo-500/50 transition-all"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                        >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                    </div>
                </div>

                {/* Submit */}
                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-xl bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-600 hover:from-indigo-600 hover:via-purple-600 hover:to-indigo-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {loading ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Đang đăng nhập...
                        </>
                    ) : (
                        <>
                            <LogIn className="h-4 w-4" />
                            Đăng nhập
                        </>
                    )}
                </button>
            </form>

            {/* Switch to Register */}
            <div className="text-center pt-2">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    Chưa có tài khoản?{" "}
                    <button
                        onClick={onSwitch}
                        className="font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                    >
                        Đăng ký ngay
                    </button>
                </p>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════
   Tab Đăng ký
   ═══════════════════════════════════════════════════════════ */
function RegisterForm({ onSwitch }: { onSwitch: () => void }) {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        // Validate
        if (password.length < 6) {
            setError("Mật khẩu phải có ít nhất 6 ký tự");
            return;
        }
        if (password !== confirmPassword) {
            setError("Mật khẩu xác nhận không khớp");
            return;
        }

        setLoading(true);
        try {
            const res = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, email, password }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || "Đăng ký thất bại");
            } else {
                setSuccess(true);
            }
        } catch {
            setError("Có lỗi xảy ra. Vui lòng thử lại.");
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="text-center py-6 space-y-4">
                <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-500/15 mx-auto">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white">
                        Đăng ký thành công!
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-xs mx-auto">
                        Tài khoản của bạn đang chờ Admin duyệt. Bạn sẽ nhận được thông báo khi tài khoản được kích hoạt.
                    </p>
                </div>
                <button
                    onClick={onSwitch}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors mt-2"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Quay lại đăng nhập
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-bold text-slate-800 dark:text-white">
                    Tạo tài khoản
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Đăng ký để truy cập dashboard FAOS
                </p>
            </div>

            {/* Thông báo chờ duyệt */}
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>Tài khoản mới cần được Admin duyệt trước khi sử dụng.</span>
            </div>

            {error && (
                <div className="flex items-start gap-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Họ tên */}
                <div>
                    <label htmlFor="reg-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        Họ và tên
                    </label>
                    <div className="relative">
                        <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                            id="reg-name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Nguyễn Văn A"
                            required
                            className="w-full rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] pl-10 pr-4 py-3 text-sm text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 dark:focus:border-indigo-500/50 transition-all"
                        />
                    </div>
                </div>

                {/* Email */}
                <div>
                    <label htmlFor="reg-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        Email
                    </label>
                    <div className="relative">
                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                            id="reg-email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="email@example.com"
                            required
                            className="w-full rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] pl-10 pr-4 py-3 text-sm text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 dark:focus:border-indigo-500/50 transition-all"
                        />
                    </div>
                </div>

                {/* Mật khẩu */}
                <div>
                    <label htmlFor="reg-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        Mật khẩu
                    </label>
                    <div className="relative">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                            id="reg-password"
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Ít nhất 6 ký tự"
                            required
                            minLength={6}
                            className="w-full rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] pl-10 pr-12 py-3 text-sm text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 dark:focus:border-indigo-500/50 transition-all"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                        >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                    </div>
                </div>

                {/* Xác nhận mật khẩu */}
                <div>
                    <label htmlFor="reg-confirm" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        Xác nhận mật khẩu
                    </label>
                    <div className="relative">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                            id="reg-confirm"
                            type={showPassword ? "text" : "password"}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Nhập lại mật khẩu"
                            required
                            className="w-full rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] pl-10 pr-4 py-3 text-sm text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 dark:focus:border-indigo-500/50 transition-all"
                        />
                    </div>
                </div>

                {/* Submit */}
                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-600 hover:via-teal-600 hover:to-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {loading ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Đang đăng ký...
                        </>
                    ) : (
                        <>
                            <UserPlus className="h-4 w-4" />
                            Đăng ký
                        </>
                    )}
                </button>
            </form>

            {/* Switch to Login */}
            <div className="text-center pt-2">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    Đã có tài khoản?{" "}
                    <button
                        onClick={onSwitch}
                        className="font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                    >
                        Đăng nhập
                    </button>
                </p>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════
   Main Login Page
   ═══════════════════════════════════════════════════════════ */
function AuthPage() {
    const [tab, setTab] = useState<"login" | "register">("login");

    return (
        <>
            {/* Logo */}
            <div className="text-center mb-8">
                <Link href="/" className="inline-block">
                    <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-indigo-600 shadow-xl shadow-indigo-500/25 mb-4 hover:scale-105 transition-transform">
                        <Zap className="h-8 w-8 text-white" />
                    </div>
                </Link>
                <h1 className="text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight">
                    FAOS
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Federated Agent Operating System
                </p>
            </div>

            {/* Tab Switcher */}
            <div className="flex rounded-xl bg-slate-100 dark:bg-white/[0.06] p-1 mb-6">
                <button
                    onClick={() => setTab("login")}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-all duration-200 ${
                        tab === "login"
                            ? "bg-white dark:bg-white/[0.1] text-slate-800 dark:text-white shadow-sm"
                            : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                    }`}
                >
                    <LogIn className="h-4 w-4" />
                    Đăng nhập
                </button>
                <button
                    onClick={() => setTab("register")}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-all duration-200 ${
                        tab === "register"
                            ? "bg-white dark:bg-white/[0.1] text-slate-800 dark:text-white shadow-sm"
                            : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                    }`}
                >
                    <UserPlus className="h-4 w-4" />
                    Đăng ký
                </button>
            </div>

            {/* Card */}
            <div className="bg-white/80 dark:bg-white/[0.04] backdrop-blur-xl rounded-2xl border border-slate-200/80 dark:border-white/[0.08] shadow-xl shadow-slate-200/50 dark:shadow-none p-8">
                {tab === "login" ? (
                    <LoginForm onSwitch={() => setTab("register")} />
                ) : (
                    <RegisterForm onSwitch={() => setTab("login")} />
                )}
            </div>

            {/* Footer */}
            <div className="text-center mt-6 space-y-2">
                <Link
                    href="/"
                    className="inline-flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400 transition-colors"
                >
                    <ArrowLeft className="h-3 w-3" />
                    Quay lại trang chủ
                </Link>
                <p className="text-xs text-slate-400 dark:text-slate-600">
                    FAOS Platform v5.0
                </p>
            </div>
        </>
    );
}

export default function LoginPage() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-gray-50 to-slate-100 dark:from-[#0B0F1A] dark:via-[#0E1225] dark:to-[#0B0F1A] relative overflow-hidden">
            {/* Background blurs */}
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-indigo-500/10 dark:bg-indigo-500/5 blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-purple-500/10 dark:bg-purple-500/5 blur-3xl" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-cyan-500/5 blur-3xl" />
            </div>

            {/* Auth Card */}
            <div className="relative w-full max-w-md mx-4">
                <Suspense fallback={
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                    </div>
                }>
                    <AuthPage />
                </Suspense>
            </div>
        </div>
    );
}
