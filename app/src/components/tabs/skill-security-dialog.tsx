import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@houston-ai/core";
import type { SkillSecurityReport } from "@houston-ai/engine-client";

interface SkillSecurityDialogProps {
  /** The flagged skill + its scan report, or null when no gate is pending. */
  gate: { skillName: string; report: SkillSecurityReport } | null;
  /** Called with the user's choice: true = install anyway, false = cancel. */
  onResolve: (proceed: boolean) => void;
}

/**
 * Gate-with-override confirm shown when a pre-install security scan flags a
 * skill. The copy is severity-aware and deliberately non-technical (no rule
 * ids, file paths, or raw category jargon) — Houston's users are founders,
 * not security engineers. `do_not_install` reads as a strong warning with a
 * destructive confirm; `caution` is a softer "double-check this".
 */
export function SkillSecurityDialog({ gate, onResolve }: SkillSecurityDialogProps) {
  const { t } = useTranslation("skills");
  const blocking = gate?.report.recommendation === "do_not_install";
  const count = gate?.report.findings.length ?? 0;
  const name = gate?.skillName ?? "";

  const title = blocking
    ? t("security.doNotInstall.title")
    : t("security.caution.title");
  const description = blocking
    ? t("security.doNotInstall.description", { name, count })
    : t("security.caution.description", { name, count });

  return (
    <ConfirmDialog
      open={!!gate}
      onOpenChange={(open) => {
        if (!open) onResolve(false);
      }}
      title={title}
      description={description}
      confirmLabel={t("security.installAnyway")}
      cancelLabel={t("security.cancel")}
      variant={blocking ? "destructive" : "default"}
      onConfirm={() => onResolve(true)}
    />
  );
}
