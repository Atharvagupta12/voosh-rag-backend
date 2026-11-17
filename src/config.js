// Central configuration. Every module reads settings from here, and this file
// loads .env before anything else touches process.env.
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(rootDir, ".env"), quiet: true });

const env = process.env;
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const int = (v, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const num = (v, d) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : d;
};
const list = (v, d) =>
  str(v) ? v.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean) : d;

export const config = Object.freeze({
  env: env.NODE_ENV || "development",
  port: int(env.PORT, 5000),
  rootDir,

  allowedOrigins: list(env.ALLOWED_ORIGINS, [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "https://voosh-rag-frontend-hazel.vercel.app",
  ]),

  jina: {
    apiKey: str(env.JINA_API_KEY),
    model: str(env.JINA_MODEL) || "jina-embeddings-v2-base-en",
    dimensions: int(env.EMBEDDING_DIMENSIONS, 768),
  },

  gemini: {
    apiKey: str(env.GEMINI_API_KEY),
    model: str(env.GEMINI_MODEL) || "gemini-2.5-flash",
  },

  // Groq: free tier, OpenAI-compatible API, fast open models. Key: https://console.groq.com/keys
  groq: {
    apiKey: str(env.GROQ_API_KEY),
    model: str(env.GROQ_MODEL) || "openai/gpt-oss-120b",
    baseUrl: (str(env.GROQ_BASE_URL) || "https://api.groq.com/openai/v1").replace(/\/+$/, ""),
  },

  openai: {
    apiKey: str(env.OPENAI_API_KEY),
    model: str(env.OPENAI_MODEL) || "gpt-4o-mini",
    // Any OpenAI-compatible endpoint works (OpenRouter, Groq, Ollama, Azure proxy…).
    baseUrl: (str(env.OPENAI_BASE_URL) || "https://api.openai.com/v1").replace(/\/+$/, ""),
  },

  qdrant: {
    url: str(env.QDRANT_URL),
    apiKey: str(env.QDRANT_API_KEY),
    collection: str(env.QDRANT_COLLECTION) || "news_articles",
  },

  // Used when QDRANT_URL is not set.
  localIndexPath: path.resolve(rootDir, str(env.LOCAL_INDEX_PATH) || "data/news-index.json"),

  redisUrl: str(env.REDIS_URL),

  session: {
    ttlSeconds: int(env.SESSION_TTL_SECONDS, 60 * 60 * 24),
    maxMessages: int(env.SESSION_MAX_MESSAGES, 100),
  },

  rag: {
    topK: int(env.RAG_TOP_K, 6),
    // Tuned for jina-embeddings-v2: on-topic news queries score ≥ 0.77,
    // off-topic ones ("hello", recipes, trivia) stay below ~0.73.
    minScore: num(env.RAG_MIN_SCORE, 0.74),
    // Drop hits far below the best one, so marginal passages don't dilute the context.
    relativeCutoff: num(env.RAG_RELATIVE_CUTOFF, 0.1),
    historyMessages: int(env.RAG_HISTORY_MESSAGES, 6),
  },

  limits: {
    maxQueryChars: int(env.MAX_QUERY_CHARS, 1000),
    chatPerMinute: int(env.RATE_LIMIT_PER_MINUTE, 20),
  },
});

export function describeConfig() {
  return {
    vectorStore: config.qdrant.url ? "qdrant" : "local-file",
    sessionStore: config.redisUrl ? "redis" : "memory",
    llmProviders: [
      config.gemini.apiKey && "gemini",
      config.groq.apiKey && "groq",
      config.openai.apiKey && "openai",
    ].filter(Boolean),
    embeddings: config.jina.apiKey ? "jina" : "missing",
  };
}
