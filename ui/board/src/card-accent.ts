/**
 * CSS custom-property overrides that retint the running-comet glow to an
 * identity accent colour (e.g. a Lunaria soul element). Returns an empty object
 * when there is nothing to override, so a card only carries a `style` attribute
 * when it actually needs one.
 *
 * The five `--glow-c*` stops mirror `.card-running-glow` in `@nexo-ai/core`'s
 * globals.css: a faint leading edge, the accent core (twice), and two lightened
 * trailing stops so the sweep reads as a single hue instead of the default brand
 * blue -> indigo -> orange -> yellow. Only a running card gets the retint — the
 * glow is a "still working" signal, so a resting card has no comet to colour.
 */
export function accentGlowVars(
  accent: string | undefined,
  isRunning: boolean,
): Record<string, string> {
  if (!accent || !isRunning) return {};
  return {
    "--glow-c1": `color-mix(in srgb, ${accent} 18%, transparent)`,
    "--glow-c2": accent,
    "--glow-c3": `color-mix(in srgb, ${accent} 70%, #fff)`,
    "--glow-c4": accent,
    "--glow-c5": `color-mix(in srgb, ${accent} 60%, #fff)`,
  };
}
