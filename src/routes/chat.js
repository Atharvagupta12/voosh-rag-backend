import { randomUUID } from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";
import { HttpError } from "../lib/http.js";
import { NoProviderError } from "../services/llm.js";
import { answerQuestion, publicSource, RetrievalError } from "../services/rag.js";
import { sessionStore } from "../services/sessionStore.js";

const log = createLogger("chat");
const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.expose = true;
  }
}

const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: config.limits.chatPerMinute,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "You're sending messages too quickly. Please wait a moment and try again." },
});

function parseChatBody(body) {
  const { query, sessionId } = body ?? {};
  if (typeof query !== "string" || !query.trim()) throw new ValidationError("Please enter a question.");
  const trimmed = query.trim();
  if (trimmed.length > config.limits.maxQueryChars) {
    throw new ValidationError(`Questions can be at most ${config.limits.maxQueryChars} characters.`);
  }
  const sid = typeof sessionId === "string" && UUID_RE.test(sessionId) ? sessionId : randomUUID();
  return { query: trimmed, sessionId: sid };
}

function requireSessionId(req) {
  const { sessionId } = req.params;
  if (!UUID_RE.test(sessionId)) throw new ValidationError("Invalid session id.");
  return sessionId;
}

/** History is helpful but not essential: if the store is down, answer without it. */
async function loadHistory(sessionId) {
  try {
    return await sessionStore.history(sessionId);
  } catch (err) {
    log.warn(`Could not load history: ${err.message}`);
    return [];
  }
}

async function saveTurn(sessionId, query, result, extra = {}) {
  const now = new Date().toISOString();
  const messages = [{ id: randomUUID(), role: "user", content: query, createdAt: now }];
  if (result.answer.trim()) {
    messages.push({
      id: randomUUID(),
      role: "assistant",
      content: result.answer,
      sources: result.sources.map(publicSource),
      createdAt: new Date().toISOString(),
      ...extra,
    });
  }
  try {
    await sessionStore.append(sessionId, messages);
  } catch (err) {
    log.warn(`Could not save history: ${err.message}`);
  }
  return messages.at(-1).id;
}

function userFacingError(err) {
  if (err instanceof NoProviderError) return "The AI service isn't configured on the server yet.";
  if (err instanceof HttpError && [401, 403].includes(err.status)) {
    return "The AI service rejected the server's credentials. Please contact the site owner.";
  }
  if (err instanceof HttpError && err.status === 429) {
    return /quota|credits|billing/i.test(JSON.stringify(err.body ?? ""))
      ? "The AI service has run out of quota. Please try again later."
      : "The AI service is busy right now. Please try again in a moment.";
  }
  if (err instanceof RetrievalError) return "Couldn't search the news index right now. Please try again in a moment.";
  if (err instanceof TypeError || err?.name === "TimeoutError") {
    return "The AI service didn't respond. Please try again in a moment.";
  }
  return "Something went wrong while generating the answer. Please try again.";
}

// POST /api/chat/stream: answers as server-sent events.
// Events: session {sessionId} → sources {sources} → token {text}* → done {messageId, provider} | error {message}
router.post("/chat/stream", chatLimiter, async (req, res) => {
  const { query, sessionId } = parseChatBody(req.body);
  const history = await loadHistory(sessionId);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);

  const started = Date.now();
  let partial = { answer: "", sources: [] };
  send("session", { sessionId });

  try {
    const result = await answerQuestion({
      query,
      history,
      signal: controller.signal,
      onSources: (sources) => {
        partial.sources = sources;
        send("sources", { sources: sources.map(publicSource) });
      },
      onToken: (text) => {
        partial.answer += text;
        send("token", { text });
      },
    });
    const messageId = await saveTurn(sessionId, query, result);
    log.info(`answered (${query.length} chars, ${result.sources.length} sources, ${result.provider}) in ${Date.now() - started}ms`);
    send("done", { messageId, provider: result.provider });
  } catch (err) {
    if (controller.signal.aborted) {
      log.info("client disconnected; saving partial answer");
      await saveTurn(sessionId, query, partial, { stopped: true });
    } else {
      log.error(`stream failed: ${err.message}`);
      send("error", { message: userFacingError(err) });
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

// POST /api/chat: same pipeline, single JSON response.
router.post("/chat", chatLimiter, async (req, res) => {
  const { query, sessionId } = parseChatBody(req.body);
  const history = await loadHistory(sessionId);
  try {
    const result = await answerQuestion({ query, history });
    const messageId = await saveTurn(sessionId, query, result);
    res.json({
      sessionId,
      messageId,
      answer: result.answer,
      sources: result.sources.map(publicSource),
      provider: result.provider,
    });
  } catch (err) {
    log.error(`chat failed: ${err.message}`);
    res.status(502).json({ error: userFacingError(err) });
  }
});

// GET /api/sessions/:sessionId/messages
async function getHistory(req, res) {
  const sessionId = requireSessionId(req);
  const [messages, ttlSeconds] = await Promise.all([sessionStore.history(sessionId), sessionStore.ttl(sessionId)]);
  res.json({ sessionId, messages, ttlSeconds });
}

// DELETE /api/sessions/:sessionId
async function clearSession(req, res) {
  const sessionId = requireSessionId(req);
  await sessionStore.clear(sessionId);
  res.json({ sessionId, cleared: true });
}

router.get("/sessions/:sessionId/messages", getHistory);
router.delete("/sessions/:sessionId", clearSession);
// Backwards-compatible aliases for the original API.
router.get("/history/:sessionId", getHistory);
router.delete("/reset/:sessionId", clearSession);

export default router;
