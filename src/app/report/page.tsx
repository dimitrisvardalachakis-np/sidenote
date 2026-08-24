/**
 * The public report form. No authentication.
 *
 * Step 4 puts the route in place; step 5 builds the Server Action, the shared
 * zod validation and the inline field errors. The shell is here so the route
 * tree is complete and navigable, and so the layout decisions — measure,
 * heading rhythm, the "what happens next" note — are settled before the form
 * controls land on top of them.
 */
export default function ReportPage() {
  return (
    <main className="mx-auto w-full max-w-[60ch] px-4 py-10">
      <h1 className="text-title font-medium">Report a side effect</h1>
      <p className="mt-2 text-prose text-slate">
        Tell us what happened. You do not need an account, and you can leave
        anything you do not know blank.
      </p>

      <hr className="my-6" />

      <p className="text-prose">
        A safety reviewer reads every report. If we need to ask you anything, we
        will use the contact details you give us — and only for that.
      </p>

      <div className="mt-6 border border-rule p-3 rounded-soft">
        <p className="text-micro uppercase tracking-label text-slate">
          Not yet built
        </p>
        <p className="mt-1 text-base">
          The form itself arrives in step 5, validated by the same zod schema on
          both the client and the server.
        </p>
      </div>
    </main>
  );
}
