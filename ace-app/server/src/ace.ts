// ACE's brain: a manual Claude agentic loop.
//
// We run the loop by hand (rather than the SDK tool runner) for two reasons:
//   1. our vault tools are client-side — we execute them here and feed results back;
//   2. web_search is an Anthropic *server* tool — it runs automatically inside the
//      same request, and can yield stop_reason "pause_turn" we must continue.
//
// Model: Opus 4.8 with adaptive thinking + effort "high". This is a reasoning-heavy,
// multi-tool task where correctness matters more than cost.

import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, buildUserMessage } from "./prompt.js";
import { readNote, searchNotes, writeNote } from "./vault.js";
import type { AskRequest } from "./types.js";

const MODEL = "claude-opus-4-8";
const MAX_TOOL_TURNS = 8; // safety cap on the agentic loop

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

// --- Custom (client-side) tool definitions ---------------------------------

const VAULT_TOOLS: Anthropic.Tool[] = [
  {
    name: "vault_search",
    description:
      "Search ACE's memory (the notes vault) for relevant existing notes. Use before answering when the topic may connect to something noted before.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for" },
      },
      required: ["query"],
    },
  },
  {
    name: "vault_read",
    description: "Read the full content of one note from memory by its exact title.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Exact note title" },
      },
      required: ["title"],
    },
  },
  {
    name: "vault_write",
    description:
      "Save a durable fact to memory: a decision, an action item and its owner, a deadline, a new project or person. Link related notes with [[wikilinks]]. Do not store raw transcript or chatter.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Note title (the entity or topic)" },
        content: {
          type: "string",
          description: "Short distilled fact to record. Use [[wikilinks]] to connect related notes.",
        },
      },
      required: ["title", "content"],
    },
  },
];

// web_search is an Anthropic server-side tool — declared here, executed by Anthropic.
const ALL_TOOLS = [
  { type: "web_search_20260209", name: "web_search" } as unknown as Anthropic.Tool,
  ...VAULT_TOOLS,
];

// --- Tool execution --------------------------------------------------------

async function runVaultTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "vault_search": {
      const hits = await searchNotes(String(input.query ?? ""));
      if (!hits.length) return "No matching notes in memory.";
      return hits.map((h) => `- ${h.title}: ${h.snippet}`).join("\n");
    }
    case "vault_read": {
      const note = await readNote(String(input.title ?? ""));
      return note ? note.content : `No note titled "${input.title}".`;
    }
    case "vault_write": {
      await writeNote(String(input.title ?? ""), String(input.content ?? ""));
      return `Saved to memory: ${input.title}`;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// --- The loop --------------------------------------------------------------

export async function think({ transcript, question }: AskRequest): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildUserMessage(transcript, question) },
  ];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    // `thinking: {type: "adaptive"}` and `output_config: {effort}` are valid
    // runtime params on Opus 4.8 but not yet in this SDK version's type defs, so we
    // build the body and cast past the stale typings. Bump @anthropic-ai/sdk to
    // drop the cast once its types catch up.
    const params = {
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: buildSystemPrompt(),
      tools: ALL_TOOLS,
      messages,
    } as unknown as Anthropic.MessageCreateParamsNonStreaming;

    const resp = await client.messages.create(params);

    // Server-side tool (web_search) hit its internal iteration cap — resume.
    if (resp.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: resp.content });
      continue;
    }

    // Custom tools requested — execute them and feed results back.
    if (resp.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: resp.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type === "tool_use") {
          const out = await runVaultTool(block.name, block.input as Record<string, unknown>);
          results.push({ type: "tool_result", tool_use_id: block.id, content: out });
        }
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    // Done — return the spoken answer.
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    return text || "I don't have a view on that yet.";
  }

  return "I got tangled up thinking about that — ask me again.";
}
