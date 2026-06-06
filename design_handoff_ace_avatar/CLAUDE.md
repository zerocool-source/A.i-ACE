# CLAUDE.md — ACE Neural Avatar

This is a **React + Vite + TypeScript** project that renders an animated futuristic
AI-avatar interface. It is already runnable — `npm install && npm run dev`.

## What this is
A single full-screen avatar: the reference render (`public/ace-avatar.png`) is the
base visual layer, centered on a pure-black background, with several subtle motion
layers composited on top. The face shape is never modified — all animation is glow,
pulse, flicker, particles, and aura.

## Hard constraints (do not violate)
- The base image defines the face. **Never** redraw, distort, or mask the face shape.
- **No UI panels, no chrome, no extra text.** The only text anywhere is the "ACE"
  baked into the source image.
- Pure black (`#000`) background.
- All motion must be gated behind `prefers-reduced-motion`.

## Architecture
- `src/main.tsx` — entry, mounts `<Avatar />`.
- `src/Avatar.tsx` — composites the layers (aura, base face, two flicker copies,
  particle canvas, eye/chip glow overlays).
- `src/useNeuralParticles.ts` — canvas hook: builds a random neural graph confined to
  an ellipse over the head and animates glowing dots travelling along its edges.
- `src/styles.css` — all keyframes and the percentage-based positions for the eye and
  ACE-chip glow overlays.
- `public/ace-avatar.png` — the reference image, served at `/ace-avatar.png`.

## If you swap the base image
The eye glows, ACE-chip glow (in `styles.css`), and the `HEAD` ellipse constant (in
`useNeuralParticles.ts`) are all expressed as percentages tuned to the current image.
Re-tune those constants if the new image frames the face differently.

## Commands
- `npm run dev` — dev server
- `npm run build` — typecheck + production build
- `npm run preview` — preview the build
