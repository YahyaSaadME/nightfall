import { Store } from './Store';
import type { ItemId } from '../level/LevelData';
import type { Prompt } from '../systems/InteractionSystem';
import type { WeaponId } from '../systems/WeaponSystem';

export type Screen = 'loading' | 'menu' | 'playing' | 'paused' | 'dead' | 'escaped';
export type Overlay = 'none' | 'settings' | 'credits' | 'controls' | 'exit';

export interface RunStats { time: number; deaths: number; hides: number; batteries: number; sprintSeconds: number; kills: number }

export interface UIState {
  screen: Screen;
  overlay: Overlay;
  /** Playing but the mouse is not captured: show "click to continue". */
  needsPointer: boolean;
  /** Pointer lock was refused (e.g. too soon after Escape). */
  pointerError: string | null;
  hasSave: boolean;
  /** Full-screen fade for death / ending sequences (0..1). */
  fade: number;
  fadeColor: 'black' | 'red';
  stats: RunStats;
  /** True until the player has dismissed the controls card once. */
  firstLaunch: boolean;
  loadingProgress: number;
}

export interface HudState {
  health: number;
  stamina: number;
  staminaVisible: boolean;
  battery: number;
  flashlightOn: boolean;
  prompt: Prompt | null;
  objectiveIndex: number;
  objectiveTitle: string;
  objectiveHint: string;
  /** performance.now() of the last completion (drives the completion animation). */
  objectiveDoneAt: number;
  objectiveDoneTitle: string;
  inventory: ItemId[];
  damageAt: number;
  hidden: boolean;
  crouched: boolean;
  /** Short in-world message (notes, warnings). */
  notice: { title: string; body: string; at: number } | null;
  /** 0..1 for subtle UI tension (vignette pulse). */
  threat: number;
  lowHealth: boolean;
  weapon: WeaponId;
  weaponName: string;
  ownedWeapons: WeaponId[];
  /** Rounds in the gun, rounds in reserve, magazine size (0 for melee). */
  mag: number;
  reserve: number;
  magSize: number;
  reloading: boolean;
  /** performance.now() of the last hit / kill (drives the hit marker). */
  hitAt: number;
  killAt: number;
  zombiesAlive: number;
}

const FIRST_KEY = 'nightfall.seenControls';
const firstLaunch = (() => {
  try { return localStorage.getItem(FIRST_KEY) !== '1'; } catch { return true; }
})();

export const ui = new Store<UIState>({
  screen: 'loading',
  overlay: 'none',
  needsPointer: false,
  pointerError: null,
  hasSave: false,
  fade: 0,
  fadeColor: 'black',
  stats: { time: 0, deaths: 0, hides: 0, batteries: 0, sprintSeconds: 0, kills: 0 },
  firstLaunch,
  loadingProgress: 0,
});

export const hud = new Store<HudState>({
  health: 100,
  stamina: 100,
  staminaVisible: false,
  battery: 100,
  flashlightOn: false,
  prompt: null,
  objectiveIndex: 0,
  objectiveTitle: '',
  objectiveHint: '',
  objectiveDoneAt: 0,
  objectiveDoneTitle: '',
  inventory: [],
  damageAt: 0,
  hidden: false,
  crouched: false,
  notice: null,
  threat: 0,
  lowHealth: false,
  weapon: 'pistol',
  weaponName: 'Pistol',
  ownedWeapons: ['bat', 'pistol'],
  mag: 0,
  reserve: 0,
  magSize: 12,
  reloading: false,
  hitAt: 0,
  killAt: 0,
  zombiesAlive: 0,
});

export function markControlsSeen() {
  try { localStorage.setItem(FIRST_KEY, '1'); } catch { /* ignore */ }
  ui.set({ firstLaunch: false });
}

/** Allowed screen transitions; anything else is ignored (keeps state changes reliable). */
const TRANSITIONS: Record<Screen, Screen[]> = {
  loading: ['menu'],
  menu: ['playing'],
  playing: ['paused', 'dead', 'escaped', 'menu'],
  paused: ['playing', 'menu'],
  dead: ['playing', 'menu'],
  escaped: ['playing', 'menu'],
};

export function setScreen(next: Screen): boolean {
  const cur = ui.get().screen;
  if (cur === next) return true;
  if (!TRANSITIONS[cur].includes(next)) {
    console.warn(`[state] blocked transition ${cur} -> ${next}`);
    return false;
  }
  ui.set({ screen: next, overlay: 'none' });
  return true;
}
