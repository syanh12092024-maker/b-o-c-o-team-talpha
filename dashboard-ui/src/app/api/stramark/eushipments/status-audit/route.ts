import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";

/**
 * Stramark — Status Audit Proposals API
 *
 * GET  /api/stramark/eushipments/status-audit
 *   → Returns pending proposals + stats
 *
 * POST /api/stramark/eushipments/status-audit
 *   body: { action: "approve" | "reject" | "trigger-audit", proposalIds?: string[] }
 */

export const dynamic = "force-dynamic";

const POS_API_BASE = process.env.POSCAKE_API_URL || "https://pos.pages.fm/api/v1";
const POS_API_KEY = process.env.POSCAKE_API_KEY || "";
const POS_SHOP_ID = process.env.POSCAKE_SHOP_ID || "1635307570";

const PROPOSALS_PATH = join(process.cwd(), "..", "data", "stramark", "status_audit_proposals.json");

// ── Status Hierarchy (must match Python) ──

const STATUS_LEVEL: Record<string, number> = {
    new: 0, submitted: 1, confirmed: 1, waitting: 2,
    packing: 3, pending: 3, ordered: 4,
    shipped: 5,
    delivered: 6, received_money: 7,
    returning: 6, returned: 7,
    canceled: -1,
};

const DELIVER_BRANCH = new Set(["shipped", "delivered", "received_money"]);
const RETURN_BRANCH = new Set(["shipped", "returning", "returned"]);

function isValidTransition(current: string, proposed: string): boolean {
    const cur = current.toLowerCase().trim();
    const prop = proposed.toLowerCase().trim();
    const curLevel = STATUS_LEVEL[cur];
    const propLevel = STATUS_LEVEL[prop];

    if (curLevel === undefined || propLevel === undefined) return false;
    if (propLevel <= curLevel) return false;

    // Prevent cross-branch — "shipped" is neutral, can go to either branch
    if (cur !== "shipped") {
        if (RETURN_BRANCH.has(cur) && DELIVER_BRANCH.has(prop)) return false;
        if (DELIVER_BRANCH.has(cur) && RETURN_BRANCH.has(prop)) return false;
    }

    return true;
}

// ── Proposals file I/O ──

interface Proposal {
    id: string;
    posOrderId: string;
    currentPosStatus: string;
    euLastStatus: string;
    euLastDate: string;
    proposedPosStatus: string;
    label: string;
    awb: string;
    createdAt: string;
    status: "pending" | "approved" | "rejected" | "stale" | "error";
    reviewedBy: string | null;
    reviewedAt: string | null;
    executeResult: string | null;
}

interface ProposalsFile {
    lastAuditAt: string | null;
    lastAuditStats: Record<string, number>;
    proposals: Proposal[];
}

function loadProposals(): ProposalsFile {
    try {
        const raw = readFileSync(PROPOSALS_PATH, "utf-8");
        return JSON.parse(raw);
    } catch {
        return { lastAuditAt: null, lastAuditStats: {}, proposals: [] };
    }
}

function saveProposals(data: ProposalsFile): void {
    try {
        mkdirSync(join(process.cwd(), "..", "data", "stramark"), { recursive: true });
        writeFileSync(PROPOSALS_PATH, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
        console.error("Failed to save proposals:", e);
    }
}

// ── POS API helpers ──

async function fetchPosOrderStatus(orderId: string): Promise<string | null> {
    try {
        const resp = await fetch(
            `${POS_API_BASE}/shops/${POS_SHOP_ID}/orders/${orderId}?api_key=${POS_API_KEY}`,
            { signal: AbortSignal.timeout(15000) }
        );
        if (!resp.ok) return null;
        const data = await resp.json();
        const order = data.data || data;
        // Read status_name (actual string status), not status (numeric, stale)
        return (order.status_name || "").toLowerCase().trim() || null;
    } catch {
        return null;
    }
}

// Stramark POS uses custom numeric→status_name mapping:
// 0=new, 1=submitted, 2=shipped, 3=delivered, 4=returning, 5=returned, 6=canceled, 9=pending
const POS_STATUS_NUMERIC: Record<string, number> = {
    shipped: 2,
    delivered: 3,
    returning: 4,
    returned: 5,
    canceled: 6,
};

async function updatePosStatus(orderId: string, newStatus: string): Promise<boolean> {
    const numericStatus = POS_STATUS_NUMERIC[newStatus.toLowerCase()];
    if (numericStatus === undefined) {
        console.error(`No numeric POS code for status "${newStatus}"`);
        return false;
    }
    try {
        const resp = await fetch(
            `${POS_API_BASE}/shops/${POS_SHOP_ID}/orders/${orderId}?api_key=${POS_API_KEY}`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: numericStatus }),
                signal: AbortSignal.timeout(10000),
            }
        );
        return resp.ok;
    } catch {
        return false;
    }
}

// ── GET: Return proposals ──

export async function GET() {
    const data = loadProposals();
    const pending = data.proposals.filter(p => p.status === "pending");

    return NextResponse.json({
        lastAuditAt: data.lastAuditAt,
        lastAuditStats: data.lastAuditStats,
        pendingCount: pending.length,
        proposals: data.proposals,
    });
}

// ── POST: approve / reject / trigger-audit ──

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const { action, proposalIds } = body as {
        action?: string;
        proposalIds?: string[];
    };

    if (!action) {
        return NextResponse.json({ error: "Missing action" }, { status: 400 });
    }

    // ── Trigger audit ──
    if (action === "trigger-audit") {
        return new Promise<NextResponse>((resolve) => {
            const scriptPath = join(process.cwd(), "..", "sync", "stramark", "status_audit.py");
            const pythonCmd = process.platform === "win32" ? "python" : "python3";
            execFile(pythonCmd, [scriptPath], { timeout: 300000 }, (err, stdout, stderr) => {
                // Python logging writes to stderr — only treat as error if exit code != 0
                if (err && err.code !== null && err.code !== 0) {
                    console.error("Audit script error:", err.message);
                    resolve(NextResponse.json({
                        success: false,
                        error: err.message,
                    }, { status: 500 }));
                    return;
                }
                // Reload proposals after script completes
                const data = loadProposals();
                const pending = data.proposals.filter(p => p.status === "pending");
                resolve(NextResponse.json({
                    success: true,
                    pendingCount: pending.length,
                    lastAuditAt: data.lastAuditAt,
                    output: stdout.slice(-500),
                }));
            });
        });
    }

    // ── Approve / Reject ──
    if (action !== "approve" && action !== "reject") {
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    if (!proposalIds || proposalIds.length === 0) {
        return NextResponse.json({ error: "No proposalIds provided" }, { status: 400 });
    }

    const data = loadProposals();
    const idSet = new Set(proposalIds);
    const results: Array<{ id: string; orderId: string; result: string }> = [];
    const now = new Date().toISOString();

    for (const proposal of data.proposals) {
        if (!idSet.has(proposal.id)) continue;
        if (proposal.status !== "pending") {
            results.push({ id: proposal.id, orderId: proposal.posOrderId, result: `already ${proposal.status}` });
            continue;
        }

        if (action === "reject") {
            proposal.status = "rejected";
            proposal.reviewedAt = now;
            results.push({ id: proposal.id, orderId: proposal.posOrderId, result: "rejected" });
            continue;
        }

        // action === "approve" — safety re-check before updating POS
        const liveStatus = await fetchPosOrderStatus(proposal.posOrderId);

        if (!liveStatus) {
            proposal.status = "error";
            proposal.executeResult = "Failed to fetch current POS status";
            proposal.reviewedAt = now;
            results.push({ id: proposal.id, orderId: proposal.posOrderId, result: "error: cannot fetch POS" });
            continue;
        }

        // Check if POS already has the proposed or higher status
        if (liveStatus === proposal.proposedPosStatus) {
            proposal.status = "stale";
            proposal.executeResult = `POS already at ${liveStatus}`;
            proposal.reviewedAt = now;
            results.push({ id: proposal.id, orderId: proposal.posOrderId, result: `stale: already ${liveStatus}` });
            continue;
        }

        if (!isValidTransition(liveStatus, proposal.proposedPosStatus)) {
            proposal.status = "stale";
            proposal.executeResult = `Invalid transition: ${liveStatus} -> ${proposal.proposedPosStatus}`;
            proposal.reviewedAt = now;
            results.push({ id: proposal.id, orderId: proposal.posOrderId, result: `stale: ${liveStatus} cannot go to ${proposal.proposedPosStatus}` });
            continue;
        }

        // Execute POS update
        const ok = await updatePosStatus(proposal.posOrderId, proposal.proposedPosStatus);
        if (ok) {
            proposal.status = "approved";
            proposal.executeResult = `Updated: ${liveStatus} -> ${proposal.proposedPosStatus}`;
            proposal.reviewedAt = now;
            results.push({ id: proposal.id, orderId: proposal.posOrderId, result: `approved: ${liveStatus} -> ${proposal.proposedPosStatus}` });
        } else {
            proposal.status = "error";
            proposal.executeResult = "POS PUT failed";
            proposal.reviewedAt = now;
            results.push({ id: proposal.id, orderId: proposal.posOrderId, result: "error: POS update failed" });
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 500));
    }

    saveProposals(data);

    const pending = data.proposals.filter(p => p.status === "pending");
    return NextResponse.json({
        success: true,
        action,
        results,
        pendingCount: pending.length,
    });
}
