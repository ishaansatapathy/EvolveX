"use client";

import { Suspense } from "react";

import TracesPageContent from "./traces-content";

export default function TracesPage() {
  return (
    <Suspense fallback={<p className="evx-dash__empty">Loading traces…</p>}>
      <TracesPageContent />
    </Suspense>
  );
}
