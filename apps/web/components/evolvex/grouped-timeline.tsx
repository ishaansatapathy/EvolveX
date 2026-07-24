"use client";

import { useMemo, useState } from "react";

import {
  groupTimelineEntries,
  type TimelineGroup,
  type TimelineGroupEntry,
} from "@repo/services/investigation/timeline-groups";

type GroupedTimelineProps = {
  entries: TimelineGroupEntry[];
  formatEventTime: (iso: string) => string;
  citationRefByEntryId?: Map<string, string>;
  onEntryClick?: (entryId: string) => void;
};

function TimelineBeat({
  ev,
  citationRef,
  onEntryClick,
  formatEventTime,
  compact = false,
}: {
  ev: TimelineGroupEntry;
  citationRef?: string;
  onEntryClick?: (entryId: string) => void;
  formatEventTime: (iso: string) => string;
  compact?: boolean;
}) {
  const errorLike = /fail|error|oom|crash|timeout|critical|backoff|killed/i.test(`${ev.title} ${ev.detail}`);

  return (
    <li
      className={`evx-dash__narrative-beat${errorLike ? " is-error" : ""}${compact ? " is-compact" : ""}`}
      data-timeline-entry-id={ev.id}
      onClick={onEntryClick ? () => onEntryClick(ev.id) : undefined}
      onKeyDown={
        onEntryClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onEntryClick(ev.id);
              }
            }
          : undefined
      }
      role={onEntryClick ? "button" : undefined}
      tabIndex={onEntryClick ? 0 : undefined}
    >
      <div className="evx-dash__narrative-beat-head">
        <span className="evx-dash__event-at">{formatEventTime(ev.occurredAt)}</span>
        {citationRef ? <span className="evx-dash__citation-badge">{citationRef}</span> : null}
        <span className={`evx-dash__chip k-${ev.kind.toLowerCase()}`}>{ev.kind}</span>
        {errorLike ? <span className="evx-dash__chip evx-dash__chip--low">error</span> : null}
      </div>
      <p className="evx-dash__narrative-sentence">
        <strong>{ev.title}</strong> — {ev.detail}
        {ev.source ? <span className="evx-dash__event-source"> · {ev.source}</span> : null}
      </p>
    </li>
  );
}

function TimelineGroupBlock({
  group,
  defaultOpen,
  formatEventTime,
  citationRefByEntryId,
  onEntryClick,
}: {
  group: TimelineGroup;
  defaultOpen: boolean;
  formatEventTime: (iso: string) => string;
  citationRefByEntryId?: Map<string, string>;
  onEntryClick?: (entryId: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const collapsible = group.entryCount > 1;

  if (!collapsible) {
    const entry = group.entries[0];
    if (!entry) return null;
    return (
      <TimelineBeat
        ev={entry}
        citationRef={citationRefByEntryId?.get(entry.id)}
        onEntryClick={onEntryClick}
        formatEventTime={formatEventTime}
      />
    );
  }

  return (
    <li
      className={`evx-dash__timeline-group kind-${group.kind}${group.highlighted ? " is-highlighted" : ""}`}
    >
      <button
        type="button"
        className="evx-dash__timeline-group-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="evx-dash__timeline-group-head">
          <span className="evx-dash__event-at">{formatEventTime(group.startedAt)}</span>
          <span className="evx-dash__chip evx-dash__chip--group">{group.title}</span>
          <span className="evx-dash__chip">{group.entryCount} events</span>
          {group.highlighted ? <span className="evx-dash__chip evx-dash__chip--low">highlight</span> : null}
        </span>
        <span className="evx-dash__timeline-group-summary">{group.summary}</span>
        <span className="evx-dash__timeline-group-chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <ol className="evx-dash__timeline-group-entries">
          {group.entries.map((entry) => (
            <TimelineBeat
              key={entry.id}
              ev={entry}
              citationRef={citationRefByEntryId?.get(entry.id)}
              onEntryClick={onEntryClick}
              formatEventTime={formatEventTime}
              compact
            />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

export function GroupedTimeline({
  entries,
  formatEventTime,
  citationRefByEntryId,
  onEntryClick,
}: GroupedTimelineProps) {
  const groups = useMemo(() => groupTimelineEntries(entries), [entries]);

  return (
    <ol className="evx-dash__narrative-beats evx-dash__timeline-groups">
      {groups.map((group) => (
        <TimelineGroupBlock
          key={group.id}
          group={group}
          defaultOpen={group.highlighted || group.entryCount <= 2}
          formatEventTime={formatEventTime}
          citationRefByEntryId={citationRefByEntryId}
          onEntryClick={onEntryClick}
        />
      ))}
    </ol>
  );
}
