import { QdrantClient } from "@qdrant/js-client-rest";

const UPSERT_BATCH = 64;

export function createQdrantStore({ url, apiKey, collection, dimensions }) {
  const client = new QdrantClient({ url, apiKey, checkCompatibility: false, timeout: 20_000 });

  return {
    kind: "qdrant",

    async ensureCollection({ recreate = false } = {}) {
      const { exists } = await client.collectionExists(collection);
      if (exists && recreate) await client.deleteCollection(collection);
      if (!exists || recreate) {
        await client.createCollection(collection, {
          vectors: { size: dimensions, distance: "Cosine" },
        });
        await client.createPayloadIndex(collection, { field_name: "chunkIndex", field_schema: "integer", wait: true });
        return;
      }
      const info = await client.getCollection(collection);
      const size = info.config?.params?.vectors?.size;
      if (size && size !== dimensions) {
        throw new Error(
          `Qdrant collection "${collection}" has vector size ${size}, expected ${dimensions}. Re-run ingestion with --fresh.`
        );
      }
    },

    async upsert(points) {
      for (let i = 0; i < points.length; i += UPSERT_BATCH) {
        await client.upsert(collection, { wait: true, points: points.slice(i, i + UPSERT_BATCH) });
      }
    },

    async search(vector, { limit, minScore }) {
      const res = await client.query(collection, {
        query: vector,
        limit,
        with_payload: true,
        score_threshold: minScore,
      });
      return res.points.map((p) => ({ id: String(p.id), score: p.score, payload: p.payload }));
    },

    async count() {
      const { exists } = await client.collectionExists(collection);
      if (!exists) return 0;
      const { count } = await client.count(collection, { exact: true });
      return count;
    },

    /** Returns one payload per article (the first chunk). */
    async listArticles(limit = 250) {
      const { exists } = await client.collectionExists(collection);
      if (!exists) return [];
      const res = await client.scroll(collection, {
        filter: { must: [{ key: "chunkIndex", match: { value: 0 } }] },
        limit,
        with_payload: true,
        with_vector: false,
      });
      return res.points.map((p) => p.payload);
    },
  };
}
