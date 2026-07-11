import { RITUAL_ELEMENTS, type RitualElement } from "./chapters.ts";

/**
 * Tally the ritual: every answer scores 1 point for its element, except the
 * final chapter (the Soul's Manifesto) which scores 2 — purpose weighs more
 * than instinct. Ties break toward the manifesto's element, then by the
 * fixed element order, so the outcome is fully deterministic.
 */
export function scoreRitual(answers: RitualElement[]): RitualElement {
  if (answers.length === 0) return "air";
  const points = new Map<RitualElement, number>();
  const last = answers.length - 1;
  for (const [i, element] of answers.entries()) {
    points.set(element, (points.get(element) ?? 0) + (i === last ? 2 : 1));
  }
  const top = Math.max(...points.values());
  const tied = RITUAL_ELEMENTS.filter((e) => points.get(e) === top);
  const manifesto = answers[last];
  if (manifesto && tied.includes(manifesto)) return manifesto;
  return tied[0] ?? "air";
}
