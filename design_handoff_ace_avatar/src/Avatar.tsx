import { useNeuralParticles } from "./useNeuralParticles";

// Image lives in /public, served from the web root by Vite.
const SRC = "/ace-avatar.png";

export function Avatar() {
  const canvasRef = useNeuralParticles();

  return (
    <div className="stage">
      <div className="aura" />
      <img className="face" src={SRC} alt="ACE neural avatar" draggable={false} />
      <img className="flicker a" src={SRC} alt="" aria-hidden draggable={false} />
      <img className="flicker b" src={SRC} alt="" aria-hidden draggable={false} />
      <canvas className="particles" ref={canvasRef} />
      <div className="glow ace" />
      <div className="glow eye left" />
      <div className="glow eye right" />
    </div>
  );
}
