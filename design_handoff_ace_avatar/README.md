# Handoff: ACE Neural Avatar

## Overview
A futuristic AI-avatar interface. A single full-screen view shows a front-facing,
symmetrical digital humanoid face on a pure-black background, with glowing eyes, an
"ACE" processor chip on the forehead, neural nodes, and thin wireframe connections.
The face is animated with subtle, premium motion — breathing glow, twinkling nodes,
pulsing eyes and chip, particles travelling along the neural lines, and a soft head
aura. There is no other UI.

## About the Design Files
**This bundle is already a working React + Vite + TypeScript project**, not just a
flat mock. It was authored as the design reference for this conversation, but it
happens to be production-shaped. Treat it as a reference implementation: the intended
look and behavior are fully specified by these files. Your job is to bring this into
your target codebase using its established patterns (component conventions, styling
approach, asset pipeline). If you have no existing environment, this project *is* a
reasonable starting point — `npm install && npm run dev` runs as-is.

The base avatar is a raster image (`public/ace-avatar.png`). Everything else is a
motion layer composited on top. **The face shape itself is the image and must never
be redrawn, distorted, or masked.**

## Fidelity
**High-fidelity.** Final colors, layout, timing, and interactions are all specified.
Recreate the motion and composition exactly. The one thing that is inherently
image-dependent is the *pixel position* of the eye/chip glow overlays and the head
ellipse used by the particle field — these are tuned as percentages to the current
image and must be re-tuned if the base image changes.

## Screens / Views
There is exactly one view.

### Avatar
- **Purpose:** Ambient/hero display of the AI persona. No interaction required.
- **Layout:**
  - `body`/`#root` fill the viewport, pure black (`#000`), `overflow: hidden`.
  - `#root` is a flex container centering its single child both axes.
  - `.stage` is a square: `width: min(92vmin, 980px)`, `aspect-ratio: 1 / 1`,
    `position: relative`, `isolation: isolate` (so `mix-blend-mode` layers blend only
    within the stage). All layers below are absolutely positioned inside `.stage`.
- **Layers (back to front, by z-index):**
  - `0` `.aura` — radial-gradient halo behind the head (see Design Tokens).
  - `1` `.face` — the base image, `object-fit: contain`, `inset: 0`, full size.
  - `2` `.flicker.a` / `.flicker.b` — two copies of the same image, `mix-blend-mode:
    screen`, flickering at offset rates to make the bright nodes twinkle.
  - `3` `.particles` — a `<canvas>`, `mix-blend-mode: screen`, the neural particle field.
  - `4` `.glow.ace`, `.glow.eye.left`, `.glow.eye.right` — radial-gradient glow blobs
    over the chip and eyes.

## Interactions & Behavior
No clicks, navigation, or input. All behavior is autonomous animation:

1. **Breathing glow** (`@keyframes breathe`, 7.5s, ease-in-out, infinite) — on `.face`.
   Brightness `0.9 → 1.14`, scale `1 → 1.012`, drop-shadow blur `16px → 42px`
   (color `rgba(170,210,255,0.5)` at peak).
2. **Node flicker** (`flickerA` 2.3s / `flickerB` 3.7s, `steps(1, end)`, infinite) —
   on the two `.flicker` copies. Opacity steps between ~0.05 and ~0.34 at different
   keyframe stops so nodes twinkle irregularly.
3. **Eye glow pulse** (`eyePulse`, 3.1s, ease-in-out, infinite; right eye delayed
   0.15s) — opacity `0.55 → 1`, scale `0.85 → 1.22`.
4. **ACE chip pulse** (`acePulse`, 3.6s, ease-in-out, infinite) — opacity `0.4 → 0.95`,
   scale `0.82 → 1.08`.
5. **Neural particles** (canvas, `requestAnimationFrame`) — see State / engine below.
6. **Head aura shimmer** (`aura`, 9s, ease-in-out, infinite) — opacity `0.45 → 0.85`,
   scale `1 → 1.05`.

**Reduced motion:** under `@media (prefers-reduced-motion: reduce)` all CSS animations
are disabled and the flicker layers are pinned to `opacity: 0.18` (steady glow).
The canvas engine should also be skipped/static under that query (currently the CSS
canvas stays present; if you want full parity, early-return from the hook when
`matchMedia('(prefers-reduced-motion: reduce)').matches`).

## Particle engine (`useNeuralParticles.ts`)
- A `HEAD` ellipse constant (normalized: `cx 0.5, cy 0.46, rx 0.275, ry 0.42`) defines
  where nodes may exist — roughly the head silhouette.
- On build/resize: scatter up to **150** nodes inside the ellipse (rejection sampling);
  connect each node to its **3** nearest neighbours within `0.12 * min(W,H)`; spawn
  **46** travellers on random edges.
- Each frame: advance each traveller along its edge; on reaching the end node, 85% of
  the time hop to a connected edge, else respawn. Dot alpha = `sin(t·π)` (fade across
  the edge) × a per-traveller sine flicker. Dots are `rgba(220,238,255,a)` with a
  `rgba(170,210,255,0.9)` shadow blur of 6, radius 0.7–2.1px.
- Canvas is sized to its CSS box × `devicePixelRatio` (capped at 2); rebuilds on resize.

## State Management
No app state. The only runtime state is internal to the particle hook (node/edge/
traveller arrays, the rAF handle) and is fully self-contained. No data fetching.

## Design Tokens
**Colors**
- Background: `#000`
- Eye glow gradient: `#fff` → `rgba(190,225,255,.7)` → `rgba(120,180,255,.3)` → transparent
- ACE chip gradient: `rgba(210,235,255,.55)` → `rgba(140,190,255,.28)` → `rgba(90,150,235,.12)` → transparent
- Aura gradient: `rgba(120,170,235,.30)` → `rgba(90,140,220,.14)` → `rgba(60,100,180,.05)` → transparent
- Particle fill: `rgba(220,238,255, alpha)`; particle glow: `rgba(170,210,255,0.9)`
- Breathe drop-shadow peak: `rgba(170,210,255,0.5)`

**Feature positions (% of stage, image-dependent)**
- Left eye: `left 37.0% / top 49.0%`, size `8% × 6%`
- Right eye: `left 62.6% / top 48.7%`, size `8% × 6%`
- ACE chip glow: `left 50% / top 34.4%`, size `22% × 22%`
- Aura: `left 50% / top 44%`, size `78% × 92%`

**Timing**
- breathe 7.5s · flickerA 2.3s · flickerB 3.7s · eyePulse 3.1s (+0.15s) · acePulse 3.6s · aura 9s
- All `infinite`; pulses ease-in-out; flickers `steps(1, end)`.

**Layout**
- Stage: `min(92vmin, 980px)`, square. Font (unused visually): `ui-monospace`.

## Assets
- `public/ace-avatar.png` — the reference avatar render (front-facing AI face with
  glowing eyes, ACE forehead chip, neural nodes/wireframe on black). This is the only
  asset and the foundation of the whole view. Served at `/ace-avatar.png`.

## Files
- `index.html` — Vite entry (mounts `/src/main.tsx`).
- `src/main.tsx` — React root.
- `src/Avatar.tsx` — layer composition.
- `src/useNeuralParticles.ts` — canvas particle engine.
- `src/styles.css` — all keyframes + feature positions.
- `public/ace-avatar.png` — base image.
- `reference-preview.html` — a standalone, no-build version (React via CDN, inline
  styles/script). Open directly in a browser to see the target without installing
  anything. Useful as a side-by-side reference while you implement.
- `package.json`, `vite.config.ts`, `tsconfig.json` — toolchain.
- `CLAUDE.md` — condensed project context for Claude Code.

## Running it
```bash
npm install
npm run dev
```

---

## 3D Avatar (React Three Fiber) — added scaffold

Alongside the original 2D composited avatar, this project now ships a **React Three
Fiber loader** for the production GLB exports. It is a separate, non-destructive entry
point — the 2D avatar at `index.html` is untouched.

### Entry points
- `index.html` → 2D neural avatar (original).
- `ace-3d.html` → 3D avatar (`src/main-3d.tsx` → `src/three/AceScene.tsx`).

In dev, open `/ace-3d.html`. `npm run build` emits both pages.

### What's wired
- `src/three/aceConfig.ts` — asset + decoder paths (BASE_URL-aware) and the clip list.
- `src/three/AceModel.tsx` — loads `ACE_ANIMATED_PRODUCTION.glb` via `useGLTF` with a
  **self-hosted Draco decoder**, and crossfades between the four baked clips
  (`ACE_Idle`, `ACE_Listening`, `ACE_Thinking`, `ACE_Speaking`).
- `src/three/AceScene.tsx` — a self-contained `<Canvas>` (lights, orbit controls,
  mobile-safe `dpr` cap). The clip buttons are a **dev harness** — wire them to your
  real conversational state and remove them in production.

### Draco decoder (offline / Electron / mobile safe)
The decoder lives in `public/draco/` and is referenced by relative path, so loading
works with no CDN — required for Electron and packaged/mobile builds. To switch ACE's
model later, point `aceConfig.ts` at a different file in `public/models/`.

If you ever upgrade `three`, refresh the decoder from
`node_modules/three/examples/jsm/libs/draco/gltf/` into `public/draco/`.

### Quality tiers
Two tiers ship per model; `pickTier()` (in `aceConfig.ts`) auto-selects from
device hints (memory / cores / coarse pointer), and `?tier=high|mobile` forces one.
- **high** — desktop / Electron (animated ~144k tris).
- **mobile** — low-end phones (animated ~90k tris, static ~84k).

### Assets
- `public/models/ACE_ANIMATED_PRODUCTION.glb` — high: skinned, 4 clips, ~144k tris.
- `public/models/ACE_EXPORT_PRODUCTION.glb` — high: static hero mesh, ~186k tris.
- `public/models/ACE_ANIMATED_MOBILE.glb` — mobile: skinned, 4 clips, ~90k tris.
- `public/models/ACE_EXPORT_MOBILE.glb` — mobile: static, ~84k tris.
- `public/draco/` — Draco decoder (`.wasm` + wrappers).

See `../reports/PRODUCTION_VALIDATION_REPORT.md` for the full validation/optimization
record. These GLBs validate with **0 errors / 0 warnings**.
