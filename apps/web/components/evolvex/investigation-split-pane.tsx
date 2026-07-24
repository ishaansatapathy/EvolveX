"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type InvestigationSplitPaneProps = {
  left: ReactNode;
  right: ReactNode;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
};

export function InvestigationSplitPane({
  left,
  right,
  defaultWidth = 300,
  minWidth = 240,
  maxWidth = 440,
}: InvestigationSplitPaneProps) {
  const [leftWidth, setLeftWidth] = useState(defaultWidth);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const startResize = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    function onMouseMove(event: MouseEvent) {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const nextWidth = event.clientX - rect.left;
      const cappedMax = Math.min(maxWidth, rect.width * 0.5);
      setLeftWidth(Math.min(cappedMax, Math.max(minWidth, nextWidth)));
    }

    function onMouseUp() {
      setIsDragging(false);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging, maxWidth, minWidth]);

  return (
    <div
      ref={containerRef}
      className={`evx-dash__split-pane ${isDragging ? "is-resizing" : ""}`}
      style={{ gridTemplateColumns: `${leftWidth}px 10px minmax(0, 1fr)` }}
    >
      <div className="evx-dash__split-pane-left">{left}</div>
      <button
        type="button"
        className="evx-dash__split-pane-handle"
        aria-label="Resize incident queue panel"
        onMouseDown={startResize}
      />
      <div className="evx-dash__split-pane-right">{right}</div>
    </div>
  );
}
