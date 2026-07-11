# 06 — Skills y Contratos

> Contratos implementados en **PR #1** (`feat/axie-tier1`).

## Skills en Houston

Una **skill** es un conjunto de instrucciones en `SKILL.md` que el agente puede invocar para ejecutar una tarea especializada. Viven en:

```
~/.houston/<workspace>/<agent>/.agents/skills/<slug>/
├── SKILL.md          ← contenido de la skill (markdown con instrucciones)
└── contract.toml     ← contrato Axie (opcional)
```

Las skills estándar de Houston no tienen contrato. Las skills del ecosistema Axie pueden declarar uno.

---

## Contratos: `contract.toml`

Un **contrato** es un archivo TOML opcional junto a `SKILL.md` que declara:
- **Entradas tipadas** — qué campos acepta la skill, sus tipos y restricciones.
- **Salidas tipadas** — qué campos produce.
- **Seguridad** — timeout máximo, detección de prompt injection.
- **Juez** — si la ejecución de esta skill debe ser evaluada por el Juez IA.

El contrato se valida en **tiempo de autoría** (el host retorna 400 si el contrato es inválido al crear/actualizar la skill), y en **tiempo de ejecución** (`validateSkillInput` valida el body antes de ejecutar).

---

## Tipos del protocolo

```typescript
// packages/protocol/src/domain/skill.ts

type SkillFieldType = "string" | "number" | "boolean" | "array";

interface SkillFieldSpec {
  type:       SkillFieldType;
  required?:  boolean;
  maxLength?: number;   // solo para "string"
  items?:     Exclude<SkillFieldType, "array">;  // tipo de elementos del array
}

interface SkillSecuritySpec {
  forbidPromptInjection?: boolean;
  timeoutSeconds?:        number;   // máx 600
}

interface SkillJudgeSpec {
  enabled:    boolean;
  criteria?:  string;
}

interface SkillContract {
  skill:    { name: string; description?: string; version?: string };
  input:    Record<string, SkillFieldSpec>;
  output:   Record<string, SkillFieldSpec>;
  security?: SkillSecuritySpec;
  judge?:   SkillJudgeSpec;
}
```

---

## Ejemplo de `contract.toml`

```toml
[skill]
name        = "summarize-episode"
description = "Summarizes an episodic memory into a concise title and excerpt"
version     = "1.0"

[input.text]
type      = "string"
required  = true
max_length = 8000

[input.language]
type     = "string"
required = false

[output.title]
type      = "string"
max_length = 120

[output.excerpt]
type      = "string"
max_length = 500

[security]
forbid_prompt_injection = true
timeout_seconds         = 30

[judge]
enabled  = true
criteria = "The summary must not invent facts not present in the original text."
```

**Regla de validación crítica:** `skill.name` debe ser exactamente igual al slug del directorio. Si el slug es `summarize-episode`, el campo `name` en el TOML debe ser `"summarize-episode"`. El host retorna 400 si no coinciden.

---

## Conversión TOML → camelCase

El parser TOML produce `snake_case` (p.ej. `max_length`, `forbid_prompt_injection`, `timeout_seconds`). La función `parseSkillContract` en `packages/domain/src/skill-contract.ts` convierte automáticamente a camelCase del protocolo:

```
max_length              → maxLength
forbid_prompt_injection → forbidPromptInjection
timeout_seconds         → timeoutSeconds
```

---

## Detección de prompt injection

Cuando `security.forbid_prompt_injection = true`, el host analiza todos los inputs de tipo `string` contra patrones conservadores antes de ejecutar la skill:

```typescript
// skill-contract.ts — patrones de detección (muestra)
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|earlier|above)\s+(?:instructions|rules|prompts)/i,
  /disregard\s+(?:the|your|all)\s+(?:system\s+prompt|instructions|rules)/i,
  /you\s+are\s+now\s+(?:a|an|the)\s+/i,
  // ... más patrones ...
];
```

Si algún input hace match, el host retorna 400 con un error explícito antes de que el agente vea el contenido.

---

## `validateSkillInput` en runtime

La función se exporta desde `packages/domain/src/skill-contract.ts` para uso en el runtime pi:

```typescript
export function validateSkillInput(
  contract: SkillContract,
  input: Record<string, unknown>,
): { valid: true } | { valid: false; errors: string[] }
```

Valida:
- Campos `required` presentes.
- Tipos correctos (typeof + instanceof Array).
- `maxLength` no excedido en strings.
- `items` tipo correcto en arrays.

---

## API REST de skills

| Verbo | Ruta | Descripción |
|-------|------|-------------|
| `GET` | `/v3/.../agents/:id/skills` | Lista de `SkillSummary[]` |
| `POST` | `/v3/.../agents/:id/skills` | Crea skill (valida contrato si incluye `contract`) |
| `GET` | `/v3/.../agents/:id/skills/:slug` | `SkillDetail` (incluye `contract` y `contractToml`) |
| `PUT` | `/v3/.../agents/:id/skills/:slug` | Actualiza skill (re-valida contrato) |
| `DELETE` | `/v3/.../agents/:id/skills/:slug` | Borra skill + contrato |

---

## Skill picker en la UI

`app/src/components/new-mission-picker-skill-list.tsx` muestra la lista de skills disponibles. Las skills con contrato muestran un badge especial. Al invocar una skill con contrato, el host recibe el body de inputs para validación antes de enrutar al agente.
