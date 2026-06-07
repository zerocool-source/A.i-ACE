// The Obsidian-style vault: one markdown file per note, linked with [[wikilinks]].
// This is ACE's second brain. Plain files on disk — portable, greppable, and
// openable in real Obsidian.

import { promises as fs } from "node:fs";
import path from "node:path";

const VAULT_DIR = process.env.ACE_VAULT_DIR
  ? path.resolve(process.env.ACE_VAULT_DIR)
  : path.resolve(process.cwd(), "vault");

export function vaultDir(): string {
  return VAULT_DIR;
}

async function ensureVault(): Promise<void> {
  await fs.mkdir(VAULT_DIR, { recursive: true });
}

/** Map a note title to a safe filename inside the vault (no path traversal). */
function fileForTitle(title: string): string {
  const safe = title
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-") // strip filesystem-hostile chars
    .replace(/\s+/g, " ")
    .slice(0, 120);
  if (!safe || safe === "." || safe === "..") {
    throw new Error(`Invalid note title: ${JSON.stringify(title)}`);
  }
  return path.join(VAULT_DIR, `${safe}.md`);
}

export interface Note {
  title: string;
  content: string;
}

export async function listNotes(): Promise<string[]> {
  await ensureVault();
  const entries = await fs.readdir(VAULT_DIR);
  return entries
    .filter((e) => e.toLowerCase().endsWith(".md"))
    .map((e) => e.slice(0, -3));
}

export async function readNote(title: string): Promise<Note | null> {
  try {
    const content = await fs.readFile(fileForTitle(title), "utf8");
    return { title, content };
  } catch {
    return null;
  }
}

/**
 * Create a note, or append to an existing one. Appending (rather than
 * overwriting) keeps memory additive — ACE accretes knowledge instead of
 * clobbering it.
 */
export async function writeNote(
  title: string,
  content: string,
  mode: "create" | "append" = "append",
): Promise<void> {
  await ensureVault();
  const file = fileForTitle(title);
  if (mode === "append") {
    let existing = "";
    try {
      existing = await fs.readFile(file, "utf8");
    } catch {
      // new note — seed minimal front matter
      existing = `---\ncreated: ${new Date().toISOString()}\n---\n\n# ${title}\n`;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    await fs.writeFile(file, `${existing.trimEnd()}\n\n- (${stamp}) ${content.trim()}\n`, "utf8");
  } else {
    const body = `---\ncreated: ${new Date().toISOString()}\n---\n\n# ${title}\n\n${content.trim()}\n`;
    await fs.writeFile(file, body, "utf8");
  }
}

/**
 * Naive full-text search over titles + bodies. Returns the best matches with a
 * short snippet. Good enough for the foundation; swap for embeddings later.
 */
export async function searchNotes(
  query: string,
  limit = 6,
): Promise<{ title: string; snippet: string }[]> {
  const titles = await listNotes();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { title: string; snippet: string; score: number }[] = [];

  for (const title of titles) {
    const note = await readNote(title);
    if (!note) continue;
    const hay = (title + "\n" + note.content).toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.toLowerCase().includes(t)) score += 3;
      if (hay.includes(t)) score += 1;
    }
    if (score > 0) {
      const firstLine = note.content
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith("---") && !l.startsWith("#")) ?? "";
      scored.push({ title, snippet: firstLine.slice(0, 160), score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ title, snippet }) => ({ title, snippet }));
}
