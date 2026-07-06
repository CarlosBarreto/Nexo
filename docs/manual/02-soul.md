# 02 — SOUL Core (Identidad permanente del agente)

> Implementado en **PR #1** (`feat/axie-tier1`).

## Concepto

Cada agente tiene un **SOUL**: una identidad criptográfica generada **una sola vez** al nacer y **nunca modificada** en toda la vida del agente. El SOUL no es configurable por el usuario; es descubierto (mediante el Ritual) o derivado matemáticamente del ID y nombre del agente.

```
AgentSoul {
  id:          "soul_<uuid>"   ← identificador permanente
  born:        "2026-07-04T..."  ← RFC3339, momento de creación
  element:     "fire" | "water" | "earth" | "air"
  originSeed:  "a3f7c2..."    ← huella determinista de nacimiento
}
```

---

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `packages/protocol/src/domain/soul.ts` | Tipos wire: `AgentSoul`, `SoulElement`, `SOUL_ELEMENTS` |
| `packages/domain/src/soul.ts` | Lógica: seed FNV-1a, forja, carga, ensureSoul |
| `packages/host/src/routes/soul.ts` | Rutas REST: GET-only (el SOUL es inmutable, no tiene PUT) |
| `app/src/agents/builtin/axie-archetypes.ts` | 4 arquetipos preconfigurados por elemento |
| `ui/core/src/agent-colors.ts` | Color UI por elemento (`ELEMENT_COLORS`, `resolveElementColor`) |

---

## Seed FNV-1a

El `originSeed` es un hash **FNV-1a de 64 bits** del string `"<agentId>:<agentName>:<bornIso>"`. FNV-1a fue elegido porque:
- Funciona en el browser (no usa `node:crypto`, que no está disponible en `packages/web`).
- Es determinista: misma entrada → mismo seed siempre.
- Es suficientemente distribuido para asignar elementos de forma uniforme.

```typescript
// packages/domain/src/soul.ts
export function soulSeed(input: string): string {
  let hash = 0xcbf29ce484222325n;         // offset basis FNV-1a 64-bit
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn; // mantiene 64 bits
  }
  return hash.toString(16).padStart(16, "0");
}
```

---

## Derivación del elemento desde el seed

Cuando el agente no pasa por el Ritual y no tiene arquetipo asignado, el elemento se deriva automáticamente del seed:

```typescript
export function deriveElement(seed: string): SoulElement {
  const bucket = Number(BigInt(`0x${seed}`) % BigInt(SOUL_ELEMENTS.length));
  return SOUL_ELEMENTS[bucket] ?? "air";
}
// SOUL_ELEMENTS = ["fire", "water", "earth", "air"]
// El módulo 4 distribuye uniformemente; "air" es el fallback de seguridad.
```

---

## Ciclo de vida del SOUL

```
POST /agents (con element opcional)
        │
        ▼
  ensureSoul() en packages/domain/src/soul.ts
        │
        ├─── ¿Ya existe .houston/soul/soul.json?
        │         Sí → retorna el soul existente (inmutable)
        │         No → llama generateSoul()
        │
        ▼
  generateSoul() → escribe soul.json una sola vez
        │
        └─── element = arg explícito (del Ritual/arquetipo)
                     │ o deriveElement(originSeed) si no hay arg
```

Los agentes creados **antes de que existiera el feature** obtienen su SOUL de forma lazy: la primera vez que se accede, `ensureSoul` usa `createdAt` como `bornIso` y deriva el elemento del seed. Esto se llama **lazy-forge**.

---

## API REST del SOUL

| Verbo | Ruta | Descripción |
|-------|------|-------------|
| `GET` | `/v3/workspaces/:ws/agents/:id/soul` | Retorna `AgentSoul` o `null` si no tiene aún |

No existe `PUT /soul`. La inmutabilidad es intencional: el SOUL nunca cambia.

---

## Arquetipos builtin

Los arquetipos son agentes preconfigurados que eliminan el "síndrome de la página en blanco" al crear un agente nuevo.

| Arquetipo | Elemento | Personalidad | Ícono Lucide |
|-----------|----------|-------------|-------------|
| Fire archetype | `fire` | Ejecución, ambición, velocidad | `Flame` |
| Water archetype | `water` | Insight, intuición, paciencia | `Droplets` |
| Earth archetype | `earth` | Confiabilidad, precisión, protección | `Mountain` |
| Air archetype | `air` | Exploración, curiosidad, creatividad | `Wind` |

Definidos en `app/src/agents/builtin/axie-archetypes.ts`. Cada uno tiene un `claudeMd` con instrucciones de sistema que refuerzan la personalidad del elemento.

---

## Color del elemento en UI

`ui/core/src/agent-colors.ts` exporta:

```typescript
export const ELEMENT_COLORS: Record<SoulElement | "system", string> = {
  fire:   "#ef4444",  // rojo
  water:  "#3b82f6",  // azul
  earth:  "#22c55e",  // verde
  air:    "#a855f7",  // morado
  system: "#6b7280",  // gris fallback (solo UI, no toca el enum del protocolo)
};

export function resolveElementColor(element: string | null | undefined): string
export function elementKey(element: string | null | undefined): SoulElement | "system"
```

El color se usa en cards, dots del sidebar y pills en el Bestiario (Tier 3). `"system"` es un fallback UI-only para agentes sin elemento conocido; no existe en el enum `SoulElement` del protocolo.

---

## Invariante de seguridad

El SOUL es **la única verdad de identidad del agente**. Si `soul.json` se corrompe o se borra, `ensureSoul` lo regenera con los mismos parámetros (agentId, agentName, bornIso del `config.json`), por lo que el `originSeed` y el elemento derivado siempre son reproducibles. Sin embargo, si el usuario pasó por el Ritual y eligió un elemento explícito, ese elemento se pierde en una regeneración — el SOUL nuevo tendrá el elemento derivado.
