"use client";

type CaseStatus = "open" | "investigating" | "monitoring" | "resolved";

const STATUS_OPTIONS: Array<{ value: CaseStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "monitoring", label: "Monitoring" },
  { value: "resolved", label: "Resolved" },
];

type CaseStatusControlsProps = {
  value: CaseStatus;
  disabled?: boolean;
  onChange: (status: CaseStatus) => void;
};

export function CaseStatusControls({ value, disabled, onChange }: CaseStatusControlsProps) {
  return (
    <div className="evx-dash__case-status-controls" role="group" aria-label="Case status">
      {STATUS_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`evx-dash__case-status-btn st-${option.value} ${value === option.value ? "is-active" : ""}`}
          disabled={disabled}
          onClick={() => onChange(value === option.value ? "open" : option.value)}
          aria-pressed={value === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
