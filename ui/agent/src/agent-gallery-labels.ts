/** Mirrors SOUL_ELEMENTS in packages/protocol/src/domain/soul.ts — ui/ stays protocol-free by design. */
export type GalleryElement = "fire" | "water" | "earth" | "air";

export interface AgentGalleryLabels {
  born?: string;
  unforged?: string;
  elements?: Partial<Record<GalleryElement, string>>;
}

export type MergedGalleryLabels = Required<
  Omit<AgentGalleryLabels, "elements">
> & {
  elements: Record<GalleryElement, string>;
};

const DEFAULT_LABELS: MergedGalleryLabels = {
  born: "Born",
  unforged: "Unforged",
  elements: { fire: "Fire", water: "Water", earth: "Earth", air: "Air" },
};

/** Consumer labels merge over English defaults (per-element too). */
export function mergeGalleryLabels(
  labels?: AgentGalleryLabels,
): MergedGalleryLabels {
  return {
    ...DEFAULT_LABELS,
    ...labels,
    elements: { ...DEFAULT_LABELS.elements, ...labels?.elements },
  };
}
