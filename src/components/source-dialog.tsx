import { Modal } from "./modal";

/**
 * A cited passage, shown where it sits in its document.
 *
 * A citation on screen is a quotation and an id, and checking it has until now
 * meant trusting us. This opens the passage with its neighbours around it, the
 * verified span marked inside it, and — for a public FDA label — a link to the
 * genuine record on DailyMed.
 *
 * The CONTENT is server-rendered and handed in as children. Nothing is
 * fetched: the case screen already holds the corpus, so the surrounding
 * passages are computed there and passed down. That also means the dialog
 * cannot show something the server did not verify.
 *
 * The dialog mechanics live in `Modal`, which the library's uploader shares.
 */
export function SourceDialog({
  label,
  children,
}: {
  /** What the trigger says, e.g. "see in source". */
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Modal
      label={`${label} ↗`}
      title="Source passage"
      triggerClassName="cursor-pointer font-mono text-micro text-steady hover:underline"
    >
      {children}
    </Modal>
  );
}
