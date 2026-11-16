import { useEffect, useRef, useState } from 'react';
import { Engine } from './game/Engine';
import { ui } from './game/state/GameStateManager';
import { EngineContext } from './ui/EngineContext';
import { GameUI } from './ui/GameUI';

declare global {
  interface Window { __nightfall?: ReturnType<Engine['debugApi']> }
}

export default function App() {
  const mount = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = mount.current!;
    const e = new Engine(el);
    let disposed = false;
    e.init((p) => ui.set({ loadingProgress: p }))
      .then(() => {
        if (disposed) return;
        setEngine(e);
        if (import.meta.env.DEV || location.search.includes('debug')) window.__nightfall = e.debugApi();
      })
      .catch((err: unknown) => {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      disposed = true;
      e.dispose();
    };
  }, []);

  return (
    <div className="relative h-full w-full bg-char">
      <div ref={mount} className="absolute inset-0" />
      <EngineContext.Provider value={engine}>
        <GameUI error={error} />
      </EngineContext.Provider>
    </div>
  );
}
