"use client";

import { use } from "react";
import STRAMARKDashboardShell from "@/components/stramark/dashboard-shell";

interface Props {
    params: Promise<{ slug?: string[] }>;
}

export default function STRAMARKPage({ params }: Props) {
    const { slug } = use(params);
    return <STRAMARKDashboardShell slug={slug} />;
}
