// Shared shapes between the brain service and the app.

/** One unit of overheard speech in the rolling, in-memory transcript. */
export interface Utterance {
  /** Best-effort speaker label, e.g. "me", "speaker 2", or "" if unknown. */
  speaker: string;
  /** Transcribed text. */
  text: string;
  /** Epoch ms when captured. */
  at: number;
}

/** A node in the knowledge graph (one note, or an unresolved "ghost" link). */
export interface GraphNode {
  id: string; // the note title / link target
  /** True when no note file backs this node (an unresolved [[link]]). */
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

export interface AskRequest {
  transcript: Utterance[];
  question: string;
}

export interface AskResponse {
  reply: string;
}
