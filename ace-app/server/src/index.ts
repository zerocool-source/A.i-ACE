// ACE brain service — HTTP surface for the app.
//   POST /ask    { transcript, question } -> { reply }
//   GET  /graph  -> { nodes, edges }
//   GET  /health
//
// NOTE: open by default for local development. Add an auth token before this
// leaves localhost (see DESIGN.md §9).

import express from "express";
import { think } from "./ace.js";
import { buildGraph } from "./graph.js";
import { vaultDir } from "./vault.js";
import type { AskRequest } from "./types.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, vault: vaultDir() });
});

app.get("/graph", async (_req, res) => {
  try {
    res.json(await buildGraph());
  } catch (err) {
    console.error("graph error", err);
    res.status(500).json({ error: "failed to build graph" });
  }
});

app.post("/ask", async (req, res) => {
  const body = req.body as Partial<AskRequest>;
  const question = (body.question ?? "").trim();
  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }
  try {
    const reply = await think({
      transcript: Array.isArray(body.transcript) ? body.transcript : [],
      question,
    });
    res.json({ reply });
  } catch (err) {
    console.error("ask error", err);
    res.status(500).json({ error: "ACE failed to respond" });
  }
});

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("⚠  ANTHROPIC_API_KEY is not set — /ask will fail until you set it.");
  }
  console.log(`ACE brain listening on http://localhost:${PORT}`);
  console.log(`Vault: ${vaultDir()}`);
});
