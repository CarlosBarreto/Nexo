import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isEngineReady, whenEngineReady } from "../../../lib/engine";
import "./lunaria-intro.css";

/**
 * Deterministic pixel starfield. Fixed percentage coordinates (no Math.random)
 * so the sky never reflows between renders; `d` staggers each star's twinkle.
 */
const STARS: ReadonlyArray<{
  top: string;
  left: string;
  size: number;
  d: string;
}> = [
  { top: "10%", left: "8%", size: 2, d: "0s" },
  { top: "16%", left: "22%", size: 3, d: "0.6s" },
  { top: "9%", left: "37%", size: 2, d: "1.2s" },
  { top: "22%", left: "52%", size: 2, d: "0.3s" },
  { top: "7%", left: "66%", size: 3, d: "0.9s" },
  { top: "19%", left: "83%", size: 2, d: "1.5s" },
  { top: "31%", left: "13%", size: 2, d: "1.1s" },
  { top: "38%", left: "29%", size: 2, d: "0.4s" },
  { top: "44%", left: "6%", size: 3, d: "1.8s" },
  { top: "28%", left: "72%", size: 2, d: "0.7s" },
  { top: "36%", left: "90%", size: 2, d: "1.3s" },
  { top: "52%", left: "18%", size: 2, d: "0.2s" },
  { top: "63%", left: "9%", size: 3, d: "1.6s" },
  { top: "58%", left: "88%", size: 2, d: "0.5s" },
  { top: "69%", left: "77%", size: 2, d: "1.0s" },
  { top: "74%", left: "31%", size: 2, d: "1.4s" },
  { top: "81%", left: "62%", size: 3, d: "0.8s" },
  { top: "86%", left: "15%", size: 2, d: "1.7s" },
];

/**
 * Full-screen pixel-art arcade splash that plays the Lunaria creation myth on
 * the first server start. Non-interactive: any key or click enters. It runs at
 * its own pace, decoupled from the engine handshake. If the engine is not ready
 * yet when the guardian enters, it flips to a "waking Lunaria" state and enters
 * automatically once the handshake lands, so we never flash the plain loader.
 */
export function LunariaArcadeIntro({ onEnter }: { onEnter: () => void }) {
  const { t } = useTranslation("lunaria");
  const [booting, setBooting] = useState(false);
  const enteredRef = useRef(false);
  const ctaRef = useRef<HTMLButtonElement>(null);

  const enter = useCallback(() => {
    if (enteredRef.current) return;
    enteredRef.current = true;
    if (isEngineReady()) {
      onEnter();
      return;
    }
    setBooting(true);
    void whenEngineReady().then(onEnter);
  }, [onEnter]);

  useEffect(() => {
    ctaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Let Tab keep moving focus; every other key enters.
      if (e.key === "Tab") return;
      enter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enter]);

  const loreRaw = t("intro.lore", { returnObjects: true });
  const lore = Array.isArray(loreRaw) ? (loreRaw as string[]) : [];

  return (
    <div
      className="lunaria-intro"
      role="dialog"
      aria-label={t("intro.ariaLabel")}
    >
      {/* Full-screen pointer affordance: click anywhere enters. A real button
          (keyboard-accessible by nature) so there is no click-without-key gap,
          but hidden from the a11y tree since the focused START button and the
          global any-key listener already serve keyboard and screen readers. */}
      <button
        type="button"
        className="lunaria-intro__backdrop"
        aria-hidden="true"
        tabIndex={-1}
        onClick={enter}
      />
      <div className="lunaria-intro__sky" aria-hidden="true">
        <div className="lunaria-moon" />
        {STARS.map((s) => (
          <span
            key={`${s.top}-${s.left}`}
            className="lunaria-star"
            style={{
              top: s.top,
              left: s.left,
              width: s.size,
              height: s.size,
              animationDelay: s.d,
            }}
          />
        ))}
      </div>

      <div className="lunaria-intro__content">
        <div className="lunaria-intro__eyebrow">{t("intro.eyebrow")}</div>
        <h1 className="lunaria-intro__title">{t("intro.title")}</h1>
        <div className="lunaria-intro__bar" aria-hidden="true" />

        <div className="lunaria-intro__lore">
          {lore.map((line, i) => (
            <p
              key={line}
              className="lunaria-intro__line"
              style={{ animationDelay: `${0.3 + i * 0.5}s` }}
            >
              {line}
            </p>
          ))}
        </div>

        {booting ? (
          <div className="lunaria-intro__booting" aria-live="polite">
            {t("intro.booting")}
          </div>
        ) : (
          <>
            <button
              ref={ctaRef}
              type="button"
              className="lunaria-intro__cta"
              onClick={enter}
            >
              {t("intro.pressStart")}
            </button>
            <div className="lunaria-intro__hint">{t("intro.hint")}</div>
          </>
        )}
      </div>
    </div>
  );
}
