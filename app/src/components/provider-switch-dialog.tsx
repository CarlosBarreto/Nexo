import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@houston-ai/core";
import { Sparkles } from "lucide-react";

interface ProviderSwitchDialogProps {
  open: boolean;
  /** Display name of the provider being switched TO. */
  providerName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Consent dialog shown when switching a conversation to a provider whose
 * context window is too small to hold the whole conversation. Carrying it over
 * then means summarizing the conversation so far — lossy, and it spends tokens
 * on the summary — so we ask first. When the conversation already fits the new
 * provider there is no dialog: the full conversation is carried over verbatim
 * (decision in `use-agent-chat-panel`).
 */
export function ProviderSwitchDialog({
  open,
  providerName,
  onConfirm,
  onCancel,
}: ProviderSwitchDialogProps) {
  const { t } = useTranslation("chat");
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Sparkles className="size-5" />
            </span>
            <div>
              <DialogTitle>
                {t("providerSwitch.dialogTitle", { provider: providerName })}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {t("providerSwitch.dialogBody", { provider: providerName })}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {t("providerSwitch.cancel")}
          </Button>
          <Button onClick={onConfirm}>{t("providerSwitch.confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
