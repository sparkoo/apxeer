import { useRef, useEffect, useState } from "preact/hooks";
import { formatLapTime } from "@/lib/types";

interface LapPoint {
  recorded_at: string;
  lap_time_ms: number;
}

interface Props {
  laps: LapPoint[];
  pbTimeMs: number;
}

const HEIGHT = 140;
const PAD_X = 48;
const PAD_Y = 20;
const DOT_R = 4;

function drawChart(
  canvas: HTMLCanvasElement,
  laps: LapPoint[],
  pbTimeMs: number,
  hoverIdx: number | null
) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = HEIGHT;
  canvas.width = w * dpr;
  canvas.height = h * dpr;

  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  if (laps.length === 0) return;

  // Sort chronologically (oldest first) for drawing
  const sorted = [...laps].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  const times = sorted.map((l) => l.lap_time_ms);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeRange = maxTime - minTime || 1000; // avoid division by zero
  const domainMin = minTime - timeRange * 0.1;
  const domainMax = maxTime + timeRange * 0.1;
  const range = domainMax - domainMin;

  const plotW = w - PAD_X - 12;
  const plotH = h - PAD_Y * 2;

  const toX = (i: number) => PAD_X + (sorted.length === 1 ? plotW / 2 : (i / (sorted.length - 1)) * plotW);
  const toY = (ms: number) => PAD_Y + plotH - ((ms - domainMin) / range) * plotH;

  // Y-axis labels (3 ticks)
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.font = "10px monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 2; i++) {
    const ms = domainMin + (range * i) / 2;
    const y = toY(ms);
    ctx.fillText(formatLapTime(Math.round(ms)), PAD_X - 6, y);
    // grid line
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_X, y);
    ctx.lineTo(w - 12, y);
    ctx.stroke();
  }

  // PB dashed line
  const pbY = toY(pbTimeMs);
  ctx.strokeStyle = "rgba(74, 222, 128, 0.5)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(PAD_X, pbY);
  ctx.lineTo(w - 12, pbY);
  ctx.stroke();
  ctx.setLineDash([]);

  // PB label
  ctx.fillStyle = "rgba(74, 222, 128, 0.7)";
  ctx.font = "9px monospace";
  ctx.textAlign = "left";
  ctx.fillText("PB", w - 10, pbY - 4);

  // Connecting line
  if (sorted.length > 1) {
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    sorted.forEach((_, i) => {
      const x = toX(i);
      const y = toY(times[i]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // Track running PB to color dots
  let runningPb = Infinity;
  sorted.forEach((_, i) => {
    const x = toX(i);
    const y = toY(times[i]);
    const isPbImprovement = times[i] < runningPb;
    if (isPbImprovement) runningPb = times[i];

    ctx.beginPath();
    ctx.arc(x, y, DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = isPbImprovement ? "#4ade80" : "rgba(255,255,255,0.5)";
    ctx.fill();

    if (hoverIdx === i) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });

  // Hover tooltip
  if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < sorted.length) {
    const x = toX(hoverIdx);
    const y = toY(times[hoverIdx]);
    const label = formatLapTime(times[hoverIdx]);
    const date = new Date(sorted[hoverIdx].recorded_at).toLocaleDateString();
    const text = `${label}  ${date}`;

    ctx.font = "11px monospace";
    const metrics = ctx.measureText(text);
    const tw = metrics.width + 10;
    const th = 20;
    let tx = x - tw / 2;
    if (tx < PAD_X) tx = PAD_X;
    if (tx + tw > w - 12) tx = w - 12 - tw;
    const ty = y - DOT_R - th - 4;

    ctx.fillStyle = "rgba(30, 30, 30, 0.9)";
    ctx.beginPath();
    ctx.roundRect(tx, ty, tw, th, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, tx + tw / 2, ty + th / 2);
  }
}

export function LapProgressionChart({ laps, pbTimeMs }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Sort once for mouse hit-testing
  const sorted = [...laps].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  useEffect(() => {
    if (canvasRef.current) {
      drawChart(canvasRef.current, laps, pbTimeMs, hoverIdx);
    }
  }, [laps, pbTimeMs, hoverIdx]);

  const handleMouseMove = (e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || sorted.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const plotW = canvas.clientWidth - PAD_X - 12;

    let closest = 0;
    let closestDist = Infinity;
    sorted.forEach((_, i) => {
      const x = PAD_X + (sorted.length === 1 ? plotW / 2 : (i / (sorted.length - 1)) * plotW);
      const dist = Math.abs(mx - x);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    setHoverIdx(closestDist < 20 ? closest : null);
  };

  const handleMouseLeave = () => setHoverIdx(null);

  if (laps.length === 0) return null;

  return (
    <div>
      <p class="text-xs text-[var(--muted)] mb-2 uppercase tracking-wider">Lap Time Progression</p>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: HEIGHT, display: "block", cursor: "crosshair" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
}
