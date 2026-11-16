import { ui } from '../game/state/GameStateManager';
import { useStore } from '../game/state/Store';
import { useEngine } from './EngineContext';
import { Label, MenuButton, Rule, formatTime } from './components';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-sans text-[9px] uppercase tracking-[0.36em] text-ash/70">{label}</div>
      <div className="mt-1 font-display text-[26px] font-light tracking-[0.06em] text-bone/90 tabular-nums">{value}</div>
    </div>
  );
}

export function DeathScreen() {
  const engine = useEngine();
  const { stats } = useStore(ui);
  return (
    <div className="absolute inset-0 animate-fade-in bg-[radial-gradient(ellipse_at_center,#1a0605_0%,#070505_70%)]">
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <Label>Deceased</Label>
        <h2 className="animate-title-in mt-5 font-display text-[clamp(44px,7vw,96px)] font-light leading-none tracking-[0.16em] text-bone/90">IT FOUND YOU</h2>
        <div className="mt-6 font-sans text-[11px] uppercase tracking-[0.5em] text-ember/90">The hospital keeps what it takes</div>
        <nav className="mt-14 flex flex-col items-center">
          <MenuButton delay={600} onClick={() => engine?.restartCheckpoint()}>Restart checkpoint</MenuButton>
          <MenuButton delay={700} onClick={() => engine?.toMenu()}>Main menu</MenuButton>
        </nav>
        <div className="mt-12 font-sans text-[10px] uppercase tracking-[0.32em] text-ash/60">
          Deaths this night: {stats.deaths}
        </div>
      </div>
    </div>
  );
}

export function EscapeScreen() {
  const engine = useEngine();
  const { stats } = useStore(ui);
  return (
    <div className="absolute inset-0 animate-fade-in bg-[radial-gradient(ellipse_at_50%_120%,#1c2632_0%,#08090c_65%)]">
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <Label>Dawn · 05:41</Label>
        <h2 className="animate-title-in mt-5 font-display text-[clamp(48px,8vw,110px)] font-light leading-none tracking-[0.16em] text-bone">ESCAPED</h2>
        <div className="mt-6 font-sans text-[11px] uppercase tracking-[0.5em] text-ash">The hospital remembers. You will try to forget.</div>
        <Rule className="mt-12 w-[min(520px,80vw)]" />
        <div className="mt-8 grid grid-cols-2 gap-x-14 gap-y-6 sm:grid-cols-4">
          <Stat label="Time" value={formatTime(stats.time)} />
          <Stat label="Deaths" value={String(stats.deaths)} />
          <Stat label="Times hidden" value={String(stats.hides)} />
          <Stat label="Batteries" value={String(stats.batteries)} />
          <Stat label="Zombies killed" value={String(stats.kills)} />
        </div>
        <Rule className="mt-8 w-[min(520px,80vw)]" />
        <nav className="mt-10 flex flex-col items-center">
          <MenuButton delay={900} onClick={() => engine?.newGame()}>Play again</MenuButton>
          <MenuButton delay={1000} onClick={() => engine?.toMenu()}>Main menu</MenuButton>
        </nav>
      </div>
    </div>
  );
}
