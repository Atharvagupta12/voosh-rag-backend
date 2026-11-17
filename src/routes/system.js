import express from "express";
import { config, describeConfig } from "../config.js";
import { getCatalog } from "../services/catalog.js";
import { availableProviders } from "../services/llm.js";
import { sessionStore } from "../services/sessionStore.js";
import { vectorStore } from "../services/vectorStore/index.js";

const router = express.Router();

const withTimeout = (promise, ms = 5_000) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), ms))]);

// GET /api/health: dependency status, used for uptime checks and debugging.
router.get("/health", async (_req, res) => {
  const [index, sessions] = await Promise.allSettled([
    withTimeout(vectorStore.count()),
    withTimeout(sessionStore.ping()),
  ]);
  const llm = availableProviders();
  const body = {
    status: "ok",
    ...describeConfig(),
    index: index.status === "fulfilled" ? { ok: true, chunks: index.value } : { ok: false, error: index.reason.message },
    sessions: sessions.status === "fulfilled" ? { ok: true } : { ok: false, error: sessions.reason.message },
    llm: { ok: llm.length > 0, active: llm },
    sessionTtlSeconds: config.session.ttlSeconds,
  };
  const healthy = body.index.ok && body.index.chunks > 0 && body.sessions.ok && body.llm.ok && body.embeddings !== "missing";
  if (!healthy) body.status = "degraded";
  res.status(healthy ? 200 : 503).json(body);
});

// GET /api/meta: what's in the index (for the landing page and suggestions).
router.get("/meta", async (_req, res) => {
  const articles = await withTimeout(getCatalog(), 10_000);
  res.set("Cache-Control", "public, max-age=60");
  res.json({
    articleCount: articles.length,
    sources: [...new Set(articles.map((a) => a.source).filter(Boolean))].sort(),
    latestPublishedAt: articles[0]?.publishedAt ?? null,
    headlines: articles.slice(0, 12).map(({ title, url, source, publishedAt, topic }) => ({
      title,
      url,
      source,
      publishedAt,
      topic: topic ?? null,
    })),
    sessionTtlSeconds: config.session.ttlSeconds,
  });
});

export default router;
