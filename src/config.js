import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: process.env.PORT || 5000,
  geminiApiKey: process.env.GEMINI_API_KEY,
  qdrantUrl: process.env.QDRANT_URL,
  redisUrl: process.env.REDIS_URL,
};
