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
    <main className="mx-auto w-full max-w-[62ch] px-4 py-8">
      <h1 className="text-hero font-medium">Report a side effect</h1>
      <p className="mt-2 text-prose">
        Tell us what happened after someone took a medicine.
      </p>

      <div className="mt-4">
        <Orientation />
      </div>

      <div className="mt-6">
        <ReportWizard />
      </div>
    </main>
  );
}
