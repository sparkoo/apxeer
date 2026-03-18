import { useLocation } from "wouter";
import { useCompare } from "@/lib/compare-context";
import { formatLapTime } from "@/lib/types";

const LABELS = ["A", "B"] as const;

export function CompareTray() {
  const { selected, remove, clear } = useCompare();
  const [, navigate] = useLocation();

  if (selected.length === 0) return null;

  const compare = () => {
    navigate(`/compare?lap_a=${selected[0].id}&lap_b=${selected[1].id}`);
  };

  return (
    <div class="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-sm px-5 py-3">
      <div class="max-w-4xl mx-auto flex items-center gap-4">
        <div class="flex items-center gap-3 flex-1">
          {LABELS.map((label, i) => {
            const lap = selected[i];
            return (
              <div
                key={label}
                class={`flex items-center gap-2 px-3 py-1.5 rounded border text-sm ${
                  lap
                    ? "border-[var(--accent)]/40 bg-[var(--accent)]/5"
                    : "border-[var(--border)] border-dashed opacity-40"
                }`}
              >
                <span class="text-xs font-bold text-[var(--accent)] w-3">{label}</span>
                {lap ? (
                  <>
                    <span class="text-[var(--muted)] text-xs">{lap.track_name ?? lap.track_id}</span>
                    <span class="text-[var(--text)] text-xs">{lap.car_name}</span>
                    <span class="font-mono text-xs font-semibold">{formatLapTime(lap.lap_time_ms)}</span>
                    <button
                      onClick={() => remove(lap.id)}
                      class="ml-1 text-[var(--muted)] hover:text-[var(--text)] transition-colors leading-none"
                      aria-label={`Remove lap ${label}`}
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <span class="text-xs text-[var(--muted)]">empty</span>
                )}
              </div>
            );
          })}
        </div>

        <div class="flex items-center gap-2">
          <button
            onClick={clear}
            class="text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors px-2 py-1"
          >
            Clear
          </button>
          <button
            onClick={compare}
            disabled={selected.length < 2}
            class="px-4 py-1.5 text-sm rounded bg-[var(--accent)] text-white disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            Compare →
          </button>
        </div>
      </div>
    </div>
  );
}
