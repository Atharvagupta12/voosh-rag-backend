// Ask the RAG pipeline a question from the terminal:
//   npm run ask -- "What's happening with interest rates?"
import { answerQuestion } from "../services/rag.js";

const query = process.argv.slice(2).join(" ").trim() || "What are the biggest stories today?";
console.log(`\nQ: ${query}\n`);

try {
  const { sources, provider } = await answerQuestion({
    query,
    onToken: (t) => process.stdout.write(t),
  });
  console.log(`\n\n— ${provider}, ${sources.length} sources`);
  for (const s of sources) console.log(`  [${s.n}] (${s.score}) ${s.title} — ${s.source}\n      ${s.url}`);
  process.exit(0);
} catch (err) {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
}
