import Link from "next/link";

type SimilarCase = {
  id: string;
  shortId: string;
  title: string;
  similarityScore: number;
  matchReasons: string[];
  status: "building" | "ready" | "failed";
  primaryService?: string | null;
};

type SimilarCasesPanelProps = {
  cases: SimilarCase[];
  activeId?: string;
};

export function SimilarCasesPanel({ cases, activeId }: SimilarCasesPanelProps) {
  if (cases.length === 0) {
    return (
      <section className="evx-dash__context-card evx-dash__similar-card">
        <p className="evx-dash__context-card-title">Similar incidents</p>
        <p className="evx-dash__stat-note">No prior cases with matching service or alert patterns yet.</p>
      </section>
    );
  }

  return (
    <section className="evx-dash__context-card evx-dash__similar-card">
      <p className="evx-dash__context-card-title">Similar incidents</p>
      <ul className="evx-dash__similar-list">
        {cases.map((item) => (
          <li key={item.id} className={activeId === item.id ? "is-active" : undefined}>
            <Link href={`/investigations?investigation=${item.id}`} className="evx-dash__similar-link">
              <span className="evx-dash__similar-id">{item.shortId}</span>
              <span className="evx-dash__similar-title">{item.title}</span>
              <span className="evx-dash__chip">{item.similarityScore}% match</span>
            </Link>
            {item.matchReasons.length > 0 ? (
              <p className="evx-dash__stat-note">{item.matchReasons.join(" · ")}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
