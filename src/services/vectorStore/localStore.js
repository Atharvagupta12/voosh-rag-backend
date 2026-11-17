// A zero-infrastructure vector store: points live in a JSON file and search is
// brute-force cosine similarity. Comfortably fast for a few thousand chunks,
// which is plenty for a news demo. Use Qdrant (QDRANT_URL) for anything larger.
import fs from "node:fs/promises";
import path from "node:path";

function norm(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s) || 1;
}

function cosine(a, aNorm, b, bNorm) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot / (aNorm * bNorm);
}

export function createLocalStore({ filePath, dimensions }) {
  /** @type {Map<string, {id: string, vector: Float32Array, norm: number, payload: object}>} */
  let points = null;
  let loading = null;

  async function load() {
    if (points) return points;
    loading ??= (async () => {
      points = new Map();
      try {
        const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
        if (raw.dimensions && raw.dimensions !== dimensions) {
          throw new Error(
            `Local index ${filePath} has dimension ${raw.dimensions}, expected ${dimensions}. Re-run ingestion.`
          );
        }
        for (const p of raw.points ?? []) {
          const vector = Float32Array.from(p.vector);
          points.set(p.id, { id: p.id, vector, norm: norm(vector), payload: p.payload });
        }
      } catch (err) {
        if (err.code !== "ENOENT") {
          points = null;
          loading = null;
          throw err;
        }
      }
      return points;
    })();
    return loading;
  }

  async function persist() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const data = {
      dimensions,
      updatedAt: new Date().toISOString(),
      points: [...points.values()].map((p) => ({
        id: p.id,
        payload: p.payload,
        vector: Array.from(p.vector, (x) => Math.round(x * 1e6) / 1e6),
      })),
    };
    const tmp = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, filePath);
  }

  return {
    kind: "local-file",

    async ensureCollection({ recreate = false } = {}) {
      await load();
      if (recreate) points.clear();
    },

    async upsert(newPoints) {
      await load();
      for (const p of newPoints) {
        if (p.vector.length !== dimensions) throw new Error(`Vector has ${p.vector.length} dims, expected ${dimensions}`);
        const vector = Float32Array.from(p.vector);
        points.set(String(p.id), { id: String(p.id), vector, norm: norm(vector), payload: p.payload });
      }
      await persist();
    },

    async search(vector, { limit, minScore = 0 }) {
      await load();
      const q = Float32Array.from(vector);
      const qNorm = norm(q);
      const scored = [];
      for (const p of points.values()) {
        const score = cosine(q, qNorm, p.vector, p.norm);
        if (score >= minScore) scored.push({ id: p.id, score, payload: p.payload });
      }
      return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    },

    async count() {
      await load();
      return points.size;
    },

    async listArticles() {
      await load();
      return [...points.values()].filter((p) => p.payload.chunkIndex === 0).map((p) => p.payload);
    },
  };
}
