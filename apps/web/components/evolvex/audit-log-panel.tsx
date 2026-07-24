type AuditEvent = {
  id: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type AuditLogPanelProps = {
  events: AuditEvent[];
  loading?: boolean;
  title?: string;
};

function formatAction(action: string) {
  return action.replace(/\./g, " · ").replace(/_/g, " ");
}

export function AuditLogPanel({ events, loading, title = "Audit log" }: AuditLogPanelProps) {
  return (
    <section className="evx-dash__context-card evx-dash__audit-card">
      <p className="evx-dash__context-card-title">{title}</p>
      {loading ? (
        <p className="evx-dash__stat-note">Loading audit events…</p>
      ) : events.length === 0 ? (
        <p className="evx-dash__stat-note">No audit events recorded yet.</p>
      ) : (
        <ul className="evx-dash__audit-list">
          {events.map((event) => (
            <li key={event.id} className="evx-dash__audit-item">
              <div className="evx-dash__audit-head">
                <span className="evx-dash__audit-action">{formatAction(event.action)}</span>
                <span className="evx-dash__audit-at">{new Date(event.createdAt).toLocaleString()}</span>
              </div>
              {event.resourceId ? (
                <p className="evx-dash__stat-note">
                  {event.resourceType}: {event.resourceId.slice(0, 8)}…
                </p>
              ) : null}
              {Object.keys(event.metadata).length > 0 ? (
                <p className="evx-dash__stat-note">{JSON.stringify(event.metadata)}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
