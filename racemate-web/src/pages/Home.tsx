import { useState, useEffect } from "preact/hooks";
import { Link } from "wouter";
import { api } from "@/lib/api";
import type { LapMetadata } from "@/lib/types";
import { formatLapTime } from "@/lib/types";
import { useCompare } from "@/lib/compare-context";

export function Home() {
  const [recentLaps, setRecentLaps] = useState<LapMetadata[]>([]);
  const { selected, lockedClass, toggle } = useCompare();

  useEffect(() => {
    api.laps.list().then((laps) => setRecentLaps(laps.slice(0, 10))).catch(() => {});
  }, []);

  return (
    <div class="max-w-4xl mx-auto flex flex-col gap-14 mt-10">

      {/* Hero */}
      <div class="flex flex-col gap-5">
        <h1 class="text-5xl font-bold tracking-tight">
          <span class="text-[var(--accent)]">Race</span>Mate
        </h1>
        <p class="text-lg text-[var(--muted)] max-w-lg leading-relaxed">
          Simracing lap comparison and race stats. Record your laps with the desktop app, upload them, and find exactly where you lose time.
        </p>
        <div class="flex gap-3">
          <Link
            href="/laps"
            class="px-5 py-2 bg-[var(--accent)] text-white rounded text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Browse Laps
          </Link>
          <Link
            href="/compare"
            class="px-5 py-2 border border-[var(--border)] rounded text-sm font-medium hover:border-[var(--accent)] transition-colors"
          >
            Compare Laps
          </Link>
        </div>
      </div>

      {/* Recent laps */}
      {recentLaps.length > 0 && (
        <div>
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-xs font-semibold text-[var(--muted)] uppercase tracking-widest">Recent Laps</h2>
            <Link href="/laps" class="text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors">
              View all →
            </Link>
          </div>
          <div class="border border-[var(--border)] rounded-lg overflow-hidden">
            <table class="w-full text-sm">
              <thead class="border-b border-[var(--border)] text-[var(--muted)]">
                <tr>
                  <th class="text-left px-4 py-2.5 font-normal">Driver</th>
                  <th class="text-left px-4 py-2.5 font-normal">Track</th>
                  <th class="text-left px-4 py-2.5 font-normal">Car</th>
                  <th class="text-right px-4 py-2.5 font-normal">Time</th>
                  <th class="text-right px-4 py-2.5 font-normal">Date</th>
                  <th class="px-4 py-2.5 w-10" />
                </tr>
              </thead>
              <tbody>
                {recentLaps.map((lap, i) => {
                  const selIdx = selected.findIndex((l) => l.id === lap.id);
                  const sel = selIdx !== -1;
                  const incompatible = !sel && lockedClass !== null && lap.car_class !== lockedClass;
                  return (
                    <tr
                      key={lap.id}
                      onClick={() => !incompatible && toggle(lap)}
                      title={incompatible ? `Class mismatch — selection locked to ${lockedClass}` : undefined}
                      class={`border-t border-[var(--border)] transition-colors ${i === 0 ? "border-t-0" : ""} ${incompatible ? "opacity-30 cursor-not-allowed" : sel ? "bg-[var(--surface)] cursor-pointer" : "hover:bg-[var(--surface)] cursor-pointer"}`}
                    >
                      <td class="px-4 py-2.5 text-[var(--muted)]">{lap.username ?? "—"}</td>
                      <td class="px-4 py-2.5">{lap.track_name ?? lap.track_id}</td>
                      <td class="px-4 py-2.5 text-[var(--muted)]">
                        {lap.car_name}
                        {lap.car_class && <span class="ml-2 text-xs opacity-60">{lap.car_class}</span>}
                      </td>
                      <td class="px-4 py-2.5 text-right font-mono font-semibold">{formatLapTime(lap.lap_time_ms)}</td>
                      <td class="px-4 py-2.5 text-right text-[var(--muted)]">
                        {new Date(lap.recorded_at).toLocaleDateString()}
                      </td>
                      <td class="px-4 py-2.5 text-right w-10">
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

      {/* Feature cards */}
      <div class="grid grid-cols-3 gap-4">
        <div class="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-5">
          <p class="text-sm font-semibold mb-1">Lap Comparison</p>
          <p class="text-xs text-[var(--muted)] leading-relaxed">
            Overlay two laps on the track map with speed, throttle, braking, and delta charts.
          </p>
        </div>
        <div class="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-5">
          <p class="text-sm font-semibold mb-1">Race Sessions</p>
          <p class="text-xs text-[var(--muted)] leading-relaxed">
            Browse full session results, lap times, sector splits, and tyre data.
          </p>
        </div>
        <div class="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-5">
          <p class="text-sm font-semibold mb-1">Desktop Recorder</p>
          <p class="text-xs text-[var(--muted)] leading-relaxed">
            Windows app records telemetry at 20Hz directly from LMU shared memory and uploads automatically.
          </p>
        </div>
      </div>

    </div>
  );
}
