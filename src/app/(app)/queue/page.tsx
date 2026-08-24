import { requireSession } from "@/lib/auth";

/**
 * The reviewer queue. A Server Component, as the brief specifies.
 *
 * Step 8 fills this with twelve seeded cases, the countdown rail and the
 * two-pane link through to each case. The route and its data boundary are
 * established here: this component is async and reads its session on the
 * server, so nothing about the queue ever ships to the client as props it
 * could be spoofed with.
 */
export default async function QueuePage() {
  const session = await requireSession();

  return (
    <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-title font-medium">Queue</h1>
        <p className="text-meta text-slate">{session.displayName}</p>
      </div>

      <hr className="my-4" />

      <div className="border border-rule p-3 rounded-soft">
        <p className="text-micro uppercase tracking-label text-slate">
          Not yet built
        </p>
        <p className="mt-1 text-base">
          Twelve seeded cases, the countdown rail and the clock states arrive in
          step 8.
        </p>
      </div>
    </main>
  );
}
