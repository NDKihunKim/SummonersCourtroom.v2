/**
 * PromptBlock — small presentational wrapper used to render the hardcoded
 * upper / lower prompt text around the timeline JSON dump.
 *
 * Pulled into its own component because we render two of these with the same
 * shape (label chip + monospace body); keeping the markup in one place keeps
 * the styling consistent and the parent component readable.
 *
 * Pure / stateless — no effects, no fetches. Safe to render anywhere.
 */

type Tone = "intro" | "instruction";

export function PromptBlock({
  label,
  text,
  tone = "intro",
}: {
  /** Short caption shown in the chip at the top-left (e.g. "Upper prompt"). */
  label: string;
  /** Prompt body. Rendered as preformatted text so newlines are preserved. */
  text: string;
  /**
   * Visual tint for the chip:
   *   - "intro"       → gold (matches the Specify-Time accent for framing text)
   *   - "instruction" → hex-blue (matches the existing "X items" badge tone)
   */
  tone?: Tone;
}) {
  // Tone → chip classes. Kept as a tiny lookup so adding a new tone later is
  // a one-line change and the JSX stays readable.
  const chipClass =
    tone === "instruction"
      ? "bg-hex-blue/20 text-hex-blue"
      : "bg-gold/20 text-gold";

  return (
    <section className="rounded border border-border bg-card/40 p-3">
      <div className="mb-2">
        <span
          className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${chipClass}`}
        >
          {label}
        </span>
      </div>
      {/*
        whitespace-pre-wrap → preserve newlines from the source string.
        break-words           → long URLs / unbroken tokens won't cause horizontal scroll
                                on the narrow (714px) preview viewport.
      */}
      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">
        {text}
      </pre>
    </section>
  );
}