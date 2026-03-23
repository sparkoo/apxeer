import { useState, useEffect, useMemo } from "preact/hooks";
import { Fragment } from "preact";
import { useLocation } from "wouter";
import { api } from "@/lib/api";
import { LapMetadata, formatLapTime, formatDelta } from "@/lib/types";
import { useCompare } from "@/lib/compare-context";
import { useAuth } from "@/lib/auth";

type DriverEntry = {
  userId: string;
  username: string;
  bestLap: LapMetadata;
  allLaps: LapMetadata[]; // sorted fastest first
  rank: number;
  deltaToP1: number; // ms, 0 for P1
};

export function Laps() {
  const [laps, setLaps] = useState<LapMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeClass, setActiveClass] = useState<string | null>(null);
  const [activeTrack, setActiveTrack] = useState<string | null>(null);
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null);
  const { selected, toggle, clear } = useCompare();
  const { user } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    api.laps.list().then(setLaps).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  const classes = Array.from(new Set(laps.map((l) => l.car_class).filter(Boolean))) as string[];

  const selectClass = (cls: string) => {
    if (cls === activeClass) return;
    setActiveClass(cls);
    setActiveTrack(null);
    setExpandedDriver(null);
    clear();
  };

  const byClassLaps = activeClass ? laps.filter((l) => l.car_class === activeClass) : [];
  const tracks = Array.from(new Set(byClassLaps.map((l) => l.track_name ?? l.track_id)));

  const selectTrack = (track: string) => {
    if (track === activeTrack) return;
    setActiveTrack(track);
    setExpandedDriver(null);
    clear();
  };

  const { sortedLaps, best, leaderboard } = useMemo(() => {
    const byTrack = activeTrack
      ? byClassLaps.filter((l) => (l.track_name ?? l.track_id) === activeTrack)
      : [];
    const sorted = [...byTrack].sort((a, b) => a.lap_time_ms - b.lap_time_ms);
    const bestTime = sorted[0]?.lap_time_ms ?? 0;

    if (sorted.length === 0) return { sortedLaps: sorted, best: bestTime, leaderboard: [] as DriverEntry[] };

    const byDriver = new Map<string, LapMetadata[]>();
    for (const lap of sorted) {
      const existing = byDriver.get(lap.user_id);
      if (existing) existing.push(lap);
      else byDriver.set(lap.user_id, [lap]);
    }
    const entries: DriverEntry[] = [];
    byDriver.forEach((driverLaps, userId) => {
      entries.push({
        userId,
        username: driverLaps[0].username ?? userId.slice(0, 8),
        bestLap: driverLaps[0],
        allLaps: driverLaps,
        rank: 0,
        deltaToP1: 0,
      });
    });
    entries.sort((a, b) => a.bestLap.lap_time_ms - b.bestLap.lap_time_ms);
    const p1Time = entries[0].bestLap.lap_time_ms;
    const lb = entries.map((e, i) => ({ ...e, rank: i + 1, deltaToP1: e.bestLap.lap_time_ms - p1Time }));

    return { sortedLaps: sorted, best: bestTime, leaderboard: lb };
  }, [laps, activeClass, activeTrack]);

  const toggleExpand = (userId: string) =>
    setExpandedDriver((prev) => (prev === userId ? null : userId));

  const compareVsP1 = (userBestLap: LapMetadata, p1BestLap: LapMetadata) => {
    clear();
    toggle(userBestLap);
    toggle(p1BestLap);
    navigate(`/compare?lap_a=${userBestLap.id}&lap_b=${p1BestLap.id}`);
  };

  if (loading) return <p class="text-[var(--muted)]">Loading...</p>;
  if (error) return <p class="text-red-500">{error}</p>;
  if (laps.length === 0) return <p class="text-[var(--muted)]">No laps uploaded yet.</p>;

  return (
    <div class="flex flex-col gap-6">
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
      ) : leaderboard.length === 0 ? (
        <p class="text-[var(--muted)] text-sm">No laps found.</p>
      ) : (
        <div>
          <div class="flex items-baseline gap-3 mb-2">
            <h2 class="text-sm font-semibold text-[var(--text)] uppercase tracking-wider">{activeTrack}</h2>
            <span class="text-xs text-[var(--muted)]">{leaderboard.length} driver{leaderboard.length !== 1 ? "s" : ""}</span>
            <span class="text-xs font-mono text-[var(--muted)]">best {formatLapTime(best)}</span>
          </div>
          <div class="border border-[var(--border)] rounded-lg overflow-hidden">
            <table class="w-full text-sm">
              <thead class="border-b border-[var(--border)] text-[var(--muted)]">
                <tr>
                  <th class="text-left px-4 py-2 font-normal w-8">#</th>
                  <th class="text-left px-4 py-2 font-normal">Driver</th>
                  <th class="text-left px-4 py-2 font-normal">Car</th>
                  <th class="text-right px-4 py-2 font-normal">Time</th>
                  <th class="text-right px-4 py-2 font-normal">Delta</th>
                  <th class="text-right px-4 py-2 font-normal">S1</th>
                  <th class="text-right px-4 py-2 font-normal">S2</th>
                  <th class="text-right px-4 py-2 font-normal">S3</th>
                  <th class="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry) => {
                  const isUser = user?.id === entry.userId;
                  const isP1 = entry.rank === 1;
                  const isExpanded = expandedDriver === entry.userId;

                  return (
                    <Fragment key={entry.userId}>
                      {/* Leaderboard row — one per driver */}
                      <tr
                        onClick={() => toggleExpand(entry.userId)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleExpand(entry.userId); } }}
                        tabIndex={0}
                        role="button"
                        aria-expanded={isExpanded}
                        class={`border-t border-[var(--border)] cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${entry.rank === 1 ? "border-t-0" : ""} ${
                          isUser
                            ? "bg-[var(--accent)]/5 hover:bg-[var(--accent)]/10"
                            : "hover:bg-[var(--surface)]"
                        }`}
                      >
                        <td class={`px-4 py-2.5 font-mono font-semibold ${isP1 ? "text-[var(--green)]" : "text-[var(--muted)]"}`}>
                          {entry.rank}
                        </td>
                        <td class="px-4 py-2.5">
                          <div class="flex items-center gap-2">
                            <span class={isUser ? "text-[var(--accent)] font-semibold" : "text-[var(--text)]"}>
                              {entry.username}
                            </span>
                            {isUser && (
                              <span class="text-xs px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] font-semibold">
                                You
                              </span>
                            )}
                            <span class={`ml-1 text-[var(--muted)] text-xs transition-transform inline-block ${isExpanded ? "rotate-90" : ""}`}>
                              ›
                            </span>
                          </div>
                        </td>
                        <td class="px-4 py-2.5 text-[var(--muted)]">{entry.bestLap.car_name}</td>
                        <td class={`px-4 py-2.5 text-right font-mono font-semibold ${isP1 ? "text-[var(--green)]" : "text-[var(--text)]"}`}>
                          {formatLapTime(entry.bestLap.lap_time_ms)}
                        </td>
                        <td class="px-4 py-2.5 text-right font-mono text-[var(--muted)]">
                          {isP1 ? <span class="text-[var(--green)]">—</span> : formatDelta(entry.deltaToP1)}
                        </td>
                        <td class="px-4 py-2.5 text-right font-mono text-[var(--muted)]">
                          {entry.bestLap.s1_ms ? formatLapTime(entry.bestLap.s1_ms) : "—"}
                        </td>
                        <td class="px-4 py-2.5 text-right font-mono text-[var(--muted)]">
                          {entry.bestLap.s2_ms ? formatLapTime(entry.bestLap.s2_ms) : "—"}
                        </td>
                        <td class="px-4 py-2.5 text-right font-mono text-[var(--muted)]">
                          {entry.bestLap.s3_ms ? formatLapTime(entry.bestLap.s3_ms) : "—"}
                        </td>
                        <td class="px-4 py-2.5 text-right">
                          {isUser && !isP1 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                compareVsP1(entry.bestLap, leaderboard[0].bestLap);
                              }}
                              class="text-xs px-2 py-1 rounded border border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors whitespace-nowrap"
                            >
                              vs P1 →
                            </button>
                          )}
                        </td>
                      </tr>

                      {/* Expanded sub-rows — all laps by this driver */}
                      {isExpanded && entry.allLaps.map((lap, lapIdx) => {
                        const selIdx = selected.findIndex((l) => l.id === lap.id);
                        const sel = selIdx !== -1;
                        const deltaVsP1 = lap.lap_time_ms - leaderboard[0].bestLap.lap_time_ms;
                        return (
                          <tr
                            key={lap.id}
                            onClick={() => toggle(lap)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(lap); } }}
                            tabIndex={0}
                            role="button"
                            aria-label={`Lap ${lap.lap_number}, ${formatLapTime(lap.lap_time_ms)}`}
                            class={`border-t border-[var(--border)] cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                              sel ? "bg-[var(--surface)]" : "bg-[var(--bg)] hover:bg-[var(--surface)]"
                            }`}
                          >
                            <td class="px-4 py-2 text-[var(--muted)] text-xs pl-6">└</td>
                            <td class="px-4 py-2 text-[var(--muted)] text-xs">Lap {lap.lap_number}</td>
                            <td class="px-4 py-2 text-[var(--muted)] text-xs">{lap.car_name}</td>
                            <td class={`px-4 py-2 text-right font-mono text-xs ${lapIdx === 0 ? "font-semibold text-[var(--text)]" : "text-[var(--muted)]"}`}>
                              {formatLapTime(lap.lap_time_ms)}
                            </td>
                            <td class="px-4 py-2 text-right font-mono text-xs text-[var(--muted)]">
                              {deltaVsP1 === 0 ? <span class="text-[var(--green)]">—</span> : formatDelta(deltaVsP1)}
                            </td>
                            <td class="px-4 py-2 text-right font-mono text-xs text-[var(--muted)]">
                              {lap.s1_ms ? formatLapTime(lap.s1_ms) : "—"}
                            </td>
                            <td class="px-4 py-2 text-right font-mono text-xs text-[var(--muted)]">
                              {lap.s2_ms ? formatLapTime(lap.s2_ms) : "—"}
                            </td>
                            <td class="px-4 py-2 text-right font-mono text-xs text-[var(--muted)]">
                              {lap.s3_ms ? formatLapTime(lap.s3_ms) : "—"}
                            </td>
                            <td class="px-4 py-2 text-right">
                              {sel && (
                                <span class="text-xs font-bold text-[var(--accent)]">
                                  {selIdx === 0 ? "A" : "B"}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
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
