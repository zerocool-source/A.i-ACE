// Ambient listening pipeline (device).
//
// Responsibilities of this hook:
//   • request mic consent (explicit, user-driven)
//   • run the mic so the avatar can react to amplitude while listening
//   • expose a `feed(text, speaker?)` seam where a speech-to-text provider pushes
//     transcribed utterances; this hook buffers them (in store) and watches for the
//     wake phrase, then hands the trailing question to `onWake`.
//
// What this hook deliberately does NOT do: persist audio. expo-av writes a temp
// file while metering; we discard it on stop and never read its contents. Real
// transcription is a provider you plug into `feed` — see the TODOs below.
//
// TODO(phase 2): wire a streaming STT provider (e.g. @react-native-voice/voice or
// expo-speech-recognition) and call `feed()` with each finalized chunk.
// TODO(phase 2): for a battery-efficient always-on hotword, run Picovoice Porcupine
// and call the same wake path instead of scanning the transcript.

import { useCallback, useRef } from "react";
import { Audio } from "expo-av";
import { useAce } from "../state/store";
import { detectWake } from "./wake";

interface Options {
  /** Called with the user's question when the wake phrase is detected. */
  onWake: (question: string) => void;
}

export function useAmbientListener({ onWake }: Options) {
  const recordingRef = useRef<Audio.Recording | null>(null);
  const setListening = useAce((s) => s.setListening);
  const setLevel = useAce((s) => s.setLevel);
  const setConsented = useAce((s) => s.setConsented);
  const pushUtterance = useAce((s) => s.pushUtterance);

  /** A transcription provider calls this with each finalized chunk of speech. */
  const feed = useCallback(
    (text: string, speaker = "") => {
      const clean = text.trim();
      if (!clean) return;
      pushUtterance({ speaker, text: clean, at: Date.now() });
      const question = detectWake(clean);
      if (question) onWake(question);
    },
    [pushUtterance, onWake],
  );

  const start = useCallback(async () => {
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) {
      setConsented(false);
      return false;
    }
    setConsented(true);

    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

    const rec = new Audio.Recording();
    await rec.prepareToRecordAsync({
      ...Audio.RecordingOptionsPresets.LOW_QUALITY,
      isMeteringEnabled: true,
    });
    rec.setOnRecordingStatusUpdate((status) => {
      if (status.isRecording && typeof status.metering === "number") {
        // metering is dBFS (~-160..0). Map to 0..1 for avatar reactivity.
        const norm = Math.max(0, Math.min(1, (status.metering + 60) / 60));
        setLevel(norm);
      }
    });
    rec.setProgressUpdateInterval(120);
    await rec.startAsync();

    recordingRef.current = rec;
    setListening(true);
    return true;
  }, [setConsented, setListening, setLevel]);

  const stop = useCallback(async () => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    setListening(false);
    setLevel(0);
    if (rec) {
      try {
        await rec.stopAndUnloadAsync();
      } catch {
        // already stopped
      }
      // We do not read or keep the temp file — discard the URI.
    }
  }, [setListening, setLevel]);

  return { start, stop, feed };
}
