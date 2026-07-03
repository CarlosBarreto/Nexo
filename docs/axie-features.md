# Axie Features for Houston

> Features from the Axie ecosystem (`03_SOFT_PERS/600_06_Axies`, `03_SOFT_PERS/604_03_nano_axie`, `03_SOFT_PERS/2603_Axie`) evaluated for integration into Houston.
>
> **Goal:** Identify which Axie capabilities — identity, memory, rituals, skills — map cleanly onto Houston's architecture (pi runtime, `packages/host`, `.houston/` layout) and deliver the highest UX impact with the lowest adoption cost.

---

## 1. Axie Ecosystem Overview

Axie is a personal AI agent ecosystem built around three principles:

- **SOUL** — permanent, immutable agent identity (soulId + element + birthTimestamp)
- **Hybrid Memory** — three-layer persistent memory (Profile / Operational / Episodic) with SQLite FTS5 + vector retrieval
- **Narrative Engagement** — element-based archetypes (Fire / Water / Earth / Air) discovered via a 5-chapter ritual

The ecosystem lives in three repos:

| Project | What it is | Tech |
|---|---|---|
| `2603_Axie` | Telegram bot, ReAct loop, local LLM | TypeScript, grammy, SQLite |
| `604_03_nano_axie` | Microkernel: SOUL/SKILL/SETTINGS, hybrid RAG | Python, fastembed, FTS5, Pydantic |
| `600_06_Axies` | Narrative web portal, bestiario, element test | Astro, FastAPI, SQLite |

Houston already shares conceptual overlap with Axie: agents have identity (`agent.json`, `CLAUDE.md`), learnings, skills, and routines. The features below extend what Houston already has.

---

## 2. Feature Catalogue

Features grouped by impact tier. Each entry lists the Houston hook (where it would live), effort, and status in Axie.

### Tier 1 — High Impact, Low Effort

> **Status: IMPLEMENTED (2026-07-02, `feat/axie-tier1`).** What landed:
>
> - **SOUL Core** — `AgentSoul` type in `packages/protocol/src/domain/soul.ts`; `soul` family (`.houston/soul/soul.json` + seeded schema) in `packages/domain/src/soul.ts` and `ui/agent-schemas`; forged eagerly on `POST /agents` (optional `element` body field), lazily on first `GET /agents/:id/soul` for pre-feature agents; GET-only over the wire (immutable). Tests: `packages/domain/src/soul.test.ts`, `packages/host/src/routes/soul.test.ts`.
> - **Agent Archetypes** — four builtin presets (`app/src/agents/builtin/axie-archetypes.ts`) registered in the creation picker; each carries an element-toned CLAUDE.md. Element passthrough to the soul exists on the v3 host API; wiring it through the creation dialog rides with the ritual (Sprint 2).
> - **Skill Contracts** — optional `contract.toml` beside SKILL.md; `packages/domain/src/skill-contract.ts` parses + validates (snake_case TOML → camelCase protocol shape), `validateSkillInput` enforces required/type/max_length/undeclared-field rules plus prompt-injection screening. Host validates the `contract` field on skill POST/PUT **before** anything lands on disk (400 on invalid) and returns parsed + raw contract on GET detail. Tests: `packages/domain/src/skill-contract.test.ts`, `packages/host/src/routes/skill-contract.test.ts`.
>
> Scope note: skills in pi are prompt expansions, not function calls, so there is no structured-input invocation hook yet — contract enforcement is authoring-time today, and `validateSkillInput` is exported for the runtime to adopt when structured skill inputs land.

---

#### 2.1 SOUL Core — Permanent Agent Identity

**What it is:** A permanent, immutable identifier generated once at agent creation:

```json
{
  "soulId": "axie_a3f7c2",
  "birthTimestamp": "2026-07-02T18:00:00Z",
  "primaryElement": "fire",
  "originSeed": "sha256_of_initial_prompt"
}
```

**Why it matters for Houston:** Agents already have a `manifest_id` in `agent.json`, but it has no semantic weight. A SOUL turns an agent into a persistent entity — it "was born" on a date, has an element, has a lineage. This is a differentiator vs plain LLM wrappers.

**Houston hook:** Extend `packages/domain` agent schema. Add `soul` block to `agent.json`:

```json
{
  "name": "My Agent",
  "soul": {
    "id": "soul_a3f7c2",
    "born": "2026-07-02T18:00:00Z",
    "element": "fire"
  }
}
```

**Axie source:** `604_03_nano_axie/src/soul/soul_core.py`, `chain_of_souls.db`

**Effort:** Low (1–2 days). Schema extension + one-time generation on agent create.

---

#### 2.2 Agent Archetypes — Element-Based Presets

**What it is:** Four archetypes that pre-configure SOUL element, CLAUDE.md tone, default skills, and routine cadence:

| Element | Personality | Default Skills | Routine Cadence |
|---|---|---|---|
| 🔥 Fire | Ambition, speed, transformation | automation, execution | high-frequency |
| 💧 Water | Intuition, depth, harmony | insight, summarize | reflective |
| 🪨 Earth | Permanence, wisdom, protection | docs, stability | low-frequency |
| 💨 Air | Freedom, exploration, creative chaos | search, creative | event-driven |

**Why it matters for Houston:** Removes the blank-canvas problem when creating an agent. User picks an archetype → gets a pre-loaded CLAUDE.md, a skill set, and a routine template. Dramatically lowers time-to-useful.

**Houston hook:** `packages/domain` portable agent templates + `app/src/agents/` registry. Each element = one `.houstonagent` template in `skills/archetypes/`.

**Axie source:** `600_06_Axies/axie_world/docs/elements.md`, `604_03_nano_axie/project_docs/AXIE_MASTER_REFERENCE.md`

**Effort:** Low-Medium (1–2 days). Define 4 template `.houstonagent` files + UI picker.

---

#### 2.3 Skill Contract Validation — TOML-First Specs

**What it is:** Before a skill is invoked, it is validated against a contract spec:

```toml
[skill]
name = "summarize"
description = "Summarizes a document into bullet points."
version = "1.0.0"

[input]
document = { type = "string", required = true, max_length = 50000 }

[output]
bullets = { type = "array", items = "string" }

[security]
forbid_prompt_injection = true
timeout_seconds = 30
```

**Why it matters for Houston:** Houston's current skill system uses YAML frontmatter in `SKILL.md` but has no structured input/output validation or security constraints. Adding a contract layer means better LLM skill matching and prevents prompt injection through skill inputs.

**Houston hook:** `knowledge-base/skills.md` describes skill discovery. Add validation pass in `packages/runtime` skill invocation path before execution.

**Axie source:** `604_03_nano_axie/src/skills/skill_validator.py`, skill TOML specs under `604_03_nano_axie/skills/`

**Effort:** Low (2 days). Parser + validation middleware in pi runtime.

---

### Tier 2 — High Impact, Medium Effort

> **Status: IMPLEMENTED (2026-07-02, `feat/axie-tier2`).** What landed:
>
> - **Memory Stack (2.4)** — `memory` family at `.houston/memory/memory.json` (profile facts + operational goals, schema seeded) plus `episodes/<id>.md` for the episodic layer. Flat learnings migrate into the profile lazily on first read (one-shot, learnings.json untouched). Host surface: `GET /memory`, `PUT /memory/{profile,operational}`, episodes CRUD. The pi runtime injects profile (always) + active goals into context via `loadMemoryContext` (`packages/runtime/src/session/resource-loader.ts`); episodes are never injected wholesale.
> - **Hybrid Retrieval (2.5)** — `packages/domain/src/retrieval.ts`: dependency-free BM25, cosine similarity, RRF merge, and an `Embedder` port. `GET /memory/retrieve?q=` ranks episodes; with no embedder wired the fusion degrades to plain BM25 deterministically, and an embedder failure surfaces rather than silently degrading. Wiring a concrete embedder (in-process or API-key) is the remaining piece.
> - **Birth Ritual (2.6)** — 5-chapter narrative wizard (`app/src/components/shell/soul-ritual/`) reached from the agent picker ("Discover with the ritual"). Answers tally invisible element points (manifesto counts double; deterministic tie-breaks); the revealed element selects the matching archetype preset AND rides the create call end-to-end (store → tauri shim → engine-client `CreateAgent.element` → v3 `POST /agents`), so the soul is born with the ritual's element on the TS host. Full i18n (en/es/pt) including archetype catalog cards.

---

#### 2.4 Three-Layer Memory Stack

**What it is:** Memory split into three explicit layers, each with distinct retrieval semantics:

| Layer | What it stores | Retrieval |
|---|---|---|
| **Profile Memory** | Static facts about the agent's context ("owner = Carlos", "stack = TypeScript") | Always injected |
| **Operational Memory** | Current goals, active tasks, in-flight context | Injected when active |
| **Episodic Memory** | Conversation history, past decisions, outcomes | Retrieved by query |

**Why it matters for Houston:** Houston's `.houston/learnings/*.md` is flat and grows unbounded. Splitting into three layers enables smarter context injection: profile always goes in, operational goes in when relevant, episodic is retrieved semantically. Reduces prompt token waste.

**Houston hook:**

```
~/.houston/workspaces/<Workspace>/<Agent>/.houston/
  memory/
    profile.json       ← always injected
    operational.json   ← injected when active goals exist
    episodes/          ← one .md per conversation, indexed for retrieval
```

Migration: existing `learnings/` → `memory/profile.json` on first open.

**Axie source:** `604_03_nano_axie/project_docs/memory.md`, `2603_Axie/src/memory/`

**Effort:** Medium (3–4 days). Schema migration + context builder changes in pi runtime.

---

#### 2.5 Hybrid Retrieval for Memory (FTS5 + Vector + RRF)

**What it is:** When episodic memory is large, retrieve relevant episodes using:

1. **BM25 / FTS5** — keyword match (fast, no embedding required)
2. **Vector similarity** — semantic match via local embeddings (fastembed or in-process OpenAI)
3. **RRF (Reciprocal Rank Fusion)** — merge both result lists into a single ranked set
4. **Cross-encoder reranking** — top-10 → top-3 (precision pass)

**Why it matters for Houston:** Current learnings are injected verbatim (all or nothing). As memory grows past a few KB, a smart retrieval layer lets agents surface what's relevant to the current conversation without blowing the context window.

**Houston hook:** Add retrieval endpoint in `packages/host` (`GET /v1/agents/:id/memory/retrieve?q=...`). pi runtime calls it before building the system prompt.

**Axie source:** `604_03_nano_axie/src/memory/retriever.py`, `604_03_nano_axie/project_docs/precision_plan.md`

**Effort:** Medium-High (4–5 days). Requires an embedding provider (in-process or API-key). SQLite FTS5 is already in Houston for chat history.

---

#### 2.6 Narrative Onboarding Ritual — 5-Chapter Element Assignment

**What it is:** A guided 5-step questionnaire that determines an agent's primary element through narrative prompts, not a configuration form:

1. **El Despertar Primordial** — "Given unlimited resources, what do you tackle first?" (instinct)
2. **La Llamada del Territorio** — "Your natural working environment?" (biome)
3. **El Espejo del Vínculo** — "What value do you hold above all else?" (core value)
4. **La Danza de la Tormenta** — "How do you respond to sudden chaos?" (stress response)
5. **El Manifiesto del Alma** — "Describe your purpose in one sentence." (mission)

Each answer maps to weighted element scores. The dominant element becomes the SOUL `primaryElement`.

**Why it matters for Houston:** Agent creation today is a blank form (name + icon + base prompt). A narrative ritual is a dramatically different, more engaging UX — the user discovers the agent's archetype rather than configuring it. Emotional investment = lower churn.

**Houston hook:** New `app/src/components/agent/soul-ritual/` flow, triggered on first agent creation (or via "Discover soul" button on existing agents). Assigns element → loads archetype template → generates SOUL block.

**Axie source:** `600_06_Axies/axie_world/docs/ritual_de_nacimiento.md`, test logic in `600_06_Axies/api/`

**Effort:** Medium (3–5 days). UI wizard (5 steps) + scoring logic + SOUL generation. i18n required (en/es/pt strings).

---

### Tier 3 — Medium Impact, Higher Effort

---

#### 2.7 Dream Auto-Schedule — Autonomous Background Tasks

**What it is:** While idle, an agent autonomously runs a "dream" routine: consolidating memory, reflecting on recent conversations, generating proactive suggestions, and indexing new skills.

**Why it matters for Houston:** Houston routines are user-scheduled (cron). Dream tasks are agent-scheduled: the agent decides when to run them based on idle time. Adds a sense of "living agent" vs a passive tool.

**Houston hook:** Extend `packages/domain` scheduler with `idle_trigger` type (fires after N minutes of inactivity). pi runtime adds a `dream` built-in skill.

**Axie source:** `604_03_nano_axie/src/chronos/dream.py`, Chronos engine in `604_03_nano_axie/`

**Effort:** Medium (3–4 days). Idle detection in host + dream skill implementation.

---

#### 2.8 ReAct Loop Depth Control

**What it is:** Configurable multi-step reasoning: agent can reason → act → observe → reason again up to a configurable step limit, with explicit loop state exposed in the activity feed.

**Why it matters for Houston:** pi runtime already has a ReAct loop. Axie adds explicit step budgets, per-skill timeout enforcement, and loop state observability (which step, what tool, elapsed time). This exposes internals that Houston currently hides.

**Houston hook:** Extend `packages/protocol` events to include `loop_step` events. Expose in `ui/@houston-ai/review` activity feed.

**Axie source:** `604_03_nano_axie/src/agent/react_loop.py`, `604_03_nano_axie/src/chronos/`

**Effort:** Medium (3–4 days). Protocol changes + activity feed UI extension.

---

#### 2.9 AI-as-a-Judge Skill Evaluation

**What it is:** After a skill run, a secondary LLM call evaluates whether the output actually met the intent — not via keyword matching, but by asking: "Did this skill achieve what was requested?"

```
skill_output → judge_llm("Did this complete the task? task=X, output=Y") → {passed: bool, reason: str}
```

On failure: automatic retry with adjusted prompt or fallback skill.

**Why it matters for Houston:** Skills currently fire-and-forget. Adding a judge pass catches silent failures (skill ran successfully but produced irrelevant output) and enables automatic retry — improving reliability without user intervention.

**Houston hook:** Optional post-invocation hook in pi runtime skill execution path. Configurable per-skill via TOML spec (`[judge] enabled = true`).

**Axie source:** `604_03_nano_axie/src/skills/evaluator.py` (in progress, Phase 8 of nano_axie roadmap)

**Effort:** Medium (2–3 days). One extra LLM call per skill run (opt-in).

---

#### 2.10 Bestiario — Agent Gallery

**What it is:** A visual catalog of agents in a workspace, showing element archetype, SOUL ID, birth date, current status, and a narrative description.

**Why it matters for Houston:** The agent sidebar today is a flat list. A bestiario-style gallery view (grid of cards, each with element color, avatar, soul birth date, active skills) makes large workspaces easier to navigate and reinforces agent identity.

**Houston hook:** New view in `ui/@houston-ai/agent/` — `AgentGallery` component. Reads from the existing agent manifest + new SOUL block.

**Axie source:** `600_06_Axies/src/pages/bestiario.astro`, element card designs in `600_06_Axies/src/components/`

**Effort:** Medium (3–4 days). Primarily UI work. Depends on SOUL Core (2.1) being implemented first.

---

## 3. Implementation Roadmap

Suggested phasing based on dependency order and impact:

### Sprint 1 (Week 1–2) — ✅ DONE (2026-07-02)
1. **SOUL Core** (2.1) — `soul` family + protocol type, forged on create, GET-only route
2. **Agent Archetypes** (2.2) — 4 builtin presets in the creation picker
3. **Skill Contract Validation** (2.3) — `contract.toml` parser + authoring-time validation in host

### Sprint 2 (Week 3–4) — ✅ DONE (2026-07-02)
4. **Narrative Onboarding Ritual** (2.6) — 5-step wizard + element scoring + create-flow wiring
5. **Three-Layer Memory Stack** (2.4) — `memory` family + lazy learnings migration + runtime injection

### Sprint 3 (Week 5–6) — 2.5 ✅ DONE (2026-07-02, embedder wiring pending)
6. **Hybrid Retrieval** (2.5) — BM25 + RRF + Embedder port in `/memory/retrieve`
7. **Dream Auto-Schedule** (2.7) — idle trigger + dream skill

### Sprint 4 (Week 7–8)
8. **ReAct Loop Observability** (2.8) — protocol events + activity feed
9. **AI-as-a-Judge** (2.9) — opt-in judge hook in pi runtime
10. **Bestiario Gallery** (2.10) — AgentGallery UI component

---

## 4. Features Not Ported (and Why)

| Feature | Reason |
|---|---|
| **Telegram bot interface** | Houston already handles multi-channel via web + desktop. Telegram = Composio integration, not a core feature. |
| **Lunaria world-building / lore** | Domain-specific to the Axie narrative. Houston is domain-agnostic — lore belongs in agent CLAUDE.md, not the platform. |
| **Genealogy / family trees** | Narrative feature; not useful at Houston's current scale. Revisit when multi-agent spawning is stable. |
| **Python-first stack (fastembed / Pydantic)** | Houston is TypeScript-first. Hybrid retrieval (2.5) uses in-process providers or API-key embeddings to stay in TS. |
| **Axie web portal (Astro)** | Houston has its own web frontend (`packages/web`). The Astro portal is replaced by the Bestiario Gallery (2.10). |

---

## 5. Cross-References

| Axie Source | Houston Target |
|---|---|
| `604_03_nano_axie/project_docs/AXIE_MASTER_REFERENCE.md` | `knowledge-base/architecture.md` |
| `604_03_nano_axie/src/memory/` | `packages/runtime` context builder |
| `604_03_nano_axie/src/skills/` | `packages/runtime` skill invocation |
| `600_06_Axies/axie_world/docs/` | `docs/axie-archetypes.md` (to be created) |
| `2603_Axie/src/` | `packages/host` memory endpoints |

---

_20260702 - mictlan - axie features doc for houston fork -- Begin_
_Source projects: `03_SOFT_PERS/600_06_Axies`, `03_SOFT_PERS/604_03_nano_axie`, `03_SOFT_PERS/2603_Axie`_
_Last updated: 2026-07-02_
_20260702 - mictlan - axie features doc for houston fork -- End_
