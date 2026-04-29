import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
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
