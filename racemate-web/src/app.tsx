import { Router, Route } from "wouter";
import { AuthProvider } from "@/lib/auth";
import { CompareProvider } from "@/lib/compare-context";
import { Nav } from "@/components/Nav";
import { CompareTray } from "@/components/CompareTray";
import { Home } from "@/pages/Home";
import { Compare } from "@/pages/Compare";
import { Sessions } from "@/pages/Sessions";
import { Laps } from "@/pages/Laps";
import { Login } from "@/pages/Login";

export function App() {
  return (
    <AuthProvider>
      <CompareProvider>
        <Nav />
        <main class="p-5 pb-20">
          <Router>
            <Route path="/" component={Home} />
            <Route path="/laps" component={Laps} />
            <Route path="/compare" component={Compare} />
            <Route path="/sessions" component={Sessions} />
            <Route path="/login" component={Login} />
          </Router>
        </main>
        <CompareTray />
      </CompareProvider>
    </AuthProvider>
  );
}
