import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import { clerk } from "./clerk";
import { api } from "./api";

// InternalUser is the user record from our DB (fetched from /api/me on sign-in).
// user.id is the internal UUID used for all API calls that take a user ID.
interface InternalUser {
  id: string;
  clerk_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
}

interface AuthContext {
  user: InternalUser | null;
  loading: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthContext>({
  user: null,
  loading: true,
  signIn: () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ComponentChildren }) {
  const [user, setUser] = useState<InternalUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    clerk.load().then(() => {
      // Set initial state from existing session
      if (clerk.session) {
        fetchInternalUser().then(setUser).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }

      // Listen for future auth state changes
      clerk.addListener((emission) => {
        const session = emission.session;
        if (session) {
          fetchInternalUser().then(setUser);
        } else {
          setUser(null);
        }
      });
    });
  }, []);

  const signIn = () => clerk.openSignIn({ afterSignInUrl: "/" });

  const signOut = async () => {
    await clerk.signOut();
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);

// fetchInternalUser calls GET /api/me to get the internal UUID.
// This is the bridge between Clerk's user ID and our DB's UUID.
async function fetchInternalUser(): Promise<InternalUser | null> {
  try {
    const token = await clerk.session?.getToken();
    if (!token) return null;
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
