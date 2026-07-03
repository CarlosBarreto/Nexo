import { Button, cn, DialogTitle } from "@houston-ai/core";
import { ArrowLeft, Droplets, Flame, Mountain, Wind } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AiStepFooter } from "../ai-step-footer";
import { RITUAL_CHAPTERS, type RitualElement } from "./chapters";
import { scoreRitual } from "./scoring";

interface SoulRitualStepProps {
  onBack: () => void;
  onComplete: (element: RitualElement) => void;
}

const ELEMENT_ICONS: Record<RitualElement, typeof Flame> = {
  fire: Flame,
  water: Droplets,
  earth: Mountain,
  air: Wind,
};

/**
 * The Ritual of Birth: five narrative chapters, one answer each. The user
 * discovers the agent's element instead of configuring it; the tallied
 * element (scoring.ts) maps to an Axie archetype preset. The result screen
 * reveals the element before handing control back to the creation flow.
 */
export function SoulRitualStep({ onBack, onComplete }: SoulRitualStepProps) {
  const { t } = useTranslation("shell");
  const { t: tCommon } = useTranslation("common");
  const [answers, setAnswers] = useState<RitualElement[]>([]);
  const [revealed, setRevealed] = useState<RitualElement | null>(null);

  const chapterIndex = answers.length;
  const chapter = RITUAL_CHAPTERS[chapterIndex];

  const choose = (element: RitualElement) => {
    const next = [...answers, element];
    if (next.length >= RITUAL_CHAPTERS.length) setRevealed(scoreRitual(next));
    setAnswers(next);
  };

  const stepBack = () => {
    if (revealed) {
      setRevealed(null);
      setAnswers(answers.slice(0, -1));
    } else if (answers.length > 0) {
      setAnswers(answers.slice(0, -1));
    } else {
      onBack();
    }
  };

  if (revealed) {
    const Icon = ELEMENT_ICONS[revealed];
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <DialogTitle className="sr-only">
          {t("soulRitual.result.title")}
        </DialogTitle>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 pt-10">
          <div className="max-w-md mx-auto flex flex-col items-center gap-4 text-center">
            <Icon className="size-14 text-foreground" />
            <h2 className="text-xl font-semibold text-foreground">
              {t(`soulRitual.elements.${revealed}.name`)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t(`soulRitual.elements.${revealed}.description`)}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("soulRitual.result.hint")}
            </p>
          </div>
        </div>
        <AiStepFooter
          onBack={stepBack}
          primaryLabel={t("soulRitual.result.continueButton")}
          onPrimary={() => onComplete(revealed)}
        />
      </div>
    );
  }

  if (!chapter) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <DialogTitle className="sr-only">{t("soulRitual.stepTitle")}</DialogTitle>
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 pt-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="text-center space-y-1">
            <p className="text-xs text-muted-foreground">
              {t("soulRitual.progress", {
                current: chapterIndex + 1,
                total: RITUAL_CHAPTERS.length,
              })}
            </p>
            <h2 className="text-lg font-semibold text-foreground">
              {t(`soulRitual.chapters.${chapter.id}.title`)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t(`soulRitual.chapters.${chapter.id}.question`)}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {chapter.options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => choose(option.element)}
                className={cn(
                  "rounded-xl border border-border/40 bg-secondary px-4 py-4 text-left",
                  "hover:bg-accent transition-colors text-sm text-foreground",
                )}
              >
                {t(`soulRitual.chapters.${chapter.id}.options.${option.id}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <footer className="shrink-0 border-t border-black/[0.06] px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={stepBack}
            className="rounded-full"
          >
            <ArrowLeft className="h-4 w-4" />
            {tCommon("actions.back")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t("soulRitual.progress", {
              current: chapterIndex + 1,
              total: RITUAL_CHAPTERS.length,
            })}
          </p>
        </div>
      </footer>
    </div>
  );
}
