import { useState, useEffect, useMemo } from "preact/hooks";
import { Link } from "wouter";
import { api } from "@/lib/api";
import type { LapMetadata, Session, CommunityStats, TrackRecord, UserSession } from "@/lib/types";
import { formatLapTime, formatDelta } from "@/lib/types";
import { useCompare } from "@/lib/compare-context";
import { useAuth } from "@/lib/auth";

const ONBOARDING_STEPS = [
  {
    label: "Download the desktop recorder",
    detail: (
      <span>
        Grab the latest release from{" "}
        <a
          href="https://github.com/sparkoo/apxeer/releases"
          target="_blank"
          rel="noopener noreferrer"
          class="text-[var(--accent)] hover:underline"
        >
          GitHub Releases
        </a>
        .
      </span>
    ),
  },
  {
    label: "Point it at your LMU results folder",
    detail: <span>Open Settings in the recorder and set your LMU results path (e.g. <code class="text-xs bg-[var(--border)] px-1 py-0.5 rounded">Documents/Le Mans Ultimate/UserData/Log/Results</code>).</span>,
  },
  {
    label: "Record a lap — it uploads automatically",
    detail: <span>Jump in-game. The recorder detects lap boundaries and uploads each completed lap.</span>,
  },
  {
    label: "Come back here to compare",
    detail: <span>Once your first lap is uploaded it will appear below and you can start comparing.</span>,
  },
];

interface PersonalBest {
  track_name: string;
  car_name: string;
  car_class?: string;
  lap: LapMetadata;
}

export function Home() {
  const [recentLaps, setRecentLaps] = useState<LapMetadata[]>([]);
  const [allMyLaps, setAllMyLaps] = useState<LapMetadata[] | null>(null);
  const [fastestByTrackClass, setFastestByTrackClass] = useState<Map<string, LapMetadata>>(new Map());
  const [communityStats, setCommunityStats] = useState<CommunityStats | null>(null);
  const [trackRecords, setTrackRecords] = useState<TrackRecord[]>([]);
  const [lastSession, setLastSession] = useState<UserSession | null>(null);
  const [lastSessionLoaded, setLastSessionLoaded] = useState(false);
  const { selected, lockedClass, toggle } = useCompare();
  const { user } = useAuth();

  // Global data — always fetch
  useEffect(() => {
    api.laps.list().then((laps) => setRecentLaps(laps.slice(0, 10))).catch(() => {});
    api.stats.get().then(setCommunityStats).catch(() => {});
    api.tracks.records().then(setTrackRecords).catch(() => {});
  }, []);

  // User-specific data
  useEffect(() => {
    if (!user) {
      setAllMyLaps(null);
      setLastSession(null);
      setLastSessionLoaded(false);
      return;
    }
    api.users.laps(user.id).then(setAllMyLaps).catch(() => {});
    api.users.sessions(user.id).then((sessions) => {
      setLastSession(sessions.length > 0 ? sessions[0] : null);
      setLastSessionLoaded(true);
    }).catch(() => { setLastSessionLoaded(true); });
  }, [user]);

  const showOnboarding = !!user && allMyLaps !== null && allMyLaps.length === 0;

  const personalBests = useMemo<PersonalBest[]>(() => {
    if (!allMyLaps) return [];
    const map = new Map<string, LapMetadata>();
    for (const lap of allMyLaps) {
      const key = `${lap.track_id}__${lap.car_id}`;
      const existing = map.get(key);
      if (!existing || lap.lap_time_ms < existing.lap_time_ms) {
        map.set(key, lap);
      }
    }
    return Array.from(map.values())
      .sort((a, b) => (a.track_name ?? a.track_id).localeCompare(b.track_name ?? b.track_id))
      .map((lap) => ({
        track_name: lap.track_name ?? lap.track_id,
        car_name: lap.car_name ?? lap.car_id,
        car_class: lap.car_class,
        lap,
      }));
  }, [allMyLaps]);

  // PB lookup by track_id for track records compare link
  const pbByTrack = useMemo(() => {
    const map = new Map<string, LapMetadata>();
    for (const pb of personalBests) {
      const existing = map.get(pb.lap.track_id);
      if (!existing || pb.lap.lap_time_ms < existing.lap_time_ms) {
        map.set(pb.lap.track_id, pb.lap);
      }
    }
    return map;
  }, [personalBests]);

  // Fetch global fastest lap per track+class for competitive gap
  useEffect(() => {
    if (personalBests.length === 0) {
      setFastestByTrackClass(new Map());
      return;
    }
    let cancelled = false;
    const trackIds = [...new Set(personalBests.map((pb) => pb.lap.track_id))];
    Promise.all(
      trackIds.map((trackId) => api.laps.list(trackId).catch(() => [] as LapMetadata[])),
    ).then((results) => {
      if (cancelled) return;
      const fastest = new Map<string, LapMetadata>();
      for (const laps of results) {
        for (const lap of laps) {
          const key = `${lap.track_id}:${lap.car_class ?? ""}`;
          const existing = fastest.get(key);
          if (!existing || lap.lap_time_ms < existing.lap_time_ms) {
            fastest.set(key, lap);
          }
        }
      }
      setFastestByTrackClass(fastest);
    });
    return () => { cancelled = true; };
  }, [personalBests]);

  const myStats = useMemo(() => {
    if (!allMyLaps || allMyLaps.length === 0) return null;
    const uniqueTracks = new Set(allMyLaps.map((l) => l.track_id)).size;
    let bestLap: { time: number; track: string } | null = null;
    for (const lap of allMyLaps) {
      if (lap.is_valid && (bestLap === null || lap.lap_time_ms < bestLap.time)) {
        bestLap = { time: lap.lap_time_ms, track: lap.track_name ?? lap.track_id };
      }
    }
    return { totalLaps: allMyLaps.length, uniqueTracks, bestLap };
  }, [allMyLaps]);

  const isLoggedIn = !!user;

  // ── Shared sub-components ──

  const communityStatsStrip = communityStats && (
    <div class="flex gap-px bg-[var(--border)] rounded-lg overflow-hidden border border-[var(--border)]">
      {[
        { label: "Laps Recorded", value: communityStats.total_laps.toLocaleString() },
        { label: "km Driven", value: Math.round(communityStats.total_km).toLocaleString() },
        { label: "Drivers", value: communityStats.total_drivers.toLocaleString() },
      ].map((stat) => (
        <div key={stat.label} class="flex-1 bg-[var(--surface)] px-5 py-3 flex flex-col gap-0.5">
          <span class="text-xl font-bold font-mono">{stat.value}</span>
          <span class="text-xs text-[var(--muted)] truncate">{stat.label}</span>
        </div>
      ))}
    </div>
  );

  const recordsByClass = useMemo(() => {
    const map = new Map<string, TrackRecord[]>();
    for (const rec of trackRecords) {
      const cls = rec.car_class || "Open";
      if (!map.has(cls)) map.set(cls, []);
      map.get(cls)!.push(rec);
    }
    return map;
  }, [trackRecords]);

  const trackRecordsPanel = trackRecords.length > 0 && (
    <div class="flex flex-col gap-6">
      <h2 class="text-xs font-semibold text-[var(--muted)] uppercase tracking-widest">Track Records</h2>
      {[...recordsByClass.entries()].map(([cls, records]) => (
        <div key={cls}>
          <h3 class="text-xs font-semibold text-[var(--accent)] mb-2">{cls}</h3>
          <div class="border border-[var(--border)] rounded-lg overflow-hidden">
            <table class="w-full text-sm">
              <thead class="border-b border-[var(--border)] text-[var(--muted)]">
                <tr>
                  <th class="text-left px-3 py-2 font-normal">Track</th>
                  <th class="text-right px-3 py-2 font-normal">Time</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rec, i) => (
                  <tr
                    key={rec.lap_id}
                    class={`border-t border-[var(--border)] transition-colors ${i === 0 ? "border-t-0" : ""} hover:bg-[var(--surface)]`}
                  >
                    <td class="px-3 py-2 whitespace-nowrap">{rec.track_name}</td>
                    <td class="px-3 py-2 text-right font-mono font-semibold whitespace-nowrap">{formatLapTime(rec.lap_time_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );

  const recentLapsTable = recentLaps.length > 0 && (
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
  );

  const personalBestsTable = personalBests.length > 0 && (
    <div>
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xs font-semibold text-[var(--muted)] uppercase tracking-widest">Personal Bests</h2>
        <Link href="/my-laps" class="text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors">
          View all →
        </Link>
      </div>
      <div class="border border-[var(--border)] rounded-lg overflow-hidden">
        <table class="w-full text-sm">
          <thead class="border-b border-[var(--border)] text-[var(--muted)]">
            <tr>
              <th class="text-left px-4 py-2.5 font-normal">Track</th>
              <th class="text-left px-4 py-2.5 font-normal">Car / Class</th>
              <th class="text-right px-4 py-2.5 font-normal">Best Time</th>
              <th class="text-right px-4 py-2.5 font-normal">S1</th>
              <th class="text-right px-4 py-2.5 font-normal">S2</th>
              <th class="text-right px-4 py-2.5 font-normal">S3</th>
              <th class="text-right px-4 py-2.5 font-normal">Fastest</th>
              <th class="text-right px-4 py-2.5 font-normal">Gap</th>
              <th class="px-4 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {personalBests.map(({ track_name, car_name, car_class, lap }, i) => {
              const selIdx = selected.findIndex((l) => l.id === lap.id);
              const sel = selIdx !== -1;
              const incompatible = !sel && lockedClass !== null && !!lap.car_class && lap.car_class !== lockedClass;
              const fastestKey = `${lap.track_id}:${lap.car_class ?? ""}`;
              const fastestLap = fastestByTrackClass.get(fastestKey) ?? null;
              const gap = fastestLap ? lap.lap_time_ms - fastestLap.lap_time_ms : null;
              const isAlreadyFastest = gap !== null && gap <= 0;
              return (
                <tr
                  key={lap.id}
                  onClick={() => !incompatible && toggle(lap)}
                  onKeyDown={(e) => { if (!incompatible && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(lap); } }}
                  tabIndex={incompatible ? undefined : 0}
                  aria-disabled={incompatible || undefined}
                  title={incompatible ? `Class mismatch — selection locked to ${lockedClass}` : undefined}
                  class={`border-t border-[var(--border)] transition-colors ${i === 0 ? "border-t-0" : ""} ${incompatible ? "opacity-30 cursor-not-allowed" : sel ? "bg-[var(--surface)] cursor-pointer" : "hover:bg-[var(--surface)] cursor-pointer"}`}
                >
                  <td class="px-4 py-2.5">{track_name}</td>
                  <td class="px-4 py-2.5 text-[var(--muted)]">
                    {car_name}
                    {car_class && <span class="ml-2 text-xs opacity-60">{car_class}</span>}
                  </td>
                  <td class="px-4 py-2.5 text-right font-mono font-semibold">{formatLapTime(lap.lap_time_ms)}</td>
                  <td class="px-4 py-2.5 text-right font-mono text-[var(--muted)]">{lap.s1_ms != null ? formatLapTime(lap.s1_ms) : "—"}</td>
                  <td class="px-4 py-2.5 text-right font-mono text-[var(--muted)]">{lap.s2_ms != null ? formatLapTime(lap.s2_ms) : "—"}</td>
                  <td class="px-4 py-2.5 text-right font-mono text-[var(--muted)]">{lap.s3_ms != null ? formatLapTime(lap.s3_ms) : "—"}</td>
                  <td class="px-4 py-2.5 text-right font-mono text-[var(--muted)]">
                    {fastestLap ? formatLapTime(fastestLap.lap_time_ms) : "—"}
                  </td>
                  <td class={`px-4 py-2.5 text-right font-mono text-xs ${gap === null ? "text-[var(--muted)]" : isAlreadyFastest ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                    {gap !== null ? (isAlreadyFastest ? "Fastest!" : formatDelta(gap)) : "—"}
                  </td>
                  <td class="px-4 py-2.5 text-right w-10">
                    {sel ? (
                      <span class="text-xs font-bold text-[var(--accent)]">
                        {selIdx === 0 ? "A" : "B"}
                      </span>
                    ) : (fastestLap && !isAlreadyFastest && (
                      <Link
                        href={`/compare?lap_a=${lap.id}&lap_b=${fastestLap.id}`}
                        onClick={(e: MouseEvent) => e.stopPropagation()}
                        class="text-xs text-[var(--accent)] hover:opacity-80 transition-opacity whitespace-nowrap"
                      >
                        Compare →
                      </Link>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const lastSessionCard = lastSessionLoaded && (
    <div class="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-5">
      <h2 class="text-xs font-semibold text-[var(--muted)] uppercase tracking-widest mb-3">Last Session</h2>
      {lastSession ? (
        <div>
          <div class="flex items-start justify-between">
            <div>
              <p class="font-semibold">{lastSession.track?.name ?? lastSession.track_id}</p>
              <p class="text-sm text-[var(--muted)]">
                {lastSession.session_type} · {new Date(lastSession.started_at).toLocaleDateString()}
              </p>
            </div>
            <div class="text-right">
              <div class={`text-2xl font-bold font-mono ${
                lastSession.my_result.finish_status === "DNF" ? "text-[var(--red)]" :
                lastSession.my_result.finish_pos === 1 ? "text-[var(--yellow)]" :
                lastSession.my_result.finish_pos <= 3 ? "text-[var(--text)]" :
                "text-[var(--muted)]"
              }`}>
                {lastSession.my_result.finish_status === "DNF" ? "DNF" : `P${lastSession.my_result.finish_pos}`}
              </div>
              {lastSession.my_result.class_pos > 0 && lastSession.my_result.class_pos !== lastSession.my_result.finish_pos && (
                <div class="text-xs text-[var(--muted)]">Class P{lastSession.my_result.class_pos}</div>
              )}
            </div>
          </div>
          <div class="flex gap-4 mt-3 text-sm text-[var(--muted)] flex-wrap">
            {lastSession.my_result.best_lap_ms && (
              <span>Best: <span class="font-mono text-[var(--text)]">{formatLapTime(lastSession.my_result.best_lap_ms)}</span></span>
            )}
            <span>{lastSession.my_result.car_name}</span>
            <span>{lastSession.my_result.laps_completed} lap{lastSession.my_result.laps_completed !== 1 ? "s" : ""}</span>
          </div>
        </div>
      ) : (
        <p class="text-sm text-[var(--muted)]">No sessions yet. Upload an LMU result file to see your race stats here.</p>
      )}
    </div>
  );

  // ── Layout ──

  if (isLoggedIn) {
    return (
      <div class="flex flex-col gap-8 mt-4">
        {/* Compact hero */}
        <div class="flex items-center gap-3">
          <h1 class="text-2xl font-bold tracking-tight">
            <span class="text-[var(--accent)]">Race</span>Mate
          </h1>
          <span class="text-sm text-[var(--muted)]">Your racing dashboard</span>
        </div>

        {/* Onboarding — full width, only if 0 laps */}
        {showOnboarding && (
          <div>
            <div class="mb-4">
              <h2 class="text-xs font-semibold text-[var(--muted)] uppercase tracking-widest mb-1">Getting Started</h2>
              <p class="text-sm text-[var(--muted)]">Follow these steps to record and compare your first lap.</p>
            </div>
            <ol class="flex flex-col gap-3">
              {ONBOARDING_STEPS.map((step, i) => (
                <li key={i} class="flex gap-4 border border-[var(--border)] rounded-lg p-4">
                  <div class="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 border-[var(--border)] flex items-center justify-center text-xs font-bold text-[var(--muted)]">
                    {i + 1}
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <span class="text-sm font-medium">{step.label}</span>
                    <span class="text-xs text-[var(--muted)] leading-relaxed">{step.detail}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Stats strips side by side */}
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {myStats && (
            <div class="flex gap-px bg-[var(--border)] rounded-lg overflow-hidden border border-[var(--border)]">
              {[
                { label: "My Laps", value: myStats.totalLaps },
                { label: "Tracks", value: myStats.uniqueTracks },
                ...(myStats.bestLap
                  ? [{ label: `Best · ${myStats.bestLap.track}`, value: formatLapTime(myStats.bestLap.time) }]
                  : []),
              ].map((stat) => (
                <div key={stat.label} class="flex-1 bg-[var(--surface)] px-5 py-3 flex flex-col gap-0.5">
                  <span class="text-xl font-bold font-mono">{stat.value}</span>
                  <span class="text-xs text-[var(--muted)] truncate">{stat.label}</span>
                </div>
              ))}
            </div>
          )}
          {communityStatsStrip}
        </div>

        {/* Main + right panel */}
        <div class="flex gap-8">
          {/* Main content */}
          <div class="flex-1 min-w-0 flex flex-col gap-8">
            {lastSessionCard}
            {recentLapsTable}
            {personalBestsTable}
          </div>

          {/* Right panel — track records */}
          {trackRecordsPanel && (
            <div class="hidden lg:block w-[28rem] flex-shrink-0">
              {trackRecordsPanel}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Logged-out layout ──
  return (
    <div class="flex flex-col gap-14 mt-10">
      {/* Full hero */}
      <div class="flex flex-col gap-5">
        <h1 class="text-5xl font-bold tracking-tight">
          <span class="text-[var(--accent)]">Apx</span>eer
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

      {communityStatsStrip}

      {/* Main + right panel */}
      <div class="flex gap-8">
        <div class="flex-1 min-w-0 flex flex-col gap-8">
          {recentLapsTable}
        </div>
        {trackRecordsPanel && (
          <div class="hidden lg:block w-[28rem] flex-shrink-0">
            {trackRecordsPanel}
          </div>
        )}
      </div>

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
