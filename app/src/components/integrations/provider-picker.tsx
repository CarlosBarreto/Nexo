/**
 * Provider picker.
 *
 * Two pieces:
 *
 * 1. {@link IntegrationsProviderBadge} — a tiny compact pill that lives at
 *    the top of the integrations view, like "Powered by Composio". Tapping
 *    it opens the dialog. Visible at all times so users always know which
 *    backend they're talking to.
 *
 * 2. {@link IntegrationsProviderPicker} — the dialog with two cards
 *    (Composio + Merge). Click a non-active card to switch. Switching is
 *    one API call, then the rest of the integrations UI re-renders against
 *    the new provider automatically (see `useSetIntegrationsProvider`'s
 *    invalidation pattern).
 *
 * Per the no-em-dashes rule the copy uses commas / sentence breaks instead.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronDown,
  Loader2,
  Plug,
  ShieldCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@houston-ai/core";
import type { IntegrationsProviderId } from "@houston-ai/engine-client";
import {
  useActiveIntegrationsProvider,
  useSetIntegrationsProvider,
} from "../../hooks/use-integrations-provider";

interface ProviderMeta {
  id: IntegrationsProviderId;
  /** Translation key under `integrations.picker.providers.<id>`. Looked up via t() with that path. */
  i18nKey: string;
  /** Brand-color accent on the active card. */
  accentClass: string;
}

const PROVIDERS: readonly ProviderMeta[] = [
  {
    id: "composio",
    i18nKey: "composio",
    accentClass: "ring-blue-500/40",
  },
  {
    id: "merge",
    i18nKey: "merge",
    accentClass: "ring-purple-500/40",
  },
];

export function IntegrationsProviderBadge() {
  const { t } = useTranslation("integrations");
  const { data: active, isLoading } = useActiveIntegrationsProvider();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border border-border bg-secondary/40 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        aria-label={t("picker.badgeAria")}
      >
        <Plug className="size-3" />
        <span>
          {isLoading
            ? t("picker.loading")
            : t("picker.poweredBy", { name: active?.displayName ?? "Composio" })}
        </span>
        <ChevronDown className="size-3 text-muted-foreground group-hover:text-foreground transition-colors" />
      </button>
      <IntegrationsProviderPicker open={open} onOpenChange={setOpen} />
    </>
  );
}

interface ProviderPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IntegrationsProviderPicker({
  open,
  onOpenChange,
}: ProviderPickerProps) {
  const { t } = useTranslation("integrations");
  const { data: active } = useActiveIntegrationsProvider();
  const setProvider = useSetIntegrationsProvider();
  const [error, setError] = useState<string | null>(null);

  const activeId = active?.id ?? "composio";

  const cards = useMemo(
    () =>
      PROVIDERS.map((p) => ({
        ...p,
        isActive: p.id === activeId,
      })),
    [activeId],
  );

  async function handleSelect(id: IntegrationsProviderId) {
    if (id === activeId) return;
    setError(null);
    try {
      await setProvider.mutateAsync(id);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("picker.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("picker.dialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 mt-2">
          {cards.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => handleSelect(card.id)}
              disabled={setProvider.isPending}
              className={[
                "group relative rounded-xl border p-4 text-left transition-all",
                card.isActive
                  ? `border-foreground/20 bg-secondary/50 ring-1 ${card.accentClass}`
                  : "border-border bg-background hover:bg-secondary/30",
                "disabled:opacity-60",
              ].join(" ")}
              aria-pressed={card.isActive}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-foreground">
                      {t(`picker.providers.${card.i18nKey}.name`)}
                    </h3>
                    {card.isActive && (
                      <span className="inline-flex items-center gap-1 px-1.5 h-4 rounded-full bg-foreground text-background text-[10px] font-medium">
                        <Check className="size-2.5" />
                        {t("picker.active")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t(`picker.providers.${card.i18nKey}.tagline`)}
                  </p>
                  <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                    <li className="flex items-start gap-1.5">
                      <ShieldCheck className="size-3 mt-0.5 flex-shrink-0 text-muted-foreground/70" />
                      {t(`picker.providers.${card.i18nKey}.bullet1`)}
                    </li>
                    <li className="flex items-start gap-1.5">
                      <ShieldCheck className="size-3 mt-0.5 flex-shrink-0 text-muted-foreground/70" />
                      {t(`picker.providers.${card.i18nKey}.bullet2`)}
                    </li>
                  </ul>
                </div>
                {setProvider.isPending && setProvider.variables === card.id && (
                  <Loader2 className="size-4 animate-spin text-muted-foreground flex-shrink-0" />
                )}
              </div>
            </button>
          ))}
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 rounded-md px-2.5 py-1.5 mt-2">
            {error}
          </p>
        )}

        <p className="text-[11px] text-muted-foreground mt-2">
          {t("picker.footerNote")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
