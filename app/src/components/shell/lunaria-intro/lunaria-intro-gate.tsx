import { type ReactNode, useState } from "react";
import { LunariaArcadeIntro } from "./lunaria-arcade-intro";
import { hasSeenLunariaIntro, markLunariaIntroSeen } from "./state";

/**
 * First-run gate for the Lunaria arcade intro. On the very first server start
 * it takes over the whole screen with the pixel-art creation-myth splash; once
 * the guardian presses start it records the flag and hands control back to the
 * normal gate chain (connection -> engine -> language -> disclaimer -> app),
 * which by then has almost always finished the engine handshake underneath.
 *
 * Mounted as the OUTERMOST gate so the lore is the first thing a new user sees.
 * The engine boots in parallel regardless of what renders, so decoupling the
 * intro from the raw handshake timing never delays startup.
 */
export function LunariaIntroGate({ children }: { children: ReactNode }) {
  const [showIntro, setShowIntro] = useState(() => !hasSeenLunariaIntro());

  if (!showIntro) return <>{children}</>;

  return (
    <LunariaArcadeIntro
      onEnter={() => {
        markLunariaIntroSeen();
        setShowIntro(false);
      }}
    />
  );
}
