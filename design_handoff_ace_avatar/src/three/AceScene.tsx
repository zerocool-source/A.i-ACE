import { Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { AceModel } from "./AceModel";
import { ACE_CLIPS, type AceState } from "./aceConfig";

function Loader() {
  return (
    <Html center style={{ color: "#9cd2ff", font: "14px system-ui", opacity: 0.8 }}>
      Loading ACE…
    </Html>
  );
}

/**
 * Drop-in React Three Fiber scene for the ACE avatar. Self-contained: lights,
 * environment, orbit controls, Draco-aware loading and a clip switcher.
 *
 * Tuned for cross-target use:
 *  - dpr capped at 2 so it stays smooth on mobile / high-DPI screens
 *  - powerPreference "high-performance", antialias on
 *  - transparent canvas so it composites over the existing ACE styling
 */
export function AceScene() {
  const [state, setState] = useState<AceState>("ACE_Idle");

  return (
    <div style={{ position: "fixed", inset: 0, background: "#04060d" }}>
      <Canvas
        shadows={false}
        dpr={[1, 2]}
        camera={{ position: [0, 0.1, 3.2], fov: 35, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 3, 4]} intensity={1.1} />
        <directionalLight position={[-3, 1, -2]} intensity={0.4} color="#6da8ff" />

        <Suspense fallback={<Loader />}>
          <AceModel state={state} />
        </Suspense>

        <OrbitControls enablePan={false} minDistance={1.5} maxDistance={6} enableDamping />
      </Canvas>

      {/* Clip switcher — wire these to your real conversational states. */}
      <div
        style={{
          position: "fixed",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 8,
        }}
      >
        {ACE_CLIPS.map((clip) => (
          <button
            key={clip}
            onClick={() => setState(clip)}
            style={{
              padding: "8px 14px",
              borderRadius: 999,
              border: "1px solid #1d3a5f",
              background: state === clip ? "#1d6fff" : "rgba(13,26,46,0.8)",
              color: "#cfe6ff",
              font: "13px system-ui",
              cursor: "pointer",
            }}
          >
            {clip.replace("ACE_", "")}
          </button>
        ))}
      </div>
    </div>
  );
}
