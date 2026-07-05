import type { ReactNode } from "react";
import { NexoLogo } from "./experience-card";

/**
 * Shared Lunaria loading splash: the sky-tinted Nexo mark above a muted
 * message, on the app background. Used by the engine-starting gate and the
 * App-level auth/data loading states so every "waking up" screen reads as one
 * branded moment instead of a bare line of grey text. Token-driven, so it
 * inherits the Lunaria theme (and both light/dark) for free.
 */
export function LoadingSplash({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-5 bg-background px-6 text-center text-foreground">
      <NexoLogo
        size={44}
        className="animate-pulse text-primary motion-reduce:animate-none"
      />
      <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
        {children}
      </p>
    </div>
  );
}
