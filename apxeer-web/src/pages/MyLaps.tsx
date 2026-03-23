import { useState, useEffect, useMemo } from "preact/hooks";
import { Link } from "wouter";
import { useLocation } from "wouter";
import { api } from "@/lib/api";
import type { LapMetadata } from "@/lib/types";
import { formatLapTime, formatDelta } from "@/lib/types";
import { useCompare } from "@/lib/compare-context";
import { useAuth } from "@/lib/auth";
import { LapProgressionChart } from "@/components/LapProgressionChart";

interface TrackCarGroup {
  trackId: string;
  carId: string;
  trackName: string;
  carName: string;
  carClass: string;
  lapCount: number;
  pbTimeMs: number;
  pbLapId: string;
}

export function MyLaps() {
  const [allLaps, setAllLaps] = useState<LapMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null); // "trackId__carId"
  const { selected, toggle, clear } = useCompare();
  const { user } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    api.users
      .laps(user.id)
      .then((laps) => {
        setAllLaps(laps);
        // Auto-select first group
        if (laps.length > 0) {
          const first = `${laps[0].track_id}__${laps[0].car_id}`;
          setSelectedGroup(first);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  // Build groups
  const groups = useMemo<TrackCarGroup[]>(() => {
    const map = new Map<string, TrackCarGroup>();
    for (const lap of allLaps) {
      const key = `${lap.track_id}__${lap.car_id}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          trackId: lap.track_id,
          carId: lap.car_id,
          trackName: lap.track_name ?? lap.track_id,
          carName: lap.car_name ?? lap.car_id,
          carClass: lap.car_class ?? "",
          lapCount: 1,
          pbTimeMs: lap.lap_time_ms,
          pbLapId: lap.id,
        });
      } else {
        existing.lapCount++;
        if (lap.lap_time_ms < existing.pbTimeMs) {
          existing.pbTimeMs = lap.lap_time_ms;
          existing.pbLapId = lap.id;
        }
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.trackName.localeCompare(b.trackName)
    );
  }, [allLaps]);

  // Laps for selected group
  const groupLaps = useMemo(() => {
    if (!selectedGroup) return [];
    const [trackId, carId] = selectedGroup.split("__");
    return allLaps
      .filter((l) => l.track_id === trackId && l.car_id === carId)
      .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
  }, [allLaps, selectedGroup]);

  const activeGroup = groups.find(
    (g) => `${g.trackId}__${g.carId}` === selectedGroup
  );

  // Best sectors across all laps in group
  const bestSectors = useMemo(() => {
    let bestS1: number | null = null;
    let bestS2: number | null = null;
    let bestS3: number | null = null;
    for (const lap of groupLaps) {
      if (lap.s1_ms != null && (bestS1 === null || lap.s1_ms < bestS1)) bestS1 = lap.s1_ms;
      if (lap.s2_ms != null && (bestS2 === null || lap.s2_ms < bestS2)) bestS2 = lap.s2_ms;
      if (lap.s3_ms != null && (bestS3 === null || lap.s3_ms < bestS3)) bestS3 = lap.s3_ms;
    }
    return { s1: bestS1, s2: bestS2, s3: bestS3 };
  }, [groupLaps]);

  // Stats
  const stats = useMemo(() => {
    if (allLaps.length === 0) return null;
    const uniqueTracks = new Set(allLaps.map((l) => l.track_id)).size;
    let bestLap: { time: number; track: string } | null = null;
    for (const lap of allLaps) {
      if (bestLap === null || lap.lap_time_ms < bestLap.time) {
        bestLap = { time: lap.lap_time_ms, track: lap.track_name ?? lap.track_id };
      }
    }
    return { totalLaps: allLaps.length, uniqueTracks, bestLap };
  }, [allLaps]);

  const handleSelectGroup = (key: string) => {
    setSelectedGroup(key);
    clear();
  };

  const compareVsPb = (lap: LapMetadata) => {
    if (!activeGroup) return;
    clear();
    navigate(`/compare?lap_a=${lap.id}&lap_b=${activeGroup.pbLapId}`);
  };

  if (!user) {
    return (
      <div class="mt-10">
        <h1 class="text-xl font-bold mb-4">My Laps</h1>
        <p class="text-[var(--muted)]">
          <Link href="/login" class="text-[var(--accent)] hover:underline">Sign in</Link> to see your lap history.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div class="mt-10">
        <p class="text-[var(--muted)]">Loading...</p>
      </div>
    );
  }

  if (allLaps.length === 0) {
    return (
      <div class="mt-10">
        <h1 class="text-xl font-bold mb-4">My Laps</h1>
        <p class="text-[var(--muted)]">
          No laps recorded yet. Head to the{" "}
          <Link href="/" class="text-[var(--accent)] hover:underline">home page</Link>{" "}
          to get started with the desktop recorder.
        </p>
      </div>
    );
  }

  return (
    <div class="flex flex-col gap-6 mt-2">
      <h1 class="text-xl font-bold">My Laps</h1>

      {/* Stats strip */}
      {stats && (
        <div class="flex gap-px bg-[var(--border)] rounded-lg overflow-hidden border border-[var(--border)]">
          {[
            { label: "Total Laps", value: stats.totalLaps },
            { label: "Tracks", value: stats.uniqueTracks },
            ...(stats.bestLap
              ? [{ label: `Best · ${stats.bestLap.track}`, value: formatLapTime(stats.bestLap.time) }]
              : []),
          ].map((stat) => (
            <div key={stat.label} class="flex-1 bg-[var(--surface)] px-5 py-3 flex flex-col gap-0.5">
              <span class="text-xl font-bold font-mono">{stat.value}</span>
              <span class="text-xs text-[var(--muted)] truncate">{stat.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Two-column layout */}
      <div class="flex gap-6">
        {/* Sidebar — track+car groups */}
        <div class="w-64 flex-shrink-0 flex flex-col gap-1.5">
          <p class="text-xs text-[var(--muted)] uppercase tracking-wider mb-1">Track / Car</p>
          {groups.map((g) => {
            const key = `${g.trackId}__${g.carId}`;
            const active = key === selectedGroup;
            return (
              <button
                key={key}
                onClick={() => handleSelectGroup(key)}
                class={`text-left px-3 py-2.5 rounded-lg border transition-colors ${
                  active
                    ? "border-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-[var(--border)] hover:border-[var(--text)]"
                }`}
              >
                <p class={`text-sm font-medium truncate ${active ? "text-[var(--accent)]" : ""}`}>
                  {g.trackName}
                </p>
                <p class="text-xs text-[var(--muted)] truncate">
                  {g.carName}
                  {g.carClass && <span class="ml-1 opacity-60">{g.carClass}</span>}
                </p>
                <p class="text-xs text-[var(--muted)] mt-0.5">
                  {g.lapCount} lap{g.lapCount !== 1 ? "s" : ""} · PB {formatLapTime(g.pbTimeMs)}
                </p>
              </button>
            );
          })}
        </div>

        {/* Main — lap table + chart */}
        <div class="flex-1 flex flex-col gap-6 min-w-0">
          {activeGroup && (
            <>
              <div class="flex items-baseline gap-3">
                <h2 class="text-sm font-semibold uppercase tracking-wider">{activeGroup.trackName}</h2>
                <span class="text-xs text-[var(--muted)]">
                  {activeGroup.carName}
                  {activeGroup.carClass && <span class="ml-1 opacity-60">{activeGroup.carClass}</span>}
                </span>
                <span class="text-xs text-[var(--muted)]">{groupLaps.length} lap{groupLaps.length !== 1 ? "s" : ""}</span>
              </div>

              {/* Lap table */}
              <div class="border border-[var(--border)] rounded-lg overflow-hidden">
                <table class="w-full text-sm table-fixed">
                  <colgroup>
                    <col class="w-auto" />
                    <col style={{ width: "120px" }} />
                    <col style={{ width: "100px" }} />
                    <col style={{ width: "100px" }} />
                    <col style={{ width: "100px" }} />
                    <col style={{ width: "100px" }} />
                    <col style={{ width: "110px" }} />
                  </colgroup>
                  <thead class="border-b border-[var(--border)] text-[var(--muted)]">
                    <tr>
                      <th class="text-left px-4 py-2 font-normal">Date</th>
                      <th class="text-right px-4 py-2 font-normal">Time</th>
                      <th class="text-right px-4 py-2 font-normal">S1</th>
                      <th class="text-right px-4 py-2 font-normal">S2</th>
                      <th class="text-right px-4 py-2 font-normal">S3</th>
                      <th class="text-right px-4 py-2 font-normal">vs PB</th>
                      <th class="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {groupLaps.map((lap, i) => {
                      const isPb = lap.id === activeGroup.pbLapId;
                      const delta = lap.lap_time_ms - activeGroup.pbTimeMs;
                      const selIdx = selected.findIndex((l) => l.id === lap.id);
                      const sel = selIdx !== -1;

                      return (
                        <tr
                          key={lap.id}
                          onClick={() => toggle(lap)}
                          class={`border-t border-[var(--border)] transition-colors cursor-pointer ${
                            i === 0 ? "border-t-0" : ""
                          } ${isPb ? "bg-[var(--green)]/5" : sel ? "bg-[var(--surface)]" : "hover:bg-[var(--surface)]"}`}
                        >
                          <td class="px-4 py-2.5 text-[var(--muted)]">
                            {new Date(lap.recorded_at).toLocaleDateString()}
                          </td>
                          <td class={`px-4 py-2.5 text-right font-mono font-semibold ${isPb ? "text-[var(--green)]" : ""}`}>
                            {formatLapTime(lap.lap_time_ms)}
                          </td>
                          <td class={`px-4 py-2.5 text-right font-mono text-xs ${lap.s1_ms != null && lap.s1_ms === bestSectors.s1 ? "text-[var(--green)]" : "text-[var(--muted)]"}`}>
                            {lap.s1_ms != null ? formatLapTime(lap.s1_ms) : "—"}
                          </td>
                          <td class={`px-4 py-2.5 text-right font-mono text-xs ${lap.s2_ms != null && lap.s2_ms === bestSectors.s2 ? "text-[var(--green)]" : "text-[var(--muted)]"}`}>
                            {lap.s2_ms != null ? formatLapTime(lap.s2_ms) : "—"}
                          </td>
                          <td class={`px-4 py-2.5 text-right font-mono text-xs ${lap.s3_ms != null && lap.s3_ms === bestSectors.s3 ? "text-[var(--green)]" : "text-[var(--muted)]"}`}>
                            {lap.s3_ms != null ? formatLapTime(lap.s3_ms) : "—"}
                          </td>
                          <td class={`px-4 py-2.5 text-right font-mono text-xs ${isPb ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                            {isPb ? (
                              <span class="text-xs px-1.5 py-0.5 rounded bg-[var(--green)]/15 text-[var(--green)] font-semibold">
                                PB
                              </span>
                            ) : (
                              formatDelta(delta)
                            )}
                          </td>
                          <td class="px-4 py-2.5 text-right">
                            {sel ? (
                              <span class="text-xs font-bold text-[var(--accent)]">
                                {selIdx === 0 ? "A" : "B"}
                              </span>
                            ) : (
                              !isPb && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    compareVsPb(lap);
                                  }}
                                  class="text-xs px-2 py-1 rounded border border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors whitespace-nowrap"
                                >
                                  vs PB →
                                </button>
                              )
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Progression chart */}
              {groupLaps.length >= 2 && (
                <div class="border border-[var(--border)] rounded-lg p-4">
                  <LapProgressionChart
                    laps={groupLaps.map((l) => ({
                      recorded_at: l.recorded_at,
                      lap_time_ms: l.lap_time_ms,
                    }))}
                    pbTimeMs={activeGroup.pbTimeMs}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
