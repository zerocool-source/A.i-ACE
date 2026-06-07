// Central config for the ACE 3D avatar scaffold.
// Paths resolve against Vite's BASE_URL so the build works when hosted under a
// sub-path, from Electron's custom protocol, or from a mobile WebView.
const base = import.meta.env.BASE_URL ?? "/";

/** Self-hosted Draco decoder directory (draco_decoder.wasm + wrapper live here). */
export const DRACO_DECODER_PATH = `${base}draco/`;

/** Quality tiers. "high" = desktop/Electron, "mobile" = low-end devices. */
export type Tier = "high" | "mobile";

const MODELS = {
  high: {
    animated: `${base}models/ACE_ANIMATED_PRODUCTION.glb`, // ~144k tris
    static: `${base}models/ACE_EXPORT_PRODUCTION.glb`, //     ~186k tris
  },
  mobile: {
    animated: `${base}models/ACE_ANIMATED_MOBILE.glb`, //     ~90k tris
    static: `${base}models/ACE_EXPORT_MOBILE.glb`, //         ~84k tris
  },
} as const;

/**
 * Pick a tier from device hints. Conservative: only desktop-class pointers with
 * enough memory get the high tier. Override-able via `?tier=high|mobile`.
 */
export function pickTier(): Tier {
  if (typeof window === "undefined") return "high";
  const forced = new URLSearchParams(window.location.search).get("tier");
  if (forced === "high" || forced === "mobile") return forced;

  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  const lowEnd = coarse || mem <= 4 || cores <= 4;
  return lowEnd ? "mobile" : "high";
}

export const aceAnimatedUrl = (tier: Tier) => MODELS[tier].animated;
export const aceStaticUrl = (tier: Tier) => MODELS[tier].static;

/** The four behavioural clips baked into every ACE animated GLB. */
export const ACE_CLIPS = ["ACE_Idle", "ACE_Listening", "ACE_Thinking", "ACE_Speaking"] as const;
export type AceState = (typeof ACE_CLIPS)[number];
