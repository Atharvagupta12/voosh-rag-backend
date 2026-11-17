// A cached list of indexed articles (one payload per article, newest first).
// Used by /api/meta and by "briefing" questions that want recent coverage
// rather than semantic matches.
import { vectorStore } from "./vectorStore/index.js";

const TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, articles: null, pending: null };

export async function getCatalog() {
  if (cache.articles && Date.now() - cache.at < TTL_MS) return cache.articles;
  cache.pending ??= vectorStore
    .listArticles()
    .then((list) => {
      const articles = list
        .filter((a) => a.title && a.url)
        .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
      cache = { at: Date.now(), articles, pending: null };
      return articles;
    })
    .catch((err) => {
      cache.pending = null;
      throw err;
    });
  return cache.pending;
}

export function invalidateCatalog() {
  cache = { at: 0, articles: null, pending: null };
}
