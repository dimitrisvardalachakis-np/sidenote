import type { Metadata } from "next";
import { Orientation } from "@/components/report/orientation";
import { ReportWizard } from "@/components/report/wizard";

export const metadata: Metadata = {
  title: "Report a side effect — SideNote",
};

/**
 * The public report form.
 *
 * No login. The person filling this in may be frightened, may be elderly, and
 * may be reading in their second language, so the whole surface avoids
 * regulatory wording. Nothing here asks anyone to classify anything; the
 * mapping onto the regulatory concepts happens on our side of the line.
 */
export default function ReportPage() {
  return (
    <main className="mx-auto w-full max-w-[46rem] flex-1 px-4 py-10">
      <h1 className="text-hero font-semibold">Report a side effect</h1>
      <p className="mt-2.5 text-prose text-slate">
        Tell us what happened after someone took a medicine. Write it however
        you like — there is no wrong way to do this.
      </p>

      <div className="mt-6">
        <Orientation />
      </div>

      <div className="mt-4">
        <ReportWizard />
      </div>
    </main>
  );
}
