/**
 * Document library and upload.
 *
 * Step 7 adds the drop target, client-side pdf.js extraction, the chunk
 * preview and the DocumentStore interface. The route exists now so the
 * reviewer navigation is complete and the company/public split has somewhere
 * to be shown.
 */
export default function LibraryPage() {
  return (
    <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6">
      <h1 className="text-title font-medium">Library</h1>
      <p className="mt-1 text-meta text-slate">
        Company safety documents and public labels, kept separate.
      </p>

      <hr className="my-4" />

      <div className="border border-rule p-3 rounded-soft">
        <p className="text-micro uppercase tracking-label text-slate">
          Not yet built
        </p>
        <p className="mt-1 text-base">
          Upload, client-side text extraction and the chunk preview arrive in
          step 7.
        </p>
      </div>
    </main>
  );
}
