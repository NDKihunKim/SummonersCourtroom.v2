import type { Locale } from "@/i18n";

/**
 * Hardcoded prompt text shown around the timeline-window context preview in the
 * Specify Time result panel.
 *
 * IMPORTANT: This is a DISPLAY-ONLY preview right now. These strings are
 * rendered as static text in `TimelineWindowResult` so the user can see what
 * a full prompt to the Judge LLM would look like with the current window's
 * merged timeline as context. They are NOT yet sent to any model.
 *
 * Kept in their own module so:
 *   - the strings live in one place and can be tweaked without touching UI
 *   - the same constants can later be reused if/when we wire Specify Time
 *     into the real Judge pipeline (e.g. as system + user-tail messages)
 *
 * The `<SUBJECT_A name>` / `<SUBJECT_B name>` tokens are intentionally left
 * as literal placeholders for now — substitution will happen when (and if)
 * we wire this up to an actual LLM call.
 */

/** Upper prompt — role/background framing rendered ABOVE the structured context brief. */
export const UPPER_PROMPT = `You are an expert League of Legends post-game analyst. Your task is to compare SUBJECT_A and SUBJECT_B and decide which subject shows greater process fault within the provided context window.

Use the Structured Context Brief as the only source of truth. It contains:
- Teams: each team's champions and roles.
- Chronological Context: frame snapshots and event lines ordered by game time.

Treat frame snapshots as state evidence: position, role, level, gold, CS, jungle CS, XP, health, crowd-control time, and champion damage. Treat event lines as action evidence: kills, deaths, assists, objectives, turret plates, building kills, and game end.

Do not use outside match knowledge, hidden information, matchup theory, vision assumptions, summoner spell assumptions, player intent, or facts not shown in the brief.`;

function outputLanguageInstruction(locale: Locale, championLocalization = ""): string {
  if (locale === "ko") {
    return `**OUTPUT LANGUAGE:**

Write the verdict and all reasoning in natural Korean.
Use the Korean champion names from NAME LOCALIZATION whenever referring to champions. Do not translate summoner names, Riot IDs, timestamps, or numeric evidence.
Use Korean fixed output wording:
- Non-tie first line: only the selected champion name, localized into Korean when NAME LOCALIZATION provides it.
- Tie line: '판결: 무승부 — 선택한 구간에는 판결을 내릴 만큼 충분한 이벤트가 없습니다.'

${championLocalization}`;
  }

  return `**OUTPUT LANGUAGE:**

Write the verdict and all reasoning in English.
Use English fixed output wording:
- Non-tie first line: only the selected champion name.
- Tie line: 'Verdict: Tie — The selected window contains not enough events to verdict.'`;
}

/** Lower prompt — strict FINAL INSTRUCTION + OUTPUT FORMAT rendered BELOW the structured context brief. */
export function buildLowerPrompt(locale: Locale = "en", championLocalization = "") {
  return `--- FINAL INSTRUCTION ---

${outputLanguageInstruction(locale, championLocalization)}

**EVIDENCE CHECK:**

First decide whether the Structured Context Brief contains actionable evidence for SUBJECT_A or SUBJECT_B. A non-tie requires at least one of:

- A death, kill, or assist involving either subject.

- Meaningful position, health, gold, CS, level, XP, or champion damage evidence involving either subject.

- Participation in a shown fight, objective, turret plate, turret/inhibitor destruction, or game-ending event.

- Clear absence from a relevant fight/objective/building event, but only when the brief shows both where the subject was and what relevant event happened elsewhere.

- A clear macro or positioning problem supported by the brief, such as being isolated around a key fight, pathing to low-value activity while a major event occurs, staying exposed near enemy structures, or missing relevant objective/building pressure.

Do not infer missing evidence. If the brief does not show an event, resource state, position pattern, or map event, do not use it as a reason.

Every reason must be traceable to one or more specific lines in Chronological Context. Do not paraphrase beyond what those lines support.

**TIE CONDITION:**

If no actionable evidence exists for either subject, output only the Tie line specified in OUTPUT LANGUAGE and STOP. Do not proceed to the verdict or reasons.

**VERDICT METHOD (only if non-tie):**

Determine who is more at fault using only process evidence from the Structured Context Brief. Process fault means the subject's decisions, positioning, timing, or map contribution made the losing outcome more likely within the shown context. It is not simple scoreboard blame.

Consider these factors:

- **Positioning and pathing:** Was the subject isolated, overextended, too far from relevant action, or moving through a low-value area while the important play happened elsewhere?

- **Fight and death context:** If a death occurred, did it create a numbers disadvantage without visible compensation, or was it part of a reasonable trade for an objective/building?

- **Objective and building context:** Was the subject present for meaningful dragon, Herald, Baron, turret plate, turret, inhibitor, or nexus pressure when the brief shows those events mattered?

- **Resource and contribution context:** Use gold, CS, level, health, XP, and champion damage only when they explain a decision. A deficit alone is not fault; the fault must come from how the subject played around that state.

- **Role and game-time expectations:** Use role labels and game time to judge reasonable presence and risk. Do not invent champion-specific matchup rules.

**DO NOT OVER-BLAME:**

- Do not blame a subject only because they died. Explain why the death was avoidable or low-value using the brief.

- Do not blame a subject only because they had lower gold, CS, level, health, or damage. Connect the state to a visible decision.

- Do not blame absence from a fight/objective unless the brief shows both the subject's location and the relevant fight/objective timing.

- Do not reward or punish actions that require unseen vision, cooldown, communication, or intent.

**LOCATION WORDING:**

Use timestamps and describe locations by understandable zones or named structures, such as "near dragon pit", "near Baron", "baron-side river", "dragon-side river", "bot-side jungle", "mid lane", "under outer turret", or "near inhibitor turret".

If map side, lane ownership, or structure location is unclear, use the brief's turret and inhibitor labels/positions only as internal reference points. Never base a verdict on coordinates alone.

**NO COUNTERFACTUALS:**

Never use "if they had" or "they should have" except when comparing to standard role expectations. Do not imagine alternate outcomes. Only describe what actually occurred in the structured context brief and whether it deviates from reasonable expectations for that champion/role/game time.

**EXAMPLE VERIFICATION:**

Before writing each numbered reason, verify that every example, timestamp, subject action, location, and event you mention appears in the Structured Context Brief. If an example cannot be directly matched to the brief, do not use it. Prefer fewer reasons over unsupported reasons.

**OUTPUT FORMAT (strict):**

- Line 1: Output only the selected champion name. Do not include "Verdict:", "is more at fault", "판결:", or any other words on this line. Pick exactly one subject; no ties here because ties are handled above.

- Then list **1 to 3 reasons**. Use exactly as many as the evidence supports. Do not pad with weak or imaginary reasons.

- Each reason must be numbered (1., 2., 3.) and describe a broader fault pattern, such as poor positioning, missed objective setup, unsafe pathing, bad fight timing, or a low-value map decision.

- Each reason must include example evidence using wording like "for example, ..." and should cite a timestamp when available. The reason should explain what the example shows, not merely restate a raw event log.

- Use qualitative map/event descriptions. Never print raw coordinate numbers (x,y) in the final answer. Users cannot interpret coordinates directly. Use coordinates only internally to infer a readable nearby map landmark, named structure, or broad zone.

- When describing location, prefer understandable map terms such as "near dragon pit", "near Baron", "baron-side river", "dragon-side river", "Blue-side Gromp", "Red-side Raptors", "bot-side jungle", "mid lane", or named structures like "Blue team's Top Outer Turret" or "Red team's Mid Inhibitor Turret".

- If exact camp/river/objective location is unclear, use a broader zone description instead of coordinates, such as "around bot-side jungle", "near mid lane", "near the enemy outer turret", or "around the inhibitor turret area".

- Order reasons from most impactful to least impactful.

- Do not add a 4th reason, a summary paragraph, caveats, hedging, or any text after the last reason.

**Example of acceptable output (non‑tie, 2 reasons):**

<SUBJECT_B name>

1. <SUBJECT_B name> showed poor objective timing around dragon; for example, at 15:30 she was farming bot lane while her team was already contesting near the pit.

2. <SUBJECT_B name> repeatedly created avoidable fight risk through unsafe positioning; for example, at 17:45 she face‑checked near Baron and died before her team could contest.

**Example of acceptable output (tie):**

Verdict: Tie — The window from 00:00 to 01:00 contains not enough events to verdict.

Stop here. Do not write anything else.`;
}
