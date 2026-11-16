import { EnemyAI, type AIDoor, type AIEnv, type EnemyEvents, type PlayerView } from './EnemyAI';
import {
  BODY_SECONDS, MAX_ALIVE, ZOMBIE_DEFS, ZOMBIE_HEAD_Y, ZOMBIE_HEIGHT, ZOMBIE_POOL, pickKind, type ZombieDef, type ZombieKind,
} from './ZombieTypes';

export interface Zombie {
  readonly id: number;
  /** Changes every time this pool slot is reused, so views know to reset. */
  serial: number;
  readonly ai: EnemyAI;
  /** Pool slot in use (alive or a lingering corpse). */
  used: boolean;
  alive: boolean;
  kind: ZombieKind;
  def: ZombieDef;
  health: number;
  /** Seconds since spawn / since death. */
  age: number;
  deadT: number;
  groanT: number;
  /** Where the last hit came from, for the death animation. */
  hitDirX: number;
  hitDirZ: number;
  killedByHeadshot: boolean;
}

export interface ZombieEvents {
  attackWindup?(z: Zombie): void;
  attackHit?(z: Zombie, damage: number): void;
  footstep?(z: Zombie, running: boolean): void;
  doorOpened?(z: Zombie, door: AIDoor): void;
  damaged?(z: Zombie, amount: number, headshot: boolean): void;
  killed?(z: Zombie, headshot: boolean): void;
}

export interface RayHit { zombie: Zombie; dist: number; y: number; headshot: boolean }

export type ZombieEnv = Omit<AIEnv, 'events'>;

/** Everything the zombies need to know about the player, beyond the AI's PlayerView. */
export interface PlayerBody { pos: { x: number; z: number }; hidden: boolean; radius: number }

/**
 * Owns every zombie: a fixed pool of EnemyAI instances with their own health, hit
 * detection, knockback and corpse cleanup. No rendering here, so it runs headless in tests.
 */
export class ZombieSystem {
  readonly zombies: Zombie[] = [];
  private serialCounter = 0;

  constructor(private readonly env: ZombieEnv, private readonly events: ZombieEvents = {}, private readonly rand: () => number = Math.random) {
    for (let i = 0; i < ZOMBIE_POOL; i++) {
      const def = ZOMBIE_DEFS.walker;
      const z: Zombie = {
        id: i, serial: 0, used: false, alive: false, kind: 'walker', def, health: 0, age: 0, deadT: 0, groanT: 0,
        hitDirX: 0, hitDirZ: 1, killedByHeadshot: false,
        ai: null as unknown as EnemyAI,
      };
      (z as { ai: EnemyAI }).ai = new EnemyAI({ ...env, events: this.bindEvents(z) }, def.tuning);
      this.zombies.push(z);
    }
  }

  private bindEvents(z: Zombie): EnemyEvents {
    return {
      attackWindup: () => this.events.attackWindup?.(z),
      attackHit: (dmg) => this.events.attackHit?.(z, dmg),
      footstep: (_x, _z, running) => this.events.footstep?.(z, running),
      doorOpened: (d) => this.events.doorOpened?.(z, d),
    };
  }

  get aliveCount() {
    let n = 0;
    for (const z of this.zombies) if (z.alive) n++;
    return n;
  }

  *living(): Generator<Zombie> {
    for (const z of this.zombies) if (z.alive) yield z;
  }

  nearestAlive(x: number, z: number): { zombie: Zombie; dist: number } | null {
    let best: { zombie: Zombie; dist: number } | null = null;
    for (const q of this.living()) {
      const d = Math.hypot(q.ai.x - x, q.ai.z - z);
      if (!best || d < best.dist) best = { zombie: q, dist: d };
    }
    return best;
  }

  clear() {
    for (const z of this.zombies) {
      z.used = z.alive = false;
      z.ai.active = false;
    }
  }

  // ---------------------------------------------------------------- spawning

  /** Spawns one zombie, recycling the oldest corpse if the pool is full. Null if every slot holds a live zombie. */
  spawn(kind: ZombieKind, x: number, z: number, aware = false, aimAt?: { x: number; z: number }): Zombie | null {
    if (this.aliveCount >= MAX_ALIVE) return null;
    let slot = this.zombies.find((z) => !z.used);
    if (!slot) slot = this.zombies.filter((z) => !z.alive).sort((a, b) => b.deadT - a.deadT)[0];
    if (!slot) return null;
    const def = ZOMBIE_DEFS[kind];
    slot.used = slot.alive = true;
    slot.serial = ++this.serialCounter;
    slot.kind = kind;
    slot.def = def;
    slot.health = def.health;
    slot.age = 0;
    slot.deadT = 0;
    slot.groanT = 1 + this.rand() * 4;
    slot.killedByHeadshot = false;
    Object.assign(slot.ai.T, { ...slot.ai.T, ...def.tuning, speed: { ...slot.ai.T.speed, ...def.tuning.speed } });
    slot.ai.reset(x, z, true);
    slot.ai.yaw = this.rand() * Math.PI * 2;
    if (aware && aimAt) slot.ai.hearNoise(aimAt.x, aimAt.z, 400, 'impact');
    return slot;
  }

  /**
   * Candidate spots for a wave: out of the player's sight, a sensible walk away, reachable
   * on the nav grid, and not on top of other zombies. Returns at most `count` points
   * (fewer if the level offers fewer; callers spawn what they get).
   */
  findSpawnPoints(count: number, player: { x: number; z: number }, candidates: { x: number; z: number }[], minDist = 14, maxDist = 48) {
    const { collision, nav } = this.env;
    const ok = candidates.filter((c) => {
      const d = Math.hypot(c.x - player.x, c.z - player.z);
      if (d < minDist || d > maxDist) return false;
      if (collision.lineOfSight(c.x, c.z, player.x, player.z)) return false;
      if (!collision.pointFree(c.x, c.z, 0.5)) return false;
      for (const z of this.living()) if (Math.hypot(z.ai.x - c.x, z.ai.z - c.z) < 4) return false;
      const path = nav.findPath(player, c);
      return !!path && nav.pathLength(player, path) < 80;
    });
    // Fisher-Yates so waves do not always use the same room.
    for (let i = ok.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [ok[i], ok[j]] = [ok[j], ok[i]];
    }
    const out: { x: number; z: number }[] = [];
    if (!ok.length) return out;
    // A wave arrives as a loose pack around one spot (extra zombies fan out nearby).
    const anchor = ok[0];
    out.push({ x: anchor.x, z: anchor.z });
    let guard = 0;
    while (out.length < count && guard++ < 60) {
      const base = guard % 3 === 0 && ok.length > 1 ? ok[1 + Math.floor(this.rand() * (ok.length - 1))] : anchor;
      const x = base.x + (this.rand() - 0.5) * 3.2, z = base.z + (this.rand() - 0.5) * 3.2;
      if (!collision.pointFree(x, z, 0.5)) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 1.0)) continue;
      out.push({ x, z });
    }
    return out;
  }

  /** Spawn a wave. Returns the zombies actually created. */
  spawnWave(count: number, player: { x: number; z: number }, candidates: { x: number; z: number }[], progress: number, aware = 0.7): Zombie[] {
    const room = MAX_ALIVE - this.aliveCount;
    const pts = this.findSpawnPoints(Math.min(count, room), player, candidates);
    const made: Zombie[] = [];
    for (const p of pts) {
      const z = this.spawn(pickKind(progress, this.rand), p.x, p.z, this.rand() < aware, player);
      if (z) made.push(z);
    }
    return made;
  }

  // ---------------------------------------------------------------- simulation

  update(dt: number, view: PlayerView, body: PlayerBody) {
    const { collision } = this.env;
    const list = this.zombies;
    for (const z of list) {
      if (!z.used) continue;
      if (!z.alive) {
        z.deadT += dt;
        if (z.deadT > BODY_SECONDS) z.used = false;
        continue;
      }
      z.age += dt;
      z.ai.update(dt, view);
      const r = z.ai.T.radius;
      // Bodies do not overlap the player ...
      if (!body.hidden && z.ai.state !== 'Attack') {
        const dx = body.pos.x - z.ai.x, dz = body.pos.z - z.ai.z;
        const d = Math.hypot(dx, dz), min = r + body.radius;
        if (d < min && d > 1e-4) {
          body.pos.x += (dx / d) * (min - d);
          body.pos.z += (dz / d) * (min - d);
          collision.resolveCircle(body.pos, body.radius);
        }
      }
      // ... or each other (stops a pack collapsing onto one point).
      for (const o of list) {
        if (o === z || !o.alive || o.id < z.id) continue;
        const dx = o.ai.x - z.ai.x, dz = o.ai.z - z.ai.z;
        const d = Math.hypot(dx, dz), min = r + o.ai.T.radius;
        if (d < min) {
          const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
          const push = (min - d) / 2;
          z.ai.x -= nx * push; z.ai.z -= nz * push;
          o.ai.x += nx * push; o.ai.z += nz * push;
          collision.resolveCircle(z.ai, r);
          collision.resolveCircle(o.ai, o.ai.T.radius);
        }
      }
      // Stale zombies that wandered far away and cannot see the player are recycled.
      if (z.age > 90) {
        const d = Math.hypot(z.ai.x - view.x, z.ai.z - view.z);
        if (d > 32 && !collision.lineOfSight(z.ai.x, z.ai.z, view.x, view.z)) this.despawn(z);
      }
    }
  }

  despawn(z: Zombie) {
    z.used = z.alive = false;
    z.ai.active = false;
  }

  hearNoise(x: number, z: number, radius: number, kind: Parameters<EnemyAI['hearNoise']>[3]) {
    for (const q of this.living()) q.ai.hearNoise(x, z, radius, kind);
  }

  // ---------------------------------------------------------------- hit detection

  /** Nearest zombie along a ray (a vertical cylinder per zombie). `dir` must be normalised. */
  raycast(o: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, maxDist: number): RayHit | null {
    let best: RayHit | null = null;
    const a = dir.x * dir.x + dir.z * dir.z;
    if (a < 1e-9) return null;
    for (const z of this.living()) {
      const s = z.def.scale;
      const r = z.ai.T.radius * 1.05;
      const fx = o.x - z.ai.x, fz = o.z - z.ai.z;
      const b = fx * dir.x + fz * dir.z;
      const c = fx * fx + fz * fz - r * r;
      const disc = b * b - a * c;
      if (disc < 0) continue;
      let t = (-b - Math.sqrt(disc)) / a;
      if (t < 0) {
        if (c > 0) continue; // cylinder is behind the muzzle
        t = 0;           // muzzle inside the cylinder
      }
      if (t > maxDist) continue;
      const y = o.y + dir.y * t;
      if (y < 0 || y > ZOMBIE_HEIGHT * s) continue;
      if (!best || t < best.dist) best = { zombie: z, dist: t, y, headshot: y > ZOMBIE_HEAD_Y * s };
    }
    return best;
  }

  /** Zombies within reach in front of the player, nearest first. `minDot` is the cosine of the half-arc. */
  meleeTargets(px: number, pz: number, fx: number, fz: number, range: number, minDot: number): Zombie[] {
    const out: { z: Zombie; d: number }[] = [];
    for (const z of this.living()) {
      const dx = z.ai.x - px, dz = z.ai.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > range + z.ai.T.radius) continue;
      if (d > 0.35 && (dx * fx + dz * fz) / d < minDot) continue;
      if (!this.env.collision.lineOfSight(px, pz, z.ai.x, z.ai.z)) continue;
      out.push({ z, d });
    }
    return out.sort((a, b) => a.d - b.d).map((e) => e.z);
  }

  /** Apply damage. Returns true if it killed the zombie. */
  damage(z: Zombie, amount: number, opts: { headshot?: boolean; fromX: number; fromZ: number; knockback?: number }): boolean {
    if (!z.alive) return false;
    const headshot = !!opts.headshot;
    z.health -= amount;
    const dx = z.ai.x - opts.fromX, dz = z.ai.z - opts.fromZ;
    const d = Math.hypot(dx, dz) || 1;
    z.hitDirX = dx / d;
    z.hitDirZ = dz / d;
    this.events.damaged?.(z, amount, headshot);
    if (z.health <= 0) {
      z.alive = false;
      z.deadT = 0;
      z.killedByHeadshot = headshot;
      z.ai.active = false;
      z.ai.moveSpeed = 0;
      this.events.killed?.(z, headshot);
      return true;
    }
    z.ai.provoke(opts.fromX, opts.fromZ);
    z.ai.stagger(amount >= 30 ? 0.55 : 0.25);
    if (opts.knockback) {
      const kb = opts.knockback / (z.kind === 'brute' ? 2.5 : 1);
      z.ai.x += z.hitDirX * kb;
      z.ai.z += z.hitDirZ * kb;
      this.env.collision.resolveCircle(z.ai, z.ai.T.radius);
    }
    return false;
  }
}
