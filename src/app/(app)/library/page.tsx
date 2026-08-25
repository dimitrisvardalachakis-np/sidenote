import { UploadPanel } from "./upload-panel";
import { getDocumentLibrary } from "@/lib/store/library-store";
import { REJECTION_MESSAGES, type SafetyDocument } from "@/lib/schemas";
import { DOCUMENT_KIND_LABELS } from "@/lib/schemas/document-upload";

/**
 * Document library and upload.
 *
 * The company/public split is the organising idea, not a detail: one column
 * is confidential material the company owns, the other is what anyone can
 * read on the FDA website. A reviewer must never be in doubt which they are
 * looking at, which is why the two are listed separately rather than mixed
 * with a badge.
 */
export default async function LibraryPage() {
  const documents = await (await getDocumentLibrary()).list();
  const company = documents.filter((d) => d.sourceType === "company");
  const publicDocs = documents.filter((d) => d.sourceType === "public");

  return (
    <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-6">
      <h1 className="text-title font-medium">Library</h1>
      <p className="mt-1 text-meta text-slate">
        Company safety documents and public labels, kept separate.
      </p>

      <hr className="my-4" />

      <section aria-label="Upload a document">
        <h2 className="text-micro uppercase tracking-label text-slate">
          Add a document
        </h2>
        <div className="mt-2">
          <UploadPanel />
        </div>
      </section>

      <hr className="my-8" />

      <div className="grid gap-8 md:grid-cols-2">
        <DocumentColumn
          heading="Company documents"
          note="Confidential. CCDS and Investigator's Brochures."
          documents={company}
        />
        <DocumentColumn
          heading="Public labels"
          note="FDA labels, fetched from openFDA."
          documents={publicDocs}
        />
      </div>
    </main>
  );
}

function DocumentColumn({
  heading,
  note,
  documents,
}: {
  heading: string;
  note: string;
  documents: readonly SafetyDocument[];
}) {
  return (
    <section aria-label={heading}>
      <h2 className="text-base font-medium">{heading}</h2>
      <p className="mt-0.5 text-meta text-slate">{note}</p>

      {documents.length === 0 ? (
        <p className="mt-3 border-t border-rule pt-3 text-meta text-slate">
          Nothing here yet.
        </p>
      ) : (
        <ul className="mt-3 border-t border-rule">
          {documents.map((doc) => (
            <li key={doc.id} className="border-b border-rule py-2">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-base">{doc.title}</p>
                <p className="text-meta text-slate">
                  {doc.status === "rejected" ? (
                    // Not --signal: the red means expedited or overdue, and a
                    // document that needs OCR is neither.
                    <span className="font-medium text-ink">needs OCR</span>
                  ) : (
                    <span>{doc.chunkCount} chunks</span>
                  )}
                </p>
              </div>
              <p className="mt-0.5 text-meta text-slate">
                {DOCUMENT_KIND_LABELS[doc.kind]}
                {doc.version !== null && ` · v${doc.version}`}
                {doc.effectiveDate !== null && ` · ${doc.effectiveDate}`}
                {` · ${doc.activeSubstance}`}
              </p>
              {doc.rejectionReason !== null && (
                <p className="mt-1 text-meta font-medium text-ink">
                  {REJECTION_MESSAGES[doc.rejectionReason]}
                </p>
              )}
              {doc.status === "chunking" && (
                <p className="mt-0.5 text-meta text-slate">
                  Chunked and mirrored. Embedding arrives in Cluster E.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
