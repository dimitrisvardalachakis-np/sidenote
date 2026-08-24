import { ReportForm } from "./report-form";

/**
 * The public report form. No authentication, by design.
 *
 * Cluster C puts Turnstile and a rate-limit binding in front of this, which is
 * what protects an endpoint that cannot ask who you are. Until then the only
 * defence is that the Server Action validates everything it is handed.
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

      <hr className="my-6" />

      <ReportForm />
    </main>
  );
}
