/**
 * The Ritual of Birth: five narrative chapters, each with one option per
 * element. Answers accumulate invisible points; the dominant element becomes
 * the agent's soul element (see scoring.ts). All copy lives in the shell
 * namespace under `soulRitual.chapters.<chapter>.*` — this file is data only.
 */

export type RitualElement = "fire" | "water" | "earth" | "air";

export const RITUAL_ELEMENTS: RitualElement[] = [
  "fire",
  "water",
  "earth",
  "air",
];

export interface RitualOption {
  id: string;
  element: RitualElement;
}

export interface RitualChapter {
  /** i18n segment: shell:soulRitual.chapters.<id> */
  id: string;
  options: RitualOption[];
}

export const RITUAL_CHAPTERS: RitualChapter[] = [
  {
    id: "awakening",
    options: [
      { id: "act", element: "fire" },
      { id: "listen", element: "water" },
      { id: "secure", element: "earth" },
      { id: "wander", element: "air" },
    ],
  },
  {
    id: "territory",
    options: [
      { id: "forge", element: "fire" },
      { id: "tide", element: "water" },
      { id: "mountain", element: "earth" },
      { id: "sky", element: "air" },
    ],
  },
  {
    id: "bond",
    options: [
      { id: "courage", element: "fire" },
      { id: "empathy", element: "water" },
      { id: "loyalty", element: "earth" },
      { id: "freedom", element: "air" },
    ],
  },
  {
    id: "storm",
    options: [
      { id: "charge", element: "fire" },
      { id: "flow", element: "water" },
      { id: "hold", element: "earth" },
      { id: "dance", element: "air" },
    ],
  },
  {
    id: "manifesto",
    options: [
      { id: "transform", element: "fire" },
      { id: "understand", element: "water" },
      { id: "protect", element: "earth" },
      { id: "explore", element: "air" },
    ],
  },
];
