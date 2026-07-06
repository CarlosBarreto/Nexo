# 07 — Tropicalización Lunaria (UI)

> Implementado en **PR #4** (`feat/lunaria-tropicalization`) + **PR #5** (`feat/lunaria-arcade-intro`).

## Concepto

"Lunaria" es el universo narrativo del ecosistema Axie. La tropicalización es una **capa de diseño reversible** sobre Houston que:

1. Cambia la paleta de colores al azul-cielo Lunaria (`#259df4`).
2. Renombra los conceptos de la UI al vocabulario del universo Lunaria.
3. Agrega una intro arcade pixel-art que presenta el mito de creación en el primer arranque.

La tropicalización **no toca el sistema de diseño base** de Houston: es una capa adicional que puede revertirse borrando `lunaria.css` de los imports.

---

## Tokens CSS (`app/src/styles/lunaria.css`)

Importado DESPUÉS de `futuristic.css` para tener mayor especificidad. Define:

```css
/* Color primario — azul-cielo Lunaria */
--ht-primary: #259df4;

/* Paleta elemental */
--el-fire:   #ef4444;   /* rojo     */
--el-water:  #3b82f6;   /* azul     */
--el-earth:  #22c55e;   /* verde    */
--el-air:    #a855f7;   /* morado   */
--el-sys:    #6b7280;   /* gris (fallback) */

/* Overrides de componentes Houston */
/* El botón primario de futuristic.css era gris hardcoded → override aquí */
/* Fondo radial sky (solo light mode) */
/* Cards más redondas */
```

Los tokens `--ht-*` fluyen a Tailwind vía la directiva `@theme` en `ui/core/src/globals.css`, que mapea `--ht-primary` → `--color-primary`. Tailwind recoge `--color-*` automáticamente.

### Cómo usar los tokens elementales en un componente

```tsx
// En CSS
.card[data-element="fire"]  { border-color: var(--el-fire); }
.card[data-element="water"] { border-color: var(--el-water); }

// En inline styles (cuando el elemento viene como prop)
import { resolveElementColor } from "@houston-ai/core";
<div style={{ borderColor: resolveElementColor(agent.soul?.element) }} />
```

---

## Narrativa localizada en/es/pt

### Renombrado de conceptos

| Houston original | Lunaria |
|-----------------|---------|
| Houston | Nexo (window title, sidebar title) |
| Mission Control | Nexo (board) |
| My workspace | Mi Santuario |
| Agents | Tus Axies |
| Active missions | En Curso |
| Awaiting review | Requiere Guardián |
| Completed | Completado |

Los textos viven en `app/src/locales/<lang>/<namespace>.json`. Los namespaces afectados:
- `shell.json` → sidebar, titles
- `dashboard.json` → columnas del board, toolbar

### Subtítulo dinámico en el toolbar

```tsx
// mission-control-toolbar.tsx
// "N hilos vivos en Lunaria ahora mismo"
const count = useActiveThreadCount(); // conteo real de agentes activos
t("toolbar.subtitle", { count })
```

El conteo es reactivo: se actualiza vía TanStack Query cuando llega un `HoustonEvent` de cambio de estado de agente.

---

## Intro arcade pixel-art (PR #5)

### Propósito

En el **primer arranque** del servidor, en lugar del loader gris de Houston, el usuario ve una pantalla completa de pixel-art estilo arcade con el mito de creación de Lunaria. Es el diferenciador visual del fork.

### Archivos

| Archivo | Descripción |
|---------|-------------|
| `app/src/components/shell/lunaria-intro/state.ts` | Flag de localStorage (`houston.lunaria.introSeen`) |
| `app/src/components/shell/lunaria-intro/lunaria-intro-gate.tsx` | Gate React (wrapper) |
| `app/src/components/shell/lunaria-intro/lunaria-arcade-intro.tsx` | Componente principal de la intro |
| `app/src/components/shell/lunaria-intro/lunaria-intro.css` | Estilos pixel-art (281 líneas) |
| `app/src/assets/fonts/pixelify-sans-latin-400.woff2` | Fuente arcade auto-hospedada |
| `app/src/assets/fonts/pixelify-sans-latin-700.woff2` | Bold variant |
| `app/src/locales/*/lunaria.json` | Lore y copy de la intro (en/es/pt) |

### Diseño visual

```
┌─────────────────────────────────────┐  ← negro fondo
│    ✦   ✦       ✦                   │  ← estrellas deterministas
│         🌙 LUNARIA 🌙              │  ← luna CSS pixel art
│ ─────────────────────────────────  │  ← separador
│   CREATION MYTH                    │  ← eyebrow (pequeño)
│                                    │
│  Before the world there was...     │  ← lore aparece línea a línea
│  Four forces met: Fire, Water...   │     con animación escalonada
│  From their balance...             │     delay 0.3s × i
│  On it the first Axies awoke...    │
│  Every birth is an echo...         │
│                                    │
│  [PRESS START]  ← parpadea a 1s   │  ← botón CTA (autofocused)
│  press any key to enter            │  ← hint
│                                    │
│ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  │  ← scanlines + vignette CRT (::after)
└─────────────────────────────────────┘
```

### Barra elemental

Debajo del separador hay una barra horizontal de 4 colores:

```css
.lunaria-intro__bar {
  background: linear-gradient(
    to right,
    var(--el-fire)  0   25%,
    var(--el-water) 25% 50%,
    var(--el-earth) 50% 75%,
    var(--el-air)   75% 100%
  );
}
```

### Luna en CSS puro

La luna es pixel-art pura sin imágenes:

```css
.lunaria-moon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #fffde7, #ffd54f 60%, #f57f17);
}
.lunaria-moon::before { /* cráter grande */ }
.lunaria-moon::after  { /* cráter pequeño */ }
```

### Fuente: Pixelify Sans

`Press Start 2P` (la fuente arcade clásica) no cubre caracteres latinos con tildes (á, é, í, ó, ú, ñ, ç, ã, õ). Se eligió **Pixelify Sans** por su aspecto pixel-art y cobertura completa del alfabeto latino extendido.

- Auto-hospedada en `app/src/assets/fonts/` (woff2 subset latin).
- ~7.7 KB para 400, ~7.9 KB para 700.
- Sin requests externos: funciona offline en el escritorio Tauri.

### Estrellas deterministas

```typescript
const STARS: ReadonlyArray<{top, left, size, d}> = [
  { top: "10%", left: "8%",  size: 2, d: "0s" },
  { top: "16%", left: "22%", size: 3, d: "0.6s" },
  // ... 16 más con coordenadas fijas
];
```

Las coordenadas están hardcodeadas (no `Math.random()`) para que la intro sea idéntica en cada render y nunca pierda frames por reflow.

### Accesibilidad

- `role="dialog"` en el contenedor principal con `aria-label`.
- Botón backdrop `aria-hidden="true" tabIndex={-1}` para el click-anywhere.
- `pointer-events: none` en `.lunaria-intro__content` para que los clicks atraviesen al backdrop.
- `pointer-events: auto` restaurado solo en `.lunaria-intro__cta`.
- El CTA se autofocusa al montar (via `ref + ctaRef.current?.focus()`).
- `keydown` global captura cualquier tecla excepto Tab.
- `@media (prefers-reduced-motion: reduce)` desactiva todas las animaciones.

---

## Namespace i18n `lunaria`

Registrado en `app/src/lib/i18n.ts` y tipado en `app/src/types/react-i18next.d.ts`:

```json
{
  "intro": {
    "eyebrow":   "Creation Myth",
    "title":     "LUNARIA",
    "lore":      ["Before...", "Four forces...", "From...", "On it...", "Every birth..."],
    "pressStart":"PRESS START",
    "hint":      "press any key to enter",
    "booting":   "WAKING LUNARIA...",
    "ariaLabel": "Lunaria intro. Press start to enter Nexo."
  }
}
```

El lore está tomado **verbatim** del website de Axie (`600_06_Axies/apps/axies_website/frontend/src/pages/myth.astro` + `content/lore/Chapter_01.md`), condensado a 5 líneas.

---

## Lunaria v2 (diferido)

La v2 debería mostrar dot/pill/glow del elemento en cada card del board y en el sidebar. Está diferida porque requiere:

1. Que `useSouls()` enrute el elemento al `KanbanItem.metadata.element`.
2. Decisión de producto: ¿elemento de la soul vs. color configurado por el usuario?
3. Agregar claves i18n `dashboard:elements.*` + `board:cardActions.reviewDecide`.

Las claves elementales ya están en `check-locales` como faltantes (parte del baseline de 39 que existía antes del PR #4). No aumentaron con la tropicalización actual.
