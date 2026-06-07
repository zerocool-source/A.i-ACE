# ACE — Ambient Cognitive Engine (app)

ACE is a listening AI agent whose **face is the UI**. A draggable neural avatar sits
on screen, follows the conversation in the room, and — when you say
**"Ace, what do you think?"** — reasons over what it heard plus the live web and its
own Obsidian-style memory, then answers out loud.

Read **[DESIGN.md](./DESIGN.md)** for the full architecture. This README is how to
run the foundation.

```
ace-app/
  DESIGN.md            ← architecture (read this first)
  app/                 ← Expo / React Native client (the face, ears, voice, graph)
  server/              ← brain service (Claude agent loop + Obsidian vault + graph)
```

## Why two pieces

The Anthropic API key must never ship inside a mobile app, and the agent loop may
run several tool calls (web search, memory reads/writes) per question. So the
**brain** runs as a small Node service that holds the key and owns the knowledge
vault; the **app** does the realtime work (audio, animation, graph rendering) and
calls the brain over HTTPS. See DESIGN.md §2.

## Run the brain service

```bash
cd server
npm install
export ANTHROPIC_API_KEY=sk-ant-...        # required
npm run dev                                 # starts on http://localhost:8787
```

Endpoints:
- `POST /ask`  `{ transcript: Utterance[], question: string }` → `{ reply }`
- `GET  /graph` → `{ nodes, edges }` (the current knowledge graph)
- `GET  /health`

The vault is a folder of markdown files at `server/vault/` (override with
`ACE_VAULT_DIR`). You can open it in real Obsidian.

## Run the app

```bash
cd app
npm install
# point the app at your brain service (LAN IP for a physical device):
export EXPO_PUBLIC_ACE_BRAIN_URL=http://localhost:8787
npm run start                               # Expo dev server; press i / a / w
```

Until device speech APIs are wired (phase 2 in DESIGN.md), tap the avatar to type a
question — the listen → think → speak loop runs the same way, just with typed input.

## Status

This is the **foundation** (phase 1): real avatar + agent loop + vault + graph,
end-to-end, with a typed-input fallback for speech. Voice in/out and the Porcupine
wake-word are the next phases. The build plan is in DESIGN.md §8; the things to
settle before shipping (consent law, vault location, auth) are in §9.
