import { useState, useEffect } from "preact/hooks";
import { Link } from "wouter";
import { api } from "@/lib/api";
import type { Session } from "@/lib/types";

export function Sessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.sessions.list().then(setSessions).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <p class="text-[var(--muted)]">Loading...</p>;
  if (error) return <p class="text-red-500">{error}</p>;
  if (sessions.length === 0) return <p class="text-[var(--muted)]">No sessions uploaded yet.</p>;

  return (
    <div class="flex flex-col gap-6">
      <h1 class="text-xl font-bold">Race Sessions</h1>

      <div class="border border-[var(--border)] rounded-lg overflow-hidden">
        <table class="w-full text-sm">
          <thead class="border-b border-[var(--border)] text-[var(--muted)]">
            <tr>
              <th class="text-left px-4 py-2.5 font-normal">Date</th>
              <th class="text-left px-4 py-2.5 font-normal">Event</th>
              <th class="text-left px-4 py-2.5 font-normal">Track</th>
              <th class="text-left px-4 py-2.5 font-normal">Type</th>
              <th class="text-right px-4 py-2.5 font-normal">Duration</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s, i) => (
              <tr
                key={s.id}
                class={`border-t border-[var(--border)] hover:bg-[var(--surface)] transition-colors ${i === 0 ? "border-t-0" : ""}`}
              >
                <td class="px-4 py-2.5 text-[var(--muted)] whitespace-nowrap">
                  {new Date(s.started_at).toLocaleDateString()}
                </td>
                <td class="px-4 py-2.5">
                  <Link href={`/sessions/${s.id}`} class="hover:text-[var(--accent)] transition-colors">
                    {s.event_name || "—"}
                  </Link>
                </td>
                <td class="px-4 py-2.5 text-[var(--muted)]">
                  {s.track?.name ?? s.track_id}
                </td>
                <td class="px-4 py-2.5 text-[var(--muted)]">{s.session_type}</td>
                <td class="px-4 py-2.5 text-right text-[var(--muted)]">
                  {s.duration_min > 0 ? `${s.duration_min} min` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
