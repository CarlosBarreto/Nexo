# Manual Técnico — axieUIHouston (AUH-001)

> Fork de `gethouston/houston` con el ecosistema Axie portado.  
> Repositorio: `CarlosBarreto/houston` · Rama base: `main`

---

## Índice

| # | Sección | Qué cubre |
|---|---------|-----------|
| 1 | [Arquitectura y stack](./01-arquitectura.md) | Motor único TS, paquetes, convergencia, Tauri 2 |
| 2 | [SOUL Core](./02-soul.md) | Identidad permanente del agente, elemento, seed FNV-1a |
| 3 | [Stack de memoria](./03-memoria.md) | 3 capas (profile/operational/episodic) + retrieval híbrido |
| 4 | [Ritual de Nacimiento](./04-ritual.md) | Wizard 5 capítulos, scoring determinista, UI |
| 5 | [Rutinas, Dream y Juez](./05-rutinas-dream-judge.md) | Cron/idle, auto-dream, AI-as-a-Judge |
| 6 | [Skills y Contratos](./06-skills-contratos.md) | SKILL.md, contract.toml, validación, guard injection |
| 7 | [Tropicalización Lunaria](./07-lunaria-ui.md) | Tokens CSS, narrativa en/es/pt, intro arcade pixel-art |
| 8 | [Flujo de arranque](./08-flujo-arranque.md) | Gate chain, boot decoupling, localStorage |
| 9 | [Guía de desarrollo](./09-desarrollo.md) | Comandos, tests, git, Biome, i18n, límites de archivo |

---

## Resumen ejecutivo

**axieUIHouston** superpone el universo narrativo de Axie sobre Houston, una plataforma de agentes de IA locales. El resultado es una experiencia cohesiva donde cada agente tiene:

- **Alma (SOUL)** — identidad criptográfica inmutable, generada al nacer y nunca modificada.
- **Elemento** — uno de cuatro (Fuego/Agua/Tierra/Aire), que define personalidad y paleta de color.
- **Memoria estratificada** — tres capas persistentes en disco, recuperables por relevancia.
- **Historia de nacimiento** — wizard narrativo de 5 capítulos que el usuario atraviesa para descubrir el elemento de su agente.
- **Rutinas autónomas** — tareas programadas + sueño (consolidación de memoria en reposo).
- **Juez interno** — evaluador post-tarea que determina si una rutina cumplió su objetivo.
- **Contratos de skills** — especificación TOML que valida entradas/salidas y blinda contra prompt injection.
- **UI Lunaria** — re-skin completo con paleta elemental, narrativa localizada e intro arcade pixel-art.

Todo el código corre sobre un **motor único TypeScript** (protocolo v3), reemplazando progresivamente el motor Rust legado.

---

## Estado de los PRs

| PR | Rama | Contenido |
|----|------|-----------|
| #1 | `feat/axie-tier1` | SOUL Core + Arquetipos + Contratos de skills |
| #2 | `feat/axie-tier2` | Memoria 3 capas + Retrieval híbrido + Ritual de Nacimiento |
| #3 | `feat/axie-tier3` | Dream auto-schedule + Telemetría ReAct + AI Judge + Bestiario |
| #4 | `feat/lunaria-tropicalization` | Tokens CSS Lunaria + Narrativa + i18n |
| #5 | `feat/lunaria-arcade-intro` | Intro arcade first-run pixel-art |

> **Orden de merge obligatorio:** #1 → #2 → #3 → #4 → #5.  
> Todos son PRs apilados; mergear fuera de orden rompe el historial.
