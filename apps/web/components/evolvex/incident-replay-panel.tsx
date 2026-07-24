"use client";

import { useEffect, useMemo, useState } from "react";

export type IncidentReplayStep = {
  id: string;
  occurredAt: string;
  kind: string;
  title: string;
  detail: string;
  citationRef?: string | null;
};

type IncidentReplayPanelProps = {
  steps: IncidentReplayStep[];
  onActiveStepChange?: (step: IncidentReplayStep | null) => void;
};

function formatReplayTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function IncidentReplayPanel({ steps, onActiveStepChange }: IncidentReplayPanelProps) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const sortedSteps = useMemo(
    () => [...steps].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()),
    [steps],
  );

  const activeStep = sortedSteps[index] ?? null;
  const maxIndex = Math.max(0, sortedSteps.length - 1);

  useEffect(() => {
    onActiveStepChange?.(activeStep);
  }, [activeStep, onActiveStepChange]);

  useEffect(() => {
    if (!playing || sortedSteps.length === 0) return;

    const timer = window.setInterval(() => {
      setIndex((current) => {
        if (current >= maxIndex) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 1800);

    return () => window.clearInterval(timer);
  }, [playing, maxIndex, sortedSteps.length]);

  if (sortedSteps.length === 0) {
    return (
      <section className="evx-dash__context-card evx-dash__replay-card">
        <p className="evx-dash__context-card-title">Incident replay</p>
        <p className="evx-dash__stat-note">Replay becomes available once timeline evidence is collected.</p>
      </section>
    );
  }

  return (
    <section className="evx-dash__context-card evx-dash__replay-card">
      <p className="evx-dash__context-card-title">Incident replay</p>
      <p className="evx-dash__stat-note" style={{ marginBottom: "0.65rem" }}>
        Step through the incident chronology — {index + 1}/{sortedSteps.length}
      </p>

      <div className="evx-dash__replay-controls">
        <button
          type="button"
          className="evx-dash__btn-ghost"
          disabled={index <= 0}
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
        >
          Prev
        </button>
        <button
          type="button"
          className="evx-dash__btn-primary"
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          className="evx-dash__btn-ghost"
          disabled={index >= maxIndex}
          onClick={() => setIndex((value) => Math.min(maxIndex, value + 1))}
        >
          Next
        </button>
        <button type="button" className="evx-dash__btn-ghost" onClick={() => setIndex(0)}>
          Reset
        </button>
      </div>

      <input
        type="range"
        min={0}
        max={maxIndex}
        value={index}
        onChange={(event) => {
          setPlaying(false);
          setIndex(Number(event.target.value));
        }}
        className="evx-dash__replay-slider"
        aria-label="Replay timeline position"
      />

      {activeStep ? (
        <article className="evx-dash__replay-step">
          <div className="evx-dash__replay-step-head">
            <span className="evx-dash__event-at">{formatReplayTime(activeStep.occurredAt)}</span>
            {activeStep.citationRef ? (
              <span className="evx-dash__citation-badge">{activeStep.citationRef}</span>
            ) : null}
            <span className={`evx-dash__chip k-${activeStep.kind.toLowerCase()}`}>{activeStep.kind}</span>
          </div>
          <p className="evx-dash__narrative-sentence">
            <strong>{activeStep.title}</strong> — {activeStep.detail}
          </p>
        </article>
      ) : null}

      <ul className="evx-dash__replay-trail">
        {sortedSteps.slice(0, index + 1).map((step) => (
          <li key={step.id} className={step.id === activeStep?.id ? "is-active" : undefined}>
            {formatReplayTime(step.occurredAt)} · {step.kind} · {step.title}
          </li>
        ))}
      </ul>
    </section>
  );
}
