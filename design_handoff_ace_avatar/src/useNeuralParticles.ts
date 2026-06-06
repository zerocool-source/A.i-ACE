import { useEffect, useRef } from "react";

type Node = { x: number; y: number };
type Edge = [number, number];
type Traveller = { e: Edge; t: number; speed: number; size: number; life: number };

/**
 * Spawns glowing dots that travel along a generated neural graph confined to
 * the head silhouette — mirroring the wireframe lines in the reference image.
 */
export function useNeuralParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let nodes: Node[] = [];
    let edges: Edge[] = [];
    let travellers: Traveller[] = [];
    let W = 0;
    let H = 0;
    let running = true;

    const HEAD = { cx: 0.5, cy: 0.46, rx: 0.275, ry: 0.42 };
    const inHead = (nx: number, ny: number) => {
      const dx = (nx - HEAD.cx) / HEAD.rx;
      const dy = (ny - HEAD.cy) / HEAD.ry;
      return dx * dx + dy * dy <= 1;
    };

    const spawn = (): Traveller => {
      const e = edges[(Math.random() * edges.length) | 0];
      return {
        e,
        t: Math.random(),
        speed: 0.004 + Math.random() * 0.01,
        size: 0.7 + Math.random() * 1.4,
        life: 0,
      };
    };

    const build = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = rect.width;
      H = rect.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      nodes = [];
      const target = 150;
      let guard = 0;
      while (nodes.length < target && guard < target * 40) {
        guard++;
        const nx = Math.random();
        const ny = Math.random();
        if (!inHead(nx, ny)) continue;
        nodes.push({ x: nx * W, y: ny * H });
      }

      edges = [];
      const maxD = Math.min(W, H) * 0.12;
      for (let i = 0; i < nodes.length; i++) {
        const cand: { j: number; d: number }[] = [];
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
          if (d < maxD) cand.push({ j, d });
        }
        cand.sort((a, b) => a.d - b.d);
        cand.slice(0, 3).forEach((c) => {
          if (i < c.j) edges.push([i, c.j]);
        });
      }
      if (!edges.length) return;

      travellers = [];
      for (let k = 0; k < 46; k++) travellers.push(spawn());
    };

    const frame = () => {
      if (!running) return;
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < travellers.length; i++) {
        const tr = travellers[i];
        tr.t += tr.speed;
        tr.life += 1;
        if (tr.t >= 1) {
          const arrive = tr.e[1];
          const next = edges.filter((ed) => ed[0] === arrive || ed[1] === arrive);
          if (next.length && Math.random() < 0.85) {
            const ne = next[(Math.random() * next.length) | 0];
            tr.e = ne[0] === arrive ? ne : [ne[1], ne[0]];
            tr.t = 0;
          } else {
            travellers[i] = spawn();
            continue;
          }
        }
        const a = nodes[tr.e[0]];
        const b = nodes[tr.e[1]];
        if (!a || !b) {
          travellers[i] = spawn();
          continue;
        }
        const x = a.x + (b.x - a.x) * tr.t;
        const y = a.y + (b.y - a.y) * tr.t;
        const edgeFade = Math.sin(tr.t * Math.PI);
        const flick = 0.65 + 0.35 * Math.sin(tr.life * 0.25 + i);
        const alpha = edgeFade * flick;

        ctx.beginPath();
        ctx.fillStyle = `rgba(220,238,255,${(alpha * 0.95).toFixed(3)})`;
        ctx.shadowColor = "rgba(170,210,255,0.9)";
        ctx.shadowBlur = 6;
        ctx.arc(x, y, tr.size, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };

    build();
    frame();
    const onResize = () => build();
    window.addEventListener("resize", onResize);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return canvasRef;
}
