import { useState, useEffect } from "preact/hooks";
import { Link } from "wouter";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { UserSession } from "@/lib/types";

function finishLabel(s: UserSession): { text: string; cls: string } {
  const status = s.my_result.finish_status?.toLowerCase() ?? "";
  if (!status || status === "finished") {
    const pos = s.my_result.finish_pos;
    return {
      text: `P${pos}`,
      cls: pos === 1 ? "text-yellow-400 font-semibold" : "",
    };
  }
  return { text: s.my_result.finish_status!, cls: "text-[var(--muted)]" };
}

export function Sessions() {
  const { user, loading: authLoading } = useAuth();
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    api.users.sessions(user.id)
      .then(setSessions)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user, authLoading]);

  if (authLoading || loading) return <p class="text-[var(--muted)]">Loading...</p>;
  if (!user) return <p class="text-[var(--muted)]">Sign in to view your sessions.</p>;
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
              <th class="text-left px-4 py-2.5 font-normal">Track</th>
              <th class="text-left px-4 py-2.5 font-normal">Type</th>
              <th class="text-left px-4 py-2.5 font-normal">Car Classes</th>
              <th class="text-right px-4 py-2.5 font-normal">Duration</th>
              <th class="text-right px-4 py-2.5 font-normal">Finished</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s, i) => {
              const finish = finishLabel(s);
              return (
                <tr
                  key={s.id}
                  class={`border-t border-[var(--border)] hover:bg-[var(--surface)] transition-colors ${i === 0 ? "border-t-0" : ""}`}
                >
                  <td class="px-4 py-2.5 text-[var(--muted)] whitespace-nowrap">
                    {new Date(s.started_at).toLocaleDateString()}
                  </td>
                  <td class="px-4 py-2.5">
                    <Link href={`/sessions/${s.id}`} class="hover:text-[var(--accent)] transition-colors">
                      {s.track?.name ?? s.track_id}
                    </Link>
                  </td>
                  <td class="px-4 py-2.5 text-[var(--muted)]">{s.session_type}</td>
                  <td class="px-4 py-2.5 text-[var(--muted)]">
                    {s.car_classes?.join(", ") || "—"}
                  </td>
                  <td class="px-4 py-2.5 text-right text-[var(--muted)]">
                    {s.duration_min > 0 ? `${s.duration_min} min` : "—"}
                  </td>
                  <td class={`px-4 py-2.5 text-right ${finish.cls}`}>
                    {finish.text}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
