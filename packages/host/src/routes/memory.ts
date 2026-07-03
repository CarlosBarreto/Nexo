import type { IncomingMessage, ServerResponse } from "node:http";
import {
  composeEpisodeMd,
  episodeKey,
  excerptFor,
  listEpisodes,
  loadEpisode,
  loadMemory,
  migrateLearningsToMemory,
  retrieveDocs,
  saveMemory,
  slugify,
} from "@houston/domain";
import type { HoustonEvent, MemoryHit } from "@houston/protocol";
import type { Agent, Workspace } from "../domain/types";
import type { WorkspacePaths } from "../paths";
import type { Vfs } from "../vfs";
import { json, readJson } from "./http";

/**
 * The agent's layered memory (.houston/memory/) served by the host off the
 * workspace Vfs. memory.json (profile + operational) reads migrate flat
 * learnings in lazily — pre-feature agents keep their knowledge. Episodes are
 * markdown files; /retrieve ranks them for a query (BM25 + RRF; the vector
 * leg activates when an Embedder is wired). Returns true when handled.
 */
export async function handleMemory(
  vfs: Vfs | undefined,
  paths: WorkspacePaths,
  ctx: { workspace: Workspace; agent: Agent },
  method: string,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
  searchParams: URLSearchParams,
  emit?: (event: HoustonEvent) => void,
): Promise<boolean> {
  const m = rest.match(/^memory(?:\/(.+))?$/);
  if (!m) return false;
  const sub = m[1] ? decodeURIComponent(m[1]) : null;

  if (!vfs) {
    json(res, 503, { error: "agent data not configured" });
    return true;
  }
  const root = paths.agentRoot(ctx.workspace, ctx.agent);
  const fireChange = () =>
    emit?.({ type: "MemoryChanged", agentPath: ctx.agent.id });

  // GET /memory — both injected layers (+ the one-shot learnings migration).
  if (!sub && method === "GET") {
    await migrateLearningsToMemory(vfs, root);
    const { memory, diagnostics } = await loadMemory(vfs, root);
    json(res, 200, { ...memory, diagnostics });
    return true;
  }

  // PUT /memory/profile | /memory/operational — replace one layer wholesale
  // (the learnings PUT idiom). loadMemory re-validates on the way back out.
  if ((sub === "profile" || sub === "operational") && method === "PUT") {
    const body = await readJson(req);
    if (!Array.isArray(body.items)) {
      json(res, 400, { error: "missing 'items' array" });
      return true;
    }
    await migrateLearningsToMemory(vfs, root);
    const { memory } = await loadMemory(vfs, root);
    await saveMemory(vfs, root, { ...memory, [sub]: body.items });
    const { memory: saved, diagnostics } = await loadMemory(vfs, root);
    fireChange();
    json(res, 200, { ...saved, diagnostics });
    return true;
  }

  if (sub === "episodes" && method === "GET") {
    json(res, 200, await listEpisodes(vfs, root));
    return true;
  }

  if (sub === "episodes" && method === "POST") {
    const body = await readJson(req);
    for (const field of ["title", "content"] as const) {
      if (!body[field] || typeof body[field] !== "string") {
        json(res, 400, { error: `missing '${field}'` });
        return true;
      }
    }
    const title = body.title as string;
    const content = body.content as string;
    // Readable-but-unique id: slug + a random tail (episodes have no natural
    // key and titles repeat — "weekly sync").
    const id = `${slugify(title) || "episode"}-${crypto.randomUUID().slice(0, 8)}`;
    await vfs.writeText(
      episodeKey(root, id),
      composeEpisodeMd({
        title,
        createdIsoDate: new Date().toISOString().slice(0, 10),
        content,
      }),
    );
    fireChange();
    json(res, 201, await loadEpisode(vfs, root, id));
    return true;
  }

  const episode = sub?.match(/^episodes\/([^/]+)$/);
  if (episode?.[1]) {
    const id = episode[1];
    if (method === "GET") {
      const detail = await loadEpisode(vfs, root, id);
      if (!detail) json(res, 404, { error: "episode not found" });
      else json(res, 200, detail);
      return true;
    }
    if (method === "DELETE") {
      if ((await vfs.readText(episodeKey(root, id))) === null) {
        json(res, 404, { error: "episode not found" });
        return true;
      }
      await vfs.deleteKey(episodeKey(root, id));
      fireChange();
      json(res, 200, { ok: true });
      return true;
    }
  }

  // GET /memory/retrieve?q=...&limit=N — ranked episodic hits.
  if (sub === "retrieve" && method === "GET") {
    const q = searchParams.get("q")?.trim() ?? "";
    if (!q) {
      json(res, 400, { error: "missing 'q'" });
      return true;
    }
    const limitRaw = Number(searchParams.get("limit") ?? "3");
    const limit =
      Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 20
        ? limitRaw
        : 3;
    const { items } = await listEpisodes(vfs, root);
    const docs = [];
    for (const summary of items) {
      const detail = await loadEpisode(vfs, root, summary.id);
      if (detail)
        docs.push({
          id: detail.id,
          text: `${detail.title}\n${detail.content}`,
        });
    }
    const ranked = await retrieveDocs({ query: q, docs, limit });
    const byId = new Map(docs.map((d) => [d.id, d]));
    const titles = new Map(items.map((i) => [i.id, i.title]));
    const hits: MemoryHit[] = ranked.map((r) => ({
      id: r.id,
      title: titles.get(r.id) ?? r.id,
      score: r.score,
      excerpt: excerptFor(q, byId.get(r.id)?.text ?? ""),
    }));
    json(res, 200, { hits });
    return true;
  }

  json(res, 405, { error: "method not allowed" });
  return true;
}
