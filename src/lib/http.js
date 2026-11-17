// Small fetch helpers: timeouts, retries with backoff, typed errors, SSE parsing.

export class HttpError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function combineSignals(...signals) {
  return AbortSignal.any(signals.filter(Boolean));
}

function isRetryable(err) {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  // Network-level failures (DNS, reset, timeout) surface as TypeError / TimeoutError.
  return err.name === "TimeoutError" || err instanceof TypeError;
}

async function readBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** fetch + JSON with a per-attempt timeout and exponential-backoff retries. */
export async function fetchJson(url, { timeoutMs = 15_000, retries = 0, signal, ...init } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: combineSignals(AbortSignal.timeout(timeoutMs), signal),
      });
      const body = await readBody(res);
      if (!res.ok) {
        throw new HttpError(`HTTP ${res.status} from ${new URL(url).host}`, { status: res.status, body });
      }
      return body;
    } catch (err) {
      if (signal?.aborted || attempt >= retries || !isRetryable(err)) throw err;
      await sleep(400 * 2 ** attempt + Math.random() * 200);
    }
  }
}

/** fetch text (e.g. HTML/RSS) with timeout + retries. */
export async function fetchText(url, { timeoutMs = 15_000, retries = 1, headers } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new HttpError(`HTTP ${res.status} for ${url}`, { status: res.status });
      return await res.text();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      await sleep(500 * 2 ** attempt);
    }
  }
}

/**
 * Opens a streaming POST request. The timeout applies only until response
 * headers arrive; the caller's signal can abort the stream at any time.
 */
export async function openStream(url, { headers, body, signal, headersTimeoutMs = 20_000 }) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(signal.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(new DOMException("Upstream timed out", "TimeoutError")), headersTimeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
    if (!res.ok) {
      const errBody = await readBody(res);
      throw new HttpError(`HTTP ${res.status} from ${new URL(url).host}`, { status: res.status, body: errBody });
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Yields the `data:` payload of each server-sent event in a fetch Response. */
export async function* readSse(response) {
  const decoder = new TextDecoder();
  let buffer = "";
  const boundary = /\r?\n\r?\n/;
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let match;
    while ((match = boundary.exec(buffer))) {
      const raw = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const data = raw
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data) yield data;
    }
  }
}
