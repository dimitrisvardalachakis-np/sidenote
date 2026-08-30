/**
 * Shown while a reviewer route streams in.
 *
 * Text, not a spinner or a skeleton. A skeleton implies the shape of what is
 * coming and would be lying whenever the answer turns out to be "no cases" —
 * and an animated placeholder in an instrument panel reads as activity that
 * is not happening. This says the one true thing and holds the layout.
 */
export default function AppLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-10">
      <p className="font-mono text-micro uppercase tracking-label text-slate">Loading</p>
    </div>
  );
}
