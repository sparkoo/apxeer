import { useEffect } from "preact/hooks";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";

export function Login() {
  const { user, signIn } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (user) navigate("/");
  }, [user]);

  return (
    <div class="min-h-[80vh] flex items-center justify-center">
      <div class="flex flex-col items-center gap-6">
        <div class="text-center">
          <h1 class="text-2xl font-bold tracking-widest uppercase text-[var(--accent)] mb-1">Apxeer</h1>
          <p class="text-sm text-[var(--muted)]">Sign in to upload your laps</p>
        </div>
        <button
          onClick={signIn}
          class="flex items-center justify-center gap-2 px-6 py-2.5 border border-[var(--border)] rounded text-sm hover:border-[var(--accent)] transition-colors w-64"
        >
          Sign in
        </button>
      </div>
    </div>
  );
}
