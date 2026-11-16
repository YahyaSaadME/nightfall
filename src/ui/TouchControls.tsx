import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { Crosshair, Flashlight, FlashlightOff, Hand, Pause, RefreshCw, RotateCw } from 'lucide-react';
import { hud, ui } from '../game/state/GameStateManager';
import { useStore } from '../game/state/Store';
import { useEngine } from './EngineContext';

const STICK_RADIUS = 58; // px of thumb travel for full deflection
const STICK_DEADZONE = 0.14;
const LOOK_GAIN = 1.7; // touch pixels -> "mouse pixels" (scaled further by the Sensitivity setting)

const safe = (side: 'left' | 'right' | 'bottom' | 'top', px: number) => `calc(${px}px + env(safe-area-inset-${side}, 0px))`;

/** Round on-screen button. Hold buttons keep the virtual key down while touched; tap buttons fire once. */
function TouchButton({ children, label, size = 56, style, onDown, onUp, active = false, accent = false }: {
  children: ReactNode; label?: string; size?: number; style: CSSProperties;
  onDown: () => void; onUp?: () => void; active?: boolean; accent?: boolean;
}) {
  const down = (e: RPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onDown();
  };
  const up = (e: RPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onUp?.();
  };
  return (
    <button
      type="button"
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
      style={{ ...style, width: size, height: size, touchAction: 'none' }}
      className={`pointer-events-auto absolute flex select-none flex-col items-center justify-center rounded-full border font-sans text-[8px] uppercase tracking-[0.18em] backdrop-blur-[2px] transition-colors active:bg-bone/25 ${
        accent ? 'border-ember/70 bg-ember/20 text-bone' : active ? 'border-bone/60 bg-bone/15 text-bone' : 'border-bone/25 bg-char/45 text-bone/75'
      }`}
    >
      {children}
      {label && <span className="mt-0.5">{label}</span>}
    </button>
  );
}

/** Shown on phones in portrait: the game is landscape-only. Pauses the run while the phone is upright. */
export function RotateHint() {
  const engine = useEngine();
  const s = useStore(ui);
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth);
  useEffect(() => {
    const on = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); };
  }, []);
  const inGame = s.screen === 'playing';
  useEffect(() => {
    if (portrait && inGame) engine?.pause();
  }, [portrait, inGame, engine]);
  if (!portrait) return null;
  return (
    <div className="pointer-events-auto absolute inset-0 z-50 flex flex-col items-center justify-center bg-char px-10 text-center">
      <RotateCw size={34} strokeWidth={1.2} className="animate-breathe text-bone/70" />
      <div className="mt-6 font-sans text-[11px] uppercase tracking-[0.42em] text-bone/90">Rotate your phone</div>
      <div className="mt-3 max-w-[260px] font-sans text-[12px] leading-relaxed text-ash/80">NIGHTFALL is played in landscape.</div>
    </div>
  );
}

/** Virtual joystick (left), look-drag area (right), and action buttons. Feeds the engine's Input. */
export function TouchControls() {
  const engine = useEngine();
  const h = useStore(hud);
  const input = engine?.input;

  const [stick, setStick] = useState<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const stickId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });
  const [running, setRunning] = useState(false);

  // Release everything if the controls disappear mid-touch (pause, death, rotation).
  useEffect(() => () => {
    if (!input) return;
    input.axisF = 0;
    input.axisR = 0;
    input.setHeld('Mouse0', false);
    input.setHeld('ShiftLeft', false);
  }, [input]);

  if (!input || !engine) return null;

  // ---- joystick
  const stickDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (stickId.current !== null) return;
    stickId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    setStick({ ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY });
  };
  const stickMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== stickId.current || !stick) return;
    let dx = e.clientX - stick.ox;
    let dy = e.clientY - stick.oy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) { dx = (dx / len) * STICK_RADIUS; dy = (dy / len) * STICK_RADIUS; }
    setStick({ ...stick, x: stick.ox + dx, y: stick.oy + dy });
    let ax = dx / STICK_RADIUS;
    let ay = -dy / STICK_RADIUS;
    const mag = Math.hypot(ax, ay);
    if (mag < STICK_DEADZONE) { ax = 0; ay = 0; }
    else {
      const k = (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE) / mag;
      ax *= k; ay *= k;
    }
    input.axisR = ax;
    input.axisF = ay;
  };
  const stickUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== stickId.current) return;
    stickId.current = null;
    input.axisF = 0;
    input.axisR = 0;
    setStick(null);
  };

  // ---- look
  const lookDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (lookId.current !== null) return;
    lookId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    lookLast.current = { x: e.clientX, y: e.clientY };
  };
  const lookMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== lookId.current) return;
    input.addLook((e.clientX - lookLast.current.x) * LOOK_GAIN, (e.clientY - lookLast.current.y) * LOOK_GAIN);
    lookLast.current = { x: e.clientX, y: e.clientY };
  };
  const lookUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerId === lookId.current) lookId.current = null;
  };

  const setRun = (v: boolean) => { setRunning(v); input.setHeld('ShiftLeft', v); };
  const zoneStyle: CSSProperties = { touchAction: 'none' };

  return (
    <div className="pointer-events-none absolute inset-0 z-30 select-none">
      {/* Touch zones: left = move, right = look */}
      <div
        className="pointer-events-auto absolute bottom-0 left-0 top-[18%] w-[42%]"
        style={zoneStyle}
        onPointerDown={stickDown}
        onPointerMove={stickMove}
        onPointerUp={stickUp}
        onPointerCancel={stickUp}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div
        className="pointer-events-auto absolute bottom-0 right-0 top-0 w-[58%]"
        style={zoneStyle}
        onPointerDown={lookDown}
        onPointerMove={lookMove}
        onPointerUp={lookUp}
        onPointerCancel={lookUp}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Floating stick visual */}
      {stick ? (
        <>
          <div className="pointer-events-none fixed h-[116px] w-[116px] rounded-full border border-bone/25 bg-char/30" style={{ left: stick.ox - 58, top: stick.oy - 58 }} />
          <div className="pointer-events-none fixed h-12 w-12 rounded-full border border-bone/50 bg-bone/20" style={{ left: stick.x - 24, top: stick.y - 24 }} />
        </>
      ) : (
        <div className="pointer-events-none absolute flex h-[88px] w-[88px] items-center justify-center rounded-full border border-dashed border-bone/12 text-[8px] uppercase tracking-[0.3em] text-bone/25" style={{ left: safe('left', 150), bottom: safe('bottom', 34) }}>
          Move
        </div>
      )}

      {/* Pause + weapon swap (top centre) */}
      <TouchButton size={40} style={{ top: safe('top', 12), left: 'calc(50% - 46px)' }} onDown={() => engine.pause()}>
        <Pause size={15} strokeWidth={1.5} />
      </TouchButton>
      <TouchButton size={40} style={{ top: safe('top', 12), left: 'calc(50% + 6px)' }} onDown={() => { input.wheel += 1; }}>
        <RefreshCw size={14} strokeWidth={1.4} className="rotate-90" />
      </TouchButton>

      {/* Right cluster */}
      <TouchButton size={84} accent style={{ right: safe('right', 18), bottom: safe('bottom', 26) }} onDown={() => input.setHeld('Mouse0', true)} onUp={() => input.setHeld('Mouse0', false)}>
        <Crosshair size={24} strokeWidth={1.4} />
        <span className="mt-1">{h.magSize > 0 ? 'Fire' : 'Swing'}</span>
      </TouchButton>
      <TouchButton size={52} style={{ right: safe('right', 118), bottom: safe('bottom', 26) }} onDown={() => input.tap('KeyR')} label="Reload">
        <RefreshCw size={15} strokeWidth={1.4} />
      </TouchButton>
      <TouchButton size={52} active={h.flashlightOn} style={{ right: safe('right', 98), bottom: safe('bottom', 100) }} onDown={() => input.tap('KeyF')} label={`${h.battery}%`}>
        {h.flashlightOn ? <Flashlight size={16} strokeWidth={1.4} /> : <FlashlightOff size={16} strokeWidth={1.4} />}
      </TouchButton>
      <TouchButton size={60} accent={!!h.prompt && !h.prompt.locked} style={{ right: safe('right', 22), bottom: safe('bottom', 128) }} onDown={() => input.tap('KeyE')} label={h.hidden ? 'Leave' : 'Use'}>
        <Hand size={17} strokeWidth={1.4} />
      </TouchButton>

      {/* Left cluster (below the stick) */}
      <TouchButton size={48} active={running} style={{ left: safe('left', 22), bottom: safe('bottom', 22) }} onDown={() => setRun(true)} onUp={() => setRun(false)}>
        <span className="text-[9px]">Run</span>
      </TouchButton>
      <TouchButton size={48} active={h.crouched} style={{ left: safe('left', 78), bottom: safe('bottom', 22) }} onDown={() => input.tap('KeyC')}>
        <span className="text-[8px] tracking-[0.1em]">Crouch</span>
      </TouchButton>
    </div>
  );
}
