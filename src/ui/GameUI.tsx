import { useEffect, useMemo, useState } from 'react';
import { ui } from '../game/state/GameStateManager';
import { useStore } from '../game/state/Store';
import { grainDataUrl } from '../game/render/Textures';
import { MainMenu } from './MainMenu';
import { HUD } from './HUD';
import { ControlsOverlay, Credits, ExitOverlay, PauseMenu, SettingsPanel } from './Overlays';
import { DeathScreen, EscapeScreen } from './EndScreens';
import { isTouchDevice } from '../game/state/Device';
import { RotateHint, TouchControls } from './TouchControls';

function LoadingScreen({ progress, error }: { progress: number; error: string | null }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-char">
      <div className="font-display text-[40px] font-light tracking-[0.3em] text-bone/40 animate-breathe">NIGHTFALL</div>
      <div className="mt-8 h-px w-56 bg-bone/10">
        <div className="h-full bg-ember/80 transition-[width] duration-300" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <div className="mt-4 font-sans text-[10px] uppercase tracking-[0.4em] text-ash/60">
        {error ? 'Could not start' : 'Preparing the east wing'}
      </div>
      {error && (
        <div className="mt-4 max-w-md text-center font-sans text-[12px] leading-relaxed text-ember">
          {error}. NIGHTFALL needs a browser with WebGL 2 enabled.
        </div>
      )}
    </div>
  );
}

/** Re-render a few times per second so time-based HUD animations settle. */
function useTicker(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => set((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

export function GameUI({ error }: { error: string | null }) {
  const s = useStore(ui);
  const grain = useMemo(() => grainDataUrl(), []);
  useTicker(500);

  return (
    <div className="absolute inset-0">
      {s.screen === 'loading' && <LoadingScreen progress={s.loadingProgress} error={error} />}
      {s.screen === 'menu' && s.overlay === 'none' && <MainMenu />}
      {(s.screen === 'playing' || s.screen === 'paused') && (
        <div className="pointer-events-none absolute inset-0"><HUD /></div>
      )}
      {isTouchDevice && s.screen === 'playing' && s.overlay === 'none' && <TouchControls />}

      {/* Death / ending fade: above the world and HUD, below menus and end screens */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ opacity: s.fade, background: s.fadeColor === 'red' ? 'radial-gradient(ellipse at center, #3a0503 0%, #000 75%)' : '#000' }}
      />

      {s.screen === 'paused' && s.overlay === 'none' && <PauseMenu />}
      {s.screen === 'dead' && <DeathScreen />}
      {s.screen === 'escaped' && <EscapeScreen />}

      {s.overlay === 'settings' && <SettingsPanel />}
      {s.overlay === 'controls' && <ControlsOverlay />}
      {s.overlay === 'credits' && <Credits />}
      {s.overlay === 'exit' && <ExitOverlay />}
      {isTouchDevice && <RotateHint />}
      <div className="vignette" />
      <div className="grain" style={{ backgroundImage: `url(${grain})` }} />
    </div>
  );
}
