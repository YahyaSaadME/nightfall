import type { ZombieSystem } from '../ai/ZombieSystem';

export type WeaponId = 'bat' | 'pistol' | 'shotgun';
export type AmmoType = '9mm' | 'shell';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  slot: 1 | 2 | 3;
  ammo: AmmoType | null;
  mag: number;
  /** Damage per bullet / pellet / swing. */
  damage: number;
  pellets: number;
  /** Cone half-angle in radians. */
  spread: number;
  range: number;
  /** Seconds between shots. */
  cooldown: number;
  /** Seconds to reload (per shell for the shotgun). */
  reload: number;
  /** Sound radius in metres when fired / swung. Zombies and the stalker hear it. */
  noise: number;
  melee: boolean;
  knockback: number;
  headMul: number;
}

/**
 * Numbers behind ml/simulator.py: pistol ~2.8 shots/s sustained, shotgun ~0.9/s, bat ~1.4/s.
 * Change them together or retrain the director.
 */
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  bat: { id: 'bat', name: 'Fire axe handle', slot: 1, ammo: null, mag: 0, damage: 40, pellets: 1, spread: 0, range: 2.0, cooldown: 0.7, reload: 0, noise: 4, melee: true, knockback: 0.5, headMul: 1.5 },
  pistol: { id: 'pistol', name: 'Pistol', slot: 2, ammo: '9mm', mag: 12, damage: 35, pellets: 1, spread: 0.014, range: 45, cooldown: 0.28, reload: 1.3, noise: 26, melee: false, knockback: 0.25, headMul: 2 },
  shotgun: { id: 'shotgun', name: 'Shotgun', slot: 3, ammo: 'shell', mag: 4, damage: 14, pellets: 6, spread: 0.085, range: 22, cooldown: 0.95, reload: 0.55, noise: 38, melee: false, knockback: 0.8, headMul: 1.5 },
};
export const WEAPON_ORDER: WeaponId[] = ['bat', 'pistol', 'shotgun'];

export const AMMO_PICKUP: Record<AmmoType, number> = { '9mm': 12, shell: 6 };
export const AMMO_CAP: Record<AmmoType, number> = { '9mm': 60, shell: 24 };
export const SWITCH_TIME = 0.3;
/** Melee hits anything within 55 degrees of the crosshair. */
export const MELEE_ARC_COS = Math.cos((55 * Math.PI) / 180);

export interface WeaponSnapshot {
  owned: WeaponId[];
  current: WeaponId;
  mag: Record<WeaponId, number>;
  reserve: Record<AmmoType, number>;
}

export interface ShotContext {
  /** Muzzle / eye position. */
  o: { x: number; y: number; z: number };
  /** Unit aim direction plus the camera's right and up vectors (for spread). */
  dir: { x: number; y: number; z: number };
  right: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
  rand: () => number;
  /** Distance to the first wall/door/prop along a ray, or Infinity. */
  wallDist: (o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, max: number) => number;
}

export interface AttackResult {
  kind: 'shot' | 'swing' | 'dry' | 'none';
  weapon: WeaponId;
  /** Any zombie was hit. */
  hit: boolean;
  kills: number;
  headshot: boolean;
  damage: number;
  /** Radius of the noise this attack made. */
  noise: number;
  /** Impact point of the first hit (for effects), or where the shot ended. */
  endPoint: { x: number; y: number; z: number } | null;
}

const NONE: AttackResult = { kind: 'none', weapon: 'bat', hit: false, kills: 0, headshot: false, damage: 0, noise: 0, endPoint: null };

export class WeaponSystem {
  private owned = new Set<WeaponId>();
  current: WeaponId = 'pistol';
  mag: Record<WeaponId, number> = { bat: 0, pistol: 0, shotgun: 0 };
  reserve: Record<AmmoType, number> = { '9mm': 0, shell: 0 };
  /** Counts down to 0; the weapon can act at 0. */
  cooldownT = 0;
  swapT = 0;
  reloadT = 0;
  reloading = false;
  /** Animation hooks for the view model: seconds since the last attack. */
  sinceAttack = 99;
  lastAttack: 'shot' | 'swing' | 'dry' | 'none' = 'none';

  constructor() {
    this.reset();
  }

  reset() {
    this.owned = new Set<WeaponId>(['bat', 'pistol']);
    this.current = 'pistol';
    this.mag = { bat: 0, pistol: WEAPONS.pistol.mag, shotgun: 0 };
    this.reserve = { '9mm': 12, shell: 0 };
    this.cooldownT = this.swapT = this.reloadT = 0;
    this.reloading = false;
    this.sinceAttack = 99;
    this.lastAttack = 'none';
  }

  get def() {
    return WEAPONS[this.current];
  }

  has(id: WeaponId) {
    return this.owned.has(id);
  }

  list(): WeaponId[] {
    return WEAPON_ORDER.filter((w) => this.owned.has(w));
  }

  addWeapon(id: WeaponId, loaded = true) {
    this.owned.add(id);
    if (loaded && WEAPONS[id].ammo && this.mag[id] === 0) {
      const take = Math.min(WEAPONS[id].mag, this.reserve[WEAPONS[id].ammo!]);
      if (take > 0) { this.mag[id] = take; this.reserve[WEAPONS[id].ammo!] -= take; }
    }
  }

  addAmmo(type: AmmoType, n: number): number {
    const before = this.reserve[type];
    this.reserve[type] = Math.min(AMMO_CAP[type], before + n);
    return this.reserve[type] - before;
  }

  /** Rounds in the gun + reserve for the current weapon. */
  roundsLeft(id: WeaponId = this.current) {
    const w = WEAPONS[id];
    return w.ammo ? this.mag[id] + this.reserve[w.ammo] : Infinity;
  }

  /** Rounds across all owned firearms (director feature `ammo_total`). */
  totalRounds() {
    let n = 0;
    if (this.owned.has('pistol')) n += this.mag.pistol;
    if (this.owned.has('shotgun')) n += this.mag.shotgun;
    for (const a of ['9mm', 'shell'] as AmmoType[]) {
      const used = WEAPON_ORDER.some((w) => this.owned.has(w) && WEAPONS[w].ammo === a);
      if (used) n += this.reserve[a];
    }
    return n;
  }

  /** Best usable weapon: 0 bat, 0.5 pistol, 1 shotgun (director feature `weapon_power`). */
  power() {
    if (this.owned.has('shotgun') && this.roundsLeft('shotgun') > 0) return 1;
    if (this.owned.has('pistol') && this.roundsLeft('pistol') > 0) return 0.5;
    return 0;
  }

  switchTo(id: WeaponId): boolean {
    if (!this.owned.has(id) || id === this.current) return false;
    this.current = id;
    this.reloading = false;
    this.reloadT = 0;
    this.swapT = SWITCH_TIME;
    return true;
  }

  cycle(dir: 1 | -1): boolean {
    const list = this.list();
    const i = list.indexOf(this.current);
    return this.switchTo(list[(i + dir + list.length) % list.length]);
  }

  startReload(): boolean {
    const d = this.def;
    if (!d.ammo || this.reloading || this.swapT > 0) return false;
    if (this.mag[d.id] >= d.mag || this.reserve[d.ammo] <= 0) return false;
    this.reloading = true;
    this.reloadT = d.reload;
    return true;
  }

  update(dt: number) {
    this.cooldownT = Math.max(0, this.cooldownT - dt);
    this.swapT = Math.max(0, this.swapT - dt);
    this.sinceAttack += dt;
    if (!this.reloading) return;
    this.reloadT -= dt;
    if (this.reloadT > 0) return;
    const d = this.def;
    const ammo = d.ammo!;
    if (d.id === 'shotgun') {
      // One shell at a time, so a reload can be interrupted by firing.
      if (this.reserve[ammo] > 0 && this.mag.shotgun < d.mag) { this.mag.shotgun++; this.reserve[ammo]--; }
      if (this.reserve[ammo] > 0 && this.mag.shotgun < d.mag) this.reloadT = d.reload;
      else this.reloading = false;
    } else {
      const take = Math.min(d.mag - this.mag[d.id], this.reserve[ammo]);
      this.mag[d.id] += take;
      this.reserve[ammo] -= take;
      this.reloading = false;
    }
  }

  /**
   * Pull the trigger / swing. Handles ammo and cooldown, resolves hits against the zombies
   * and reports what happened. Returns kind 'none' if the weapon was not ready.
   */
  attack(ctx: ShotContext, zombies: ZombieSystem): AttackResult {
    const d = this.def;
    if (this.cooldownT > 0 || this.swapT > 0) return { ...NONE, weapon: d.id };
    if (this.reloading && !(d.id === 'shotgun' && this.mag.shotgun > 0)) return { ...NONE, weapon: d.id };
    if (d.melee) return this.swing(ctx, zombies);

    if (this.mag[d.id] <= 0) {
      // Dry fire: click, then start reloading if there is anything to load.
      this.cooldownT = 0.25;
      this.sinceAttack = 0;
      this.lastAttack = 'dry';
      this.startReload();
      return { ...NONE, kind: 'dry', weapon: d.id };
    }
    this.reloading = false;
    this.mag[d.id]--;
    this.cooldownT = d.cooldown;
    this.sinceAttack = 0;
    this.lastAttack = 'shot';

    let hit = false, headshot = false, kills = 0, damage = 0;
    let end: AttackResult['endPoint'] = null;
    for (let i = 0; i < d.pellets; i++) {
      const dir = this.spreadDir(ctx, d.spread, d.pellets > 1 && i === 0 ? 0 : 1);
      const wall = ctx.wallDist(ctx.o, dir, d.range);
      const h = zombies.raycast(ctx.o, dir, Math.min(d.range, wall));
      const t = h ? h.dist : Math.min(d.range, wall);
      if (!end || h) end = { x: ctx.o.x + dir.x * t, y: ctx.o.y + dir.y * t, z: ctx.o.z + dir.z * t };
      if (!h) continue;
      hit = true;
      const dmg = d.damage * (h.headshot ? d.headMul : 1);
      damage += dmg;
      headshot ||= h.headshot;
      if (zombies.damage(h.zombie, dmg, { headshot: h.headshot, fromX: ctx.o.x, fromZ: ctx.o.z, knockback: d.knockback / d.pellets })) kills++;
    }
    // Auto-reload when the magazine just emptied.
    if (this.mag[d.id] === 0) this.startReload();
    return { kind: 'shot', weapon: d.id, hit, kills, headshot, damage, noise: d.noise, endPoint: end };
  }

  private swing(ctx: ShotContext, zombies: ZombieSystem): AttackResult {
    const d = this.def;
    this.cooldownT = d.cooldown;
    this.sinceAttack = 0;
    this.lastAttack = 'swing';
    const fx = ctx.dir.x, fz = ctx.dir.z;
    const fl = Math.hypot(fx, fz) || 1;
    const targets = zombies.meleeTargets(ctx.o.x, ctx.o.z, fx / fl, fz / fl, d.range, MELEE_ARC_COS).slice(0, 2);
    let kills = 0, damage = 0, headshot = false;
    for (const z of targets) {
      // Swinging at a wall-blocked zombie is already filtered by line of sight; pitch picks a headshot.
      const head = ctx.dir.y > 0.25;
      const dmg = d.damage * (head ? d.headMul : 1);
      damage += dmg;
      headshot ||= head;
      if (zombies.damage(z, dmg, { headshot: head, fromX: ctx.o.x, fromZ: ctx.o.z, knockback: d.knockback })) kills++;
    }
    const first = targets[0];
    return {
      kind: 'swing', weapon: d.id, hit: targets.length > 0, kills, headshot, damage,
      noise: targets.length ? d.noise + 4 : d.noise,
      endPoint: first ? { x: first.ai.x, y: 1.2, z: first.ai.z } : null,
    };
  }

  private spreadDir(ctx: ShotContext, spread: number, jitterScale: number) {
    if (spread <= 0 || jitterScale === 0) return ctx.dir;
    // Uniform in a disc.
    const r = Math.sqrt(ctx.rand()) * spread, a = ctx.rand() * Math.PI * 2;
    const rx = Math.cos(a) * r, ry = Math.sin(a) * r;
    const x = ctx.dir.x + ctx.right.x * rx + ctx.up.x * ry;
    const y = ctx.dir.y + ctx.right.y * rx + ctx.up.y * ry;
    const z = ctx.dir.z + ctx.right.z * rx + ctx.up.z * ry;
    const l = Math.hypot(x, y, z) || 1;
    return { x: x / l, y: y / l, z: z / l };
  }

  snapshot(): WeaponSnapshot {
    return { owned: this.list(), current: this.current, mag: { ...this.mag }, reserve: { ...this.reserve } };
  }

  restore(s: WeaponSnapshot, minReserve9mm = 12) {
    this.reset();
    this.owned = new Set(s.owned);
    this.owned.add('bat');
    this.mag = { ...this.mag, ...s.mag };
    this.reserve = { ...this.reserve, ...s.reserve };
    // Dying should not leave the player empty-handed.
    this.reserve['9mm'] = Math.max(this.reserve['9mm'], minReserve9mm);
    this.current = this.owned.has(s.current) ? s.current : 'pistol';
  }
}
