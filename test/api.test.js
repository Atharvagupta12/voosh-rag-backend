// HTTP-level tests that need no external services: validation, sessions, errors.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

process.env.REDIS_URL = ""; // force the in-memory session store
process.env.LOG_LEVEL = "error";

const { createApp } = await import("../src/app.js");
const { sessionStore } = await import("../src/services/sessionStore.js");

let server;
let base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await sessionStore.close();
  await new Promise((r) => server.close(r));
});

const post = (path, body, raw) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });

test("rejects empty, non-string and oversized questions", async () => {
  for (const body of [{}, { query: "   " }, { query: 42 }, { query: "x".repeat(5000) }]) {
    const res = await post("/api/chat", body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40));
    assert.ok((await res.json()).error);
  }
});

test("malformed JSON gets a clean 400", async () => {
  const res = await post("/api/chat", null, "{oops");
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "Request body must be valid JSON.");
});

test("session history round-trip and clear", async () => {
  const id = crypto.randomUUID();
  await sessionStore.append(id, [
    { id: "1", role: "user", content: "hi" },
    { id: "2", role: "assistant", content: "hello", sources: [] },
  ]);

  let res = await fetch(`${base}/api/sessions/${id}/messages`);
  let body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.messages.map((m) => m.role), ["user", "assistant"]);
  assert.ok(body.ttlSeconds > 0);

  // Legacy alias still works.
  res = await fetch(`${base}/api/history/${id}`);
  assert.equal((await res.json()).messages.length, 2);

  res = await fetch(`${base}/api/sessions/${id}`, { method: "DELETE" });
  assert.equal(res.status, 200);
  res = await fetch(`${base}/api/sessions/${id}/messages`);
  assert.deepEqual((await res.json()).messages, []);
});

test("invalid session ids are rejected", async () => {
  const res = await fetch(`${base}/api/sessions/not-a-uuid/messages`);
  assert.equal(res.status, 400);
});

test("unknown routes return JSON 404", async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /Not found/);
});

test("CORS allows configured origins only", async () => {
  const ok = await fetch(`${base}/api/meta`, { headers: { Origin: "http://localhost:5173" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:5173");
  const bad = await fetch(`${base}/api/meta`, { headers: { Origin: "https://evil.example" } });
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});
