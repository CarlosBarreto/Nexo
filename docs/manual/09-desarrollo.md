# 09 — Guía de Desarrollo

## Prerequisitos

```
Node.js 20+ (LTS)
pnpm 9+
Rust toolchain (rustup + cargo)
Bun (para compilar el sidecar TS)
```

En Windows: Visual Studio Build Tools 2022 (para el target MSVC).

---

## Comandos del día a día

### Desarrollo desktop

```bash
# Arrancar en modo dev (hot-reload frontend + motor sidecar)
cd app
pnpm tauri dev
```

**Importante:** Si desde el último dev se modificó algo en `engine/` (Rust), recompilar el sidecar primero:

```bash
cargo build -p houston-engine-server
# Luego sí: pnpm tauri dev
```

Síntoma de sidecar viejo: 404 en rutas que existen en el código actual, eventos faltantes, mismatches de schema.

### Tests

```bash
# Todos los tests del monorepo
pnpm test

# App únicamente (runner Node nativo)
cd app
node --experimental-strip-types --test tests/*.test.ts

# Tests del dominio
pnpm --filter @houston/domain test

# Tests del host
pnpm --filter @houston/host test

# Typecheck completo (los 20 proyectos)
pnpm -r typecheck

# Typecheck del app específicamente
cd app && pnpm tsgo --noEmit
```

**Nota:** `parent-watchdog.process.test.ts` (HOU-582) y `fs-guard.test.ts` fallan siempre en Windows. Son pre-existentes, no producidos por las features Axie. Ignorar.

### Linting y formateo

```bash
# Biome: linting + formateo automático (OBLIGATORIO tras cada cambio)
pnpm check:fix

# Verificar sin modificar
pnpm check

# i18n: verificar claves faltantes, em-dashes, parity entre langs
cd app && pnpm check-locales

# Boundaries: verificar que host-cloud no sea importado por host
pnpm check:boundaries
```

### Build de producción

```bash
# Desktop MSI (Windows, necesita host Windows o xwin SDK)
cd app && pnpm tauri build --target x86_64-pc-windows-msvc

# Desktop .app (macOS)
cd app && pnpm tauri build

# Web package
pnpm --filter houston-web build
```

---

## Estructura de branches y PRs

```
main  (protegida, PRs únicamente)
  ├── feat/axie-tier1  → PR #1 (merged → main)
  ├── feat/axie-tier2  → PR #2 (base: feat/axie-tier1)
  ├── feat/axie-tier3  → PR #3 (base: feat/axie-tier2)
  ├── feat/lunaria-tropicalization → PR #4 (base: feat/axie-tier3)
  └── feat/lunaria-arcade-intro   → PR #5 (base: feat/lunaria-tropicalization)
```

Los PRs están **apilados**. El orden de merge es obligatorio: #1 → #2 → #3 → #4 → #5.

### Git en este proyecto

```bash
# Siempre verificar la rama actual antes de commitear
git branch --show-current

# Nunca git add -A (EOL churn: ~1100 archivos fantasma en Windows)
# Siempre stagear archivos específicos
git add app/src/components/shell/lunaria-intro/state.ts
git add app/src/locales/en/lunaria.json

# Commit convencional
git commit -m "feat(app): descripción concisa"
# El pre-commit hook corre automáticamente:
# 1. lint-staged (biome --write en archivos staged)
# 2. pnpm -r typecheck (los 20 proyectos — tarda ~60s)
```

### Pre-commit hook

El hook en `.husky/pre-commit` ejecuta:
1. `lint-staged` → Biome `--write` sobre los archivos staged.
2. `pnpm -r typecheck` → typecheck de los 20 proyectos.

Si el hook falla, el commit NO ocurre. Corregir el error y hacer un commit nuevo (nunca `--amend` sobre un commit anterior que sí existía).

---

## Convenciones de código

### Límite de líneas por archivo

| Tipo | Límite |
|------|--------|
| TypeScript / TSX | 200 líneas (excluyendo tests) |
| CSS | 500 líneas |

No comprimir código para entrar en el límite. Si un archivo crece, extraer módulos.

### Tests obligatorios

Toda feature necesita tests. Los archivos de test NO cuentan para el límite de 200 líneas.

El runner del app usa Node nativo con strips de tipos:
```bash
node --experimental-strip-types --test tests/*.test.ts
```

**Los imports dentro de los tests DEBEN usar extensión `.ts`:**
```typescript
// CORRECTO
import { hasSeenLunariaIntro } from "../src/components/shell/lunaria-intro/state.ts";

// INCORRECTO (falla en el runner Node)
import { hasSeenLunariaIntro } from "../src/components/shell/lunaria-intro/state";
```

### Sin Math.random() en módulos de dominio

El sistema de workflows del motor puede necesitar reproducir resultados. `Math.random()` rompe la reproducibilidad. En su lugar, usar coordenadas/valores deterministas (como el array `STARS` en la intro).

### Sin em-dashes en copy de usuario

`check-locales` rechaza `—`. Usar coma o punto.

### Biome después de cada cambio

```bash
pnpm check:fix
```

Si no pasa Biome, el pre-commit hook lo rechazará.

---

## Internacionalización (i18n)

Houston soporta 3 idiomas: **en** (fuente de verdad), **es** (español latinoamericano), **pt** (portugués brasileño).

### Agregar una clave nueva

1. Agregar en `app/src/locales/en/<namespace>.json`.
2. Agregar las mismas claves (misma forma, mismo array length) en `es/` y `pt/`.
3. Usar con `useTranslation("<namespace>")`:
   ```tsx
   const { t } = useTranslation("lunaria");
   t("intro.title") // → "LUNARIA"
   ```
4. Tipear en `app/src/types/react-i18next.d.ts`:
   ```typescript
   resources: {
     lunaria: typeof import("../locales/en/lunaria.json");
   }
   ```
5. Registrar en `app/src/lib/i18n.ts` si es un namespace nuevo:
   ```typescript
   import lunariaEn from "../locales/en/lunaria.json";
   // ...
   ns: [...existentes, "lunaria"],
   resources: { en: { lunaria: lunariaEn }, ... }
   ```

### Verificar parity entre idiomas

```bash
cd app && pnpm check-locales
# Muestra claves faltantes en es/pt vs en.
# Baseline actual: 39 preexistentes (no aumentar).
```

### Reglas del CLAUDE.md para i18n

- No strings literales en inglés en JSX.
- Plurales: `count` API con `_one` / `_other`.
- Markup embebido: `<Trans components={...}>`.
- `ui/@houston-ai/*` no usa `react-i18next`. Los componentes reciben `labels?` props.

---

## Gotchas de Windows

| Gotcha | Descripción | Solución |
|--------|-------------|----------|
| EOL churn | `core.autocrlf=true` marca ~1100 archivos como modificados | Stagear solo archivos específicos; nunca `git add -A` |
| git stash | El pop falla silenciosamente con el churn EOL | No usar `git stash` para verificar pre-existencia de cambios |
| HOU-582 | `parent-watchdog.process.test.ts` siempre falla en Windows | Es pre-existente; ignorar |
| fs-guard test | Falla en Windows por diferencias de FS | Pre-existente; ignorar |
| `Console.Clear()` | Exe consola C# con stdout redirigido lanza IOException | No redirigir stdout de ese exe; usar log files |

---

## EOL y formateo entre SO

La razón del churn de EOL: Windows configura `core.autocrlf=true` en git, que convierte `LF` → `CRLF` al checkout. Biome formatea a `LF`. El resultado es que git ve diferencias en los 1100 archivos que Biome tocó aunque el contenido sea idéntico.

Git normaliza en el commit (CRLF → LF), así que el diff real que va al repo siempre es `LF`. Solo afecta al working tree local.

**Regla:** stagear únicamente los archivos que modificaste intencionalmente. `git diff --name-only` te muestra cuáles cambiaron realmente.

---

## Archivos a no modificar

| Archivo | Razón |
|---------|-------|
| `.houston/soul/soul.json` | Inmutable por diseño; el agente lo lee pero nunca lo sobrescribe |
| `convergence/final-cutover.md` | Gating document del equipo; no modificar unilateralmente |
| `engine/` (Rust legacy) | Módulo en retirada; cambios solo si hay bug bloqueante |
| `BOUNDARY.md` | Documento de arquitectura; cambios requieren consensus |

---

## Agregar un feature Axie nuevo (checklist)

- [ ] Definir tipos en `packages/protocol/src/domain/<feature>.ts`.
- [ ] Implementar lógica en `packages/domain/src/<feature>.ts`.
- [ ] Escribir tests en `packages/domain/src/<feature>.test.ts`.
- [ ] Agregar rutas en `packages/host/src/routes/<feature>.ts`.
- [ ] Escribir tests de rutas en `packages/host/src/routes/<feature>.test.ts`.
- [ ] Agregar componentes en `app/src/components/` (< 200 líneas/archivo).
- [ ] Agregar strings i18n en los 3 idiomas.
- [ ] Registrar namespace nuevo en `i18n.ts` + `react-i18next.d.ts` si aplica.
- [ ] Documentar en `docs/axie-features.md`.
- [ ] Correr `pnpm check:fix` + `pnpm -r typecheck` + `pnpm check-locales`.
- [ ] Commit convencional con el pre-commit hook activo.
- [ ] PR contra la rama base correcta.
