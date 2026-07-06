# 04 — Ritual de Nacimiento

> Implementado en **PR #2** (`feat/axie-tier2`).

## Concepto

En lugar de pedirle al usuario que "elija un elemento", el Ritual de Nacimiento lo lleva a través de **5 capítulos narrativos**. Cada capítulo presenta una situación del mundo de Lunaria con 4 opciones, una por elemento. El usuario elige inconscientemente: al final, el scoring determinista revela el elemento que el agente "ya tenía" desde siempre.

Este enfoque narrativo crea **apego emocional**: el usuario no configuró un agente, lo descubrió.

---

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `app/src/components/shell/soul-ritual/chapters.ts` | Estructura de los 5 capítulos y sus opciones |
| `app/src/components/shell/soul-ritual/scoring.ts` | Algoritmo de puntuación determinista |
| `app/src/components/shell/soul-ritual/soul-ritual-step.tsx` | UI del wizard (React) |
| `app/src/locales/*/shell.json` | Textos del ritual (en/es/pt) bajo la clave `soulRitual.*` |

---

## Los 5 capítulos

```typescript
// chapters.ts
export const RITUAL_CHAPTERS: RitualChapter[] = [
  { id: "awakening", ... },  // ¿Cómo despiertas?
  { id: "territory", ... },  // ¿Dónde vives en Lunaria?
  { id: "bond",      ... },  // ¿Qué valor defiendes?
  { id: "storm",     ... },  // ¿Cómo afrontas la crisis?
  { id: "manifesto", ... },  // ¿Cuál es tu propósito?  ← PESA x2
];
```

Cada capítulo tiene exactamente 4 opciones, una por elemento:

| Capítulo | fire | water | earth | air |
|----------|------|-------|-------|-----|
| awakening | act | listen | secure | wander |
| territory | forge | tide | mountain | sky |
| bond | courage | empathy | loyalty | freedom |
| storm | charge | flow | hold | dance |
| manifesto | transform | understand | protect | explore |

Los IDs de opción se usan como claves i18n: `shell:soulRitual.chapters.<chapterId>.options.<optionId>`.

---

## Algoritmo de scoring

```typescript
// scoring.ts
export function scoreRitual(answers: RitualElement[]): RitualElement {
  if (answers.length === 0) return "air";

  const points = new Map<RitualElement, number>();
  const last = answers.length - 1;

  for (const [i, element] of answers.entries()) {
    // El último capítulo (manifesto) pesa 2 puntos; los demás 1
    points.set(element, (points.get(element) ?? 0) + (i === last ? 2 : 1));
  }

  const top = Math.max(...points.values());
  const tied = RITUAL_ELEMENTS.filter((e) => points.get(e) === top);

  // Desempate: favorece el elemento del manifesto (capítulo final)
  const manifesto = answers[last];
  if (manifesto && tied.includes(manifesto)) return manifesto;

  // Segundo desempate: orden fijo del array SOUL_ELEMENTS
  return tied[0] ?? "air";
}
```

**Ejemplo:**

| Capítulo | Elección | Puntos acumulados |
|----------|----------|-----------------|
| awakening | fire | fire:1 |
| territory | water | water:1 |
| bond | fire | fire:2 |
| storm | earth | earth:1 |
| manifesto | fire | fire:4 (x2) |

Resultado: **fire** con 4 puntos.

El scoring es **100% determinista**: mismas respuestas → mismo elemento siempre.

---

## Flujo UI

```
AgentPickerDialog
  └── SoulRitualStep  (soul-ritual-step.tsx)
        │
        ├── estado: answers: RitualElement[]
        ├── estado: revealed: RitualElement | null
        │
        ├── [chapters 0..4] → usuario elige → choose(element)
        │       Si answers.length === 5 → revealed = scoreRitual(answers)
        │
        └── [reveal screen] → usuario confirma
              └── onComplete(element) → POST /agents con element
```

La card del resultado muestra:
- Ícono grande del elemento (Flame/Droplets/Mountain/Wind de Lucide).
- Nombre narrativo del elemento (vía i18n `shell:soulRitual.elements.<element>.name`).
- Descripción del arquetipo (p.ej. "Ejecución primero. Ambicioso, veloz, catalizador.").

---

## Cómo el elemento viaja al servidor

Cuando el usuario confirma su elemento en el ritual:

```
1. SoulRitualStep → onComplete(element: RitualElement)
2. AgentPickerDialog → form state: element
3. POST /v3/agents
   Body: { ..., element: "fire" }
4. Host → ensureSoul(store, root, { ..., element: "fire" })
5. soul.json escrito: { ..., element: "fire" }
```

El flujo pasa por el **Tauri event bridge** en `app/src/components/shell/agent-picker-dialog.tsx`, que incluye el elemento en el body de creación. En el store del pi runtime, el elemento queda grabado en `soul.json` de forma permanente.

---

## i18n del ritual

Todos los textos están en las 3 lenguas bajo `app/src/locales/<lang>/shell.json`, clave `soulRitual`:

```json
{
  "soulRitual": {
    "stepTitle": "Ritual de Nacimiento",
    "chapters": {
      "awakening": {
        "prompt": "Lunaria despierta. ¿Cuál es tu primer impulso?",
        "options": {
          "act":    "Actuar de inmediato",
          "listen": "Escuchar el viento",
          "secure": "Asegurar el entorno",
          "wander": "Explorar sin rumbo"
        }
      }
      ...
    },
    "elements": {
      "fire":  { "name": "Fuego",  "desc": "Ejecución, ambición, transformación." },
      "water": { "name": "Agua",   "desc": "Intuición, armonía, profundidad." },
      "earth": { "name": "Tierra", "desc": "Permanencia, sabiduría, protección." },
      "air":   { "name": "Aire",   "desc": "Libertad, curiosidad, caos creativo." }
    }
  }
}
```

---

## Card "crystal-ball" en el picker

Antes del ritual, en el selector de agente hay una card especial de tipo `"crystal-ball"` que invita al usuario a descubrir el elemento de su agente. Al hacer clic, abre `SoulRitualStep` en lugar de ir directamente a la configuración.
