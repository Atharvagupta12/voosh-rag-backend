import { getGeminiResponse } from "./gemini.js";
import { getEmbedding } from "./embeddings.js";
import { searchArticles } from "./qdrant.js";

export async function getAnswer(query) {
  try {
    const queryEmbedding = await getEmbedding(query);
    if (!queryEmbedding) return " Could not generate embedding.";

    const topArticles = await searchArticles(queryEmbedding, 3);
    const context = topArticles.join("\n\n");

    const response = await getGeminiResponse(query, context);
    return response;
  } catch (err) {
    console.error("Retriever Error:", err.message);
    return "Error retrieving answer.";
  }
}
