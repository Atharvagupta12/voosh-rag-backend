import { getAnswer } from "../services/retriever.js";

async function main() {
  const query = "What is the latest news about the stock market?";
  const answer = await getAnswer(query);
  console.log(" Gemini says:", answer);
}

main();