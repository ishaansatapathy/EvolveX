type AiConfidenceBadgeProps = {
  level: "high" | "medium" | "low";
  rationale: string;
};

export function AiConfidenceBadge({ level, rationale }: AiConfidenceBadgeProps) {
  return (
    <span className={`evx-dash__ai-confidence evx-dash__ai-confidence--${level}`} title={rationale}>
      AI confidence · {level}
    </span>
  );
}
