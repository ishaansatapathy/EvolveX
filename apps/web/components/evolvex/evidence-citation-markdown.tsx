import type { ReactNode } from "react";

type EvidenceCitation = {
  ref: string;
  timelineEntryId: string | null;
  evidenceId: string | null;
  kind: string;
  label: string;
  occurredAt: string;
};

type EvidenceCitationMarkdownProps = {
  markdown: string;
  citations: EvidenceCitation[];
  onCitationClick?: (timelineEntryId: string) => void;
};

const CITATION_MARKER_PATTERN = /\[(T|E)(\d+)\]/g;

function citationMap(citations: EvidenceCitation[]) {
  return new Map(citations.map((item) => [item.ref, item]));
}

function renderLineWithCitations(
  line: string,
  catalog: Map<string, EvidenceCitation>,
  onCitationClick?: (timelineEntryId: string) => void,
) {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of line.matchAll(CITATION_MARKER_PATTERN)) {
    const fullMatch = match[0];
    const prefix = match[1];
    const number = match[2];
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      nodes.push(<span key={`text-${lastIndex}`}>{line.slice(lastIndex, matchIndex)}</span>);
    }

    const ref = `${prefix}${number}`;
    const citation = catalog.get(ref);

    if (citation?.timelineEntryId && onCitationClick) {
      nodes.push(
        <button
          key={`cite-${matchIndex}`}
          type="button"
          className="evx-dash__citation-link"
          title={`${citation.kind}: ${citation.label}`}
          onClick={() => onCitationClick(citation.timelineEntryId!)}
        >
          [{ref}]
        </button>,
      );
    } else {
      nodes.push(
        <span key={`cite-${matchIndex}`} className="evx-dash__citation-static" title={citation?.label}>
          [{ref}]
        </span>,
      );
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < line.length) {
    nodes.push(<span key={`text-${lastIndex}`}>{line.slice(lastIndex)}</span>);
  }

  return nodes;
}

export function EvidenceCitationMarkdown({
  markdown,
  citations,
  onCitationClick,
}: EvidenceCitationMarkdownProps) {
  const catalog = citationMap(citations);
  const lines = markdown.split("\n");

  return (
    <div className="evx-dash__citation-markdown">
      {lines.map((line, lineIndex) => {
        const headingMatch = line.match(/^##\s+(.+)$/);
        if (headingMatch) {
          return (
            <h3 key={`heading-${lineIndex}`} className="evx-dash__citation-heading">
              {headingMatch[1]}
            </h3>
          );
        }

        if (line.trim() === "") {
          return <div key={`spacer-${lineIndex}`} className="evx-dash__citation-spacer" />;
        }

        return (
          <p key={`line-${lineIndex}`} className="evx-dash__citation-line">
            {renderLineWithCitations(line, catalog, onCitationClick)}
          </p>
        );
      })}
    </div>
  );
}
