// Builds the news index: RSS feeds -> article pages -> clean text -> chunks ->
// Jina embeddings -> vector store (Qdrant or the local file index).
//
//   npm run ingest                 # rebuild the index with ~50 fresh articles
//   npm run ingest -- --limit=80   # more articles
//   npm run ingest -- --append     # keep existing points, add/update new ones
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { config } from "../config.js";
import { chunkParagraphs } from "../lib/chunk.js";
import { fetchText } from "../lib/http.js";
import { createLogger } from "../lib/logger.js";
import { embedDocuments } from "../services/embeddings.js";
import { vectorStore } from "../services/vectorStore/index.js";
import { FEEDS } from "./feeds.js";

const log = createLogger("ingest");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const LIMIT = Number.parseInt(args.limit, 10) || 50;
const APPEND = Boolean(args.append);
const CONCURRENCY = 4;
const MIN_ARTICLE_CHARS = 500;
const HEADERS = {
  "User-Agent": "DispatchNewsBot/2.0 (RAG demo; respectful single-pass fetch)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const BOILERPLATE =
  /^(sign up|subscribe|follow us|read more|related:|advertisement|share this|copyright|©|this article|image source|getty images|watch:|listen:|download the|we use cookies|support the guardian|skip past)/i;

/** Deterministic UUID (v5-shaped) so re-ingesting the same article overwrites, not duplicates. */
function stableId(input) {
  const h = createHash("sha1").update(input).digest("hex");
  const variant = ((Number.parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function cleanText(s) {
  return s.replace(/\s+/g, " ").trim();
}

function canonicalUrl(link) {
  try {
    const u = new URL(link);
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|at_|ns_|maca$)/.test(p)) u.searchParams.delete(p);
    return u.toString();
  } catch {
    return null;
  }
}

async function readFeed(feed) {
  const xml = await fetchText(feed.url, { headers: HEADERS });
  const $ = cheerio.load(xml, { xmlMode: true });
  return $("item")
    .map((_, el) => {
      const item = $(el);
      const link = canonicalUrl(item.find("link").first().text().trim() || item.find("guid").first().text().trim());
      return {
        ...feed,
        url: link,
        title: cleanText(item.find("title").first().text()),
        description: cleanText(cheerio.load(item.find("description").first().text() || "").text()),
        publishedAt: (() => {
          const d = new Date(item.find("pubDate").first().text());
          return Number.isNaN(d.getTime()) ? null : d.toISOString();
        })(),
      };
    })
    .get()
    .filter((a) => a.url && a.title && !/\/(live|video|videos|av|audio|gallery|picture)\//i.test(a.url));
}

function extractArticle(html) {
  const $ = cheerio.load(html);
  const meta = (name) =>
    $(`meta[property="${name}"]`).attr("content") || $(`meta[name="${name}"]`).attr("content") || null;

  const title = cleanText(meta("og:title") || $("h1").first().text() || "");
  const publishedAt = meta("article:published_time") || $("time[datetime]").first().attr("datetime") || null;

  $("script, style, noscript, nav, header, footer, aside, form, figure, figcaption, button, svg").remove();
  $('[role="complementary"], [aria-hidden="true"], [data-component="links-block"], .ad, .advert').remove();

  // Most specific article-body selectors first, generic fallbacks last.
  const selectors = [
    '[data-component="text-block"] p',
    '[data-gu-name="body"] p',
    "#maincontent p",
    ".wysiwyg p",
    ".rich-text p",
    "article p",
    "main p",
  ];
  for (const sel of selectors) {
    const paragraphs = $(sel)
      .map((_, el) => cleanText($(el).text()).replace(/, external(?=[\s.,;:!?)"”]|$)/g, ""))
      .get()
      .filter((p) => p.length > 40 && !BOILERPLATE.test(p));
    const unique = [...new Set(paragraphs)];
    if (unique.join(" ").length >= MIN_ARTICLE_CHARS) return { title, publishedAt, paragraphs: unique };
  }
  return { title, publishedAt, paragraphs: [] };
}

async function fetchArticle(item) {
  try {
    const html = await fetchText(item.url, { headers: HEADERS, timeoutMs: 20_000 });
    const page = extractArticle(html);
    if (!page.paragraphs.length) return null;
    return {
      url: item.url,
      title: item.title || page.title,
      source: item.source,
      topic: item.topic,
      publishedAt: item.publishedAt || (page.publishedAt ? new Date(page.publishedAt).toISOString() : null),
      paragraphs: page.paragraphs,
    };
  } catch (err) {
    log.debug(`skip ${item.url}: ${err.message}`);
    return null;
  }
}

/** Interleaves feeds so we don't take all articles from the first one. */
function roundRobin(lists) {
  const out = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

async function collectArticles() {
  const feedResults = await Promise.allSettled(FEEDS.map(readFeed));
  const lists = feedResults.map((r, i) => {
    if (r.status === "fulfilled") {
      log.info(`feed ok   ${FEEDS[i].source} / ${FEEDS[i].topic}: ${r.value.length} items`);
      return r.value;
    }
    log.warn(`feed fail ${FEEDS[i].source} / ${FEEDS[i].topic}: ${r.reason.message}`);
    return [];
  });

  const seenUrls = new Set();
  const seenTitles = new Set();
  const queue = roundRobin(lists).filter((item) => {
    const titleKey = item.title.toLowerCase();
    if (seenUrls.has(item.url) || seenTitles.has(titleKey)) return false;
    seenUrls.add(item.url);
    seenTitles.add(titleKey);
    return true;
  });
  if (!queue.length) throw new Error("No feed items found. Check your network connection.");

  const articles = [];
  let cursor = 0;
  async function worker() {
    while (articles.length < LIMIT && cursor < queue.length) {
      const item = queue[cursor++];
      const article = await fetchArticle(item);
      if (article && articles.length < LIMIT) {
        articles.push(article);
        log.info(`[${String(articles.length).padStart(2)}/${LIMIT}] ${article.source}: ${article.title.slice(0, 80)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return articles;
}

async function main() {
  const started = Date.now();
  log.info(`Target: ${LIMIT} articles → ${vectorStore.kind} index (${APPEND ? "append" : "fresh rebuild"})`);
  if (!config.jina.apiKey) throw new Error("JINA_API_KEY is not set in Backend/.env");

  const articles = await collectArticles();
  if (articles.length < LIMIT) log.warn(`Only ${articles.length} articles could be extracted.`);

  const points = [];
  for (const a of articles) {
    const chunks = chunkParagraphs(a.paragraphs);
    chunks.forEach((text, chunkIndex) => {
      points.push({
        id: stableId(`${a.url}#${chunkIndex}`),
        embedInput: `${a.title}\n\n${text}`,
        payload: {
          articleId: stableId(a.url),
          url: a.url,
          title: a.title,
          source: a.source,
          topic: a.topic,
          publishedAt: a.publishedAt,
          chunkIndex,
          chunkCount: chunks.length,
          text,
        },
      });
    });
  }
  log.info(`Embedding ${points.length} chunks from ${articles.length} articles…`);

  const vectors = await embedDocuments(
    points.map((p) => p.embedInput),
    { onProgress: (done, total) => log.info(`  embedded ${done}/${total}`) }
  );

  await vectorStore.ensureCollection({ recreate: !APPEND });
  await vectorStore.upsert(points.map((p, i) => ({ id: p.id, vector: vectors[i], payload: p.payload })));

  const total = await vectorStore.count();
  log.info(
    `Done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${articles.length} articles, ${points.length} chunks. Index now holds ${total} chunks.`
  );
}

main().catch((err) => {
  log.error(`Ingestion failed: ${err.message}`);
  process.exit(1);
});
