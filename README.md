# Dispatch: backend

The API for **Dispatch**, a RAG-powered news chatbot. It answers questions about recent news
using retrieved article passages, cites its sources, streams responses and keeps per-session chat
history with an expiry.

**Stack:** Node.js 20+ · Express 5 · Jina embeddings · Qdrant (or a local file index) · Gemini
(OpenAI-compatible fallback) · Redis (or in-memory sessions)

---

## Quick start

```bash
cd Backend
npm install
cp .env.example .env        # add JINA_API_KEY and GEMINI_API_KEY (or OPENAI_API_KEY)
npm run ingest              # fetch ~50 articles, chunk, embed, index (~2 min)
npm run dev                 # http://localhost:5000
```

No Docker is needed. If `QDRANT_URL` and `REDIS_URL` are unset, the index is a JSON file
(`data/news-index.json`) and sessions live in memory. To use real infrastructure locally:

```bash
docker compose up -d        # from the repo root: Qdrant on :6333, Redis on :6379
# Backend/.env
QDRANT_URL=http://localhost:6333
REDIS_URL=redis://localhost:6379
npm run ingest              # re-ingest into Qdrant
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm start` | Run the server (production) |
| `npm run dev` | Run with auto-restart on file changes |
| `npm run ingest` | Rebuild the index. `-- --limit=80` for more articles, `-- --append` to keep existing points |
| `npm run ask -- "question"` | Ask the pipeline from the terminal (prints sources and scores) |
| `npm test` | Unit and API tests (`node:test`, no external services needed) |

`GET /api/health` reports what's connected:
`{"vectorStore":"local-file","sessionStore":"memory","llm":{"active":["gemini","openai"]},"index":{"chunks":303}, …}`

---

## How it works

```
                      ┌────────────── ingestion (npm run ingest) ──────────────┐
 RSS feeds (BBC, Guardian, Al Jazeera, DW, CBS) → article pages → clean paragraphs
   → ~1,100-char chunks with 1-paragraph overlap → Jina embeddings (batched)
   → vector store (Qdrant / local file), deterministic IDs
                      └────────────────────────────────────────────────────────┘

 POST /api/chat/stream
   1. validate input, load session history (Redis)
   2. retrieve
        • overview questions ("top stories", "today's tech news") → newest articles (by topic)
        • everything else → embed question (+ previous exchange for follow-ups)
          → top-k cosine search → score threshold + relative cutoff → group by article
   3. prompt: grounded system prompt + last 6 history messages + numbered excerpts
   4. stream tokens from Gemini (fallback: OpenAI-compatible) as server-sent events
   5. append user + assistant messages to the session (sliding TTL)
```

### Key decisions

- **Chunking with overlap.** Articles are split on paragraph boundaries into passages of about
  1,100 characters. Each passage starts with the last paragraph of the previous one, so facts that
  span a boundary stay retrievable. Each passage is embedded together with its headline.
- **Stable IDs.** Point IDs are UUIDs derived from `url#chunkIndex`. Re-ingesting updates articles
  in place instead of duplicating them.
- **Relevance filtering.** Hits below `RAG_MIN_SCORE` (0.74, tuned for Jina v2) or more than 0.1
  below the best hit are dropped. Off-topic questions get no context, and the model says it doesn't
  know instead of guessing.
- **Briefing mode.** "What are the top stories?" has no meaningful embedding match, so overview
  questions (detected by vocabulary) use the most recent articles instead, filtered by topic when
  one is named.
- **Follow-ups.** Short, context-dependent questions ("tell me more about the second one") are also
  searched together with the previous question and answer. History is sent to the LLM with old
  citation numbers removed.
- **Grounded prompt.** The model may only use the numbered excerpts. It must cite them as `[n]`, say
  when the excerpts don't answer the question, and ignore instructions found inside excerpts.
- **Provider fallback.** Gemini is tried first, then OpenAI or any OpenAI-compatible API. Fallback
  happens only before the first token, so an answer never mixes two models. Providers that fail
  with bad credentials, an unknown model or no quota are switched off for 10 minutes instead of
  being retried on every request.
- **Streaming.** Answers are server-sent events over a POST request. If the client disconnects,
  the upstream LLM request is aborted and the partial answer is saved, marked as stopped.

---

## Caching and session expiry (TTL)

| What | Where | TTL / policy | Why |
| --- | --- | --- | --- |
| Chat history | Redis list `session:{id}:messages` | **24 h sliding** (`SESSION_TTL_SECONDS`), refreshed on every read and write | Sessions clean themselves up, so there's no cron job and no unbounded growth |
| History length | same list | `LTRIM` to the last 100 messages (`SESSION_MAX_MESSAGES`) | Caps memory for very long chats |
| Query embeddings | in-process LRU | 500 entries | Repeated and suggested questions skip the Jina call (~0.5–5 s saved) |
| Article catalog (`/api/meta`, briefings) | in-process | 5 min | Avoids a full index scan on every landing-page view |
| `/api/meta` response | HTTP `Cache-Control` | `max-age=60` | Browsers and CDNs can reuse it |

Each turn is written with one atomic `MULTI` (`RPUSH` + `LTRIM` + `EXPIRE`), so a crash can't
leave a list without a TTL.

**Cache warming.** Run `npm run ingest` before serving traffic, e.g. as a Render job or cron
(`0 */6 * * *`), so the index stays fresh. The first `/api/meta` call loads the article catalog,
and the frontend makes that call on page load, which also wakes a sleeping free-tier server.

**Production notes.**
- Use a managed Redis (Upstash: `rediss://` URL) so sessions survive restarts and scale across
  instances.
- In-memory sessions are fine for development, but they reset when the process restarts.
- For a larger index, use Qdrant. The local JSON index is brute-force search, which is fast up to a
  few thousand chunks.

---

## API

All routes are under `/api`. Errors are JSON: `{ "error": "message" }`.

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/chat/stream` | Ask a question; responds with server-sent events (below) |
| `POST` | `/chat` | Same pipeline, single JSON response: `{ sessionId, messageId, answer, sources, provider }` |
| `GET` | `/sessions/:id/messages` | History: `{ sessionId, messages[], ttlSeconds }` |
| `DELETE` | `/sessions/:id` | Clear a session |
| `GET` | `/meta` | Index summary: `{ articleCount, sources[], latestPublishedAt, headlines[], sessionTtlSeconds }` |
| `GET` | `/health` | Dependency status (503 when degraded) |
| | `/history/:id`, `/reset/:id` | Aliases kept for the original API |

**Request body** for the chat endpoints: `{ "query": "string (1–1000 chars)", "sessionId": "uuid?" }`.
Omit `sessionId` (or send an unknown one) to start a session; the response returns its ID.

**Stream events** (`POST /chat/stream`):

```
event: session   data: {"sessionId":"…"}
event: sources   data: {"sources":[{"n":1,"title":"…","url":"…","source":"BBC News","publishedAt":"…"}]}
event: token     data: {"text":"Partial "}          (repeated)
event: done      data: {"messageId":"…","provider":"gemini"}
event: error     data: {"message":"user-facing error"}
```

The answer cites sources inline as `[n]`, matching `sources[].n`.

**Limits:** 20 chat requests per minute per IP (`RATE_LIMIT_PER_MINUTE`), 16 KB request body.
Every external call has a timeout, and retries use backoff.

---

## Configuration

All settings are environment variables. See [.env.example](.env.example) for the full list with
defaults. The essentials:

| Variable | Required | Default |
| --- | --- | --- |
| `JINA_API_KEY` | yes | |
| `GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENAI_API_KEY` | at least one (tried in that order) | |
| `GEMINI_MODEL` | | `gemini-2.5-flash` |
| `GROQ_MODEL` | | `openai/gpt-oss-120b` (free tier: [console.groq.com/keys](https://console.groq.com/keys)) |
| `OPENAI_MODEL` / `OPENAI_BASE_URL` | | `gpt-4o-mini` / OpenAI |
| `QDRANT_URL` / `QDRANT_API_KEY` | | local file index |
| `REDIS_URL` | | in-memory sessions |
| `ALLOWED_ORIGINS` | | localhost + the Vercel frontend |
| `SESSION_TTL_SECONDS` | | `86400` |

---

## Project structure

```
src/
├── index.js                 server start-up, graceful shutdown
├── app.js                   express app: security headers, CORS, routes, errors
├── config.js                all configuration (loads .env first)
├── routes/
│   ├── chat.js              chat (SSE + JSON), sessions, validation, rate limit
│   └── system.js            health, meta
├── services/
│   ├── rag.js               retrieval, briefing/follow-up logic, prompt, answer
│   ├── llm.js               Gemini / OpenAI streaming with fallback + circuit breaker
│   ├── embeddings.js        Jina client (batching, retries, query cache)
│   ├── sessionStore.js      Redis or in-memory history with TTL
│   ├── catalog.js           cached article list
│   └── vectorStore/         Qdrant and local-file implementations, same interface
├── lib/                     chunking, HTTP/SSE helpers, logger
└── scripts/
    ├── ingest.js            RSS → articles → chunks → embeddings → index
    ├── feeds.js             news sources
    └── ask.js               CLI question
test/                        node:test suites
data/news-index.json         local index (generated by npm run ingest)
```

---

## Deploying (Render)

- **Build:** `npm install`. **Start:** `npm start`. **Node:** 20 or newer.
- **Environment:** set `JINA_API_KEY`, `GEMINI_API_KEY` and/or `OPENAI_API_KEY`, and
  `ALLOWED_ORIGINS=https://<your-frontend>`.
- **Index:** either set `QDRANT_URL` and `QDRANT_API_KEY` (Qdrant Cloud) and run
  `npm run ingest` once, or commit `data/news-index.json` so the local index ships with the app.
- **Sessions:** set `REDIS_URL` to a `rediss://` Upstash URL to keep sessions across restarts.
- **Health check path:** `/api/health`.
