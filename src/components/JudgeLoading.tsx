import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { TranslationKey } from "@/i18n";

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

export type PipelineStep = "contextualize" | "judge" | "parse";

export function JudgeLoading({
  active,
  completed,
  t,
}: {
  active: PipelineStep;
  completed: Set<PipelineStep>;
  t: Translate;
}) {
  const loadingPhrases: TranslationKey[] = [
    "judgeLoadingPhraseDeliberating",
    "judgeLoadingPhraseTimeline",
    "judgeLoadingPhraseEvidence",
    "judgeLoadingPhraseMoments",
  ];
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [dotCount, setDotCount] = useState(1);
  const steps: { id: PipelineStep; label: string; sub: string }[] = [
    { id: "contextualize", label: t("contextualizeStep"), sub: t("contextualizeStepSub") },
    { id: "judge", label: t("judgeStep"), sub: t("judgeStepSub") },
    { id: "parse", label: t("verdictStep"), sub: t("verdictStepSub") },
  ];

  useEffect(() => {
    const id = window.setInterval(() => {
      setPhraseIndex((index) => (index + 1) % loadingPhrases.length);
    }, 5200);
    return () => window.clearInterval(id);
  }, [loadingPhrases.length]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setDotCount((count) => (count >= 3 ? 1 : count + 1));
    }, 600);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center gap-5 py-6">
      <div className="min-h-5 overflow-hidden text-center">
        <p
          key={phraseIndex}
          className="animate-judge-loading-phrase text-sm font-semibold uppercase tracking-[0.3em] text-gold"
        >
          {t(loadingPhrases[phraseIndex])}
          <span aria-hidden="true">{".".repeat(dotCount)}</span>
        </p>
      </div>
      <ol className="flex w-full max-w-2xl items-start justify-between gap-2">
        {steps.map((s, i) => {
          const isDone = completed.has(s.id);
          const isActive = active === s.id && !isDone;
          return (
            <li key={s.id} className="flex flex-1 flex-col items-center gap-2 text-center">
              <div className="flex w-full items-center">
                <div
                  className={`h-px flex-1 ${i === 0 ? "opacity-0" : isDone || isActive ? "bg-gold" : "bg-border"}`}
                />
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all ${
                    isDone
                      ? "border-gold bg-gold/20 text-gold"
                      : isActive
                        ? "border-gold bg-card text-gold"
                        : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {isDone ? (
                    <Check className="h-4 w-4" />
                  ) : isActive ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span className="text-xs font-semibold">{i + 1}</span>
                  )}
                </div>
                <div
                  className={`h-px flex-1 ${i === steps.length - 1 ? "opacity-0" : isDone ? "bg-gold" : "bg-border"}`}
                />
              </div>
              <div>
                <div
                  className={`text-xs font-semibold uppercase tracking-wider ${
                    isDone || isActive ? "text-gold" : "text-muted-foreground"
                  }`}
                >
                  {s.label}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{s.sub}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
