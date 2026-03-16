import { createContext } from "preact";
import { useContext, useState } from "preact/hooks";
import { LapMetadata } from "@/lib/types";

interface CompareContextValue {
  selected: LapMetadata[];
  lockedClass: string | null;
  toggle: (lap: LapMetadata) => void;
  remove: (id: string) => void;
  clear: () => void;
}

const CompareContext = createContext<CompareContextValue>({
  selected: [],
  lockedClass: null,
  toggle: () => {},
  remove: () => {},
  clear: () => {},
});

export function CompareProvider({ children }: { children: preact.ComponentChildren }) {
  const [selected, setSelected] = useState<LapMetadata[]>([]);

  const lockedClass = selected.length > 0 ? (selected[0].car_class ?? null) : null;

  const toggle = (lap: LapMetadata) => {
    setSelected((prev) => {
      // Deselect if already selected
      if (prev.some((l) => l.id === lap.id)) return prev.filter((l) => l.id !== lap.id);
      // Block cross-class selection
      if (prev.length > 0 && prev[0].car_class && lap.car_class && prev[0].car_class !== lap.car_class) return prev;
      if (prev.length >= 2) return [prev[1], lap];
      return [...prev, lap];
    });
  };

  const remove = (id: string) => setSelected((prev) => prev.filter((l) => l.id !== id));
  const clear = () => setSelected([]);

  return (
    <CompareContext.Provider value={{ selected, lockedClass, toggle, remove, clear }}>
      {children}
    </CompareContext.Provider>
  );
}

export function useCompare() {
  return useContext(CompareContext);
}
