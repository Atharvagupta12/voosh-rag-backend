import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkParagraphs } from "../src/lib/chunk.js";

const para = (n, len = 300) => `P${n} ${"x".repeat(len - 3 - String(n).length)}.`;

test("packs paragraphs into chunks no larger than maxChars", () => {
  const paragraphs = Array.from({ length: 12 }, (_, i) => para(i));
  const chunks = chunkParagraphs(paragraphs, { maxChars: 1000, overlapChars: 350 });
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 1000, `chunk too long: ${c.length}`);
});

test("keeps every paragraph and overlaps the boundary paragraph", () => {
  const paragraphs = Array.from({ length: 8 }, (_, i) => para(i));
  const chunks = chunkParagraphs(paragraphs, { maxChars: 1000, overlapChars: 350 });
  for (let i = 0; i < 8; i++) assert.ok(chunks.some((c) => c.includes(`P${i} `)), `P${i} missing`);
  // The last paragraph of chunk 0 starts chunk 1.
  const lastOfFirst = chunks[0].split("\n").at(-1);
  assert.ok(chunks[1].startsWith(lastOfFirst));
});

test("splits a single oversized paragraph by sentence", () => {
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
  const chunks = chunkParagraphs([long], { maxChars: 200 });
  assert.ok(chunks.length > 3);
  for (const c of chunks) assert.ok(c.length <= 200);
  assert.match(chunks[0], /^Sentence number 0/);
});

test("returns a single chunk for short input and nothing for empty input", () => {
  assert.deepEqual(chunkParagraphs(["Short paragraph."]), ["Short paragraph."]);
  assert.deepEqual(chunkParagraphs([]), []);
});
