# ACE — Ambient Cognitive Engine

> A listening AI agent whose **face is the UI**. ACE sits on screen as a draggable
> neural avatar, quietly follows the conversation in the room, and — when you ask
> "**Ace, what do you think?**" — reasons over what it heard (plus the live web and
> its own memory) and answers out loud. Everything it learns is written into an
> **Obsidian-style knowledge graph** that becomes its second brain over time.

This document is the design. The code in this folder is the foundation that
implements it. We borrow the JARVIS interaction *pattern* (listen → think → speak)
from the original avatar prototype; we do **not** reuse any JARVIS UI/branding.

---

## 1. Product shape

| Pillar | What it means |
|---|---|
| **Avatar is the UI** | The neural face is the entire interface. It's draggable (floats anywhere on screen), and its motion/glow react to state: idle, listening, thinking, speaking. No panels, no chrome. |
| **Ambient listening** | ACE keeps a rolling, in-memory transcript of recent speech. It is *not* a recorder — audio is transcribed and the raw audio is discarded. The transcript window is short (configurable, default ~6 min) and never persisted unless ACE decides a fact is worth remembering. |
| **Wake to reason** | The phrase "**Ace, what do you think?**" (and close variants) triggers reasoning. ACE forms its own view from the conversation context — "here's what I think needs to be done" — using the transcript + web + memory. |
| **Web access** | ACE can search and fetch the live web mid-reasoning (Anthropic server-side `web_search` tool). |
| **Second brain (Obsidian behavior)** | Knowledge is stored as markdown notes with `[[wikilinks]]`. Links form a graph ACE can traverse, visualize, and grow. ACE writes notes autonomously (decisions, action items, people, projects). |

---

## 2. System architecture

ACE is split into a **device app** (face, ears, voice, graph view) and a **brain
service** (the Claude agent loop + the vault). This split exists for one
non-negotiable reason: **the Anthropic API key must never ship inside a mobile
app.** The agent loop, web search, and the knowledge vault therefore live
server-side; the app talks to it over HTTPS.

```
┌─────────────────────────── DEVICE (Expo / React Native) ───────────────────────────┐
│                                                                                     │
│   Avatar.tsx ............ draggable neural face; modes drive glow/particles         │
│   useAmbientListener .... mic → STT → rolling transcript → wake-phrase detection    │
│   expo-speech (TTS) ..... speaks ACE's reply; word boundaries drive mouth/glow      │
│   GraphView.tsx ......... renders the knowledge graph (react-native-svg)            │
│   store (zustand) ....... mode, transcript window, consent, graph snapshot          │
│                                                                                     │
└───────────────────────────────────────┬─────────────────────────────────────────────┘
                                         │  HTTPS
                                         │  POST /ask   { transcript, question }
                                         │  GET  /graph
                                         ▼
┌──────────────────────────── BRAIN SERVICE (Node + Anthropic SDK) ───────────────────┐
│                                                                                     │
│   ace.ts ........ the agent loop: Claude Opus 4.8, adaptive thinking, effort=high   │
│   tools:                                                                            │
│     • web_search        (Anthropic server tool — runs automatically)                │
│     • vault_search      (custom — find notes by query/link)                         │
│     • vault_read        (custom — read a note)                                      │
│     • vault_write       (custom — create/append a note with [[links]])              │
│   vault.ts ...... markdown files on disk = the Obsidian vault                        │
│   graph.ts ...... parse [[wikilinks]] across the vault → nodes + edges               │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Why this shape
- **Security:** key stays server-side; the loop (which may run several tool calls)
  runs where we control it.
- **Persistence:** the vault is a real folder of `.md` files — portable, greppable,
  and openable in actual Obsidian. The "brain" survives app reinstalls.
- **Latency:** the device does the realtime-sensitive work (audio, animation); the
  server does the slow work (reasoning, search).

> **Single-device alternative:** for a pure on-device build with no server, you can
> run the vault in `expo-file-system` and proxy Claude through a minimal serverless
> function that only holds the key. The module boundaries below don't change — only
> where `vault.ts` reads/writes.

---

## 3. The agent loop (brain service)

One Claude call per "what do you think?", run as a **manual agentic loop** so we can
service the custom vault tools while letting `web_search` run server-side.

```
context  = recent transcript (last N minutes, in memory on device → sent per request)
question = the user's spoken question after the wake phrase

loop:
  resp = messages.create(
           model            = "claude-opus-4-8",
           thinking         = { type: "adaptive" },
           output_config    = { effort: "high" },
           system           = ACE_PERSONA + vault-awareness,
           tools            = [ web_search, vault_search, vault_read, vault_write ],
           messages         = history )
  if stop_reason == "tool_use":   run vault_* tools, append results, continue
  if stop_reason == "pause_turn": re-send (server tool continuation), continue
  else: break
speak(final text)
```

- **Persona:** calm, precise, a little dry. Answers are short and speakable (1–3
  sentences) because they're read aloud — but ACE may do extensive tool work first.
- **Memory write-back:** after answering, ACE is prompted to capture anything
  durable (a decision, an owner, a deadline) via `vault_write`, growing the graph.
- **Model choice:** Opus 4.8 with adaptive thinking + `effort: "high"` — this is a
  reasoning-heavy, multi-tool task where correctness matters more than cost.

See `server/src/ace.ts` for the implementation and `server/src/prompt.ts` for the
persona.

---

## 4. The avatar (device)

Ported from the neural-face prototype, re-expressed for React Native:

- **Base layer:** the avatar image (`assets/ace-avatar.png`).
- **Motion layers:** breathing glow, eye/chip pulse, ambient aura — driven by
  `react-native-reanimated` instead of CSS keyframes.
- **Draggable:** `react-native-gesture-handler` `Pan` + Reanimated shared values;
  the face can be parked anywhere and stays put.
- **Mode reactivity:** a single `mode` value (`idle | listening | thinking |
  speaking`) scales animation speed and glow intensity, exactly like the prototype's
  `--speed` / `--level` CSS vars.
- **Audio reactivity:** during speech, `expo-speech` `onBoundary` events pulse the
  glow per word; during listening, mic amplitude feeds the same channel.

See `src/avatar/Avatar.tsx`.

---

## 5. Listening pipeline (device)

```
mic (expo-av) ──┬─► amplitude  → avatar glow while listening
                └─► STT (speech recognition) → text chunks
                                              → rolling transcript buffer (in memory)
                                              → scan for wake phrase
wake phrase detected ("ace what do you think") →
        take {transcript window, the trailing question} → POST /ask → speak(reply)
```

- **Wake phrase:** detected by scanning the live transcript for the normalized
  phrase and close variants ("ace what do you think", "ace what's your take",
  "ace thoughts"). For a production always-on hotword with low battery cost, swap in
  **Picovoice Porcupine** — noted as a TODO; the interface (`onWake`) doesn't change.
- **Transient by design:** the buffer is a fixed-size ring of recent utterances.
  Nothing is written to disk by the listener. Only the agent's `vault_write`
  persists anything, and only distilled facts — never raw transcript.
- **Consent gate:** listening starts only after an explicit, visible opt-in, and a
  persistent on-screen "listening" indicator shows when the mic is live.

See `src/listening/useAmbientListener.ts`.

---

## 6. Knowledge graph (Obsidian behavior)

- **Storage:** one markdown file per note in the vault directory. Front-matter for
  type/created; body is freeform with `[[Other Note]]` links.
- **Graph:** `graph.ts` scans every note, extracts `[[links]]`, and emits
  `{ nodes, edges }`. Unresolved links become "ghost" nodes (just like Obsidian).
- **Visualization:** `GraphView.tsx` lays the graph out (simple force simulation)
  and draws it with `react-native-svg`. Tapping a node could open/zoom (future).
- **Growth:** ACE creates notes for the entities it reasons about, so the graph
  densifies the more it listens.

See `server/src/vault.ts`, `server/src/graph.ts`, `src/brain/GraphView.tsx`.

---

## 7. State model (device)

Minimal global state (zustand):

```
mode:        "idle" | "listening" | "thinking" | "speaking"
consented:   boolean         // user enabled the mic
listening:   boolean         // mic currently live
transcript:  Utterance[]     // rolling, in-memory only
level:       number          // 0..1 audio reactivity for the avatar
graph:       { nodes, edges } // last snapshot fetched from /graph
```

No other app state. The brain is stateless per request (the transcript window is
sent each time); durable state lives in the vault.

---

## 8. Build phases

1. **Foundation (this scaffold):** avatar (draggable + modes), listener interface,
   brain service with the agent loop + vault + graph, graph view. Runs end-to-end
   with a typed-text fallback when device speech APIs aren't wired.
2. **Voice in:** wire real STT (`@react-native-voice/voice` or
   `expo-speech-recognition`); add Porcupine wake-word.
3. **Voice out:** tune `expo-speech` voice + boundary-driven glow.
4. **Graph polish:** interactive pan/zoom, node tap → note, force layout tuning.
5. **Hardening:** auth on the brain service, rate limiting, transcript retention
   controls, consent/recording-law review, on-device encryption of the vault if it
   moves to the device.

---

## 9. Open decisions (flag before shipping)

- **Recording consent / law.** Always-listening in shared spaces implicates
  all-party-consent rules in many jurisdictions. We never store audio and we show a
  live indicator, but get a legal review for your deployment region.
- **Vault location.** Server (shared, multi-device, easy agent access) vs. on-device
  (private, offline). Scaffold defaults to server.
- **Wake mechanism.** Transcript scan (simple, works today) vs. Porcupine hotword
  (battery-efficient, production). Scaffold uses the former with a clean seam for the
  latter.
- **Auth.** The brain service is open in the scaffold. Add an auth token before it
  leaves localhost.
