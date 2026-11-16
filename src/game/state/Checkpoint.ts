import type { ItemId } from '../level/LevelData';
import type { ProfileSnapshot } from '../ai/BehaviourProfile';
import type { RunStats } from './GameStateManager';
import type { WeaponSnapshot } from '../systems/WeaponSystem';

export interface Checkpoint {
  version: 1;
  player: { x: number; z: number; yaw: number; health: number; battery: number };
  inventory: ItemId[];
  objective: number;
  power: boolean;
  exitUnlocked: boolean;
  doors: { id: string; locked: boolean; open: boolean }[];
  picked: string[];
  profile: ProfileSnapshot;
  stats: RunStats;
  /** Absent in saves made before weapons existed. */
  weapons?: WeaponSnapshot;
}

const KEY = 'nightfall.checkpoint.v1';

export function saveCheckpoint(c: Checkpoint) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage unavailable: checkpoint stays in memory */ }
}

export function loadCheckpoint(): Checkpoint | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Checkpoint;
    return c.version === 1 ? c : null;
  } catch {
    return null;
  }
}

export function clearCheckpoint() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
