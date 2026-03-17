import { Link } from "wouter";
import { useAuth } from "@/lib/auth";

export function Nav() {
  const { user, loading, signOut } = useAuth();

  return (
    <header class="h-12 border-b border-[var(--border)] flex items-center px-5 gap-8">
      <Link href="/" class="flex items-center gap-2 text-sm font-bold tracking-widest uppercase text-[var(--accent)]">
        <svg width="22" height="22" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="7" fill="#1c1c1f"/>
          <path d="M6 26 L6 8 Q6 6 8 6 L26 6" stroke="#3a3a3e" stroke-width="3" stroke-linecap="round"/>
          <path d="M6 26 Q20 26 26 20 Q30 16 26 6" stroke="#e8304a" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        RaceMate
      </Link>
      <nav class="flex gap-5 text-sm text-[var(--muted)]">
        <Link href="/laps" class="hover:text-[var(--text)] transition-colors">
          Laps
        </Link>
        <Link href="/sessions" class="hover:text-[var(--text)] transition-colors">
          Sessions
        </Link>
        <Link href="/compare" class="hover:text-[var(--text)] transition-colors">
          Compare
        </Link>
      </nav>
      <div class="ml-auto flex items-center gap-4 text-sm text-[var(--muted)]">
        {!loading && (
          user ? (
            <>
              <span>{user.email}</span>
              <button onClick={signOut} class="hover:text-[var(--text)] transition-colors">
                Sign out
              </button>
            </>
          ) : (
            <Link href="/login" class="hover:text-[var(--text)] transition-colors">
              Sign in
            </Link>
          )
        )}
      </div>
    </header>
  );
}
