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
import { skillTools, runSkill } from "./skills.js";
import type { AskRequest } from "./types.js";

const MODEL = "claude-opus-4-8";
const MAX_TOOL_TURNS = 8; // safety cap on the agentic loop

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

// Tools = the Anthropic server-side web_search + the OpenJarvis-style skill
// registry (vault_search/read/write, current_time, …). Add capabilities by adding
// a Skill in skills.ts — the loop picks them up automatically.
const ALL_TOOLS = [
  { type: "web_search_20260209", name: "web_search" } as unknown as Anthropic.Tool,
  ...skillTools(),
];

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
          const out = await runSkill(block.name, block.input as Record<string, unknown>);
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
