import { useState, useEffect } from "preact/hooks";
import { useParams, Link } from "wouter";
import { api } from "@/lib/api";
import type { Session } from "@/lib/types";

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.sessions.get(id).then(setSession).catch(() => setError(true));
  }, [id]);

  if (error) {
    return (
      <div class="mt-10">
        <p class="text-[var(--muted)]">Session not found.</p>
        <Link href="/sessions" class="text-sm text-[var(--accent)] hover:underline mt-2 inline-block">← Back to sessions</Link>
      </div>
    );
  }

  if (!session) {
    return <div class="mt-10 text-[var(--muted)]">Loading…</div>;
  }

  return (
    <div class="flex flex-col gap-8 mt-10">
      <div>
        <Link href="/sessions" class="text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors">← Sessions</Link>
        <h1 class="text-2xl font-bold mt-2">{session.event_name || "Session"}</h1>
        <p class="text-sm text-[var(--muted)] mt-1">
          {session.track?.name ?? session.track_id} · {session.session_type} · {new Date(session.started_at).toLocaleDateString()}
        </p>
      </div>

      {session.results && session.results.length > 0 && (
        <div>
          <h2 class="text-xs font-semibold text-[var(--muted)] uppercase tracking-widest mb-3">Results</h2>
          <div class="border border-[var(--border)] rounded-lg overflow-hidden">
            <table class="w-full text-sm">
              <thead class="border-b border-[var(--border)] text-[var(--muted)]">
                <tr>
                  <th class="text-left px-4 py-2.5 font-normal">Pos</th>
                  <th class="text-left px-4 py-2.5 font-normal">Driver</th>
                  <th class="text-left px-4 py-2.5 font-normal">Car</th>
                  <th class="text-right px-4 py-2.5 font-normal">Laps</th>
                  <th class="text-right px-4 py-2.5 font-normal">Best Lap</th>
                </tr>
              </thead>
              <tbody>
                {session.results.map((result, i) => (
                  <tr key={i} class={`border-t border-[var(--border)] ${i === 0 ? "border-t-0" : ""}`}>
                    <td class="px-4 py-2.5 text-[var(--muted)]">{result.finish_pos}</td>
                    <td class="px-4 py-2.5">{result.ingame_name}</td>
                    <td class="px-4 py-2.5 text-[var(--muted)]">{result.car_type}</td>
                    <td class="px-4 py-2.5 text-right text-[var(--muted)]">{result.laps_completed}</td>
                    <td class="px-4 py-2.5 text-right font-mono">
                      {result.best_lap_ms != null
                        ? new Date(result.best_lap_ms).toISOString().slice(14, 22)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
