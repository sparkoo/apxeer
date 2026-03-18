import { useRef, useEffect } from "preact/hooks";
import type { TelemetrySample } from "@/lib/types";

interface Props {
  samplesA: TelemetrySample[];
  samplesB: TelemetrySample[];
  cursor: number;
  onCursorChange: (v: number) => void;
  colorA?: string;
  colorB?: string;
}

interface Channel {
  label: string;
  valuesA: (samples: TelemetrySample[]) => number[];
  valuesB: (samples: TelemetrySample[]) => number[];
  domain?: [number, number];
}

function buildDelta(samplesA: TelemetrySample[], samplesB: TelemetrySample[]): number[] {
  const len = Math.min(samplesA.length, samplesB.length);
  let acc = 0;
  return Array.from({ length: len }, (_, i) => {
    acc += (samplesA[i].t - samplesB[i].t) / len;
    return acc;
  });
}

const CHANNELS: Channel[] = [
  {
    label: "Delta (s)",
    valuesA: (a) => [], // handled specially — both lines are the delta series
    valuesB: (b) => [],
  },
  {
    label: "Speed (km/h)",
    valuesA: (a) => a.map((s) => s.speed),
    valuesB: (b) => b.map((s) => s.speed),
  },
  {
    label: "Throttle",
    valuesA: (a) => a.map((s) => s.throttle),
    valuesB: (b) => b.map((s) => s.throttle),
    domain: [0, 1],
  },
  {
    label: "Brake",
    valuesA: (a) => a.map((s) => s.brake),
    valuesB: (b) => b.map((s) => s.brake),
    domain: [0, 1],
  },
  {
    label: "Gear",
    valuesA: (a) => a.map((s) => s.gear),
    valuesB: (b) => b.map((s) => s.gear),
    domain: [1, 8],
  },
  {
    label: "Steering",
    valuesA: (a) => a.map((s) => s.steering),
    valuesB: (b) => b.map((s) => s.steering),
    domain: [-1, 1],
  },
];

const HEIGHT = 80;

function drawChart(
  canvas: HTMLCanvasElement,
  dataA: number[],
  dataB: number[],
  domain: [number, number] | undefined,
  cursor: number,
  colorA: string,
  colorB: string
) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = HEIGHT;
  canvas.width = w * dpr;
  canvas.height = h * dpr;

  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const allVals = [...dataA, ...dataB].filter(isFinite);
  if (allVals.length === 0) return;

  const [dMin, dMax] = domain ?? [
    Math.min(...allVals),
    Math.max(...allVals),
  ];
  const range = dMax - dMin || 1;
  const pad = 4;

  const toX = (i: number, len: number) => (i / (len - 1)) * w;
  const toY = (v: number) => h - pad - ((v - dMin) / range) * (h - pad * 2);

  const drawLine = (data: number[], color: string) => {
    if (data.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = toX(i, data.length);
      const y = toY(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  drawLine(dataA, colorA);
  drawLine(dataB, colorB);

  // Zero line for delta
  if (domain && domain[0] < 0 && domain[1] > 0) {
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    const y0 = toY(0);
    ctx.moveTo(0, y0);
    ctx.lineTo(w, y0);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Cursor line
  const cx = cursor * w;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, h);
  ctx.stroke();
}

function MiniChart({
  label,
  dataA,
  dataB,
  domain,
  cursor,
  onCursorChange,
  colorA,
  colorB,
}: {
  label: string;
  dataA: number[];
  dataB: number[];
  domain?: [number, number];
  cursor: number;
  onCursorChange: (v: number) => void;
  colorA: string;
  colorB: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      drawChart(canvasRef.current, dataA, dataB, domain, cursor, colorA, colorB);
    }
  }, [dataA, dataB, domain, cursor, colorA, colorB]);

  const handleClick = (e: MouseEvent) => {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    onCursorChange((e.clientX - rect.left) / rect.width);
  };

  return (
    <div>
      <p class="text-xs text-[var(--muted)] mb-1 uppercase tracking-wider">{label}</p>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: HEIGHT, display: "block", cursor: "crosshair" }}
        onClick={handleClick}
      />
    </div>
  );
}

export function TelemetryCharts({
  samplesA,
  samplesB,
  cursor,
  onCursorChange,
  colorA = "#e8304a",
  colorB = "#3b82f6",
}: Props) {
  if (!samplesA.length || !samplesB.length) return null;

  const delta = buildDelta(samplesA, samplesB);
  const deltaMax = Math.max(...delta.map(Math.abs));

  return (
    <div class="flex flex-col gap-4">
      <MiniChart
        label="Delta (s)"
        dataA={delta}
        dataB={[]}
        domain={[-deltaMax, deltaMax]}
        cursor={cursor}
        onCursorChange={onCursorChange}
        colorA={colorA}
        colorB={colorB}
      />
      {CHANNELS.slice(1).map((ch) => (
        <MiniChart
          key={ch.label}
          label={ch.label}
          dataA={ch.valuesA(samplesA)}
          dataB={ch.valuesB(samplesB)}
          domain={ch.domain}
          cursor={cursor}
          onCursorChange={onCursorChange}
          colorA={colorA}
          colorB={colorB}
        />
      ))}
    </div>
  );
}
