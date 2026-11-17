// Streaming chat completions. Gemini is preferred; OpenAI is the fallback.
// Fallback only happens before the first token, so an answer is never stitched
// together from two models. Providers with bad credentials or an unknown model
// are switched off for a while instead of being retried on every request.
import { config } from "../config.js";
import { HttpError, openStream, readSse } from "../lib/http.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("llm");
const DISABLE_FOR_MS = 10 * 60 * 1000;
const disabledUntil = new Map();
const lastFailure = new Map(); // provider -> { at, error } for fail-fast while all are cooling down

const GENERATION = { temperature: 0.3, maxOutputTokens: 2048 };

async function* streamGemini({ system, messages, signal }) {
  const { apiKey, model } = config.gemini;
  const generationConfig = { ...GENERATION };
  // 2.5 Flash "thinks" by default; for short grounded answers that only adds latency.
  if (/^gemini-2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const res = await openStream(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig,
      }),
      signal,
    }
  );

  for await (const data of readSse(res)) {
    const chunk = JSON.parse(data);
    if (chunk.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the prompt (${chunk.promptFeedback.blockReason})`);
    }
    const text = (chunk.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("");
    if (text) yield text;
  }
}

/** Any OpenAI-compatible chat completions API (OpenAI, Groq, OpenRouter, Ollama…). */
async function* streamOpenAICompatible({ apiKey, model, baseUrl }, { system, messages, signal }) {
  const body = {
    model,
    stream: true,
    temperature: GENERATION.temperature,
    max_tokens: GENERATION.maxOutputTokens,
    messages: [{ role: "system", content: system }, ...messages],
  };
  // gpt-oss models reason before answering; grounded news answers don't need much of it.
  if (/gpt-oss/.test(model)) body.reasoning_effort = "low";

  const res = await openStream(`${baseUrl}/chat/completions`, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  });

  for await (const data of readSse(res)) {
    if (data === "[DONE]") return;
    const text = JSON.parse(data).choices?.[0]?.delta?.content;
    if (text) yield text;
  }
}

const PROVIDERS = [
  { name: "gemini", configured: () => Boolean(config.gemini.apiKey), stream: streamGemini },
  { name: "groq", configured: () => Boolean(config.groq.apiKey), stream: (o) => streamOpenAICompatible(config.groq, o) },
  { name: "openai", configured: () => Boolean(config.openai.apiKey), stream: (o) => streamOpenAICompatible(config.openai, o) },
];

function describeError(err) {
  const msg = err.body?.error?.message ?? (typeof err.body === "string" ? err.body : "");
  return `${err.message}${msg ? `: ${String(msg).slice(0, 200)}` : ""}`;
}

/** Credential or model errors won't fix themselves, so stop calling that provider for a while. */
function isPermanent(err) {
  if (!(err instanceof HttpError)) return false;
  if ([401, 403, 404].includes(err.status)) return true;
  const body = JSON.stringify(err.body ?? "");
  if (err.status === 429 && /insufficient_quota|no credits|billing/i.test(body)) return true;
  return err.status === 400 && /api[ _]key|model/i.test(body);
}

export function availableProviders() {
  return PROVIDERS.filter((p) => p.configured() && (disabledUntil.get(p.name) ?? 0) <= Date.now()).map(
    (p) => p.name
  );
}

export class NoProviderError extends Error {
  constructor() {
    super("No LLM provider is configured. Set GEMINI_API_KEY, GROQ_API_KEY or OPENAI_API_KEY.");
    this.name = "NoProviderError";
  }
}

/**
 * Streams a completion. Yields text deltas; calls onProvider(name) once a
 * provider starts producing output.
 */
export async function* streamCompletion({ system, messages, signal, onProvider }) {
  if (!PROVIDERS.some((p) => p.configured())) throw new NoProviderError();
  const candidates = PROVIDERS.filter((p) => availableProviders().includes(p.name));
  if (!candidates.length) {
    // Every configured provider is cooling down after a credential/model/quota error:
    // fail fast with the most recent cause instead of hammering them on every request.
    const latest = [...lastFailure.values()].sort((a, b) => b.at - a.at)[0];
    throw latest?.error ?? new NoProviderError();
  }

  let lastError;
  for (const provider of candidates) {
    let started = false;
    try {
      for await (const text of provider.stream({ system, messages, signal })) {
        if (!started) {
          started = true;
          onProvider?.(provider.name);
        }
        yield text;
      }
      if (started) return;
      lastError = new Error(`${provider.name} returned an empty response`);
      log.warn(lastError.message);
    } catch (err) {
      if (signal?.aborted || started) throw err;
      lastError = err;
      log.warn(`${provider.name} failed: ${describeError(err)}`);
      if (isPermanent(err)) {
        disabledUntil.set(provider.name, Date.now() + DISABLE_FOR_MS);
        lastFailure.set(provider.name, { at: Date.now(), error: err });
        log.warn(`${provider.name} disabled for ${DISABLE_FOR_MS / 60000} min (check its API key / model)`);
      }
    }
  }
  throw lastError;
}
