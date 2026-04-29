"use client";

import React, { useEffect, useState, useCallback } from "react";

// ─── Types ─────────────────────────────
interface AdAccountConfig {
    account_id: string;
    account_name: string;
    managed_by: "AI" | "HUMAN";
}

interface DelegationResponse {
    project_id: string;
    accounts: AdAccountConfig[];
    ai_count: number;
    human_count: number;
    total: number;
}

const PROJECTS = [
    { id: "stramark", label: "STRAMARK", color: "#6366f1" },
    { id: "auus1", label: "AUUS1", color: "#f59e0b" },
    { id: "zen8", label: "ZEN8", color: "#10b981" },
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ─── Main Component ────────────────────
export default function PersonalitySettings() {
    const [activeProject, setActiveProject] = useState(PROJECTS[0].id);
    const [accounts, setAccounts] = useState<AdAccountConfig[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [stats, setStats] = useState({ ai: 0, human: 0, total: 0 });
    const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);

    // ─── Fetch delegation matrix ─────────
    const fetchDelegations = useCallback(async (projectId: string) => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/personality/${projectId}/accounts`);
            const data: DelegationResponse = await res.json();
            setAccounts(data.accounts || []);
            setStats({ ai: data.ai_count, human: data.human_count, total: data.total });
            setDirty(false);
        } catch (err) {
            setAccounts([]);
            setStats({ ai: 0, human: 0, total: 0 });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDelegations(activeProject);
    }, [activeProject, fetchDelegations]);

    // ─── Toggle handler ──────────────────
    const handleToggle = (accountId: string) => {
        setAccounts((prev) =>
            prev.map((a) =>
                a.account_id === accountId
                    ? { ...a, managed_by: a.managed_by === "AI" ? "HUMAN" : "AI" }
                    : a
            )
        );
        setDirty(true);
    };

    // ─── Save handler ────────────────────
    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch(`${API_BASE}/api/personality/${activeProject}/accounts`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(accounts),
            });
            const data = await res.json();
            if (data.status === "saved") {
                setToast({ type: "success", msg: `Saved ${data.total} accounts for ${activeProject.toUpperCase()}` });
                setDirty(false);
                fetchDelegations(activeProject);
            } else {
                setToast({ type: "error", msg: "Save failed" });
            }
        } catch {
            setToast({ type: "error", msg: "Network error" });
        } finally {
            setSaving(false);
            setTimeout(() => setToast(null), 3000);
        }
    };

    const activeProjectData = PROJECTS.find((p) => p.id === activeProject)!;

    return (
        <div style={styles.container}>
            {/* ─── Header ─────────────────── */}
            <div style={styles.header}>
                <div>
                    <h2 style={styles.title}>
                        <span style={styles.titleIcon}>🛡️</span> AI Delegation Matrix
                    </h2>
                    <p style={styles.subtitle}>
                        Control which ad accounts are managed by AI vs Human per project
                    </p>
                </div>
                <div style={styles.statsRow}>
                    <span style={styles.statBadge}>
                        🤖 <strong>{stats.ai}</strong> AI
                    </span>
                    <span style={{ ...styles.statBadge, background: "rgba(245, 158, 11, 0.15)", color: "#f59e0b" }}>
                        🧑‍💻 <strong>{stats.human}</strong> Human
                    </span>
                </div>
            </div>

            {/* ─── Project Tabs ───────────── */}
            <div style={styles.tabsRow}>
                {PROJECTS.map((proj) => (
                    <button
                        key={proj.id}
                        onClick={() => setActiveProject(proj.id)}
                        style={{
                            ...styles.tab,
                            ...(activeProject === proj.id
                                ? { ...styles.tabActive, borderBottomColor: proj.color, color: proj.color }
                                : {}),
                        }}
                    >
                        <span
                            style={{
                                ...styles.tabDot,
                                backgroundColor: activeProject === proj.id ? proj.color : "#555",
                            }}
                        />
                        {proj.label}
                    </button>
                ))}
            </div>

            {/* ─── Table ──────────────────── */}
            <div style={styles.tableWrapper}>
                {loading ? (
                    <div style={styles.loadingState}>
                        <div style={styles.spinner} />
                        <p>Loading accounts for {activeProjectData.label}...</p>
                    </div>
                ) : accounts.length === 0 ? (
                    <div style={styles.emptyState}>
                        <p style={styles.emptyIcon}>📭</p>
                        <p>No ad accounts configured for <strong>{activeProjectData.label}</strong></p>
                        <p style={styles.emptyHint}>Add accounts via the API or seed data.</p>
                    </div>
                ) : (
                    <table style={styles.table}>
                        <thead>
                            <tr>
                                <th style={styles.th}>Account Name</th>
                                <th style={styles.th}>Account ID</th>
                                <th style={{ ...styles.th, textAlign: "center" }}>Managed By</th>
                                <th style={{ ...styles.th, textAlign: "center" }}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {accounts.map((acct) => (
                                <tr key={acct.account_id} style={styles.tr}>
                                    <td style={styles.td}>
                                        <strong>{acct.account_name || acct.account_id}</strong>
                                    </td>
                                    <td style={styles.tdMono}>{acct.account_id}</td>
                                    <td style={{ ...styles.td, textAlign: "center" }}>
                                        {/* Toggle Switch */}
                                        <div
                                            style={{
                                                ...styles.toggleTrack,
                                                backgroundColor: acct.managed_by === "AI" ? "#6366f1" : "#374151",
                                            }}
                                            onClick={() => handleToggle(acct.account_id)}
                                        >
                                            <div
                                                style={{
                                                    ...styles.toggleThumb,
                                                    transform: acct.managed_by === "AI" ? "translateX(24px)" : "translateX(0)",
                                                }}
                                            />
                                            <span
                                                style={{
                                                    ...styles.toggleLabel,
                                                    left: acct.managed_by === "AI" ? "6px" : "auto",
                                                    right: acct.managed_by === "AI" ? "auto" : "6px",
                                                }}
                                            >
                                                {acct.managed_by === "AI" ? "🤖" : "🧑‍💻"}
                                            </span>
                                        </div>
                                    </td>
                                    <td style={{ ...styles.td, textAlign: "center" }}>
                                        <span
                                            style={{
                                                ...styles.statusChip,
                                                background:
                                                    acct.managed_by === "AI"
                                                        ? "rgba(99, 102, 241, 0.15)"
                                                        : "rgba(245, 158, 11, 0.15)",
                                                color: acct.managed_by === "AI" ? "#818cf8" : "#fbbf24",
                                            }}
                                        >
                                            {acct.managed_by === "AI" ? "AI Managed" : "Human Only"}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* ─── Save Bar ───────────────── */}
            {dirty && (
                <div style={styles.saveBar}>
                    <span style={styles.saveHint}>⚠️ Unsaved changes</span>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        style={{
                            ...styles.saveButton,
                            opacity: saving ? 0.6 : 1,
                        }}
                    >
                        {saving ? "Saving..." : "💾 Save Changes"}
                    </button>
                </div>
            )}

            {/* ─── Toast ──────────────────── */}
            {toast && (
                <div
                    style={{
                        ...styles.toast,
                        background: toast.type === "success" ? "#065f46" : "#7f1d1d",
                        borderColor: toast.type === "success" ? "#10b981" : "#ef4444",
                    }}
                >
                    {toast.type === "success" ? "✅" : "❌"} {toast.msg}
                </div>
            )}
        </div>
    );
}

// ─── Styles ────────────────────────────
const styles: Record<string, React.CSSProperties> = {
    container: {
        maxWidth: 900,
        margin: "0 auto",
        padding: "24px",
        fontFamily: "'Inter', -apple-system, sans-serif",
        color: "#e5e7eb",
    },
    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 24,
    },
    title: {
        fontSize: 22,
        fontWeight: 700,
        color: "#f9fafb",
        margin: 0,
        display: "flex",
        alignItems: "center",
        gap: 8,
    },
    titleIcon: { fontSize: 24 },
    subtitle: {
        fontSize: 13,
        color: "#9ca3af",
        marginTop: 4,
    },
    statsRow: {
        display: "flex",
        gap: 8,
    },
    statBadge: {
        padding: "4px 12px",
        borderRadius: 20,
        fontSize: 13,
        background: "rgba(99, 102, 241, 0.15)",
        color: "#818cf8",
    },

    // Tabs
    tabsRow: {
        display: "flex",
        gap: 0,
        borderBottom: "1px solid #374151",
        marginBottom: 0,
    },
    tab: {
        padding: "10px 20px",
        background: "transparent",
        border: "none",
        borderBottom: "2px solid transparent",
        color: "#9ca3af",
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 6,
        transition: "all 0.2s",
    },
    tabActive: {
        color: "#f9fafb",
        borderBottomColor: "#6366f1",
    },
    tabDot: {
        width: 8,
        height: 8,
        borderRadius: "50%",
        display: "inline-block",
    },

    // Table
    tableWrapper: {
        background: "#111827",
        borderRadius: "0 0 12px 12px",
        border: "1px solid #1f2937",
        borderTop: "none",
        overflow: "hidden",
        minHeight: 200,
    },
    table: {
        width: "100%",
        borderCollapse: "collapse" as const,
    },
    th: {
        padding: "12px 16px",
        textAlign: "left" as const,
        fontSize: 12,
        fontWeight: 600,
        color: "#6b7280",
        textTransform: "uppercase" as const,
        letterSpacing: "0.5px",
        borderBottom: "1px solid #1f2937",
        background: "#0d1117",
    },
    tr: {
        borderBottom: "1px solid #1f2937",
        transition: "background 0.15s",
    },
    td: {
        padding: "14px 16px",
        fontSize: 14,
    },
    tdMono: {
        padding: "14px 16px",
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: "#9ca3af",
    },

    // Toggle
    toggleTrack: {
        width: 48,
        height: 24,
        borderRadius: 12,
        position: "relative" as const,
        cursor: "pointer",
        transition: "background 0.3s",
        display: "inline-block",
    },
    toggleThumb: {
        width: 20,
        height: 20,
        borderRadius: "50%",
        background: "#fff",
        position: "absolute" as const,
        top: 2,
        left: 2,
        transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
    },
    toggleLabel: {
        position: "absolute" as const,
        top: 3,
        fontSize: 12,
    },

    // Status chip
    statusChip: {
        padding: "4px 10px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
    },

    // Save bar
    saveBar: {
        position: "fixed" as const,
        bottom: 0,
        left: 0,
        right: 0,
        padding: "12px 24px",
        background: "rgba(17, 24, 39, 0.95)",
        backdropFilter: "blur(8px)",
        borderTop: "1px solid #374151",
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: 16,
        zIndex: 50,
    },
    saveHint: {
        fontSize: 13,
        color: "#fbbf24",
    },
    saveButton: {
        padding: "8px 20px",
        background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
        color: "#fff",
        border: "none",
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.2s",
    },

    // Loading/Empty
    loadingState: {
        display: "flex",
        flexDirection: "column" as const,
        alignItems: "center",
        padding: 48,
        color: "#9ca3af",
    },
    spinner: {
        width: 24,
        height: 24,
        border: "2px solid #374151",
        borderTopColor: "#6366f1",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
        marginBottom: 12,
    },
    emptyState: {
        textAlign: "center" as const,
        padding: 48,
        color: "#6b7280",
    },
    emptyIcon: { fontSize: 32, marginBottom: 8 },
    emptyHint: { fontSize: 12, color: "#4b5563", marginTop: 4 },

    // Toast
    toast: {
        position: "fixed" as const,
        bottom: 80,
        right: 24,
        padding: "10px 20px",
        borderRadius: 8,
        border: "1px solid",
        fontSize: 14,
        fontWeight: 500,
        color: "#fff",
        zIndex: 60,
        animation: "fadeIn 0.3s ease",
    },
};
