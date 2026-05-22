import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
    // 'standalone' only for VPS/Docker. Vercel manages its own output.
    ...(process.env.VERCEL ? {} : { output: 'standalone' }),
    turbopack: {},
    // Fix "multiple lockfiles" warning — tell Next.js the workspace root is dashboard-ui/
    outputFileTracingRoot: __dirname,
    webpack: (config) => {
        config.resolve = {
            ...config.resolve,
            symlinks: false,
        };
        return config;
    },
    reactStrictMode: false,
};

export default nextConfig;
