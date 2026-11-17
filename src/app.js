import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { createLogger } from "./lib/logger.js";
import chatRoutes from "./routes/chat.js";
import systemRoutes from "./routes/system.js";

const log = createLogger("http");

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind Render / other proxies: needed for per-IP rate limits

  // This is a JSON API consumed cross-origin by the frontend.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin(origin, callback) {
        // Allow non-browser clients (no Origin header) and configured origins.
        if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
      methods: ["GET", "POST", "DELETE"],
      maxAge: 86_400,
    })
  );
  app.use(express.json({ limit: "16kb" }));

  app.get("/", (_req, res) => {
    res.json({ name: "Dispatch API", status: "ok", health: "/api/health", docs: "See README.md" });
  });

  app.use("/api", systemRoutes);
  app.use("/api", chatRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) log.error(`${req.method} ${req.path} failed: ${err.stack ?? err.message}`);
    if (res.headersSent) return res.end();
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Request body must be valid JSON." });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large." });
    const expose = err.expose ?? status < 500;
    res.status(status).json({ error: expose ? err.message : "Something went wrong. Please try again." });
  });

  return app;
}
