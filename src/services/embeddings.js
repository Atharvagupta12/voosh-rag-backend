import { config } from "../config.js";
import { fetchJson } from "../lib/http.js";

const JINA_URL = "https://api.jina.ai/v1/embeddings";
const BATCH_SIZE = 32;

// Small LRU cache for query embeddings: repeated or suggested questions skip the API call.
const QUERY_CACHE_MAX = 500;
const queryCache = new Map();

async function callJina(input, signal, { timeoutMs = 30_000, retries = 3 } = {}) {
  if (!config.jina.apiKey) throw new Error("JINA_API_KEY is not set");
  const body = await fetchJson(JINA_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.jina.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: config.jina.model, input }),
    timeoutMs,
    retries,
    signal,
  });
  const data = Array.isArray(body?.data) ? [...body.data].sort((a, b) => a.index - b.index) : [];
  if (data.length !== input.length || data.some((d) => !Array.isArray(d.embedding))) {
    throw new Error("Embedding API returned an unexpected response");
  }
  return data.map((d) => d.embedding);
}

/** Embeds many texts (documents), batching requests. */
export async function embedDocuments(texts, { signal, onProgress } = {}) {
  const vectors = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    vectors.push(...(await callJina(texts.slice(i, i + BATCH_SIZE), signal)));
    onProgress?.(Math.min(i + BATCH_SIZE, texts.length), texts.length);
  }
  return vectors;
}

/** Embeds user queries, with an in-memory LRU cache. */
export async function embedQueries(queries, { signal } = {}) {
  const keys = queries.map((q) => q.trim().toLowerCase());
  const missing = [...new Set(keys.filter((k) => !queryCache.has(k)))];
  if (missing.length) {
    // Jina's free tier can take 10–25 s at busy times; wait for it rather than fail.
    const vectors = await callJina(missing, signal, { timeoutMs: 30_000, retries: 1 });
    missing.forEach((k, i) => {
      queryCache.set(k, vectors[i]);
      if (queryCache.size > QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value);
    });
  }
  return keys.map((k) => {
    const v = queryCache.get(k);
    queryCache.delete(k); // refresh LRU position
    queryCache.set(k, v);
    return v;
  });
}
