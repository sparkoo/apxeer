import { useMemo } from "preact/hooks";
import type { TelemetrySample } from "@/lib/types";

interface Props {
  samplesA: TelemetrySample[];
  samplesB: TelemetrySample[];
  cursor: number;
  colorA?: string;
  colorB?: string;
}

interface Point { x: number; y: number }

const W = 480;
const H = 320;

function project(samples: TelemetrySample[]): Point[] {
  return samples.map((s) => ({ x: s.x, y: s.z }));
}

function normalise(points: Point[], pad = 24): Point[] {
  if (!points.length) return [];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min((W - pad * 2) / rangeX, (H - pad * 2) / rangeY);
  const offX = pad + ((W - pad * 2) - rangeX * scale) / 2;
  const offY = pad + ((H - pad * 2) - rangeY * scale) / 2;
  return points.map((p) => ({
    x: offX + (p.x - minX) * scale,
    y: offY + (p.y - minY) * scale,
  }));
}

function toPath(pts: Point[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

function atCursor(pts: Point[], cursor: number): Point {
  if (!pts.length) return { x: 0, y: 0 };
  return pts[Math.min(Math.floor(cursor * pts.length), pts.length - 1)];
}

export function TrackMap({
  samplesA,
  samplesB,
  cursor,
  colorA = "#e8304a",
  colorB = "#3b82f6",
}: Props) {
  const combined = useMemo(
    () => normalise(project([...samplesA, ...samplesB])),
    [samplesA, samplesB]
  );
  const normA = combined.slice(0, samplesA.length);
  const normB = combined.slice(samplesA.length);

  const posA = atCursor(normA, cursor);
  const posB = atCursor(normB, cursor);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ background: "var(--surface)", borderRadius: 8 }}
    >
      <path d={toPath(normA)} fill="none" stroke="var(--border)" strokeWidth={8}
        strokeLinecap="round" strokeLinejoin="round" />
      <path d={toPath(normA)} fill="none" stroke={colorA} strokeWidth={2}
        strokeOpacity={0.7} strokeLinecap="round" strokeLinejoin="round" />
      <path d={toPath(normB)} fill="none" stroke={colorB} strokeWidth={2}
        strokeOpacity={0.7} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={posA.x} cy={posA.y} r={10} fill={colorA} fillOpacity={0.3} />
      <circle cx={posA.x} cy={posA.y} r={6} fill={colorA} />
      <circle cx={posB.x} cy={posB.y} r={10} fill={colorB} fillOpacity={0.3} />
      <circle cx={posB.x} cy={posB.y} r={6} fill={colorB} />
    </svg>
  );
}
