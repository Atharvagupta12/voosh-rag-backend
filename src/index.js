import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import cors from "cors";
import chatRoutes from "./routes/chat.js";

dotenv.config();
const app = express();

// Middlewares
app.use(bodyParser.json());
app.use(
  cors({
    origin: "https://voosh-rag-frontend-hazel.vercel.app/", // Allow frontend (Vite dev server)
    methods: ["GET", "POST"],
  })
);

// Routes
app.use("/api", chatRoutes);

app.get("/", (req, res) => {
  res.send("Server is running. Use /api/chat to interact.");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});
