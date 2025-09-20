import express from "express";
import { v4 as uuidv4 } from "uuid";
import { getAnswer } from "../services/retriever.js";
import redisClient from "../utils/redisClient.js";

const router = express.Router();

router.post("/chat", async (req, res) => {
  try {
    const { sessionId, query } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    const sid = sessionId || uuidv4();
    let answer;

    try {
      console.log(`[Chat] Generating answer for query: "${query}"`);
      answer = await getAnswer(query);
      console.log(`[Chat] Answer generated: "${answer}"`);
    } catch (err) {
      console.error("[Chat] Retriever error:", err);
      answer = ` (Dummy reply) You asked: "${query}"`;
    }

    // Save user query and bot answer to Redis
    try {
      await redisClient.rpush(
        `session:${sid}`,
        JSON.stringify({ role: "user", text: query })
      );
      await redisClient.rpush(
        `session:${sid}`,
        JSON.stringify({ role: "bot", text: answer })
      );
      console.log(`[Chat] Saved conversation in Redis for session: ${sid}`);
    } catch (err) {
      console.error("[Chat] Redis error:", err);
    }

    res.json({ sessionId: sid, answer });
  } catch (err) {
    console.error("[Chat] General error:", err);
    res.status(500).json({ error: "Something went wrong in chat route" });
  }
});

// =======================
// GET /api/history/:sessionId
// =======================
router.get("/history/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    let history = [];
    try {
      const data = await redisClient.lrange(`session:${sessionId}`, 0, -1);
      history = data.map((item) => JSON.parse(item));
      console.log(`[History] Fetched history for session: ${sessionId}`);
    } catch (err) {
      console.error("[History] Redis error:", err);
    }

    res.json(history);
  } catch (err) {
    console.error("[History] General error:", err);
    res.status(500).json({ error: "Could not fetch history" });
  }
});

// =======================
// DELETE /api/reset/:sessionId
// =======================
router.delete("/reset/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    try {
      await redisClient.del(`session:${sessionId}`);
      console.log(`[Reset] Cleared session: ${sessionId}`);
      res.json({ msg: "Session cleared" });
    } catch (err) {
      console.error("[Reset] Redis error:", err);
      res.status(500).json({ error: "Could not reset session" });
    }
  } catch (err) {
    console.error("[Reset] General error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

export default router;
