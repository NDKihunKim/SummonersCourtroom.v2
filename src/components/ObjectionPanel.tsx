import { useEffect, useState } from "react";
import { MessageSquareWarning } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { TranslationKey } from "@/i18n";

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;
type ReasoningChoice = { index: number; text: string; explanation?: string };

function splitReasoningChoices(reasoning: string): ReasoningChoice[] {
  const text = reasoning.trim();
  if (!text) return [];

  const matches = [...text.matchAll(/(?:^|\n)\s*(\d{1,2})\.\s+/g)];
  if (matches.length === 0) return [{ index: 1, text }];

  return matches
    .slice(0, 5)
    .map((match, position) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = matches[position + 1]?.index ?? text.length;
      const index = Number(match[1]);
      return {
        index: Number.isFinite(index) ? index : position + 1,
        text: text.slice(start, end).trim(),
      };
    })
    .filter((choice) => choice.text.length > 0);
}

function objectionErrorKey(error: unknown): TranslationKey {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("OBJECTION_AUTH_REQUIRED")) return "objectionLoginRequired";
  if (message.includes("OBJECTION_ALREADY_SUBMITTED")) return "objectionAlreadySubmitted";
  if (message.includes("OBJECTION_RATE_LIMITED")) return "objectionRateLimited";
  if (message.includes("OBJECTION_SESSION_EXPIRED")) return "objectionSessionExpired";
  if (message.includes("OBJECTION_VERIFY_FAILED")) return "objectionVerifyFailed";
  return "objectionFailed";
}

export function ObjectionPanel({
  reasoning,
  t,
  onSubmit,
  onAfterSubmit,
  renderActions,
}: {
  reasoning: string;
  t: Translate;
  onSubmit: (selectedReasons: ReasoningChoice[], feedback?: string) => Promise<void>;
  onAfterSubmit: () => void;
  renderActions: (button: React.ReactNode, saved: React.ReactNode) => React.ReactNode;
}) {
  const choices = splitReasoningChoices(reasoning);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [explanationsByReason, setExplanationsByReason] = useState<Record<number, string>>({});
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.session));
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSignedIn(Boolean(nextSession));
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  function toggleChoice(index: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
        setExplanationsByReason((currentExplanations) => {
          const { [index]: _removed, ...rest } = currentExplanations;
          return rest;
        });
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function updateExplanation(index: number, value: string) {
    setExplanationsByReason((current) => ({ ...current, [index]: value }));
  }

  async function submit() {
    const selectedReasons = choices
      .filter((choice) => selected.has(choice.index))
      .map((choice) => ({
        ...choice,
        explanation: explanationsByReason[choice.index]?.trim() ?? "",
      }));

    const trimmedFeedback = feedback.trim();
    if (selectedReasons.length === 0 && !trimmedFeedback) return;

    setSubmitting(true);
    try {
      await onSubmit(
        selectedReasons,
        trimmedFeedback || undefined,
      );
      setSubmitted(true);
      setOpen(false);
      setSelected(new Set());
      setExplanationsByReason({});
      setFeedback("");
      toast.success(t("objectionSubmitted"));
    } catch (error) {
      if ((error instanceof Error ? error.message : "").includes("OBJECTION_ALREADY_SUBMITTED")) {
        setSubmitted(true);
        setOpen(false);
      }
      toast.error(t(objectionErrorKey(error)));
    } finally {
      setSubmitting(false);
      onAfterSubmit();
    }
  }

  const hasContent = selected.size > 0 || feedback.trim().length > 0;
  const objectionDisabled = submitted || signedIn !== true;
  const button = (
    <button
      type="button"
      disabled={objectionDisabled}
      onClick={() => setOpen((value) => !value)}
      title={signedIn === false ? t("objectionLoginRequired") : undefined}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      <MessageSquareWarning className="h-3.5 w-3.5" />
      {t("objection")}
    </button>
  );
  const saved = submitted ? (
    <span className="text-[10px] font-medium text-muted-foreground">{t("objectionSaved")}</span>
  ) : signedIn === false ? (
    <span className="text-[10px] font-medium text-muted-foreground">
      {t("objectionLoginRequired")}
    </span>
  ) : null;

  return (
    <>
      {renderActions(button, saved)}
      {open && (
        <div className="mt-3 space-y-3 rounded-lg border border-border bg-background/40 p-3 animate-fade-in">
          {choices.length > 0 && (
            <>
              <p className="text-xs font-medium text-muted-foreground">{t("objectionHelp")}</p>
              <div className="space-y-2">
            {choices.map((choice) => {
              const checked = selected.has(choice.index);
              return (
                <div
                  key={`${choice.index}-${choice.text}`}
                  className={`rounded-md border p-2 text-xs leading-relaxed transition-colors ${
                    checked
                      ? "border-gold bg-gold/10 text-foreground"
                      : "border-border bg-card/60 text-muted-foreground hover:border-gold/50 hover:text-foreground"
                  }`}
                >
                  <label className="flex cursor-pointer gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleChoice(choice.index)}
                      className="mt-0.5 h-3.5 w-3.5 accent-gold"
                    />
                    <span>
                      <span className="font-semibold text-gold">{choice.index}. </span>
                      {choice.text}
                    </span>
                  </label>
                  {checked && (
                    <textarea
                      value={explanationsByReason[choice.index] ?? ""}
                      onChange={(event) => updateExplanation(choice.index, event.target.value)}
                      maxLength={1000}
                      placeholder={t("objectionPlaceholder")}
                      className="mt-2 min-h-16 w-full resize-y rounded-md border border-border bg-background/70 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-gold/50"
                    />
                  )}
                </div>
              );
            })}
          </div>
          </>
          )}
          <textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            maxLength={2000}
            placeholder="Share your additional thoughts or feedback (optional)"
            className="min-h-20 w-full resize-y rounded-md border border-border bg-background/70 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-gold/50"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 flex-1 text-left text-[10px] font-medium leading-relaxed text-muted-foreground">
              {t("objectionNotice")}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                disabled={submitting || !hasContent}
                onClick={() => void submit()}
                className="rounded-md border border-gold bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? t("loading") : t("objectionSend")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
