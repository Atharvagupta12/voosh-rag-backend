import assert from "node:assert/strict";
import { test } from "node:test";
import { readSse } from "../src/lib/http.js";

function responseFrom(chunks) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    })
  );
}

test("readSse yields data payloads across arbitrary chunk boundaries", async () => {
  const res = responseFrom(['data: {"a":1}\n', "\ndata: {\"b\"", ':2}\r\n\r\n: comment\n\ndata: [DONE]\n\n']);
  const out = [];
  for await (const d of readSse(res)) out.push(d);
  assert.deepEqual(out, ['{"a":1}', '{"b":2}', "[DONE]"]);
});

test("readSse joins multi-line data fields", async () => {
  const res = responseFrom(["event: x\ndata: line1\ndata: line2\n\n"]);
  const out = [];
  for await (const d of readSse(res)) out.push(d);
  assert.deepEqual(out, ["line1\nline2"]);
});
