"use client";

type InvestigationCaseNavProps = {
  onJump: (sectionId: string) => void;
};

const SECTIONS = [
  { id: "case-story", label: "Story" },
  { id: "case-evidence", label: "Evidence" },
  { id: "case-analysis", label: "Analysis" },
  { id: "case-timeline", label: "Timeline" },
] as const;

export function InvestigationCaseNav({ onJump }: InvestigationCaseNavProps) {
  return (
    <nav className="evx-dash__case-nav" aria-label="Case sections">
      {SECTIONS.map((section) => (
        <button
          key={section.id}
          type="button"
          className="evx-dash__case-nav-item"
          onClick={() => onJump(section.id)}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}
