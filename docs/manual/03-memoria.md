# 03 — Stack de Memoria (3 capas)

> Implementado en **PR #2** (`feat/axie-tier2`).

## Las tres capas

```
.houston/memory/
├── memory.json          ← Capa 1: Profile (hechos estables, siempre en contexto)
│                           Capa 2: Operational (metas activas, en contexto mientras active)
└── episodes/
    ├── <id>.md          ← Capa 3: Episodic (recuperada por relevancia, no inyectada whole)
    └── <id>.md
```

La diferencia clave entre capas:

| Capa | Qué almacena | Cómo se usa | Tamaño esperado |
|------|-------------|-------------|----------------|
| **Profile** | Hechos duraderos sobre el usuario/agente (nombre, preferencias, contexto de trabajo) | Inyectada en CADA turno del sistema prompt | Pequeño (< 50 hechos) |
| **Operational** | Metas actuales con estado `active`/`done` | Inyectada mientras haya metas activas | Mediano (< 20 metas) |
| **Episodic** | Eventos, decisiones, resúmenes de sesiones pasadas | Recuperada por relevancia cuando se necesita (BM25/vectorial) | Puede crecer indefinido |

---

## Tipos del protocolo

```typescript
// packages/protocol/src/domain/memory.ts

interface MemoryFact {
  id: string;
  text: string;
  created_at: string;    // ISO 8601
}

interface MemoryGoal {
  id: string;
  text: string;
  status: "active" | "done";
  created_at: string;
}

interface AgentMemory {
  profile:     MemoryFact[];    // capa 1
  operational: MemoryGoal[];    // capa 2
}

interface EpisodeSummary { id, title, created }
interface EpisodeDetail   { id, title, created, content }  // content = markdown completo

interface MemoryHit {
  id:      string;
  title:   string;
  score:   number;    // RRF score, más alto = más relevante
  excerpt: string;   // extracto del markdown
}
```

---

## Migración lazy desde `learnings`

Los agentes que existían antes del feature de memoria tenían sus datos en `config.json` → `learnings: string[]`. Al primer acceso a `/memory`, el host ejecuta `migrateLearningsToMemory()`:

```
¿Existe memory.json? Sí → no-op (idempotente)
                     No → leer learnings[] de config.json
                          → escribir cada learning como MemoryFact en profile
                          → crear memory.json
```

El `config.json` original no se modifica. La migración corre en el host antes de retornar el primer `GET /memory`.

---

## API REST de memoria

| Verbo | Ruta | Descripción |
|-------|------|-------------|
| `GET` | `/v3/.../agents/:id/memory` | Retorna `{ profile, operational }` (ambas capas inyectadas) |
| `PUT` | `/v3/.../agents/:id/memory/profile` | Reemplaza la lista de hechos del profile |
| `PUT` | `/v3/.../agents/:id/memory/operational` | Reemplaza la lista de metas |
| `GET` | `/v3/.../agents/:id/memory/episodes` | Lista de `EpisodeSummary[]` |
| `POST` | `/v3/.../agents/:id/memory/episodes` | Crea un episodio nuevo (markdown) |
| `GET` | `/v3/.../agents/:id/memory/episodes/:episodeId` | Detalle completo de un episodio |
| `DELETE` | `/v3/.../agents/:id/memory/episodes/:episodeId` | Borra un episodio |
| `GET` | `/v3/.../agents/:id/memory/retrieve?q=...&limit=N` | Búsqueda híbrida en episodios |

---

## Retrieval híbrido (BM25 + vectorial + RRF)

Implementado en `packages/domain/src/retrieval.ts`. Sin dependencias externas pesadas.

### Paso 1: Tokenización unicode

```typescript
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
// Funciona con español, portugués, etc. gracias a \p{L}
```

### Paso 2: BM25 (Okapi BM25)

Algoritmo clásico de recuperación de información. Considera:
- Frecuencia del término en el documento (TF).
- Frecuencia inversa del documento (IDF) — términos raros en el corpus valen más.
- Longitud del documento vs. longitud promedio (normalización k1=1.2, b=0.75).

```typescript
export function bm25Rank(query: string, docs: RetrievalDoc[]): RankedDoc[]
```

### Paso 3: Vectorial (opcional)

Si se provee un `Embedder`, calcula similitud coseno entre el embedding de la query y los embeddings de cada documento.

```typescript
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export function cosineSimilarity(a: number[], b: number[]): number
```

> **Estado actual (PR #5):** El puerto `Embedder` existe pero no hay ningún embedder concreto cableado. El retrieval degrada de forma elegante a BM25 puro sin errores.

### Paso 4: RRF (Reciprocal Rank Fusion)

Fusiona los rankings de BM25 y vectorial sin necesidad de normalizar scores heterogéneos. La fórmula es `1 / (k + rank)` por cada ranking, sumada para cada documento.

```typescript
export function rrfMerge(rankings: string[][]): RankedDoc[]
// rankings = [listaBM25, listaVectorial]  (ambas son arrays de doc IDs ordenados)
```

### API de retrieval en el host

```
GET /memory/retrieve?q=<consulta>&limit=<N>
```

Responde con `MemoryHit[]` ordenados por score descendente. El agente puede usar esto como herramienta interna para recuperar contexto pasado relevante antes de responder.

---

## Inyección en el contexto del agente

`loadMemoryContext()` en el runtime pi inyecta la memoria directamente en el system prompt del turno:

```
[memory: profile]
- Hecho 1
- Hecho 2

[memory: operational]
- Meta activa 1 (active)
- Meta completada (done)
```

La capa episódica NO se inyecta wholesale; se recupera solo cuando la lógica del agente decide hacer un retrieve.

---

## Cómo el Dream consolida la memoria

El **Dream** (sección 05) es la rutina automática que corre cuando el agente ha estado inactivo. Su prompt explícitamente le pide al agente que:

1. Revise conversaciones recientes.
2. Actualice `memory.json`: añada hechos al profile, marque metas como `done`.
3. Si algo notable ocurrió, escriba un episodio nuevo en `episodes/`.

Esto mantiene las capas 1 y 2 compactas y la capa 3 creciendo con información valiosa en lugar de ruido.
