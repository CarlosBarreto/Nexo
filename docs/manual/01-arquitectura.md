# 01 — Arquitectura y stack

## Visión general: motor único

Houston está en proceso de **convergencia hacia un solo motor TypeScript** que sirve tanto al escritorio (Tauri 2) como a la nube (multi-tenant SaaS). El motor Rust legado (`engine/`) sigue siendo el binario por defecto en el build de escritorio pero será eliminado al finalizar la convergencia (fase P6).

```
┌─────────────────────────────────────────────────────────┐
│                    app/ (Tauri 2)                        │
│  React 19 frontend (app/src) + Rust shell (app/src-tauri)│
│  El shell spawna el motor como sidecar HTTP              │
└──────────────────┬──────────────────────────────────────┘
                   │ HTTP + SSE (protocolo v3)
┌──────────────────▼──────────────────────────────────────┐
│            packages/host  (@houston/host)                │
│  Router único, authorize(), dominio, rutas REST/SSE      │
│  Dos perfiles de adaptadores (wired en main()):          │
│    • Local:  FS store, subprocess pi, single-user        │
│    • Cloud:  Postgres, GKE/CloudRun, Supabase JWT, Redis │
└──────────────────┬──────────────────────────────────────┘
                   │ in-process
┌──────────────────▼──────────────────────────────────────┐
│           packages/runtime  (pi engine)                  │
│  Loop de agente único. TS/Node en dev; Bun en el sidecar │
└─────────────────────────────────────────────────────────┘
         ▲                         ▲
         │                         │
┌────────┴──────┐        ┌─────────┴──────┐
│packages/domain│        │packages/protocol│
│ Lógica de     │        │ Tipos wire v3   │
│ dominio puro  │        │ (Zod schemas)   │
└───────────────┘        └────────────────┘
         ▲
         │
┌────────┴──────┐
│  ui/          │
│@houston-ai/*  │
│Props-only,    │
│sin Zustand    │
└───────────────┘
```

---

## Paquetes del monorepo

| Paquete | Path | Rol |
|---------|------|-----|
| `app` | `app/` | Tauri 2 desktop. Frontend React + Rust shell |
| `@houston/host` | `packages/host/` | Servidor único (local + cloud). OPEN |
| `@houston/host-cloud` | `packages/host-cloud/` | Adaptadores cloud cerrados (Pg/GCS/Redis) |
| `@houston/runtime` | `packages/runtime/` | Motor pi — el único loop de agente |
| `@houston/domain` | `packages/domain/` | Lógica de dominio, sin UI ni framework |
| `@houston/protocol` | `packages/protocol/` | Tipos wire v3 + Zod, compartidos |
| `@houston-ai/*` | `ui/` | Componentes React reutilizables. Props-only |
| `houston-web` | `packages/web/` | El mismo frontend que `app/src`, empaquetado para cloud |
| `engine/` | `engine/` | Motor Rust legado (sidecar actual en desktop). Se elimina en P6 |

---

## Tauri 2 y el sidecar

El shell Rust (`app/src-tauri/`) **solo hace glue de SO**: spawna el motor como proceso hijo, abre ventana, gestiona bandeja del sistema, maneja autenticación OAuth con loopback, y expone comandos Tauri para operaciones del SO (terminal, diagnósticos, updates).

**No hay `invoke()` de Tauri para lógica de dominio.** Todo el dominio viaja como peticiones HTTP/SSE al host a través de `@houston-ai/engine-client`.

El sidecar binario se aloja en `app/src-tauri/binaries/houston-engine-<triple>`. En dev, `build.rs` lo copia desde `target/debug/`. Si se modifica `engine/`, hay que recompilar manualmente antes del siguiente `pnpm tauri dev`.

---

## Protocolo v3

La comunicación frontend ↔ host usa:
- **REST** para operaciones CRUD sobre agentes, skills, memoria, rutinas.
- **SSE** en `/v1/events` para el stream de `HoustonEvent` que actualiza la UI en tiempo real.
- **WebSocket** para el stream de turno de conversación.

El frontend usa **TanStack Query** + el hook `use-agent-invalidation.ts` que mapea eventos SSE a invalidaciones de queries. No hay `setTimeout` ni polling: todo es reactivo.

---

## Datos del usuario en disco

```
~/.houston/workspaces/<Workspace>/<Agent>/
└── .houston/
    ├── soul/soul.json       ← identidad permanente (Axie Tier 1)
    ├── config.json          ← configuración del agente
    ├── memory/
    │   ├── memory.json      ← profile + operational (Axie Tier 2)
    │   └── episodes/        ← episodios markdown (Axie Tier 2)
    ├── routines.json        ← rutinas cron + idle
    ├── prompts/             ← system.md, planning.md, execution.md
    ├── activity.json        ← registro de actividad
    └── sessions/            ← archivos .sid por sesión
.agents/skills/
└── <slug>/
    ├── SKILL.md             ← contenido de la skill
    └── contract.toml        ← contrato Axie Tier 1 (opcional)
```

---

## Reactivity: cómo la UI se actualiza sin polling

1. El agente escribe un archivo (p.ej. `memory.json`).
2. El FS watcher del host detecta el cambio.
3. El host emite un `HoustonEvent` en el stream SSE.
4. `use-agent-invalidation.ts` mapea el evento al query key correcto.
5. TanStack Query refetcha; la UI actualiza sin intervención.

Esto aplica tanto a escrituras del agente como a escrituras del usuario desde la UI. **Nunca se construye un flujo donde "el agente puede hacer X pero la UI no se entera hasta recargar."**

---

## Seam abierto/cerrado

`BOUNDARY.md` documenta qué puede importar qué. `scripts/check-boundaries.mjs` lo hace cumplir en CI:

- `packages/host` solo importa interfaces y adaptadores, nunca implementaciones cloud concretas.
- `packages/host-cloud` puede importar `packages/host` pero NO al revés.
- `ui/` nunca importa Zustand, Tauri, ni tipos de `app/`.

---

## Proveedores de IA

En el motor pi (TS), los proveedores son **in-process**: Anthropic, OpenAI/Codex (OAuth), y proveedores API-key (OpenCode, OpenRouter, Google Gemini, Amazon Bedrock). No hay CLIs de proveedor bundleados. Las integraciones de herramientas (Gmail, Calendar, etc.) van por Composio como REST tool, no como proveedor de IA.
