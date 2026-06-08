// ACE skills engine — a self-describing, pluggable skill registry.
//
// Adapted from OpenJarvis (https://github.com/open-jarvis/OpenJarvis, Apache-2.0):
// its agents discover and invoke "skills" — small, self-describing tools — on
// demand. ACE uses the same idea: every capability is a Skill with a name,
// description, JSON-schema, and a run() function. The agent loop turns these into
// Claude tools and dispatches calls back to them, so adding a capability is just
// adding a Skill object (no changes to the loop).

import type Anthropic from "@anthropic-ai/sdk";
import { readNote, searchNotes, writeNote } from "./vault.js";

export interface Skill {
  name: string;
  description: string;
  input_schema: Anthropic.Tool.InputSchema;
  run(input: Record<string, unknown>): Promise<string>;
}

/** The registry. Append a Skill here to give ACE a new capability. */
export const SKILLS: Skill[] = [
  {
    name: "vault_search",
    description:
      "Search ACE's memory (the notes vault) for relevant existing notes. Use before answering when the topic may connect to something noted before.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "What to look for" } },
      required: ["query"],
    },
    async run(input) {
      const hits = await searchNotes(String(input.query ?? ""));
      return hits.length
        ? hits.map((h) => `- ${h.title}: ${h.snippet}`).join("\n")
        : "No matching notes in memory.";
    },
  },
  {
    name: "vault_read",
    description: "Read the full content of one note from memory by its exact title.",
    input_schema: {
      type: "object",
      properties: { title: { type: "string", description: "Exact note title" } },
      required: ["title"],
    },
    async run(input) {
      const note = await readNote(String(input.title ?? ""));
      return note ? note.content : `No note titled "${input.title}".`;
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
        content: { type: "string", description: "Short distilled fact. Use [[wikilinks]] to connect notes." },
      },
      required: ["title", "content"],
    },
    async run(input) {
      await writeNote(String(input.title ?? ""), String(input.content ?? ""));
      return `Saved to memory: ${input.title}`;
    },
  },
  {
    name: "current_time",
    description: "Get the current date and time (use for anything time-sensitive or scheduling).",
    input_schema: { type: "object", properties: {} },
    async run() {
      return new Date().toString();
    },
  },
];

/** Render the registry as Claude tool definitions. */
export function skillTools(): Anthropic.Tool[] {
  return SKILLS.map((s) => ({ name: s.name, description: s.description, input_schema: s.input_schema }));
}

/** Dispatch a tool call to the matching skill. */
export async function runSkill(name: string, input: Record<string, unknown>): Promise<string> {
  const skill = SKILLS.find((s) => s.name === name);
  if (!skill) return `Unknown skill: ${name}`;
  try {
    return await skill.run(input);
  } catch (e) {
    return `Skill ${name} failed: ${(e as Error).message}`;
  }
}
