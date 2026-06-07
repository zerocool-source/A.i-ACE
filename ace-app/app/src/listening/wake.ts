// Wake-phrase detection over a normalized transcript string.
import { WAKE_PHRASES } from "../config";

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * If a wake phrase appears, return the text that FOLLOWS it (the actual question).
 * Returns null when no wake phrase is present. If the wake phrase is present but
 * nothing follows, returns the phrase itself so ACE still engages.
 */
export function detectWake(text: string): string | null {
  const n = normalize(text);
  for (const phrase of WAKE_PHRASES) {
    const idx = n.lastIndexOf(phrase);
    if (idx !== -1) {
      const after = n.slice(idx + phrase.length).trim();
      return after.length ? after : phrase;
    }
  }
  return null;
}
