// src/services/gemini.js
import axios from "axios";

export async function getGeminiResponse(query, context) {
  const prompt = `Context: ${context}\n\nUser: ${query}`;

  // 1. Try Gemini first
  if (process.env.GEMINI_API_KEY) {
    try {
      const resp = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-002:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          contents: [{ parts: [{ text: prompt }] }]
        }
      );
      return resp.data.candidates?.[0]?.content?.parts?.[0]?.text || " Gemini gave no response.";
    } catch (err) {
      console.error("Gemini Error:", err.response?.data || err.message);
    }
  }

  // 2. Fallback to OpenAI
  if (process.env.OPENAI_API_KEY) {
    try {
      const resp = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini", // you can switch to gpt-3.5-turbo if cheaper
          messages: [
            { role: "system", content: "You are a helpful assistant. Use the given context when answering." },
            { role: "user", content: prompt }
          ]
        },
        {
          headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );
      return resp.data.choices?.[0]?.message?.content || " OpenAI gave no response.";
    } catch (err) {
      console.error("OpenAI Error:", err.response?.data || err.message);
    }
  }

  // 3. Fallback dummy
  return `You asked: "${query}" sorry currently gemini is not available`;
}
