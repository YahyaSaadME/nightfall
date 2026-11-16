import { DirectorModel, type DirectorObservation } from './DirectorModel';
import { MAX_ALIVE } from './ZombieTypes';

export const DIRECTOR = {
  /** No spawns during the first seconds of a run. */
  graceSeconds: 20,
  /** How often the director looks at the player. */
  interval: 5,
  /** Minimum gap between two spawn waves. */
  minGap: 8,
  /** Below this health a wave is limited to one zombie, whatever the model says. */
  mercyHealth: 25,
  /** Chance of sampling the tier from the model's probabilities instead of taking the arg-max. */
  explore: 0.15,
  maxAlive: MAX_ALIVE,
  logSize: 300,
};

export interface DirectorDecision {
  t: number;
  tier: number;
  count: number;
  probs: number[];
  source: 'model' | 'fallback';
  /** Why the count differs from the model's pick, if it does. */
  limited?: string;
  obs: DirectorObservation;
}

/** Sliding-window bookkeeping for the features the engine cannot read off the player directly. */
export class DirectorTelemetry {
  private damageAt = -Infinity;
  private killAt = -Infinity;
  private spawnAt = 0;
  private kills: number[] = [];
  private shots: { t: number; hit: boolean }[] = [];
  private sprint: { t: number; dt: number; on: boolean }[] = [];

  reset(now = 0) {
    this.damageAt = this.killAt = -Infinity;
    this.spawnAt = now;
    this.kills = [];
    this.shots = [];
    this.sprint = [];
  }

  onDamage(t: number) { this.damageAt = t; }
  onKill(t: number) { this.killAt = t; this.kills.push(t); }
  onShot(t: number, hit: boolean) { this.shots.push({ t, hit }); }
  onSpawn(t: number) { this.spawnAt = t; }
  sinceSpawn(now: number) { return now - this.spawnAt; }
  sample(t: number, dt: number, sprinting: boolean) { this.sprint.push({ t, dt, on: sprinting }); }

  snapshot(now: number) {
    const cut = now - 60;
    this.kills = this.kills.filter((k) => k >= cut);
    this.shots = this.shots.filter((s) => s.t >= cut);
    this.sprint = this.sprint.filter((s) => s.t >= cut);
    const hits = this.shots.filter((s) => s.hit).length;
    let on = 0, total = 0;
    for (const s of this.sprint) { total += s.dt; if (s.on) on += s.dt; }
    return {
      since_damage_s: Math.min(120, now - this.damageAt),
      since_kill_s: Math.min(120, now - this.killAt),
      kills_60s: this.kills.length,
      accuracy_60s: this.shots.length ? hits / this.shots.length : 0.5,
      since_spawn_s: Math.min(120, now - this.spawnAt),
      sprint_frac_60s: total > 0 ? on / total : 0,
    };
  }
}

/** The hand-written policy from ml/simulator.py (`heuristic_policy`), used if the model is unavailable. */
export function fallbackProbs(o: DirectorObservation): number[] {
  const alive = o.zombies_alive;
  const calm = o.since_damage_s > 25 && o.health > 60 && o.ammo_total > 8;
  let tier = 0;
  if (alive < 3 && o.since_spawn_s > 20) tier = 1;
  if (calm && alive < 2) tier = 2;
  if (calm && alive === 0 && o.progress > 0.5) tier = 3;
  if (o.health < 35 || o.ammo_total < 4) tier = 0;
  const p = [0, 0, 0, 0];
  p[tier] = 1;
  return p;
}

/**
 * Decides when and how many zombies to spawn. A neural network (the spawn-director model)
 * proposes a tier from 16 observations; hard rules then clamp it so the model can never
 * exceed the live-zombie cap or pile on a player who is nearly dead.
 */
export class SpawnDirector {
  enabled = true;
  readonly log: DirectorDecision[] = [];
  last: DirectorDecision | null = null;
  private timer = 0;

  constructor(private model: DirectorModel | null = DirectorModel.bundled(), private readonly rand: () => number = Math.random) {}

  /** Swap the network at runtime (null = hand-written rules). Takes effect on the next decision. */
  setModel(model: DirectorModel | null) {
    this.model = model;
  }

  get modelName(): string {
    return this.model ? this.model.spec.model : 'rules';
  }

  get usingModel() {
    return !!this.model;
  }

  reset() {
    this.timer = 0;
    this.last = null;
    this.log.length = 0;
  }

  /** Call every simulation step. Returns a decision when one is taken (count may be 0). */
  update(dt: number, now: number, sinceSpawn: number, obs: () => DirectorObservation): DirectorDecision | null {
    if (!this.enabled) return null;
    this.timer += dt;
    if (this.timer < DIRECTOR.interval) return null;
    this.timer = 0;
    if (now < DIRECTOR.graceSeconds || sinceSpawn < DIRECTOR.minGap) return null;
    return this.decide(now, obs());
  }

  decide(now: number, o: DirectorObservation): DirectorDecision {
    const probs = this.model ? this.model.predict(o) : fallbackProbs(o);
    const counts = this.model ? this.model.counts : [0, 1, 3, 5];
    let tier = probs.indexOf(Math.max(...probs));
    if (this.model && this.rand() < DIRECTOR.explore) {
      let r = this.rand(), acc = 0;
      for (let i = 0; i < probs.length; i++) { acc += probs[i]; if (r <= acc) { tier = i; break; } }
    }
    let count = counts[tier];
    let limited: string | undefined;
    const room = DIRECTOR.maxAlive - o.zombies_alive;
    if (count > room) { count = Math.max(0, room); limited = 'cap'; }
    if (o.health < DIRECTOR.mercyHealth && count > 1) { count = 1; limited = 'mercy'; }
    const d: DirectorDecision = { t: now, tier, count, probs, source: this.model ? 'model' : 'fallback', limited, obs: { ...o } };
    this.last = d;
    this.log.push(d);
    if (this.log.length > DIRECTOR.logSize) this.log.shift();
    return d;
  }
}
