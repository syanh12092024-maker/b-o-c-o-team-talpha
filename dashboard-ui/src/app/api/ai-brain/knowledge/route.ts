import { NextResponse } from "next/server";

// Knowledge Graph API — query REAL Graphiti MCP via Streamable HTTP
const GRAPHITI_URL = process.env.GRAPHITI_MCP_URL || "http://localhost:8200";

// Graphiti MCP uses Streamable HTTP protocol — needs session init first
async function graphitiCall(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;

    const res = await fetch(`${GRAPHITI_URL}/mcp`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }),
    });

    const text = await res.text();
    // Parse SSE response: "event: message\ndata: {...}"
    let parsed;
    if (text.includes("data:")) {
        const dataLine = text.split("\n").find(l => l.startsWith("data:"));
        parsed = dataLine ? JSON.parse(dataLine.replace("data: ", "").trim()) : JSON.parse(text);
    } else {
        parsed = JSON.parse(text);
    }

    // Extract session ID from response headers
    const sid = res.headers.get("mcp-session-id") || sessionId;
    return { data: parsed, sessionId: sid };
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") || "";

    try {
        // Step 1: Initialize MCP session
        const init = await graphitiCall("initialize", {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "faos-dashboard", version: "1.0" },
        });
        const sessionId = init.sessionId;

        if (!sessionId) throw new Error("No session ID from Graphiti");

        // Step 2: Get status
        const statusRes = await graphitiCall("tools/call", {
            name: "get_status", arguments: {},
        }, sessionId);

        // Step 3: Search nodes (if query provided) or get episodes
        let entities: { name: string; type: string; facts: number; summary?: string }[] = [];
        let totalFacts = 0;
        let totalEpisodes = 0;

        if (query) {
            const searchRes = await graphitiCall("tools/call", {
                name: "search_nodes", arguments: { query, max_nodes: 20 },
            }, sessionId);
            const result = searchRes.data?.result?.content?.[0]?.text;
            if (result) {
                const parsed = JSON.parse(result);
                if (parsed.result?.nodes) {
                    entities = parsed.result.nodes.map((n: any) => ({
                        name: n.name, type: (n.labels || [])[0] || "Entity",
                        facts: 0, summary: n.summary,
                    }));
                }
            }
        }

        // Step 4: Get recent episodes count
        const epRes = await graphitiCall("tools/call", {
            name: "get_episodes", arguments: { max_episodes: 100 },
        }, sessionId);
        const epText = epRes.data?.result?.content?.[0]?.text;
        if (epText) {
            const epParsed = JSON.parse(epText);
            totalEpisodes = epParsed.result?.episodes?.length || 0;
        }

        const statusText = statusRes.data?.result?.content?.[0]?.text;
        const graphitiStatus = statusText ? JSON.parse(statusText) : {};

        return NextResponse.json({
            success: true,
            graphitiConnected: true,
            serverStatus: graphitiStatus,
            data: {
                entities,
                totalEntities: entities.length,
                totalEpisodes,
                totalFacts,
            },
        });
    } catch (err: any) {
        console.error("Graphiti MCP error:", err.message);
        // Fallback to basic info
        return NextResponse.json({
            success: true,
            graphitiConnected: false,
            error: err.message,
            data: {
                entities: [],
                totalEntities: 0,
                totalEpisodes: 0,
                totalFacts: 0,
            },
        });
    }
}
