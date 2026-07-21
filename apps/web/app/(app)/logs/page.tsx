"use client";

import { Suspense } from "react";

import LogsPageContent from "./logs-content";

export default function LogsPage() {
  return (
    <Suspense fallback={<p className="evx-dash__empty">Loading logs…</p>}>
      <LogsPageContent />
    </Suspense>
  );
}
