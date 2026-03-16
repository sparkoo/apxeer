import { useState, useEffect } from "preact/hooks";
import { api } from "@/lib/api";
import { LapMetadata, formatLapTime, formatDelta } from "@/lib/types";
import { useCompare } from "@/lib/compare-context";

export function Laps() {
  const [laps, setLaps] = useState<LapMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeClass, setActiveClass] = useState<string | null>(null);
  const [activeTrack, setActiveTrack] = useState<string | null>(null);
  const { selected, toggle, clear } = useCompare();

  useEffect(() => {
    api.laps.list().then(setLaps).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  const classes = Array.from(new Set(laps.map((l) => l.car_class).filter(Boolean))) as string[];

  const selectClass = (cls: string) => {
    if (cls === activeClass) return;
    setActiveClass(cls);
    setActiveTrack(null);
    clear();
  };

  const byClassLaps = activeClass ? laps.filter((l) => l.car_class === activeClass) : [];
  const tracks = Array.from(new Set(byClassLaps.map((l) => l.track_name ?? l.track_id)));

  const selectTrack = (track: string) => {
    if (track === activeTrack) return;
    setActiveTrack(track);
    clear();
  };

  const filtered = activeTrack ? byClassLaps.filter((l) => (l.track_name ?? l.track_id) === activeTrack) : [];
  const sortedLaps = [...filtered].sort((a, b) => a.lap_time_ms - b.lap_time_ms);
  const best = sortedLaps[0]?.lap_time_ms ?? 0;

  if (loading) return <p class="text-[var(--muted)]">Loading...</p>;
  if (error) return <p class="text-red-500">{error}</p>;
  if (laps.length === 0) return <p class="text-[var(--muted)]">No laps uploaded yet.</p>;

  return (
    <div class="max-w-4xl mx-auto flex flex-col gap-6">
      <div class="flex flex-col gap-3">
        <h1 class="text-xl font-bold">Laps</h1>

        {/* Step 1: class */}
        <div class="flex items-center gap-2 flex-wrap">
          {classes.map((cls) => (
            <button
              key={cls}
              onClick={() => selectClass(cls)}
              class={`px-3 py-1 text-sm rounded-full border transition-colors ${
                activeClass === cls
                  ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--text)] hover:text-[var(--text)]"
              }`}
            >
              {cls}
            </button>
          ))}
        </div>

        {/* Step 2: track */}
        {activeClass && (
          <div class="flex items-center gap-2 flex-wrap">
            {tracks.map((track) => (
              <button
                key={track}
                onClick={() => selectTrack(track)}
                class={`px-3 py-1 text-sm rounded-full border transition-colors ${
                  activeTrack === track
                    ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--text)] hover:text-[var(--text)]"
                }`}
              >
                {track}
              </button>
            ))}
          </div>
        )}
      </div>

      {!activeClass ? (
        <p class="text-[var(--muted)] text-sm">Select a car class to get started.</p>
      ) : !activeTrack ? (
        <p class="text-[var(--muted)] text-sm">Select a track to see laps.</p>
      ) : sortedLaps.length === 0 ? (
        <p class="text-[var(--muted)] text-sm">No laps found.</p>
      ) : (
        <div>
          <div class="flex items-baseline gap-3 mb-2">
            <h2 class="text-sm font-semibold text-[var(--text)] uppercase tracking-wider">{activeTrack}</h2>
            <span class="text-xs text-[var(--muted)]">{sortedLaps.length} lap{sortedLaps.length !== 1 ? "s" : ""}</span>
            <span class="text-xs font-mono text-[var(--muted)]">best {formatLapTime(best)}</span>
          </div>
          <div class="border border-[var(--border)] rounded-lg overflow-hidden">
            <table class="w-full text-sm">
              <thead class="border-b border-[var(--border)] text-[var(--muted)]">
                <tr>
                  <th class="text-left px-4 py-2 font-normal">Car</th>
                  <th class="text-right px-4 py-2 font-normal">Lap</th>
                  <th class="text-right px-4 py-2 font-normal">Time</th>
                  <th class="text-right px-4 py-2 font-normal">Delta</th>
                  <th class="text-right px-4 py-2 font-normal">S1</th>
                  <th class="text-right px-4 py-2 font-normal">S2</th>
                  <th class="text-right px-4 py-2 font-normal">S3</th>
                  <th class="text-right px-4 py-2 font-normal">Date</th>
                  <th class="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {sortedLaps.map((lap, i) => {
                  const selIdx = selected.findIndex((l) => l.id === lap.id);
                  const sel = selIdx !== -1;
                  const delta = lap.lap_time_ms - best;
                  return (
                    <tr
                      key={lap.id}
                      onClick={() => toggle(lap)}
                      class={`border-t border-[var(--border)] cursor-pointer ${i === 0 ? "border-t-0" : ""} ${sel ? "bg-[var(--surface)]" : "hover:bg-[var(--surface)]"} transition-colors`}
                    >
                      <td class="px-4 py-2.5 text-[var(--text)]">{lap.car_name}</td>
                      <td class="px-4 py-2.5 text-right text-[var(--muted)]">{lap.lap_number}</td>
                      <td class={`px-4 py-2.5 text-right font-mono font-semibold ${i === 0 ? "text-[var(--green)]" : ""}`}>
                        {formatLapTime(lap.lap_time_ms)}
                      </td>
                      <td class="px-4 py-2.5 text-right font-mono text-[var(--muted)]">
                        {i === 0 ? <span class="text-[var(--green)]">—</span> : formatDelta(delta)}
                      </td>
                      <td class="px-4 py-2.5 text-right font-mono text-[var(--muted)]">{lap.s1_ms ? formatLapTime(lap.s1_ms) : "—"}</td>
                      <td class="px-4 py-2.5 text-right font-mono text-[var(--muted)]">{lap.s2_ms ? formatLapTime(lap.s2_ms) : "—"}</td>
                      <td class="px-4 py-2.5 text-right font-mono text-[var(--muted)]">{lap.s3_ms ? formatLapTime(lap.s3_ms) : "—"}</td>
                      <td class="px-4 py-2.5 text-right text-[var(--muted)]">
                        {new Date(lap.recorded_at).toLocaleDateString()}
                      </td>
                      <td class="px-4 py-2.5 text-right">
                        {sel && (
                          <span class="text-xs font-bold text-[var(--accent)]">
                            {selIdx === 0 ? "A" : "B"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
