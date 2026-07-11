/** Agent color definitions, each with light and dark variants. */
export interface AgentColor {
  id: string;
  light: string;
  dark: string;
}

export const AGENT_COLORS: AgentColor[] = [
  { id: "charcoal", light: "#1a1a1a", dark: "#d4d4d4" },
  { id: "forest", light: "#1b6b3a", dark: "#4ade80" },
  { id: "navy", light: "#1e4d8c", dark: "#60a5fa" },
  { id: "purple", light: "#5b21b6", dark: "#a78bfa" },
  { id: "crimson", light: "#a3261a", dark: "#f87171" },
  { id: "orange", light: "#b45309", dark: "#fb923c" },
  { id: "golden", light: "#a16207", dark: "#fbbf24" },
];

export function resolveAgentColor(stored: string | undefined): string {
  if (!stored) return currentDefault();
  const entry = AGENT_COLORS.find(
    (c) => c.id === stored || c.light === stored || c.dark === stored,
  );
  if (entry) return colorHex(entry);
  return stored;
}

/**
 * Resolve a stored color value (id, light hex, or dark hex) to its canonical
 * palette id, defaulting to the first color when nothing matches. Used to mark
 * the active swatch in color pickers.
 */
export function agentColorId(stored: string | undefined): string {
  const match = AGENT_COLORS.find(
    (entry) =>
      entry.id === stored || entry.light === stored || entry.dark === stored,
  );
  return match?.id ?? AGENT_COLORS[0].id;
}

export function colorHex(color: AgentColor): string {
  return isDark() ? color.dark : color.light;
}

/**
 * Axie element visual identity — the ONE source for the elemental palette used
 * by the Lunaria skin (sidebar dots, board tokens, pills, running glow). The
 * four canonical soul elements (fire/water/earth/air) plus a UI-only `system`
 * fallback for agents with no forged element (the design's "Sistema" tone). The
 * hexes come from the Axie Lunaria design system; keep them in step with the
 * `--el-*` CSS vars in `app/src/styles/lunaria.css`.
 */
export type ElementKey = "fire" | "water" | "earth" | "air" | "system";

export const ELEMENT_COLORS: Record<ElementKey, AgentColor> = {
  fire: { id: "fire", light: "#f08b3e", dark: "#f5a862" },
  water: { id: "water", light: "#41c3c6", dark: "#5fd4d7" },
  earth: { id: "earth", light: "#2f8a58", dark: "#4fb57c" },
  air: { id: "air", light: "#d8c16a", dark: "#e6d488" },
  system: { id: "system", light: "#259df4", dark: "#5cb8f7" },
};

/** Normalize any stored/unknown element to a known key (`system` = fallback). */
export function elementKey(element: string | undefined): ElementKey {
  return element && element in ELEMENT_COLORS
    ? (element as ElementKey)
    : "system";
}

/** The theme-correct hex for an element, defaulting to `system` when unknown. */
export function resolveElementColor(element: string | undefined): string {
  return colorHex(ELEMENT_COLORS[elementKey(element)]);
}

/**
 * The agent's identity colour: its forged soul element when it has one, else its
 * user-picked palette colour. This is the Lunaria "element with a colour
 * fallback" rule — agents without a soul (legacy engine, or pre-soul v3) keep
 * the colour the user chose instead of collapsing to the `system` blue.
 */
export function resolveIdentityColor(
  element: string | undefined,
  storedColor: string | undefined,
): string {
  return element
    ? resolveElementColor(element)
    : resolveAgentColor(storedColor);
}

function isDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-theme") === "dark";
}

function currentDefault(): string {
  return colorHex(AGENT_COLORS[0]);
}
