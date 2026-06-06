// Central config for the ACE 3D avatar scaffold.
// Paths resolve against Vite's BASE_URL so the build works when hosted under a
// sub-path, from Electron's custom protocol, or from a mobile WebView.
const base = import.meta.env.BASE_URL ?? "/";

/** Self-hosted Draco decoder directory (draco_decoder.wasm + wrapper live here). */
export const DRACO_DECODER_PATH = `${base}draco/`;

/** Production GLB assets, served from /public. */
export const ACE_ANIMATED_URL = `${base}models/ACE_ANIMATED_PRODUCTION.glb`;
export const ACE_STATIC_URL = `${base}models/ACE_EXPORT_PRODUCTION.glb`;

/** The four behavioural clips baked into ACE_ANIMATED_PRODUCTION.glb. */
export const ACE_CLIPS = ["ACE_Idle", "ACE_Listening", "ACE_Thinking", "ACE_Speaking"] as const;
export type AceState = (typeof ACE_CLIPS)[number];
