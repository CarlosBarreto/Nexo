import { AgentGallery, type AgentGalleryItem } from "@nexo-ai/agent";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  resolveAgentColor,
} from "@nexo-ai/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSouls } from "../../hooks/queries/use-souls";
import { useAgentCatalogStore } from "../../stores/agent-catalog";
import { useAgentStore } from "../../stores/agents";
import { useUIStore } from "../../stores/ui";

/**
 * The Bestiario: a gallery of the workspace's agents with their soul
 * identity (element, birth date). Souls are read files-first (works on both
 * engines); an agent without a forged soul renders the "unforged" state and
 * falls back to its createdAt for the birth line.
 */
export function BestiaryDialog() {
  const { t, i18n } = useTranslation("shell");
  const open = useUIStore((s) => s.bestiaryOpen);
  const setOpen = useUIStore((s) => s.setBestiaryOpen);
  const agents = useAgentStore((s) => s.agents);
  const setCurrent = useAgentStore((s) => s.setCurrent);
  const getConfig = useAgentCatalogStore((s) => s.getById);
  const souls = useSouls(agents);

  const items = useMemo<AgentGalleryItem[]>(() => {
    const born = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" });
    return agents.map((agent) => {
      const soul = souls[agent.id];
      const bornIso = soul?.born ?? agent.createdAt;
      let bornLabel: string | null = null;
      if (bornIso) {
        const date = new Date(bornIso);
        if (!Number.isNaN(date.getTime())) bornLabel = born.format(date);
      }
      return {
        id: agent.id,
        name: agent.name,
        color: resolveAgentColor(agent.color),
        description: getConfig(agent.configId)?.config.description,
        element: soul?.element ?? null,
        bornLabel,
      };
    });
  }, [agents, souls, getConfig, i18n.language]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[900px] max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("bestiary.title")}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {t("bestiary.subtitle")}
          </p>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto pt-2">
          <AgentGallery
            items={items}
            onSelect={(id) => {
              const agent = agents.find((a) => a.id === id);
              if (agent) {
                setCurrent(agent);
                setOpen(false);
              }
            }}
            labels={{
              born: t("bestiary.born"),
              unforged: t("bestiary.unforged"),
              elements: {
                fire: t("soulRitual.elements.fire.name"),
                water: t("soulRitual.elements.water.name"),
                earth: t("soulRitual.elements.earth.name"),
                air: t("soulRitual.elements.air.name"),
              },
            }}
            emptyTitle={t("bestiary.emptyTitle")}
            emptyDescription={t("bestiary.emptyDescription")}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
