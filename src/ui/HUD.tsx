import { CreditCard, Flashlight, FlashlightOff, KeyRound, Lock, Zap } from 'lucide-react';
import { WEAPONS, WEAPON_ORDER } from '../game/systems/WeaponSystem';
import type { ReactNode } from 'react';
import { hud, ui } from '../game/state/GameStateManager';
import { useStore } from '../game/state/Store';
import { OBJECTIVES } from '../game/systems/ObjectiveManager';
import { ITEM_LABELS } from '../game/systems/InventorySystem';
import type { ItemId } from '../game/level/LevelData';
import { KeyCap } from './components';
import { useEngine } from './EngineContext';
import { isTouchDevice } from '../game/state/Device';

const ITEM_ICON: Record<ItemId, ReactNode> = {
  fuse: <Zap size={14} strokeWidth={1.4} />,
  keycard: <CreditCard size={14} strokeWidth={1.4} />,
  exitKey: <KeyRound size={14} strokeWidth={1.4} />,
};

function Bar({ value, tone = 'bone', thin = false }: { value: number; tone?: 'bone' | 'red' | 'ash'; thin?: boolean }) {
  const color = tone === 'red' ? 'bg-ember' : tone === 'ash' ? 'bg-ash' : 'bg-bone/85';
  return (
    <div className={`relative w-44 ${thin ? 'h-[2px]' : 'h-[3px]'} bg-bone/10`}>
      <div className={`absolute inset-y-0 left-0 ${color} transition-[width] duration-200 ease-out`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      {/* quarter ticks */}
      {[25, 50, 75].map((t) => <div key={t} className="absolute top-0 h-full w-px bg-char/70" style={{ left: `${t}%` }} />)}
    </div>
  );
}

export function HUD() {
  const h = useStore(hud);
  const s = useStore(ui);
  const engine = useEngine();
  const now = performance.now();
  const showDone = now - h.objectiveDoneAt < 3600 && h.objectiveDoneAt > 0;
  const total = OBJECTIVES.length;

  return (
    <div className="pointer-events-none absolute inset-0 font-sans">
      {/* Threat and low-health edge treatment */}
      <div className="absolute inset-0 transition-opacity duration-700" style={{ opacity: h.threat * 0.8, background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.75) 100%)' }} />
      {h.lowHealth && <div className="absolute inset-0 animate-pulse-red" style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(110,10,6,0.55) 100%)' }} />}
      {h.damageAt > 0 && now - h.damageAt < 1000 && (
        <div key={h.damageAt} className="absolute inset-0 animate-hurt" style={{ background: 'radial-gradient(ellipse at center, rgba(120,8,4,0.05) 30%, rgba(120,8,4,0.6) 100%)' }} />
      )}

      {/* Locker view */}
      {h.hidden && (
        <div className="absolute inset-0 animate-fade-in">
          <div className="slats absolute inset-0" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.85)_80%)]" />
          <div className="absolute left-1/2 top-[18%] -translate-x-1/2 text-[10px] uppercase tracking-[0.5em] text-ash/70">Hiding</div>
        </div>
      )}

      {/* Objective (top-left) */}
      <div className="absolute left-6 top-6 max-w-[360px] sm:left-8 sm:top-7">
        {h.objectiveTitle && (
          <div key={h.objectiveIndex} className="animate-rise-in">
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.36em] text-ash/80">
              <span>Objective</span>
              <span className="h-px w-6 bg-bone/20" />
              <span className="tabular-nums">{String(Math.min(h.objectiveIndex + 1, total)).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
            </div>
            <div className="mt-2 text-[14px] font-light leading-snug tracking-[0.04em] text-bone/90">{h.objectiveTitle}</div>
            {h.objectiveHint && <div className="mt-1 text-[11px] tracking-[0.04em] text-ash/70">{h.objectiveHint}</div>}
          </div>
        )}
        {showDone && (
          <div key={h.objectiveDoneAt} className="animate-toast mt-4 text-[11px] uppercase tracking-[0.28em] text-bone/70">
            <div className="relative inline-block">
              <span className="text-ash">{h.objectiveDoneTitle}</span>
              <span className="animate-strike absolute left-0 top-1/2 h-px w-full bg-ember" />
            </div>
            <div className="mt-1 text-[9px] tracking-[0.4em] text-ember/90">Complete</div>
          </div>
        )}
      </div>

      {/* Inventory (top-right) */}
      <div className="absolute right-6 top-6 flex flex-col items-end gap-2 sm:right-8 sm:top-7">
        {h.inventory.map((id) => (
          <div key={id} className="flex animate-rise-in items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-bone/75">
            <span>{ITEM_LABELS[id]}</span>
            <span className="text-bone/85">{ITEM_ICON[id]}</span>
          </div>
        ))}
      </div>

      {/* Crosshair & prompt (centre) */}
      {!h.hidden && <div className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-bone/45" />}
      {!h.hidden && h.hitAt > 0 && now - h.hitAt < 220 && (
        <div key={h.hitAt} className={`absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 ${h.killAt >= h.hitAt ? 'text-ember' : 'text-bone/90'}`}>
          <svg viewBox="0 0 16 16" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 2l4 4M14 2l-4 4M2 14l4-4M14 14l-4-4" /></svg>
        </div>
      )}
      {h.prompt && (
        <div className="absolute left-1/2 top-1/2 mt-12 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap animate-fade-in">
          {h.prompt.locked ? <Lock size={12} className="text-ash" strokeWidth={1.6} /> : isTouchDevice ? <span className="text-[9px] uppercase tracking-[0.25em] text-ember">Use</span> : <KeyCap>{h.prompt.key ?? 'E'}</KeyCap>}
          <span className={`text-[12px] tracking-[0.12em] ${h.prompt.locked ? 'text-ash/90' : 'text-bone/90'}`}>{h.prompt.text}</span>
        </div>
      )}

      {/* Notes / notices */}
      {h.notice && (
        <div key={h.notice.at} className="absolute bottom-[19%] left-1/2 w-[min(560px,86vw)] -translate-x-1/2 text-center animate-rise-in">
          <div className="text-[10px] uppercase tracking-[0.42em] text-ember/90">{h.notice.title}</div>
          <div className="mx-auto mt-2 max-w-[520px] text-[13px] font-light leading-relaxed tracking-[0.03em] text-bone/85">{h.notice.body}</div>
        </div>
      )}

      {/* Vitals (bottom-left) */}
      <div className={`absolute left-6 sm:left-8 ${isTouchDevice ? 'bottom-[84px]' : 'bottom-6 sm:bottom-8'}`}>
        <div className="flex items-baseline gap-3 text-[10px] uppercase tracking-[0.34em] text-ash/80">
          <span>Condition</span>
          {h.crouched && <span className="text-bone/50">· crouched</span>}
        </div>
        <div className="mt-2"><Bar value={h.health} tone={h.health < 35 ? 'red' : 'bone'} /></div>
        <div className={`mt-3 transition-opacity duration-500 ${h.staminaVisible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="mb-1.5 text-[9px] uppercase tracking-[0.34em] text-ash/60">Stamina</div>
          <Bar value={h.stamina} tone={h.stamina < 25 ? 'red' : 'ash'} thin />
        </div>
      </div>

      {/* Weapon (bottom-centre) */}
      {!h.hidden && (
        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center sm:bottom-8">
          <div className="flex items-baseline gap-2 tabular-nums">
            {h.magSize > 0 ? (
              <>
                <span className={`text-[22px] font-light leading-none ${h.mag === 0 ? 'text-ember' : 'text-bone/90'}`}>{h.mag}</span>
                <span className="text-[12px] text-ash/70">/ {h.reserve}</span>
              </>
            ) : (
              <span className="text-[12px] uppercase tracking-[0.3em] text-ash/70">Melee</span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-3 text-[9px] uppercase tracking-[0.3em] text-ash/70">
            {WEAPON_ORDER.map((w) => (
              <span key={w} className={h.ownedWeapons.includes(w) ? (w === h.weapon ? 'text-bone' : 'text-ash/70') : 'text-ash/20'}>
                {WEAPONS[w].slot}
              </span>
            ))}
            <span className="text-bone/80">{h.weaponName}</span>
            {h.reloading && <span className="text-ember/90">Reloading</span>}
            {!h.reloading && h.magSize > 0 && h.mag === 0 && h.reserve === 0 && <span className="text-ember/90">Out of ammo</span>}
          </div>
        </div>
      )}

      {/* Flashlight (bottom-right); on touch the Light button shows the battery instead */}
      {!isTouchDevice && <div className="absolute bottom-6 right-6 flex flex-col items-end sm:bottom-8 sm:right-8">
        <div className="flex items-center gap-2.5 text-[10px] uppercase tracking-[0.34em] text-ash/80">
          <span className="tabular-nums text-bone/70">{h.battery}%</span>
          <span className={h.flashlightOn ? 'text-bone/85' : 'text-ash/60'}>
            {h.flashlightOn ? <Flashlight size={13} strokeWidth={1.5} /> : <FlashlightOff size={13} strokeWidth={1.5} />}
          </span>
        </div>
        <div className="mt-2 [&>div]:w-32"><Bar value={h.battery} tone={h.battery < 20 ? 'red' : 'bone'} thin /></div>
        <div className="mt-2 flex items-center gap-2 text-[9px] uppercase tracking-[0.3em] text-ash/50"><KeyCap>F</KeyCap> Light</div>
      </div>}

      {/* Click to recapture the mouse */}
      {s.needsPointer && s.overlay === 'none' && (
        <div onClick={() => engine?.requestPointer()} className="pointer-events-auto absolute inset-0 flex cursor-pointer items-center justify-center bg-char/40 animate-fade-in">
          <div className="text-center">
            <div className="text-[11px] uppercase tracking-[0.5em] text-bone/90">Click to continue</div>
            <div className="mt-3 max-w-[380px] text-[11px] leading-relaxed text-ash/80">
              {s.pointerError ?? 'The game needs to capture your mouse to look around. Press Esc at any time to pause.'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
