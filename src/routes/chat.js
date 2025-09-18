import express from "express";
import { v4 as uuidv4 } from "uuid";
import { getAnswer } from "../services/retriever.js";
import redisClient from "../utils/redisClient.js";

const router = express.Router();

// Start chat session
router.post("/chat", async (req, res) => {
  try {
    const { sessionId, query } = req.body;
    const sid = sessionId || uuidv4();

    let answer;
    try {
      answer = await getAnswer(query);
    } catch (err) {
      console.error("Retriever error:", err.message);
      answer = ` (Dummy reply) You asked: "${query}"`;
    }

    // Save to Redis (optional)
    await redisClient.rpush(
      `session:${sid}`,
      JSON.stringify({ role: "user", text: query })
    );
    await redisClient.rpush(
      `session:${sid}`,
      JSON.stringify({ role: "bot", text: answer })
    );

    res.json({ sessionId: sid, answer });
  } catch (error) {
    console.error("Chat error:", error.message);
    res.status(500).json({ error: "Something went wrong in chat route" });
  }
});

// Fetch chat history (safe fallback if Redis not used)
router.get("/history/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const history = await redisClient.lrange(`session:${sessionId}`, 0, -1);
    res.json(history.map((h) => JSON.parse(h)));

    res.json([]); // empty history fallback
  } catch (err) {
    console.error("History error:", err.message);
    res.status(500).json({ error: "Could not fetch history" });
  }
});

// Reset session
router.delete("/reset/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    await redisClient.del(`session:${sessionId}`);
    res.json({ msg: "Session cleared" });
  } catch (err) {
    console.error("Reset error:", err.message);
    res.status(500).json({ error: "Could not reset session" });
  }
});

export default router;
