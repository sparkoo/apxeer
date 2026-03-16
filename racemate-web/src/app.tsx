import { Router, Route, Redirect } from "wouter";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { Home } from "@/pages/Home";
import { Compare } from "@/pages/Compare";
import { Sessions } from "@/pages/Sessions";
import { Laps } from "@/pages/Laps";
import { Login } from "@/pages/Login";

function AppRoutes() {
  const { session, loading } = useAuth();

  if (loading) return null;

  if (!session) {
    return <Login />;
  }

  return (
    <>
      <Nav />
      <main class="p-5">
        <Router>
          <Route path="/" component={Home} />
          <Route path="/laps" component={Laps} />
          <Route path="/compare" component={Compare} />
          <Route path="/sessions" component={Sessions} />
          <Route path="/login">
            <Redirect to="/" />
          </Route>
        </Router>
      </main>
    </>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
