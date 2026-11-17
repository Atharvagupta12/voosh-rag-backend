import { config, describeConfig } from "./config.js";
import { createApp } from "./app.js";
import { createLogger } from "./lib/logger.js";
import { sessionStore } from "./services/sessionStore.js";

const log = createLogger("server");
const app = createApp();

const server = app.listen(config.port, (err) => {
  // Express 5 reports listen errors (e.g. EADDRINUSE) through this callback.
  if (err) {
    log.error(`Could not start on port ${config.port}: ${err.message}`);
    process.exit(1);
  }
  const d = describeConfig();
  log.info(`Dispatch API listening on http://localhost:${config.port}`);
  log.info(
    `vector store: ${d.vectorStore} | sessions: ${d.sessionStore} | llm: ${d.llmProviders.join(" → ") || "NONE"} | embeddings: ${d.embeddings}`
  );
  if (!d.llmProviders.length) {
    log.warn("No LLM key set (GEMINI_API_KEY / GROQ_API_KEY / OPENAI_API_KEY): chat will fail.");
  }
  if (d.embeddings === "missing") log.warn("JINA_API_KEY is not set: retrieval will fail.");
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received, shutting down…`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  server.close(async () => {
    await sessionStore.close();
    process.exit(0);
  });
  server.closeIdleConnections?.();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => log.error("Unhandled rejection", reason));
