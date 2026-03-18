import { useState, useEffect, useRef } from "preact/hooks";
import { useSearch } from "wouter";
import { api } from "@/lib/api";
import { CompareData, formatLapTime } from "@/lib/types";
import { TrackMap } from "@/components/TrackMap";
import { TelemetryCharts } from "@/components/TelemetryCharts";

const COLOR_A = "#e8304a";
const COLOR_B = "#3b82f6";

export function Compare() {
  const search = useSearch();
  const [lapAId, setLapAId] = useState("");
  const [lapBId, setLapBId] = useState("");
  const [data, setData] = useState<CompareData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const a = params.get("lap_a");
    const b = params.get("lap_b");
    if (!a || !b) return;
    setLapAId(a);
    setLapBId(b);
    setLoading(true);
    setError(null);
    api.compare(a, b)
      .then((d) => { setData(d); setCursor(0); setPlaying(false); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => {
    if (!playing || !data) return;

    const tick = (now: number) => {
      if (lastTimeRef.current == null) lastTimeRef.current = now;
      const dt = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;

      const lapDurationS = data.lap_a.lap_time_ms / 1000;
      setCursor((c) => {
        const next = c + (dt * speed) / lapDurationS;
        if (next >= 1) { setPlaying(false); return 1; }
        return next;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTimeRef.current = null;
    };
  }, [playing, data, speed]);

  const load = async () => {
    if (!lapAId || !lapBId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await api.compare(lapAId, lapBId);
      setData(d);
      setCursor(0);
      setPlaying(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  const togglePlay = () => {
    if (cursor >= 1) setCursor(0);
    setPlaying((p) => !p);
  };

  const sampleAtCursor = (samples: CompareData["samples_a"]) => {
    if (!samples?.length) return null;
    return samples[Math.min(Math.floor(cursor * samples.length), samples.length - 1)];
  };

  return (
    <div class="max-w-7xl mx-auto">
      <h1 class="text-xl font-bold mb-6">Lap Comparison</h1>

      <div class="flex gap-3 mb-6 items-end flex-wrap">
        {(["A", "B"] as const).map((label, i) => {
          const val = i === 0 ? lapAId : lapBId;
          const set = i === 0 ? setLapAId : setLapBId;
          return (
            <div class="flex flex-col gap-1" key={label}>
              <label class="text-xs text-[var(--muted)] uppercase tracking-wider">Lap {label}</label>
              <input
                value={val}
                onInput={(e) => set((e.target as HTMLInputElement).value)}
                placeholder="Lap ID"
                class="bg-[var(--surface)] border border-[var(--border)] rounded px-3 py-2 text-sm w-64 outline-none focus:border-[var(--accent)]"
              />
            </div>
          );
        })}
        <button
          onClick={load}
          disabled={loading || !lapAId || !lapBId}
          class="px-4 py-2 bg-[var(--accent)] text-white rounded text-sm font-semibold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        >
          {loading ? "Loading…" : "Compare"}
        </button>
      </div>

      {error && <p class="text-[var(--accent)] text-sm mb-4">{error}</p>}

      {data && (
        <div class="flex flex-col gap-6">
          {/* Lap headers */}
          <div class="grid grid-cols-2 gap-4">
            {([
              { lap: data.lap_a, color: COLOR_A, samples: data.samples_a },
              { lap: data.lap_b, color: COLOR_B, samples: data.samples_b },
            ] as const).map(({ lap, color, samples }, i) => {
              const s = sampleAtCursor(samples);
              return (
                <div
                  key={i}
                  class="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4"
                  style={{ borderTopColor: color, borderTopWidth: 3 }}
                >
                  <p class="text-xs text-[var(--muted)] uppercase tracking-wider mb-1">
                    {lap.track_name ?? "—"} · {lap.car_class ?? "—"}
                  </p>
                  <p class="text-2xl font-bold font-mono">{formatLapTime(lap.lap_time_ms)}</p>
                  <p class="text-sm text-[var(--muted)] mt-1">{lap.username ?? "Unknown"}</p>
                  {s && (
                    <div class="flex gap-4 mt-3 text-xs text-[var(--muted)] font-mono">
                      <span>{s.speed.toFixed(0)} km/h</span>
                      <span>G{s.gear}</span>
                      <span>{(s.rpm / 1000).toFixed(1)}k rpm</span>
                      <span>T {(s.throttle * 100).toFixed(0)}%</span>
                      <span>B {(s.brake * 100).toFixed(0)}%</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Main view */}
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="flex flex-col gap-4">
              <TrackMap
                samplesA={data.samples_a}
                samplesB={data.samples_b}
                cursor={cursor}
                colorA={COLOR_A}
                colorB={COLOR_B}
              />

              {/* Playback controls */}
              <div class="flex items-center gap-3">
                <button
                  onClick={togglePlay}
                  class="w-10 h-10 bg-[var(--surface)] border border-[var(--border)] rounded-full flex items-center justify-center hover:border-[var(--accent)] transition-colors cursor-pointer"
                >
                  {playing ? "⏸" : "▶"}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1000}
                  value={Math.round(cursor * 1000)}
                  onInput={(e) => {
                    setPlaying(false);
                    setCursor(Number((e.target as HTMLInputElement).value) / 1000);
                  }}
                  class="flex-1 accent-[var(--accent)]"
                />
                <select
                  value={speed}
                  onChange={(e) => setSpeed(Number((e.target as HTMLSelectElement).value))}
                  class="bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs"
                >
                  <option value={0.5}>0.5×</option>
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                  <option value={4}>4×</option>
                </select>
              </div>
            </div>

            <TelemetryCharts
              samplesA={data.samples_a}
              samplesB={data.samples_b}
              cursor={cursor}
              onCursorChange={setCursor}
              colorA={COLOR_A}
              colorB={COLOR_B}
            />
          </div>
        </div>
      )}
    </div>
  );
}
