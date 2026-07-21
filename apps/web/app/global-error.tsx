"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#0a0a0a", color: "#f5f5f5" }}>
        <div style={{ maxWidth: 420, margin: "80px auto", padding: 24 }}>
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>Evolvex encountered an error</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "#a3a3a3" }}>
            Something unexpected happened. Try reloading the page.
          </p>
          {error.digest ? (
            <p style={{ fontSize: 12, color: "#737373", marginTop: 8 }}>Reference: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 16,
              padding: "8px 14px",
              borderRadius: 8,
              border: "none",
              background: "#3b82f6",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
