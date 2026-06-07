import { create } from "zustand";
import { TRANSCRIPT_MAX_UTTERANCES, TRANSCRIPT_WINDOW_MS } from "../config";

export type Mode = "idle" | "listening" | "thinking" | "speaking";

export interface Utterance {
  speaker: string;
  text: string;
  at: number;
}

export interface GraphNode {
  id: string;
  ghost: boolean;
}
export interface GraphEdge {
  from: string;
  to: string;
}
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface AceState {
  mode: Mode;
  consented: boolean; // user enabled the mic
  listening: boolean; // mic currently live
  level: number; // 0..1 audio reactivity for the avatar
  transcript: Utterance[]; // rolling, in-memory only
  graph: Graph;

  setMode: (m: Mode) => void;
  setConsented: (v: boolean) => void;
  setListening: (v: boolean) => void;
  setLevel: (v: number) => void;
  /** Append an overheard utterance and prune the rolling window. */
  pushUtterance: (u: Utterance) => void;
  recentTranscript: () => Utterance[];
  setGraph: (g: Graph) => void;
}

export const useAce = create<AceState>((set, get) => ({
  mode: "idle",
  consented: false,
  listening: false,
  level: 0,
  transcript: [],
  graph: { nodes: [], edges: [] },

  setMode: (mode) => set({ mode }),
  setConsented: (consented) => set({ consented }),
  setListening: (listening) => set({ listening }),
  setLevel: (level) => set({ level }),

  pushUtterance: (u) =>
    set((s) => {
      const cutoff = Date.now() - TRANSCRIPT_WINDOW_MS;
      const next = [...s.transcript, u]
        .filter((x) => x.at >= cutoff)
        .slice(-TRANSCRIPT_MAX_UTTERANCES);
      return { transcript: next };
    }),

  recentTranscript: () => {
    const cutoff = Date.now() - TRANSCRIPT_WINDOW_MS;
    return get().transcript.filter((x) => x.at >= cutoff);
  },

  setGraph: (graph) => set({ graph }),
}));
