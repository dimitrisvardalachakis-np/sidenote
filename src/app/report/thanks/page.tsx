import Link from "next/link";

/**
 * Confirmation, with the reference number.
 *
 * The reference is what a reporter reads out on the phone, so it is set in
 * mono at figure size and is the only large thing on the page. It arrives as a
 * search param rather than being generated here, because this page must be
 * safe to reload — regenerating a reference on refresh would hand the same
 * person two numbers for one report.
 *
 * Step 5 wires the Server Action that redirects here with a real reference.
 */
export default async function ThanksPage({
  searchParams,
}: PageProps<"/report/thanks">) {
  const params = await searchParams;
  const raw = params["ref"];
  const reference = typeof raw === "string" ? raw : null;

  return (
    <main className="mx-auto w-full max-w-[60ch] px-4 py-10">
      <h1 className="text-title font-medium">Thank you — your report is in</h1>
      <p className="mt-2 text-prose text-slate">
        A safety reviewer will read it. You do not need to do anything else.
      </p>

      <hr className="my-6" />

      {reference === null ? (
        <p className="text-prose">
          We could not show your reference number here. Your report was still
          received.
        </p>
      ) : (
        <div>
          <p className="text-micro uppercase tracking-label text-slate">
            Your reference
          </p>
          <p className="mt-1 font-mono text-figure">{reference}</p>
          <p className="mt-3 text-prose">
            Keep this. Quote it if you contact us about this report.
          </p>
        </div>
      )}

      <hr className="my-6" />

      <Link href="/" className="text-base text-steady hover:underline">
        Back to the start
      </Link>
    </main>
  );
}
