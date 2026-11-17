import assert from "node:assert/strict";
import { test } from "node:test";
import { detectBriefing, isFollowUp } from "../src/services/rag.js";

test("follow-up detection only triggers on context-dependent questions", () => {
  for (const q of ["Tell me more about that", "What about the second one?", "Why did they do it?", "Who is he?"]) {
    assert.equal(isFollowUp(q), true, q);
  }
  for (const q of ["best pasta recipe?", "What happened at COP31?", "Latest on UK unemployment"]) {
    assert.equal(isFollowUp(q), false, q);
  }
});

test("overview questions are briefings, with a topic when one is named", () => {
  assert.deepEqual(detectBriefing("What are the biggest stories right now?"), { topic: null });
  assert.deepEqual(detectBriefing("Give me a news briefing"), { topic: null });
  assert.deepEqual(detectBriefing("Summarise today's business and economy news"), { topic: "Business" });
  assert.deepEqual(detectBriefing("What's new in technology and AI?"), { topic: "Technology" });
  assert.deepEqual(detectBriefing("Any science news?"), { topic: "Science" });
});

test("specific, conversational or off-topic questions use semantic search", () => {
  for (const q of [
    "What's the latest news about the Crimean Bridge?",
    "What's happening with Nvidia?",
    "Why is Jensen Huang in the news?",
    "Tell me more about that",
    "best pasta recipe",
    "hello",
    "",
  ]) {
    assert.equal(detectBriefing(q), null, q);
  }
});
