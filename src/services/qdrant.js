import { QdrantClient } from "@qdrant/js-client-rest";
// import config from "../config.js";

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL || "http://localhost:6333"
});

const COLLECTION_NAME = "news_articles";

export async function initCollection() {
  try {
    await qdrant.getCollection(COLLECTION_NAME);
    console.log(" Qdrant collection exists");
  } catch {
    console.log(" Creating collection in Qdrant...");
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: { size: 768, distance: "Cosine" } // 768 = embedding dimension (Jina base model)
    });
  }
}

export async function insertArticle(id, text, embedding) {
  await qdrant.upsert(COLLECTION_NAME, {
    points: [
      {
        id,
        vector: embedding,
        payload: { text }
      }
    ]
  });
}

export async function searchArticles(queryEmbedding, topK = 3) {
  const results = await qdrant.search(COLLECTION_NAME, {
    vector: queryEmbedding,
    limit: topK
  });
  return results.map(r => r.payload.text);
}
