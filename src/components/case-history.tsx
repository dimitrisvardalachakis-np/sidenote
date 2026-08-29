import type { AuditRecord } from "@/lib/audit";

/**
 * What has happened to this case.
 *
 * Non-negotiable #9 has emitted a structured line for every mutation since the
 * first cluster, and no screen has ever shown one — an odd gap in a tool whose
 * pitch is that every decision is logged, and the first thing a
 * pharmacovigilance reviewer looks for.
 *
 * Collapsed by default, because it is reference material rather than part of
 * the decision. `<details>` rather than a client component: the disclosure is
 * the browser's job and this needs no state.
 *
 * The AI lines carry the model and the gateway request id, which is the whole
 * of non-negotiable #9's second sentence — a verdict traces to the exact
 * inference that informed it.
 */
export function CaseHistory({ records }: { records: readonly AuditRecord[] }) {
  return (
    <details className="mt-6 border-t border-rule pt-3">
      <summary className="cursor-pointer text-micro uppercase tracking-label text-slate hover:text-ink">
        History · {records.length} {records.length === 1 ? "entry" : "entries"}
      </summary>

      {records.length === 0 ? (
        <p className="mt-2 text-meta text-slate">
          Nothing recorded against this case yet. Every claim, assessment and
          ruling writes a line here.
        </p>
      ) : (
        <ol className="mt-2">
          {records.map((record, index) => (
            <li
              key={`${record.timestamp}-${index}`}
              className="border-t border-rule py-1.5 first:border-t-0"
            >
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-mono text-micro tabular-nums text-slate">
                  {record.timestamp.slice(0, 16).replace("T", " ")}
                </span>
                <span className="text-meta text-ink">
                  {record.action.replace(/_/g, " ")}
                </span>
                <span className="text-micro text-slate">{record.actor}</span>
                <span
                  className={[
                    "text-micro uppercase tracking-label",
                    // Not --signal: a rejected write is a system working, not
                    // a regulatory deadline.
                    record.outcome === "success" ? "text-steady" : "text-slate",
                  ].join(" ")}
                >
                  {record.outcome}
                </span>
              </div>
              {record.detail !== undefined && (
                <p className="mt-0.5 font-mono text-micro break-words text-slate">
                  {Object.entries(record.detail)
                    .map(([key, value]) => `${key}=${String(value)}`)
                    .join("  ")}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
