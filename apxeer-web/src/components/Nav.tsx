import { Link } from "wouter";
import { useAuth } from "@/lib/auth";

export function Nav() {
  const { user, loading, signOut } = useAuth();

  return (
    <header class="h-12 border-b border-[var(--border)] flex items-center px-5 gap-8">
      <Link href="/" class="text-sm font-bold tracking-widest uppercase text-[var(--accent)]">
        Apxeer
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
