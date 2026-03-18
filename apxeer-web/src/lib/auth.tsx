import { createContext } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

interface AuthContext {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithDiscord: () => Promise<void>;
  signInWithGitHub: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthContext>({
  session: null,
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  signInWithDiscord: async () => {},
  signInWithGitHub: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: preact.ComponentChildren }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const redirectTo = `${window.location.origin}/`;

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
  };

  const signInWithDiscord = async () => {
    await supabase.auth.signInWithOAuth({ provider: "discord", options: { redirectTo } });
  };

  const signInWithGitHub = async () => {
    await supabase.auth.signInWithOAuth({ provider: "github", options: { redirectTo } });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthCtx.Provider value={{ session, user: session?.user ?? null, loading, signInWithGoogle, signInWithDiscord, signInWithGitHub, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
