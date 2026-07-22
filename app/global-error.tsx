"use client"; // Error boundaries must be Client Components

// Last-resort boundary: catches an error in the root layout itself (which the segment-level
// error.tsx cannot, since it sits inside that layout). This file replaces the whole shell, so it
// must render its own <html>/<body>. Kept deliberately dependency-free — no fonts, no nav.
// NOTE: Next.js 16 passes `unstable_retry`, not `reset`.
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "4rem 1rem" }}>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600 }}>NodeVelo crashed</h2>
          <p style={{ marginTop: 4, color: "#71717a", fontSize: "0.875rem" }}>
            A top-level error broke the app shell. Try again to recover.
          </p>
          {/* UXA-22: raw message stays reachable but collapsed — see app/error.tsx's twin fix. */}
          {error.message && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontSize: "0.8rem", color: "#71717a" }}>Technical details</summary>
              <pre
                style={{
                  marginTop: 8,
                  overflowX: "auto",
                  borderRadius: 6,
                  background: "#f4f4f5",
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.75rem",
                  color: "#b91c1c",
                }}
              >
                {error.message}
              </pre>
            </details>
          )}
          <button
            onClick={() => unstable_retry()}
            style={{
              marginTop: 16,
              borderRadius: 6,
              background: "#18181b",
              color: "#fff",
              border: "none",
              padding: "0.625rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
