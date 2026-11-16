import { Headphones } from 'lucide-react';
import { ui } from '../game/state/GameStateManager';
import { useStore } from '../game/state/Store';
import { useEngine } from './EngineContext';
import { MenuButton } from './components';
import { isTouchDevice } from '../game/state/Device';
import { settingsStore } from '../game/state/Settings';

/** On phones, going fullscreen + landscape-lock must happen inside the tap that starts the game. */
function withTouchSetup(fn: () => void) {
  return () => {
    if (isTouchDevice) {
      settingsStore.set({ fullscreen: true });
      try { void (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape')?.catch(() => {}); } catch { /* unsupported */ }
    }
    fn();
  };
}

export function MainMenu() {
  const engine = useEngine();
  const s = useStore(ui);
  const busy = !engine;

  return (
    <div className="absolute inset-0">
      {/* Legibility gradient over the live 3D corridor */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(8,8,9,0.92)_0%,rgba(8,8,9,0.72)_32%,rgba(8,8,9,0.0)_62%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(0deg,rgba(6,6,7,0.9),transparent)]" />

      <div className="absolute inset-y-0 left-0 flex w-full max-w-[640px] flex-col justify-center px-6 sm:px-[7vw]">
        <div className="animate-fade-in font-sans text-[10px] uppercase tracking-[0.5em] text-ash/70" style={{ animationDelay: '400ms' }}>
          St. Aldric General &nbsp;·&nbsp; East Wing
        </div>
        <h1 className="animate-title-in mt-5 [@media(max-height:500px)]:mt-2 font-display text-[clamp(40px,min(10vw,17vh),132px)] font-light leading-[0.9] tracking-[0.16em] text-bone">
          NIGHTFALL
        </h1>
        <div className="mt-6 [@media(max-height:500px)]:mt-3 flex items-center gap-4 animate-fade-in" style={{ animationDelay: '900ms' }}>
          <span className="h-px w-10 bg-ember/80" />
          <span className="font-sans text-[11px] font-medium uppercase tracking-[0.55em] text-ember">The hospital remembers</span>
        </div>

        <nav className="mt-14 flex flex-col [@media(max-height:500px)]:mt-4">
          <MenuButton delay={1100} disabled={busy || !s.hasSave} onClick={withTouchSetup(() => engine?.continueGame())} hint={!s.hasSave ? 'no checkpoint' : undefined}>
            Continue
          </MenuButton>
          <MenuButton delay={1200} disabled={busy} onClick={withTouchSetup(() => engine?.newGame())}>New Game</MenuButton>
          <MenuButton delay={1300} disabled={busy} onClick={() => ui.set({ overlay: 'settings' })}>Settings</MenuButton>
          <MenuButton delay={1400} onClick={() => ui.set({ overlay: 'controls' })}>Controls</MenuButton>
          <MenuButton delay={1500} onClick={() => ui.set({ overlay: 'credits' })}>Credits</MenuButton>
          <MenuButton delay={1600} onClick={() => ui.set({ overlay: 'exit' })}>Exit</MenuButton>
        </nav>
      </div>

      <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between font-sans text-[10px] uppercase tracking-[0.3em] text-ash/60 sm:left-[7vw] sm:right-[4vw]">
        <span className="flex items-center gap-2 animate-breathe">
          <Headphones size={12} strokeWidth={1.5} /> Headphones recommended
        </span>
        <span className="hidden sm:inline">v1.0 · Prototype</span>
      </div>
    </div>
  );
}
