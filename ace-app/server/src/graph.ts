// Build the knowledge graph from the vault: notes are nodes, [[wikilinks]] are
// edges. Unresolved links become "ghost" nodes — exactly like Obsidian.

import type { Graph, GraphEdge, GraphNode } from "./types.js";
import { listNotes, readNote } from "./vault.js";

const WIKILINK = /\[\[([^\]]+)\]\]/g;

/** Extract [[link]] targets from note body (drops any "|alias" suffix). */
function extractLinks(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(WIKILINK)) {
    const target = m[1].split("|")[0].trim();
    if (target) out.push(target);
  }
  return out;
}

export async function buildGraph(): Promise<Graph> {
  const titles = await listNotes();
  const real = new Set(titles);
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  for (const title of titles) {
    nodes.set(title, { id: title, ghost: false });
  }

  for (const title of titles) {
    const note = await readNote(title);
    if (!note) continue;
    for (const target of extractLinks(note.content)) {
      if (!nodes.has(target)) {
        nodes.set(target, { id: target, ghost: !real.has(target) });
      }
      edges.push({ from: title, to: target });
    }
  }

  return { nodes: [...nodes.values()], edges };
}
