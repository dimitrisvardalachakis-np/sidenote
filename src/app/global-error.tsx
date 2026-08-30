"use client";

/**
 * The last boundary: an error in the root layout itself.
 *
 * This one replaces the whole document, so it has to render its own <html> and
 * <body> — and it cannot rely on anything the root layout sets up. That
 * includes the stylesheet, which is why every style here is inline. A global
 * error page that depends on the CSS the failing layout was going to load is a
 * page that renders unstyled exactly when it is needed.
 *
 * The colours are the tokens' literal values rather than var() references for
 * the same reason: tokens.css may never have loaded.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#FAFAF8",
          color: "#14171A",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <main style={{ maxWidth: "40rem", margin: "0 auto", padding: "4rem 1rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
            SideNote could not start
          </h1>
          <p style={{ marginTop: "0.75rem", lineHeight: 1.6, color: "#5B6570" }}>
            Something failed before the page could be built. Nothing was saved
            or changed.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              minHeight: "2.75rem",
              padding: "0.5rem 1.25rem",
              borderRadius: "0.375rem",
              border: "none",
              background: "#2F6B72",
              color: "#FAFAF8",
              font: "inherit",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest !== undefined && (
            <p
              style={{
                marginTop: "2rem",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.75rem",
                color: "#5B6570",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <p style={{ marginTop: "2rem", fontSize: "0.8125rem", color: "#5B6570" }}>
            Training demo — synthetic and public data, not a validated system.
          </p>
        </main>
      </body>
    </html>
  );
}
