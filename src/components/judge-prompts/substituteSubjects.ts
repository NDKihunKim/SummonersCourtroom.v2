/**
 * substituteSubjects — replace the SUBJECT_A / SUBJECT_B placeholder tokens
 * inside the hardcoded judge prompt strings with concrete values (currently
 * the two compared champions: the viewer's champion and the picked ally's
 * champion).
 *
 * Kept in its own tiny module so:
 *   - the substitution rules live in one place and are trivially unit-testable
 *   - both render-time display and copy-to-clipboard share the exact same
 *     output (no risk of the UI showing one thing and the clipboard another)
 *
 * Token forms handled (both appear across UPPER_PROMPT / LOWER_PROMPT):
 *   - bare token:      `SUBJECT_A`,        `SUBJECT_B`
 *   - "<X name>" form: `<SUBJECT_A name>`, `<SUBJECT_B name>`
 *
 * Edge cases:
 *   - Empty / falsy values fall back to the original token so the user can
 *     still see what would be substituted (better than silently rendering
 *     "between the two given subjects ( and )").
 *   - Replacement is global (`g` flag) — a token can appear multiple times.
 *   - Replacement strings are escaped for `$&`-style backrefs so champion
 *     names containing `$` (none today, but cheap insurance) don't corrupt
 *     the output.
 */

export type SubjectValues = {
  /** Display name for SUBJECT_A — currently the viewer's champion. */
  subjectA: string;
  /** Display name for SUBJECT_B — currently the picked ally's champion. */
  subjectB: string;
};

/** Escape `$` so it isn't interpreted as a `String.replace` backref. */
function escapeReplacement(value: string): string {
  return value.replace(/\$/g, "$$$$");
}

export function substituteSubjects(
  text: string,
  { subjectA, subjectB }: SubjectValues,
): string {
  // Fall back to the original token when a value is missing so the preview
  // stays informative instead of producing weird empty parentheses.
  const a = subjectA ? escapeReplacement(subjectA) : "SUBJECT_A";
  const b = subjectB ? escapeReplacement(subjectB) : "SUBJECT_B";

  return text
    // "<SUBJECT_A name>" / "<SUBJECT_B name>" — must come BEFORE the bare
    // token replacement, otherwise the inner `SUBJECT_A` would be replaced
    // first and we'd be left with a stray "<Champion name>" wrapper.
    .replace(/<SUBJECT_A\s+name>/g, a)
    .replace(/<SUBJECT_B\s+name>/g, b)
    // Bare tokens.
    .replace(/SUBJECT_A/g, a)
    .replace(/SUBJECT_B/g, b);
}