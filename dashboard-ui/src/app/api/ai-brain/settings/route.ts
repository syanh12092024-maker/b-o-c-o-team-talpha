import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Settings are stored in two places:
// 1. /opt/faos/.env — API keys, tokens (sensitive)
// 2. /opt/faos/settings.json — feature toggles, UI preferences

const ENV_PATH = process.env.ENV_FILE_PATH || path.join(process.cwd(), "..", ".env");
const SETTINGS_PATH = process.env.SETTINGS_FILE_PATH || path.join(process.cwd(), "..", "settings.json");

// Which env keys are allowed to be read/written via API
const ALLOWED_KEYS: Record<string, { label: string; category: string; masked?: boolean }> = {
    // LLM
    GEMINI_API_KEY: { label: "Gemini API Key", category: "llm", masked: true },
    OPENAI_API_KEY: { label: "OpenAI API Key", category: "llm", masked: true },
    LLM_DEFAULT_PROVIDER: { label: "Default LLM Provider", category: "llm" },
    LLM_DEFAULT_MODEL: { label: "Default LLM Model", category: "llm" },
    LLM_TEMPERATURE: { label: "Temperature", category: "llm" },
    // Channels
    TELEGRAM_BOT_TOKEN: { label: "Telegram Bot Token", category: "channels", masked: true },
    TELEGRAM_CHAT_ID: { label: "Telegram Chat ID", category: "channels" },
    DISCORD_WEBHOOK_REPORT: { label: "Discord Webhook (Report)", category: "channels", masked: true },
    DISCORD_WEBHOOK_ALERT: { label: "Discord Webhook (Alert)", category: "channels", masked: true },
    // Data
    BQ_PROJECT_ID: { label: "BigQuery Project ID", category: "data" },
    BQ_DATASET: { label: "BigQuery Dataset", category: "data" },
    BQ_LOCATION: { label: "BigQuery Location", category: "data" },
    POSCAKE_API_KEY: { label: "Poscake API Key", category: "data", masked: true },
    POSCAKE_SHOP_ID: { label: "Poscake Shop ID", category: "data" },
    META_ACCESS_TOKEN: { label: "Meta Ads Token", category: "data", masked: true },
    META_AD_ACCOUNT_IDS: { label: "Meta Ad Account IDs", category: "data" },
    // Services
    GRAPHITI_MCP_URL: { label: "Graphiti MCP URL", category: "services" },
    VPS_IP: { label: "VPS IP Address", category: "services" },
    BIZCLAW_URL: { label: "BizClaw Gateway URL", category: "services" },
};

function parseEnv(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
            const key = trimmed.substring(0, eqIdx).trim();
            const val = trimmed.substring(eqIdx + 1).trim();
            result[key] = val;
        }
    }
    return result;
}

function maskValue(value: string): string {
    if (value.length <= 8) return "••••••••";
    return value.substring(0, 6) + "••••" + value.substring(value.length - 4);
}

function readSettings(): Record<string, unknown> {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
        }
    } catch { /* default */ }
    return {
        features: {
            syncStramark: true,
            syncAuus1: true,
            syncTalpha: true,
            autoRefresh: true,
            costTracking: true,
            knowledgeGraph: true,
            telegramBot: true,
            bizclawAgents: false,
        },
        ui: {
            refreshInterval: 30,
            timezone: "Asia/Ho_Chi_Minh",
            logLevel: "INFO",
        },
    };
}

export async function GET() {
    try {
        // Read .env
        let envVars: Record<string, string> = {};
        if (fs.existsSync(ENV_PATH)) {
            envVars = parseEnv(fs.readFileSync(ENV_PATH, "utf-8"));
        }

        // Build response with masking
        const keys: Record<string, { label: string; category: string; value: string; hasValue: boolean }> = {};
        for (const [key, meta] of Object.entries(ALLOWED_KEYS)) {
            const rawValue = envVars[key] || process.env[key] || "";
            keys[key] = {
                label: meta.label,
                category: meta.category,
                value: meta.masked && rawValue ? maskValue(rawValue) : rawValue,
                hasValue: !!rawValue,
            };
        }

        const settings = readSettings();

        return NextResponse.json({ success: true, keys, settings });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { action } = body;

        if (action === "updateKey") {
            // Update a single env key
            const { key, value } = body;
            if (!ALLOWED_KEYS[key]) {
                return NextResponse.json({ success: false, error: "Key not allowed" }, { status: 400 });
            }
            if (!value || typeof value !== "string") {
                return NextResponse.json({ success: false, error: "Invalid value" }, { status: 400 });
            }

            // Read, update, write .env
            let content = "";
            if (fs.existsSync(ENV_PATH)) {
                content = fs.readFileSync(ENV_PATH, "utf-8");
            }

            const lines = content.split("\n");
            let found = false;
            const newLines = lines.map(line => {
                const trimmed = line.trim();
                if (trimmed.startsWith(key + "=")) {
                    found = true;
                    return `${key}=${value}`;
                }
                return line;
            });
            if (!found) newLines.push(`${key}=${value}`);

            fs.writeFileSync(ENV_PATH, newLines.join("\n"), "utf-8");
            // Also set in process.env for immediate effect
            process.env[key] = value;

            return NextResponse.json({ success: true, message: `${key} updated` });
        }

        if (action === "updateSettings") {
            // Update feature toggles / UI settings
            const { settings } = body;
            const current = readSettings();
            const merged = { ...current, ...settings };
            if (settings.features) merged.features = { ...(current as any).features, ...settings.features };
            if (settings.ui) merged.ui = { ...(current as any).ui, ...settings.ui };

            fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2), "utf-8");
            return NextResponse.json({ success: true, message: "Settings saved" });
        }

        return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
