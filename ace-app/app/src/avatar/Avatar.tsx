// The neural avatar — ACE's face, which IS the UI.
//
// Ported from the web prototype's CSS-keyframe layers to Reanimated:
//   • breathing glow (scale + opacity), speed scaled by mode
//   • eye/chip aura pulse
//   • draggable: park the face anywhere; it stays put
//   • mode-reactive: idle | listening | thinking | speaking change tempo & glow
//
// Tap the face to talk (typed fallback until device speech is wired).

import { useEffect } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import type { Mode } from "../state/store";

const SIZE = 300;

// Animation tempo per mode (lower = faster). Mirrors the prototype's --speed var.
const SPEED: Record<Mode, number> = {
  idle: 1,
  listening: 1.4,
  thinking: 2.2,
  speaking: 1.6,
};

// Baseline glow intensity per mode (0..1). Mirrors --level.
const GLOW: Record<Mode, number> = {
  idle: 0.25,
  listening: 0.5,
  thinking: 0.7,
  speaking: 0.85,
};

interface Props {
  mode: Mode;
  /** live audio reactivity 0..1, added on top of the mode baseline */
  level: number;
  onTap: () => void;
}

export function Avatar({ mode, level, onTap }: Props) {
  // Drag position.
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  // Breathing.
  const breathe = useSharedValue(0);
  // Glow target (mode baseline + live level).
  const glow = useSharedValue(GLOW.idle);

  useEffect(() => {
    const period = 3000 * SPEED[mode];
    cancelAnimation(breathe);
    breathe.value = 0;
    breathe.value = withRepeat(
      withTiming(1, { duration: period, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(breathe);
  }, [mode]);

  useEffect(() => {
    glow.value = withTiming(Math.min(1, GLOW[mode] + level * 0.6), { duration: 180 });
  }, [mode, level]);

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = tx.value;
      startY.value = ty.value;
    })
    .onUpdate((e) => {
      tx.value = startX.value + e.translationX;
      ty.value = startY.value + e.translationY;
    });

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
  }));

  const faceStyle = useAnimatedStyle(() => {
    const s = 1 + breathe.value * 0.02;
    const b = 0.9 + breathe.value * 0.24 + glow.value * 0.1;
    return { transform: [{ scale: s }], opacity: Math.min(1, b) };
  });

  const auraStyle = useAnimatedStyle(() => ({
    opacity: 0.2 + glow.value * 0.6,
    transform: [{ scale: 0.9 + breathe.value * 0.06 + glow.value * 0.12 }],
  }));

  const eyeStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + glow.value * 0.6 + breathe.value * 0.2,
    transform: [{ scale: 0.85 + breathe.value * 0.3 }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.container, containerStyle]}>
        {/* ambient halo behind the head */}
        <Animated.View style={[styles.aura, auraStyle]} pointerEvents="none" />

        <Pressable onPress={onTap} hitSlop={12}>
          <View style={styles.stage}>
            <Animated.Image
              source={require("../../assets/ace-avatar.png")}
              style={[styles.face, faceStyle]}
              resizeMode="contain"
            />
            {/* eye/chip glow blobs (positions are % of stage, tuned to the image) */}
            <Animated.View style={[styles.glow, styles.eyeLeft, eyeStyle]} pointerEvents="none" />
            <Animated.View style={[styles.glow, styles.eyeRight, eyeStyle]} pointerEvents="none" />
            <Animated.View style={[styles.glow, styles.chip, eyeStyle]} pointerEvents="none" />
          </View>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  stage: { width: SIZE, height: SIZE },
  face: { position: "absolute", width: SIZE, height: SIZE },
  aura: {
    position: "absolute",
    width: SIZE * 0.95,
    height: SIZE,
    borderRadius: SIZE,
    backgroundColor: "#3f6fd8",
    opacity: 0.3,
  },
  glow: {
    position: "absolute",
    backgroundColor: "#c7e2ff",
    borderRadius: 999,
  },
  eyeLeft: { left: SIZE * 0.34, top: SIZE * 0.47, width: SIZE * 0.1, height: SIZE * 0.07 },
  eyeRight: { left: SIZE * 0.58, top: SIZE * 0.47, width: SIZE * 0.1, height: SIZE * 0.07 },
  chip: { left: SIZE * 0.4, top: SIZE * 0.29, width: SIZE * 0.2, height: SIZE * 0.2, backgroundColor: "#9cc4ff" },
});
