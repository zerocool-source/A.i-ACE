// ACE — the app. The avatar IS the UI; the controls are intentionally minimal.
//
// Flow: ambient listen (opt-in) → wake phrase OR tap-to-type → think (brain
// service) → speak (expo-speech). The knowledge graph is one tap away.

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import * as Speech from "expo-speech";

import { Avatar } from "./src/avatar/Avatar";
import { GraphView } from "./src/brain/GraphView";
import { ask, fetchGraph } from "./src/brain/api";
import { useAmbientListener } from "./src/listening/useAmbientListener";
import { useAce } from "./src/state/store";

const { width, height } = Dimensions.get("window");

export default function App() {
  const mode = useAce((s) => s.mode);
  const setMode = useAce((s) => s.setMode);
  const level = useAce((s) => s.level);
  const setLevel = useAce((s) => s.setLevel);
  const listening = useAce((s) => s.listening);
  const recentTranscript = useAce((s) => s.recentTranscript);
  const graph = useAce((s) => s.graph);
  const setGraph = useAce((s) => s.setGraph);

  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [showGraph, setShowGraph] = useState(false);

  // listen → think → speak ---------------------------------------------------

  const engage = useCallback(
    async (question: string) => {
      if (!question.trim()) return;
      setMode("thinking");
      try {
        const reply = await ask(recentTranscript(), question);
        setMode("speaking");
        Speech.stop();
        Speech.speak(reply, {
          rate: 1.0,
          pitch: 0.95,
          onBoundary: () => setLevel(0.4 + Math.random() * 0.5), // pulse glow per word
          onDone: () => {
            setLevel(0);
            setMode("idle");
          },
          onStopped: () => {
            setLevel(0);
            setMode("idle");
          },
          onError: () => {
            setLevel(0);
            setMode("idle");
          },
        });
      } catch {
        setMode("idle");
      }
    },
    [recentTranscript, setMode, setLevel],
  );

  const listener = useAmbientListener({ onWake: engage });

  const toggleListening = useCallback(async () => {
    if (listening) {
      await listener.stop();
      setMode("idle");
    } else {
      const ok = await listener.start();
      if (ok) setMode("listening");
    }
  }, [listening, listener, setMode]);

  // graph --------------------------------------------------------------------

  const openGraph = useCallback(async () => {
    try {
      setGraph(await fetchGraph());
    } catch {
      // brain offline — show whatever we have
    }
    setShowGraph(true);
  }, [setGraph]);

  useEffect(() => () => Speech.stop(), []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />

      <View style={styles.stage}>
        <Avatar mode={mode} level={level} onTap={() => setTyping(true)} />
      </View>

      {/* minimal status line — no chrome around the face */}
      <View style={styles.statusBar} pointerEvents="box-none">
        {listening && (
          <View style={styles.liveRow}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>listening</Text>
          </View>
        )}
        {mode === "thinking" && (
          <View style={styles.liveRow}>
            <ActivityIndicator color="#7fb0ff" size="small" />
            <Text style={styles.liveText}>thinking</Text>
          </View>
        )}
      </View>

      {/* two unobtrusive controls */}
      <View style={styles.controls}>
        <Pressable style={styles.btn} onPress={toggleListening}>
          <Text style={styles.btnText}>{listening ? "Stop listening" : "Listen"}</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={openGraph}>
          <Text style={styles.btnText}>Brain</Text>
        </Pressable>
      </View>

      {/* tap-to-type fallback for "Ace, what do you think?" */}
      <Modal visible={typing} transparent animationType="fade" onRequestClose={() => setTyping(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Ask ACE</Text>
            <TextInput
              style={styles.input}
              placeholder="What do you think?"
              placeholderTextColor="#5b6b86"
              value={draft}
              onChangeText={setDraft}
              autoFocus
              multiline
            />
            <View style={styles.modalRow}>
              <Pressable style={styles.btn} onPress={() => setTyping(false)}>
                <Text style={styles.btnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.btnPrimary]}
                onPress={() => {
                  const q = draft;
                  setDraft("");
                  setTyping(false);
                  engage(q);
                }}
              >
                <Text style={styles.btnText}>Ask</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* knowledge graph */}
      <Modal visible={showGraph} animationType="slide" onRequestClose={() => setShowGraph(false)}>
        <View style={styles.graphWrap}>
          <Text style={styles.graphTitle}>ACE · knowledge graph</Text>
          {graph.nodes.length ? (
            <GraphView graph={graph} width={width} height={height - 160} />
          ) : (
            <Text style={styles.empty}>
              No memories yet. Ask ACE something — it writes what it learns here.
            </Text>
          )}
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => setShowGraph(false)}>
            <Text style={styles.btnText}>Close</Text>
          </Pressable>
        </View>
      </Modal>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  stage: { flex: 1, alignItems: "center", justifyContent: "center" },
  statusBar: { position: "absolute", top: 64, width: "100%", alignItems: "center" },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#ff5a5a" },
  liveText: { color: "#9bb8e6", fontSize: 13, letterSpacing: 1 },
  controls: {
    position: "absolute",
    bottom: 48,
    width: "100%",
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#2a4a7f",
    backgroundColor: "#0a1424",
  },
  btnPrimary: { backgroundColor: "#173a6e", borderColor: "#3f6fd8" },
  btnText: { color: "#cfe2ff", fontSize: 15 },
  modalWrap: { flex: 1, backgroundColor: "#000a", justifyContent: "center", padding: 24 },
  modalCard: { backgroundColor: "#0a1424", borderRadius: 18, padding: 20, borderWidth: 1, borderColor: "#2a4a7f" },
  modalTitle: { color: "#cfe2ff", fontSize: 18, marginBottom: 12 },
  input: {
    minHeight: 80,
    color: "#eaf2ff",
    fontSize: 16,
    backgroundColor: "#060d18",
    borderRadius: 12,
    padding: 12,
    textAlignVertical: "top",
  },
  modalRow: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },
  graphWrap: { flex: 1, backgroundColor: "#000", alignItems: "center", paddingTop: 64, gap: 16 },
  graphTitle: { color: "#cfe2ff", fontSize: 16, letterSpacing: 1 },
  empty: { color: "#5b6b86", textAlign: "center", paddingHorizontal: 40, marginTop: 40 },
});
