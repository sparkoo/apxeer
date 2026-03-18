import { useEffect } from "preact/hooks";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";

export function Login() {
  const { session, signInWithGoogle, signInWithDiscord, signInWithGitHub } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (session) navigate("/");
  }, [session]);

  return (
    <div class="min-h-[80vh] flex items-center justify-center">
      <div class="flex flex-col items-center gap-6">
        <div class="text-center">
          <h1 class="text-2xl font-bold tracking-widest uppercase text-[var(--accent)] mb-1">Apxeer</h1>
          <p class="text-sm text-[var(--muted)]">Sign in to upload your laps</p>
        </div>
        <div class="flex flex-col gap-3 w-64">
          <button
            onClick={signInWithGoogle}
            class="flex items-center justify-center gap-2 px-4 py-2 border border-[var(--border)] rounded text-sm hover:border-[var(--accent)] transition-colors"
          >
            Continue with Google
          </button>
          <button
            onClick={signInWithDiscord}
            class="flex items-center justify-center gap-2 px-4 py-2 border border-[var(--border)] rounded text-sm hover:border-[var(--accent)] transition-colors"
          >
            Continue with Discord
          </button>
          <button
            onClick={signInWithGitHub}
            class="flex items-center justify-center gap-2 px-4 py-2 border border-[var(--border)] rounded text-sm hover:border-[var(--accent)] transition-colors"
          >
            Continue with GitHub
          </button>
        </div>
      </div>
    </div>
  );
}
