import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const JINA_URL = "https://api.jina.ai/v1/embeddings";
const JINA_MODEL = "jina-embeddings-v2-base-en";

export async function getEmbedding(text) {
  try {
    const resp = await axios.post(
      JINA_URL,
      { model: JINA_MODEL, input: [text]},
      { headers: { Authorization: `Bearer ${process.env.JINA_API_KEY}` } }
    );

    const emb = resp.data?.data?.[0]?.embedding;
    if (!emb) throw new Error("No embedding returned");
    return emb;
  } catch (err) {
    console.error("Embedding error:", err?.response?.data || err.message);
    throw err;
  }
}
