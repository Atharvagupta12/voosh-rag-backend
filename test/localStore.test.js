import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createLocalStore } from "../src/services/vectorStore/localStore.js";

const tmpFile = () => path.join(os.tmpdir(), `dispatch-test-${process.pid}-${Math.random().toString(16).slice(2)}.json`);

test("upserts, searches by cosine similarity and persists to disk", async () => {
  const filePath = tmpFile();
  const store = createLocalStore({ filePath, dimensions: 3 });
  await store.ensureCollection({ recreate: true });
  await store.upsert([
    { id: "a", vector: [1, 0, 0], payload: { title: "A", chunkIndex: 0 } },
    { id: "b", vector: [0, 1, 0], payload: { title: "B", chunkIndex: 0 } },
    { id: "c", vector: [0.9, 0.1, 0], payload: { title: "C", chunkIndex: 1 } },
  ]);

  const hits = await store.search([1, 0, 0], { limit: 2, minScore: 0.5 });
  assert.deepEqual(hits.map((h) => h.id), ["a", "c"]);
  assert.ok(Math.abs(hits[0].score - 1) < 1e-6);

  assert.equal(await store.count(), 3);
  assert.deepEqual((await store.listArticles()).map((p) => p.title).sort(), ["A", "B"]);

  // A fresh instance reads the same data back from disk.
  const reopened = createLocalStore({ filePath, dimensions: 3 });
  assert.equal(await reopened.count(), 3);
  await fs.rm(filePath, { force: true });
});

test("upsert replaces points with the same id; recreate clears", async () => {
  const filePath = tmpFile();
  const store = createLocalStore({ filePath, dimensions: 2 });
  await store.upsert([{ id: "x", vector: [1, 0], payload: { v: 1 } }]);
  await store.upsert([{ id: "x", vector: [0, 1], payload: { v: 2 } }]);
  assert.equal(await store.count(), 1);
  const [hit] = await store.search([0, 1], { limit: 1 });
  assert.equal(hit.payload.v, 2);

  await store.ensureCollection({ recreate: true });
  assert.equal(await store.count(), 0);
  await fs.rm(filePath, { force: true });
});

test("rejects vectors with the wrong dimension", async () => {
  const store = createLocalStore({ filePath: tmpFile(), dimensions: 4 });
  await assert.rejects(store.upsert([{ id: "z", vector: [1, 2], payload: {} }]), /dims/);
});

test("a missing index file means an empty store", async () => {
  const store = createLocalStore({ filePath: tmpFile(), dimensions: 3 });
  assert.equal(await store.count(), 0);
  assert.deepEqual(await store.search([1, 0, 0], { limit: 5 }), []);
});
