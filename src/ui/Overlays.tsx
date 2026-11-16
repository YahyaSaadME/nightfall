import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { hud, markControlsSeen, ui } from '../game/state/GameStateManager';
import { isTouchDevice } from '../game/state/Device';
import { directorChoices, effectiveKey } from '../game/ai/DirectorRegistry';
import { settingsStore, type Quality } from '../game/state/Settings';
import { useStore } from '../game/state/Store';
import { useEngine } from './EngineContext';
import { Backdrop, KeyCap, Label, MenuButton, Rule, Segmented, Slider, Toggle } from './components';

function Panel({ title, kicker, children, onBack, backLabel = 'Back', wide = false }: {
  title: string; kicker?: string; children: ReactNode; onBack?: () => void; backLabel?: string; wide?: boolean;
}) {
  return (
    <Backdrop strong>
      {/* Scrolls on short screens (phones in landscape); pan-y re-enables touch scrolling here. */}
      <div className="h-full overflow-y-auto overscroll-contain" style={{ touchAction: 'pan-y' }}>
      <div className="flex min-h-full items-center justify-center px-4 py-6">
        <div className={`w-full ${wide ? 'max-w-[640px]' : 'max-w-[480px]'} animate-rise-in`}>
          {kicker && <Label>{kicker}</Label>}
          <h2 className="mt-3 font-display text-[44px] font-light leading-none tracking-[0.12em] text-bone">{title}</h2>
          <Rule className="mt-6 mb-7" />
          {children}
          {onBack && (
            <>
              <Rule className="mt-8 mb-4" />
              <button type="button" onClick={onBack} className="group flex items-center gap-2 font-sans text-[11px] uppercase tracking-[0.32em] text-ash transition-colors hover:text-bone">
                <ChevronLeft size={14} strokeWidth={1.5} className="transition-transform group-hover:-translate-x-0.5" /> {backLabel}
              </button>
            </>
          )}
        </div>
      </div>
      </div>
    </Backdrop>
  );
}

/** Pick which trained model decides zombie waves. Applies immediately, even mid-run. */
function DirectorPicker() {
  const s = useStore(settingsStore);
  const current = effectiveKey(s.directorModel);
  return (
    <div>
      <Label>Spawn AI</Label>
      <div className="mt-3 flex flex-col">
        {directorChoices().map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => settingsStore.set({ directorModel: c.key })}
            className={`border-l-2 py-2 pl-4 pr-2 text-left transition-colors duration-300 ${c.key === current ? 'border-ember bg-bone/[0.04]' : 'border-bone/10 hover:border-bone/30'}`}
          >
            <div className={`font-sans text-[12px] uppercase tracking-[0.18em] ${c.key === current ? 'text-bone' : 'text-ash'}`}>{c.label}</div>
            <div className="mt-1 font-sans text-[11px] leading-snug tracking-[0.03em] text-ash/80">{c.blurb}</div>
            {c.stats && <div className="mt-1 font-sans text-[10px] tabular-nums tracking-[0.08em] text-ash/55">{c.stats}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PauseMenu() {
  const engine = useEngine();
  const h = useStore(hud);
  return (
    <Backdrop>
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,8,9,0.85)_0%,rgba(8,8,9,0.4)_45%,transparent_75%)]" />
      <div className="relative flex h-full flex-col justify-center px-6 sm:px-[7vw]">
        <Label>Paused</Label>
        <h2 className="mt-3 font-display text-[64px] font-light leading-none tracking-[0.14em] text-bone animate-rise-in">NIGHTFALL</h2>
        {h.objectiveTitle && (
          <div className="mt-6 max-w-[420px] font-sans text-[12px] font-light tracking-[0.04em] text-ash">
            <span className="mr-3 text-[10px] uppercase tracking-[0.32em] text-ember/90">Objective</span>{h.objectiveTitle}
          </div>
        )}
        <nav className="mt-10 flex flex-col">
          <MenuButton onClick={() => engine?.resume()}>Resume</MenuButton>
          <MenuButton delay={60} onClick={() => engine?.restartCheckpoint()}>Restart checkpoint</MenuButton>
          <MenuButton delay={120} onClick={() => ui.set({ overlay: 'settings' })}>Settings</MenuButton>
          <MenuButton delay={180} onClick={() => ui.set({ overlay: 'controls' })}>Controls</MenuButton>
          <MenuButton delay={240} onClick={() => engine?.toMenu()}>Main menu</MenuButton>
        </nav>
      </div>
    </Backdrop>
  );
}

export function SettingsPanel() {
  const s = useStore(settingsStore);
  const fsSupported = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  return (
    <Panel kicker="Options" title="Settings" onBack={() => ui.set({ overlay: 'none' })}>
      <div className="flex flex-col gap-6">
        <Slider label="Mouse sensitivity" value={s.sensitivity} min={0.2} max={3} step={0.05} onChange={(v) => settingsStore.set({ sensitivity: v })} format={(v) => `${v.toFixed(2)}×`} />
        <Toggle label="Invert mouse Y" value={s.invertY} onChange={(v) => settingsStore.set({ invertY: v })} />
        <Slider label="Master volume" value={s.volume} min={0} max={1} step={0.01} onChange={(v) => settingsStore.set({ volume: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <div>
          <Slider label="Brightness" value={s.brightness} min={0.6} max={1.6} step={0.01} onChange={(v) => settingsStore.set({ brightness: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <div className="mt-3 flex items-center gap-4">
            <div className="flex gap-2">
              {[0.035, 0.07, 0.14].map((a) => (
                <span key={a} className="block h-7 w-7" style={{ background: `rgba(230,225,214,${a * s.brightness})` }} />
              ))}
            </div>
            <span className="font-sans text-[10px] leading-relaxed tracking-[0.06em] text-ash/80">Adjust until the left square is barely visible.</span>
          </div>
        </div>
        <Segmented<Quality>
          label="Quality"
          value={s.quality}
          options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]}
          onChange={(v) => settingsStore.set({ quality: v })}
        />
        <DirectorPicker />
        <Toggle label={fsSupported ? 'Fullscreen' : 'Fullscreen (unsupported)'} value={s.fullscreen} disabled={!fsSupported} onChange={(v) => settingsStore.set({ fullscreen: v })} />
      </div>
    </Panel>
  );
}

const CONTROLS: [ReactNode, string][] = [
  [<span className="flex gap-1"><KeyCap>W</KeyCap><KeyCap>A</KeyCap><KeyCap>S</KeyCap><KeyCap>D</KeyCap></span>, 'Move'],
  [<KeyCap wide>Mouse</KeyCap>, 'Look around'],
  [<KeyCap wide>Shift</KeyCap>, 'Sprint (drains stamina, makes noise)'],
  [<span className="flex gap-1"><KeyCap wide>Ctrl</KeyCap><KeyCap>C</KeyCap></span>, 'Crouch (toggle) — quieter, harder to see'],
  [<KeyCap>E</KeyCap>, 'Interact · open doors · hide in lockers'],
  [<KeyCap>F</KeyCap>, 'Flashlight (drains battery, can be seen)'],
  [<KeyCap wide>Click</KeyCap>, 'Shoot / swing — gunfire is loud and draws everything'],
  [<KeyCap>R</KeyCap>, 'Reload (also reloads automatically when empty)'],
  [<span className="flex gap-1"><KeyCap>1</KeyCap><KeyCap>2</KeyCap><KeyCap>3</KeyCap></span>, 'Switch weapon · or use the mouse wheel'],
  [<KeyCap wide>Esc</KeyCap>, 'Pause and release the mouse'],
];

const TOUCH_CONTROLS: [string, string][] = [
  ['Left thumb', 'Drag anywhere on the left to move'],
  ['Right thumb', 'Drag anywhere on the right to look'],
  ['Run', 'Hold while moving forward (drains stamina, makes noise)'],
  ['Crouch', 'Toggle — quieter, harder to see'],
  ['Use', 'Doors, items, notes, lockers, the fuse box'],
  ['Light', 'Flashlight (drains battery, can be seen)'],
  ['Fire', 'Shoot / swing — gunfire is loud and draws everything'],
  ['Reload', 'Reloads (also automatic when empty)'],
  ['Swap / Pause', 'Buttons at the top centre'],
];

export function ControlsOverlay() {
  const engine = useEngine();
  const s = useStore(ui);
  const starting = s.screen === 'playing';
  const close = () => {
    markControlsSeen();
    if (starting) engine?.dismissControls();
    else ui.set({ overlay: 'none' });
  };
  return (
    <Panel kicker={starting ? 'Before you begin' : 'Reference'} title="Controls" wide onBack={starting ? undefined : close}>
      <div className={isTouchDevice ? 'grid gap-y-2' : 'grid gap-y-4'}>
        {isTouchDevice && TOUCH_CONTROLS.map(([k, label]) => (
          <div key={k} className="grid grid-cols-[110px_1fr] items-center gap-4 font-sans text-[12px] tracking-[0.04em] text-bone/85">
            <div className="uppercase tracking-[0.18em] text-ash">{k}</div>
            <div className="text-bone/80">{label}</div>
          </div>
        ))}
        {!isTouchDevice && CONTROLS.map(([k, label], i) => (
          <div key={i} className="grid grid-cols-[140px_1fr] items-center gap-6 font-sans text-[12px] tracking-[0.06em] text-bone/85">
            <div>{k}</div>
            <div className="text-bone/80">{label}</div>
          </div>
        ))}
      </div>
      <div className="mt-7 font-sans text-[11px] leading-relaxed tracking-[0.04em] text-ash/80">
        Something walks these halls. It hears running and doors, and it notices light. Lockers can hide you — unless it saw you get in. The dead walk too: they can be killed, but shots are heard everywhere. Ammo lies on the floor — walk over it.
      </div>
      {starting && (
        <button
          type="button"
          onClick={close}
          className="group mt-9 flex items-center gap-4 font-sans text-[12px] uppercase tracking-[0.42em] text-bone transition-colors hover:text-white"
        >
          <span className="h-px w-8 bg-ember transition-all duration-500 group-hover:w-14" />
          {isTouchDevice ? 'Tap to begin' : 'Click to begin'}
        </button>
      )}
    </Panel>
  );
}

export function Credits() {
  return (
    <Panel kicker="About" title="Credits" onBack={() => ui.set({ overlay: 'none' })}>
      <div className="space-y-5 font-sans text-[12px] font-light leading-relaxed tracking-[0.04em] text-bone/80">
        <p><span className="text-ash">Game, design &amp; code</span><br />NIGHTFALL — a browser horror prototype.</p>
        <p><span className="text-ash">Technology</span><br />Three.js · React · TypeScript · Vite · Tailwind CSS · Lucide icons.</p>
        <p><span className="text-ash">Art &amp; sound</span><br />Every texture, model and sound in this game is generated procedurally at runtime — no external assets.</p>
        <p><span className="text-ash">Typefaces</span><br />Cormorant Garamond and Inter, under the SIL Open Font License.</p>
      </div>
    </Panel>
  );
}

export function ExitOverlay() {
  return (
    <Panel kicker="Leave" title="Exit" onBack={() => ui.set({ overlay: 'none' })} backLabel="Return to menu">
      <p className="font-sans text-[13px] font-light leading-relaxed tracking-[0.04em] text-bone/80">
        Browsers do not let a page close itself. Your progress is saved at the last checkpoint — you can safely close this tab now.
      </p>
      <button
        type="button"
        onClick={() => { window.close(); }}
        className="mt-6 font-sans text-[11px] uppercase tracking-[0.32em] text-ash transition-colors hover:text-bone"
      >
        Try to close the tab
      </button>
    </Panel>
  );
}
