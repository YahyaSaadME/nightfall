import type { EnemyTuningOverride } from './EnemyAI';

export type ZombieKind = 'walker' | 'runner' | 'brute';

export interface ZombieDef {
  kind: ZombieKind;
  health: number;
  /** Visual and hit-box scale. */
  scale: number;
  tuning: EnemyTuningOverride;
}

/**
 * Shared by every zombie: slower and dumber than the stalker. They do not check lockers,
 * lose interest sooner and flinch for less time after an attack.
 *
 * The numbers here are mirrored in ml/simulator.py (the spawn director's training data):
 * walker 2.6 m/s / 22 dmg / 60 hp, runner 1.3x speed / 16 dmg / 40 hp, brute 0.85x / 30 dmg / 140 hp.
 */
const BASE: EnemyTuningOverride = {
  radius: 0.36,
  sightRange: 10,
  chaseSightRange: 18,
  fovCos: Math.cos((110 * Math.PI) / 180),
  closeSense: 1.8,
  attackRange: 1.45,
  hitRange: 1.9,
  windup: 0.6,
  attackRecovery: 0.4,
  recoverTime: 1.0,
  lostSightTimeout: 4,
  searchTime: 9,
  searchRadius: 6,
  checkLockers: false,
};

export const ZOMBIE_DEFS: Record<ZombieKind, ZombieDef> = {
  walker: {
    kind: 'walker', health: 60, scale: 1.0,
    tuning: { ...BASE, damage: 22, speed: { Patrol: 0.85, Investigate: 1.5, Search: 1.1, Chase: 2.6 } },
  },
  runner: {
    kind: 'runner', health: 40, scale: 0.94,
    tuning: { ...BASE, damage: 16, windup: 0.45, speed: { Patrol: 1.1, Investigate: 2.1, Search: 1.5, Chase: 3.4 } },
  },
  brute: {
    kind: 'brute', health: 140, scale: 1.18,
    tuning: { ...BASE, radius: 0.46, damage: 30, windup: 0.75, recoverTime: 0.7, speed: { Patrol: 0.7, Investigate: 1.3, Search: 0.95, Chase: 2.2 } },
  },
};

/** Spawn mix. Later objectives bring more runners and brutes. */
export function pickKind(progress: number, rand: () => number): ZombieKind {
  const brute = 0.04 + 0.16 * progress;
  const runner = 0.12 + 0.22 * progress;
  const r = rand();
  if (r < brute) return 'brute';
  if (r < brute + runner) return 'runner';
  return 'walker';
}

/** Director cap on zombies alive at once (also the cap used when the model was trained). */
export const MAX_ALIVE = 8;
/** Pool size: live zombies plus a few lingering corpses. */
export const ZOMBIE_POOL = MAX_ALIVE + 4;
export const BODY_SECONDS = 7;
export const ZOMBIE_HEIGHT = 1.85;
export const ZOMBIE_HEAD_Y = 1.42;
