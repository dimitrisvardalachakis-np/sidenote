import { ReportWizard } from "@/components/report/wizard";
import { getTurnstileSiteKey } from "@/lib/protection/bot-gate";

/**
 * The public report form.
 *
 * No login. The person filling this in may be frightened, may be elderly, and
 * may be reading in their second language, so the whole surface avoids
 * regulatory wording. Nothing here asks anyone to classify anything; the
 * mapping onto the regulatory concepts happens on our side of the line.
 *
 * The site key is read on the server and handed down. The alternative —
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY inlined at build time — would bake one
 * environment's key into the bundle, so a preview deployment and production
 * could not have different ones without rebuilding.
 */
export default async function ReportPage() {
  const turnstileSiteKey = await getTurnstileSiteKey();

  return (
    <main className="mx-auto w-full max-w-[62ch] px-4 py-8">
      <h1 className="text-title font-medium">Report a side effect</h1>
      <p className="mt-2 text-prose">
        Tell us what happened after someone took a medicine. It takes about five
        minutes. You do not need an account.
      </p>
      <p className="mt-3 text-prose">
        There are five short steps. You can leave anything blank if you do not
        know it, and you can go back at any time.
      </p>

      <div className="mt-6">
        <ReportWizard turnstileSiteKey={turnstileSiteKey} />
      </div>
    </main>
  );
}
