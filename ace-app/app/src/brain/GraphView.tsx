// Knowledge-graph visualization (Obsidian-style) using react-native-svg.
// A lightweight force simulation lays out the nodes; ghost (unresolved) links are
// dimmed. This is read-only in the foundation; node tap → note is a future phase.

import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Text as SvgText } from "react-native-svg";
import type { Graph } from "../state/store";

interface Props {
  graph: Graph;
  width: number;
  height: number;
}

interface P {
  x: number;
  y: number;
}

/** Deterministic force-directed layout (Fruchterman–Reingold-ish, few iters). */
function layout(graph: Graph, w: number, h: number): Map<string, P> {
  const pos = new Map<string, P>();
  const n = graph.nodes.length;
  if (n === 0) return pos;

  // seed on a circle (deterministic)
  graph.nodes.forEach((node, i) => {
    const a = (i / n) * Math.PI * 2;
    pos.set(node.id, { x: w / 2 + Math.cos(a) * w * 0.3, y: h / 2 + Math.sin(a) * h * 0.3 });
  });

  const k = Math.sqrt((w * h) / Math.max(1, n)) * 0.6;
  for (let iter = 0; iter < 80; iter++) {
    const disp = new Map<string, P>(graph.nodes.map((nd) => [nd.id, { x: 0, y: 0 }]));

    // repulsion
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = graph.nodes[i].id;
        const b = graph.nodes[j].id;
        const pa = pos.get(a)!;
        const pb = pos.get(b)!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let d = Math.hypot(dx, dy) || 0.01;
        const f = (k * k) / d;
        dx = (dx / d) * f;
        dy = (dy / d) * f;
        disp.get(a)!.x += dx;
        disp.get(a)!.y += dy;
        disp.get(b)!.x -= dx;
        disp.get(b)!.y -= dy;
      }
    }

    // attraction along edges
    for (const e of graph.edges) {
      const pa = pos.get(e.from);
      const pb = pos.get(e.to);
      if (!pa || !pb) continue;
      let dx = pa.x - pb.x;
      let dy = pa.y - pb.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = (d * d) / k;
      dx = (dx / d) * f;
      dy = (dy / d) * f;
      disp.get(e.from)!.x -= dx;
      disp.get(e.from)!.y -= dy;
      disp.get(e.to)!.x += dx;
      disp.get(e.to)!.y += dy;
    }

    const temp = 8 * (1 - iter / 80);
    for (const nd of graph.nodes) {
      const dp = disp.get(nd.id)!;
      const d = Math.hypot(dp.x, dp.y) || 0.01;
      const p = pos.get(nd.id)!;
      p.x += (dp.x / d) * Math.min(d, temp);
      p.y += (dp.y / d) * Math.min(d, temp);
      p.x = Math.max(20, Math.min(w - 20, p.x));
      p.y = Math.max(20, Math.min(h - 20, p.y));
    }
  }
  return pos;
}

export function GraphView({ graph, width, height }: Props) {
  const pos = useMemo(() => layout(graph, width, height), [graph, width, height]);

  return (
    <View style={[styles.wrap, { width, height }]}>
      <Svg width={width} height={height}>
        {graph.edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          return (
            <Line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2a4a7f" strokeWidth={1} />
          );
        })}
        {graph.nodes.map((nd) => {
          const p = pos.get(nd.id);
          if (!p) return null;
          return (
            <React.Fragment key={nd.id}>
              <Circle
                cx={p.x}
                cy={p.y}
                r={nd.ghost ? 4 : 6}
                fill={nd.ghost ? "#1c345c" : "#7fb0ff"}
                opacity={nd.ghost ? 0.5 : 1}
              />
              <SvgText x={p.x + 8} y={p.y + 3} fontSize={9} fill="#9bb8e6">
                {nd.id.length > 18 ? nd.id.slice(0, 17) + "…" : nd.id}
              </SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: "#000" },
});
