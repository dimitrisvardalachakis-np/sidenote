import { FrontDoor } from "@/components/front-door";

/**
 * The front door: one question, one door per answer.
 *
 * It used to offer two cards and a quieter third link, so the first thing this
 * app asked a frightened person to do was choose a user interface. It asks
 * which of them you are, and the panel becomes the door for the answer.
 *
 * Chat versus form is still a decision made INSIDE the reporting flow, where
 * it can be reversed without losing anything. The lookup is a peer here rather
 * than a footnote, because it is a genuinely different job and burying it sent
 * people who only wanted to check something into a five-minute intake form.
 *
 * Written as an instrument, not a landing page: no gradient, no illustration,
 * no marketing sentence about safety.
 */
export default function LandingPage() {
  return (
    <main className="mx-auto w-full max-w-[76rem] flex-1 px-4 py-12 lg:py-16">
      <FrontDoor />
    </main>
  );
}
