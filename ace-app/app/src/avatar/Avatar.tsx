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
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
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
            {/* eye/chip soft glows — SVG radial gradients (positions are % of
                stage, tuned to the image). Opacity pulses with the breath/mode. */}
            <Animated.View style={[StyleSheet.absoluteFill, eyeStyle]} pointerEvents="none">
              <Svg width={SIZE} height={SIZE}>
                <Defs>
                  <RadialGradient id="eye" cx="50%" cy="50%" r="50%">
                    <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.95} />
                    <Stop offset="35%" stopColor="#bee1ff" stopOpacity={0.55} />
                    <Stop offset="100%" stopColor="#78b4ff" stopOpacity={0} />
                  </RadialGradient>
                  <RadialGradient id="chip" cx="50%" cy="50%" r="50%">
                    <Stop offset="0%" stopColor="#d2ebff" stopOpacity={0.6} />
                    <Stop offset="45%" stopColor="#8cbeff" stopOpacity={0.25} />
                    <Stop offset="100%" stopColor="#5a96eb" stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Circle cx={SIZE * 0.37} cy={SIZE * 0.49} r={SIZE * 0.07} fill="url(#eye)" />
                <Circle cx={SIZE * 0.626} cy={SIZE * 0.487} r={SIZE * 0.07} fill="url(#eye)" />
                <Circle cx={SIZE * 0.5} cy={SIZE * 0.344} r={SIZE * 0.14} fill="url(#chip)" />
              </Svg>
            </Animated.View>
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
});
