// Where the brain service lives. For a physical device, set this to your machine's
// LAN IP (e.g. http://192.168.1.20:8787) via EXPO_PUBLIC_ACE_BRAIN_URL.
export const BRAIN_URL =
  process.env.EXPO_PUBLIC_ACE_BRAIN_URL ?? "http://localhost:8787";

// Wake phrases that trigger reasoning. Matched against a normalized transcript.
export const WAKE_PHRASES = [
  "ace what do you think",
  "ace whats your take",
  "ace what is your take",
  "ace thoughts",
  "ace what would you do",
];

// How much recent speech ACE keeps in the rolling, in-memory transcript.
export const TRANSCRIPT_WINDOW_MS = 6 * 60 * 1000; // 6 minutes
export const TRANSCRIPT_MAX_UTTERANCES = 80;
