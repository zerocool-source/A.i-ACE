// Thin client for the ACE brain service.
import { BRAIN_URL } from "../config";
import type { Graph, Utterance } from "../state/store";

export async function ask(transcript: Utterance[], question: string): Promise<string> {
  const res = await fetch(`${BRAIN_URL}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, question }),
  });
  if (!res.ok) throw new Error(`brain /ask failed: ${res.status}`);
  const data = (await res.json()) as { reply: string };
  return data.reply;
}

export async function fetchGraph(): Promise<Graph> {
  const res = await fetch(`${BRAIN_URL}/graph`);
  if (!res.ok) throw new Error(`brain /graph failed: ${res.status}`);
  return (await res.json()) as Graph;
}
