import { useEffect, useRef } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import {
  DRACO_DECODER_PATH,
  aceAnimatedUrl,
  pickTier,
  type AceState,
  type Tier,
} from "./aceConfig";

type AceModelProps = {
  /** Which baked clip to play. Defaults to ACE_Idle. */
  state?: AceState;
  /** Crossfade duration between clips, in seconds. */
  fade?: number;
  /** Quality tier. Defaults to a device-hint heuristic (see pickTier). */
  tier?: Tier;
};

// Keyword each ACE state matches against, so a GLB whose clips were named in
// Blender (e.g. "Idle", "talk", "Armature|Speaking") still drives the avatar.
const CLIP_KEYWORD: Record<AceState, string> = {
  ACE_Idle: "idle",
  ACE_Listening: "listen",
  ACE_Thinking: "think",
  ACE_Speaking: "speak",
};

/** Resolve a requested ACE state to an actual action name present in the GLB. */
function resolveClip(actionNames: string[], state: AceState): string | undefined {
  if (actionNames.includes(state)) return state; // canonical name present
  const kw = CLIP_KEYWORD[state];
  const fuzzy = actionNames.find((n) => n.toLowerCase().includes(kw));
  return fuzzy ?? actionNames[0]; // fall back to the first available clip
}

/**
 * Loads the tier-appropriate ACE animated GLB (Draco-compressed, skinned) and
 * crossfades between behavioural states. Geometry, materials and transparency are
 * used exactly as authored — this loader does not alter ACE's look.
 *
 * Clip names are resolved fuzzily (see resolveClip), so a rig exported from
 * Blender with arbitrarily-named actions still works without re-baking.
 *
 * The second argument to useGLTF points DRACOLoader at the self-hosted decoder
 * in /public/draco, so loading works offline (Electron / packaged / mobile).
 */
export function AceModel({ state = "ACE_Idle", fade = 0.4, tier }: AceModelProps) {
  const group = useRef<THREE.Group>(null);
  const url = aceAnimatedUrl(tier ?? pickTier());
  const { scene, animations } = useGLTF(url, DRACO_DECODER_PATH);
  const { actions, mixer } = useAnimations(animations, group);

  // Crossfade to the requested clip whenever `state` changes.
  useEffect(() => {
    const name = resolveClip(Object.keys(actions), state);
    const next = name ? actions[name] : undefined;
    if (!next) return;
    next.reset().fadeIn(fade).play();
    return () => {
      next.fadeOut(fade);
    };
  }, [actions, state, fade]);

  // Keep skinned-mesh frustum culling off; the animated bounds can extend past
  // the bind-pose AABB and otherwise pop out of view at certain angles.
  useEffect(() => {
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.frustumCulled = false;
    });
  }, [scene]);

  // Stop all actions on unmount (drei drives the mixer via useFrame internally).
  useEffect(
    () => () => {
      mixer.stopAllAction();
    },
    [mixer],
  );

  return (
    <group ref={group} dispose={null}>
      <primitive object={scene} />
    </group>
  );
}

// Warm the cache + decoder for the detected tier so first interaction is instant.
useGLTF.preload(aceAnimatedUrl(pickTier()), DRACO_DECODER_PATH);
