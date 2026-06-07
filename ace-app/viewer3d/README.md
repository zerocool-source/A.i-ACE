# ACE · 3D viewer (local dev)

A live Three.js viewer for the ACE head — the GLB rendered on black with bloom,
orbit controls, and procedural mode animation (idle / listening / thinking /
speaking). Use it to inspect the model and to drive the avatar's states.

## Run it

```bash
cd ace-app/viewer3d
npm install        # also pulls Three.js (which ships the Draco decoder)
npm run dev        # prep copies the GLB + decoder, then starts Vite → http://localhost:5173
```

`npm run prep` (run automatically before dev/build) copies two runtime binaries
into `public/` — they're intentionally **not** committed:

- `public/models/ace.glb` ← canonical copy at `../app/assets/ace-3d/ace.glb`
- `public/draco/*` ← Three's gltf Draco decoder from `node_modules`

`npm run build` produces a static `dist/` (portable, `base: "./"`).

## Controls
Drag to orbit · the four buttons set the behavioural state · **HUD** toggles the
overlay. Speaking emits the mouth particle stream.

---

## Open it with no server (`ace-3d.html`)

`ace-3d.html` (committed) is a **single self-contained file** — Three.js inlined and
the GLB embedded (decoder-free), so you just **double-click it**; no install, no
server, no `localhost`. (The cloud dev container can't expose a reachable localhost,
so this file is the "just let me see it" path.)

Rebuild it:
```bash
# 1) make a decoder-free GLB (no Draco — file:// can't fetch a decoder)
npx @gltf-transform/cli simplify ../app/assets/ace-3d/ace.glb /tmp/s.glb --ratio 0.1 --error 0.01
npx @gltf-transform/cli optimize /tmp/s.glb /tmp/ace.web.glb \
    --compress quantize --texture-compress webp --texture-size 1024 --simplify false
# 2) embed + build the single file
npm run embed -- /tmp/ace.web.glb
npm run build:standalone        # → dist-standalone/standalone.html
cp dist-standalone/standalone.html ace-3d.html
```

## Design references

These three reference frames define ACE's look; the viewer implements their cues.
(The raw images live with the design owner — described here so the build can be
checked against them.)

1. **Front view — neural head.** Translucent wireframe head on black, dense glowing
   node field, bright eyes, and an **"ACE" processor chip** on the forehead with
   circuit traces. → the base mesh + **UnrealBloom** make the eyes/chip/points glow;
   black background + fog.
2. **Side view — "response output".** Profile of the head with a **particle stream
   emitting from the mouth** as it speaks. → the `speaking` state turns on the
   forward-streaming `THREE.Points` system from the mouth position.
3. **HUD spec sheet.** Multi-view technical readout (FRONT/SIDE/REAR), labelled
   subsystems (NEURAL NODES, CONNECTIVITY, SYNAPTIC PATHWAYS, CORE PROCESSOR, SENSOR
   GRID, RESPONSE OUTPUT) and a spec panel (TOTAL NODES 128,000+, CONNECTIONS 2.4M+,
   RESPONSE LATENCY 0.002 SEC, UPTIME 100%). → the corner **HUD overlay** reproduces
   the labels, the spec panel, and the mode tags; the view label echoes FRONT VIEW.

## Animation note (rigging)

This viewer animates the head **procedurally** — breathing, sway, glow pulse, and the
speaking particle stream — because the Meshy mesh is **unrigged**. For true skeletal
/ facial animation (jaw, blinks, visemes), rig the mesh in Blender (or use the
rigged Blender build) and export an animated GLB; the R3F loader
(`design_handoff_ace_avatar/src/three/AceModel.tsx`) plays its clips and now matches
clip names fuzzily. See `3D-PIPELINE.md`.
