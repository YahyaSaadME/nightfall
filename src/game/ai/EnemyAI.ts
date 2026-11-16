import { toCell, type CollisionWorld, type DoorState } from '../level/Grid';
import type { BehaviourProfile } from './BehaviourProfile';
import type { Navigation, NavPoint } from './Navigation';

export type EnemyState = 'Patrol' | 'Investigate' | 'Search' | 'Chase' | 'Attack' | 'Recover';

/** What the stalker is allowed to read about the player. Perception decides what it actually knows. */
export interface PlayerView {
  x: number; z: number; vx: number; vz: number;
  crouched: boolean; sprinting: boolean;
  flashlightOn: boolean;
  /** Horizontal flashlight direction (normalised). */
  fdx: number; fdz: number;
  hiddenSpot: string | null;
  alive: boolean;
  /** 0..1 ambient light at the player's position. */
  lightLevel: number;
  invulnerable: boolean;
}

export interface AIDoor extends DoorState {
  requestOpen(fromX: number, fromZ: number): void;
}

export interface HideSpotInfo { id: string; x: number; z: number; frontX: number; frontZ: number }

export interface EnemyEvents {
  stateChanged?(from: EnemyState, to: EnemyState): void;
  spotted?(): void;
  attackWindup?(): void;
  attackHit?(damage: number): void;
  attackMissed?(): void;
  doorOpened?(door: AIDoor): void;
  lockerCheck?(spotId: string, found: boolean): void;
  footstep?(x: number, z: number, running: boolean): void;
}

export interface AIEnv {
  collision: CollisionWorld;
  nav: Navigation;
  profile: BehaviourProfile;
  rand: () => number;
  hideSpots: HideSpotInfo[];
  patrolPoints: NavPoint[];
  doorAt(cx: number, cz: number): AIDoor | undefined;
  lightLevel(x: number, z: number): number;
  events: EnemyEvents;
}

export const ENEMY_TUNING = {
  radius: 0.38,
  speed: { Patrol: 1.45, Investigate: 2.25, Search: 1.75, Chase: 3.95, Attack: 0, Recover: 0 } as Record<EnemyState, number>,
  sightRange: 12,
  chaseSightRange: 22,
  fovCos: Math.cos((65 * Math.PI) / 180),
  closeSense: 2.2,
  attackRange: 1.55,
  hitRange: 2.05,
  windup: 0.55,
  attackRecovery: 0.35,
  damage: 34,
  lockerDamage: 45,
  recoverTime: 1.7,
  lostSightTimeout: 5,
  searchTime: 16,
  searchRadius: 8,
  lockerCooldown: 30,
  perceptionInterval: 0.1,
  /** Whether it looks inside lockers (the stalker does; zombies are not that clever). */
  checkLockers: true,
};

export type EnemyTuning = typeof ENEMY_TUNING;
/** Per-instance overrides: zombies reuse this AI with different numbers. */
export type EnemyTuningOverride = Partial<Omit<EnemyTuning, 'speed'>> & { speed?: Partial<Record<EnemyState, number>> };

export class EnemyAI {
  x = 0;
  z = 0;
  /** Facing: forward = (sin(yaw), cos(yaw)). */
  yaw = 0;
  active = false;
  state: EnemyState = 'Patrol';
  stateTime = 0;
  /** 0..1 confidence that it has found the player. */
  detection = 0;
  visible = false;
  aggression = 0;
  /** Current movement speed (for animation). */
  moveSpeed = 0;
  attackTimer = 0;
  lockerTarget: HideSpotInfo | null = null;
  lockerTimer = 0;

  lastSeen: { x: number; z: number; vx: number; vz: number } | null = null;
  timeSinceSeen = Infinity;
  knownHideSpot: string | null = null;

  goal: NavPoint | null = null;
  path: NavPoint[] = [];
  pathIdx = 0;
  private repathTimer = 0;
  private perceptionAcc = 0;
  private idleTimer = 0;
  private searchCenter: NavPoint = { x: 0, z: 0 };
  private searchTimeLeft = 0;
  private lockerChecks = 0;
  private lockerCooldown = 0;
  private hitDone = false;
  private waitingDoor: AIDoor | null = null;
  private waitDoorTimer = 0;
  private stuckTimer = 0;
  private stuckCount = 0;
  private stuckRef = { x: 0, z: 0 };
  private recentPatrol: number[] = [];
  private stepPhase = 0;
  private prevHidden: string | null = null;
  private chaseTarget: NavPoint | null = null;

  /** Effective tuning for this instance. */
  readonly T: EnemyTuning;
  private recoverOverride: number | null = null;

  constructor(private readonly env: AIEnv, tuning: EnemyTuningOverride = {}) {
    this.T = { ...ENEMY_TUNING, ...tuning, speed: { ...ENEMY_TUNING.speed, ...tuning.speed } };
  }

  reset(x: number, z: number, active: boolean) {
    this.x = x;
    this.z = z;
    this.active = active;
    this.detection = 0;
    this.visible = false;
    this.lastSeen = null;
    this.timeSinceSeen = Infinity;
    this.knownHideSpot = null;
    this.lockerTarget = null;
    this.waitingDoor = null;
    this.aggression = 0;
    this.lockerCooldown = 10;
    this.prevHidden = null;
    this.setState('Patrol');
    this.pickPatrolPoint();
  }

  get forwardX() { return Math.sin(this.yaw); }
  get forwardZ() { return Math.cos(this.yaw); }

  // ---------------------------------------------------------------- state machine

  private setState(s: EnemyState) {
    const prev = this.state;
    this.state = s;
    this.stateTime = 0;
    this.idleTimer = 0;
    this.recoverOverride = null;
    if (prev !== s) this.env.events.stateChanged?.(prev, s);
  }

  private enterChase() {
    if (this.state !== 'Chase') this.env.events.spotted?.();
    this.setState('Chase');
    this.detection = 1;
    this.chaseTarget = null;
    this.lockerTarget = null;
  }

  private enterInvestigate(x: number, z: number) {
    const p = this.env.nav.nearestPassable(x, z);
    if (!p) return;
    this.setState('Investigate');
    this.setGoal(p);
  }

  private enterSearch(center: NavPoint) {
    this.setState('Search');
    this.searchCenter = { ...center };
    const s = this.env.profile.scores();
    this.searchTimeLeft = this.T.searchTime + this.aggression * 8 + s.hide * 4;
    this.lockerChecks = 0;
    this.goal = null;
    this.path = [];
    if (this.knownHideSpot && this.T.checkLockers) {
      // Valid evidence: it saw the player hide (or light leaking from a locker).
      const spot = this.env.hideSpots.find((h) => h.id === this.knownHideSpot);
      if (spot) this.beginLockerCheck(spot);
    } else {
      this.maybeCheckLocker(true);
    }
  }

  private enterPatrol() {
    this.setState('Patrol');
    this.knownHideSpot = null;
    this.pickPatrolPoint();
  }

  // ---------------------------------------------------------------- public inputs

  /**
   * A sound happened. Returns true if the stalker heard it.
   * radius = how far (metres) it carries in open space; walls dampen it.
   */
  hearNoise(x: number, z: number, radius: number, kind: 'step' | 'sprint' | 'door' | 'impact' | 'alarm' | 'light'): boolean {
    if (!this.active) return false;
    if (this.state === 'Chase' || this.state === 'Attack') return false;
    const d = Math.hypot(x - this.x, z - this.z);
    const los = this.env.collision.lineOfSight(this.x, this.z, x, z);
    let eff = radius * (los ? 1 : 0.55);
    if (kind === 'sprint') eff *= this.env.profile.sprintHearingMultiplier();
    if (d > eff) return false;
    const cell = this.env.collision.grid.index(toCell(x), toCell(z));
    this.env.profile.recordEvidence(cell, 0.5);
    if (kind === 'sprint') this.env.profile.recordNoise(cell);
    if (kind === 'alarm') this.aggression = 1;
    if (this.state === 'Recover') return true;
    // Sound only gives an approximate location.
    const jitter = kind === 'alarm' ? 0 : Math.min(2.5, d * 0.12);
    const r = this.env.rand;
    this.enterInvestigate(x + (r() - 0.5) * 2 * jitter, z + (r() - 0.5) * 2 * jitter);
    return true;
  }

  /** Hit by the player: flinch for `seconds` (interrupts an attack), then react to whoever hit it. */
  stagger(seconds: number) {
    if (!this.active) return;
    this.setState('Recover');
    this.recoverOverride = seconds;
    this.moveSpeed = 0;
  }

  /** Shot or struck by the player: it knows exactly where they are, whether or not it can see them. */
  provoke(x: number, z: number) {
    if (!this.active) return;
    this.lastSeen = { x, z, vx: 0, vz: 0 };
    this.timeSinceSeen = 0;
    this.detection = 1;
    if (this.state === 'Chase' || this.state === 'Attack' || this.state === 'Recover') return;
    this.enterChase();
  }

  // ---------------------------------------------------------------- update

  update(dt: number, p: PlayerView) {
    if (!this.active) return;
    this.stateTime += dt;
    this.lockerCooldown -= dt;
    this.timeSinceSeen += dt;

    this.perceptionAcc += dt;
    if (this.perceptionAcc >= this.T.perceptionInterval) {
      this.perceive(p, this.perceptionAcc);
      this.perceptionAcc = 0;
    }

    switch (this.state) {
      case 'Patrol': this.updatePatrol(dt); break;
      case 'Investigate': this.updateInvestigate(dt); break;
      case 'Search': this.updateSearch(dt, p); break;
      case 'Chase': this.updateChase(dt, p); break;
      case 'Attack': this.updateAttack(dt, p); break;
      case 'Recover': this.updateRecover(p); break;
    }
  }

  private perceive(p: PlayerView, dt: number) {
    const dx = p.x - this.x, dz = p.z - this.z;
    const d = Math.hypot(dx, dz) || 0.0001;
    const chasing = this.state === 'Chase' || this.state === 'Attack' || this.state === 'Recover';
    const sens = this.env.profile.lightSensitivity();
    let seen = false;
    let beam = false;
    let los: boolean | null = null;
    const hasLos = () => (los ??= this.env.collision.lineOfSight(this.x, this.z, p.x, p.z));

    if (p.alive && !p.hiddenSpot) {
      let range = this.T.sightRange * (p.flashlightOn ? 1.5 : 1) * (p.crouched ? 0.65 : 1) * (0.75 + 0.45 * p.lightLevel);
      if (chasing) range = Math.max(range, this.T.chaseSightRange);
      const facing = (this.forwardX * dx + this.forwardZ * dz) / d;
      const inFov = d < this.T.closeSense || facing > (chasing ? -0.3 : this.T.fovCos);
      if (d < range && inFov && hasLos()) seen = true;
    }
    // A lit flashlight is visible to the stalker when the beam falls on it, or leaks out of a locker.
    if (p.alive && p.flashlightOn && d < 20 * sens && hasLos()) {
      const inBeam = (p.fdx * -dx + p.fdz * -dz) / d > Math.cos(0.42);
      const facing = (this.forwardX * dx + this.forwardZ * dz) / d;
      const leak = !!p.hiddenSpot && d < 9 && facing > this.T.fovCos;
      beam = inBeam || leak;
    }

    if (seen) {
      const range = this.T.sightRange * 1.5;
      this.detection += dt * (0.55 + 2.4 * Math.max(0, 1 - d / range)) * (p.crouched ? 0.75 : 1);
      this.lastSeen = { x: p.x, z: p.z, vx: p.vx, vz: p.vz };
      this.timeSinceSeen = 0;
      this.env.profile.recordEvidence(this.env.collision.grid.index(toCell(p.x), toCell(p.z)), dt);
    } else if (beam) {
      this.detection = Math.min(0.9, this.detection + dt * 0.7 * sens);
    } else {
      this.detection = Math.max(0, this.detection - dt * (chasing ? 0.05 : 0.2));
    }
    this.detection = Math.min(1, this.detection);
    this.visible = seen;

    // Watched the player step into a hiding place (or saw light from inside one).
    if (this.T.checkLockers && p.hiddenSpot && p.hiddenSpot !== this.prevHidden && this.timeSinceSeen < 0.6) this.knownHideSpot = p.hiddenSpot;
    if (this.T.checkLockers && p.hiddenSpot && beam && !p.hiddenSpot.startsWith('_')) {
      const spot = this.env.hideSpots.find((h) => h.id === p.hiddenSpot);
      if (spot && Math.hypot(spot.x - this.x, spot.z - this.z) < 9) this.knownHideSpot = p.hiddenSpot;
    }
    this.prevHidden = p.hiddenSpot;

    if (chasing) return;
    if (seen && this.detection >= 1) {
      this.enterChase();
    } else if ((seen && this.detection > 0.3) || (beam && this.detection > 0.25)) {
      const tgt = this.state === 'Investigate' ? this.goal : null;
      if (!tgt || Math.hypot(tgt.x - p.x, tgt.z - p.z) > 3) {
        if (this.knownHideSpot && this.state !== 'Search') this.enterSearch({ x: p.x, z: p.z });
        else if (!this.knownHideSpot) this.enterInvestigate(p.x, p.z);
      }
    }
  }

  private updatePatrol(dt: number) {
    if (this.idleTimer > 0) {
      this.idleTimer -= dt;
      this.lookAround(dt);
      if (this.idleTimer <= 0) this.pickPatrolPoint();
      return;
    }
    if (this.follow(dt, this.T.speed.Patrol * (1 + this.env.profile.scores().sprint * 0.15))) {
      this.idleTimer = 1.5 + this.env.rand() * 2;
    }
  }

  private updateInvestigate(dt: number) {
    if (this.idleTimer > 0) {
      this.idleTimer -= dt;
      this.lookAround(dt);
      if (this.idleTimer <= 0) this.enterSearch(this.goal ?? { x: this.x, z: this.z });
      return;
    }
    const speed = this.T.speed.Investigate * (1 + this.aggression * 0.15);
    if (this.follow(dt, speed) || this.stateTime > 25) this.idleTimer = 1.6;
  }

  private updateSearch(dt: number, p: PlayerView) {
    this.searchTimeLeft -= dt;
    if (this.lockerTarget) {
      this.updateLockerCheck(dt, p);
      return;
    }
    if (this.searchTimeLeft <= 0) {
      this.enterPatrol();
      return;
    }
    if (this.idleTimer > 0) {
      this.idleTimer -= dt;
      this.lookAround(dt);
      if (this.idleTimer <= 0) {
        this.maybeCheckLocker(false);
        if (!this.lockerTarget) this.pickSearchPoint();
      }
      return;
    }
    if (!this.goal) {
      this.pickSearchPoint();
      return;
    }
    if (this.follow(dt, this.T.speed.Search * (1 + this.aggression * 0.2))) this.idleTimer = 0.9 + this.env.rand() * 1.4;
  }

  private updateChase(dt: number, p: PlayerView) {
    const speed = this.T.speed.Chase * (1 + this.aggression * 0.06);
    if (this.visible && this.lastSeen) {
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d < this.T.attackRange) {
        this.setState('Attack');
        this.attackTimer = 0;
        this.hitDone = false;
        this.moveSpeed = 0;
        this.env.events.attackWindup?.();
        return;
      }
      this.chaseTarget = null;
      this.repathTimer -= dt;
      if (this.repathTimer <= 0 || !this.goal) {
        this.setGoal({ x: p.x, z: p.z });
        this.repathTimer = 0.3;
      }
      // Close and in view: steer straight at the player instead of cell centres.
      if (d < 4 && this.env.nav.walkable({ x: this.x, z: this.z }, { x: p.x, z: p.z })) {
        this.path = [{ x: p.x, z: p.z }];
        this.pathIdx = 0;
      }
      this.follow(dt, speed);
      return;
    }
    // Lost sight: go to where it was last seen, plus a short prediction along its velocity.
    if (this.knownHideSpot) {
      this.enterSearch(this.lastSeen ?? { x: this.x, z: this.z });
      return;
    }
    if (!this.chaseTarget && this.lastSeen) {
      const ls = this.lastSeen;
      const k = 1.1;
      const px = ls.x + ls.vx * k, pz = ls.z + ls.vz * k;
      const predicted = this.env.collision.lineOfSight(ls.x, ls.z, px, pz) ? { x: px, z: pz } : { x: ls.x, z: ls.z };
      this.chaseTarget = this.env.nav.nearestPassable(predicted.x, predicted.z) ?? { x: ls.x, z: ls.z };
      this.setGoal(this.chaseTarget);
    }
    const arrived = this.follow(dt, speed * 0.92);
    if (arrived || this.timeSinceSeen > this.T.lostSightTimeout) {
      this.detection = 0.6;
      this.enterSearch(this.lastSeen ?? { x: this.x, z: this.z });
    }
  }

  private updateAttack(dt: number, p: PlayerView) {
    this.attackTimer += dt;
    this.faceTowards(p.x, p.z, dt, 9);
    if (!this.hitDone && this.attackTimer >= this.T.windup) {
      this.hitDone = true;
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      const canHit = p.alive && !p.hiddenSpot && !p.invulnerable && d < this.T.hitRange
        && this.env.collision.lineOfSight(this.x, this.z, p.x, p.z);
      if (canHit) this.env.events.attackHit?.(this.T.damage);
      else this.env.events.attackMissed?.();
    }
    if (this.attackTimer >= this.T.windup + this.T.attackRecovery) this.setState('Recover');
  }

  private updateRecover(p: PlayerView) {
    this.moveSpeed = 0;
    if (this.stateTime < (this.recoverOverride ?? this.T.recoverTime)) return;
    if (!p.alive) return;
    // A zombie that was just shot knows where the shot came from even without line of sight.
    const flinched = this.recoverOverride !== null && this.timeSinceSeen < 4;
    if (this.visible || flinched) this.enterChase();
    else this.enterSearch(this.lastSeen ?? { x: this.x, z: this.z });
  }

  // ---------------------------------------------------------------- hiding places

  private beginLockerCheck(spot: HideSpotInfo) {
    this.lockerTarget = spot;
    this.lockerTimer = 0;
    this.lockerChecks++;
    this.setGoal({ x: spot.frontX, z: spot.frontZ });
  }

  /** Decide whether a nearby hiding place is worth checking (needs a reason, respects cooldowns). */
  private maybeCheckLocker(onEnter: boolean) {
    if (!this.T.checkLockers || this.lockerChecks >= 2 || this.lockerCooldown > 0) return;
    const c = this.searchCenter;
    const near = this.env.hideSpots
      .map((h) => ({ h, d: Math.hypot(h.x - c.x, h.z - c.z) }))
      .filter((e) => e.d < 7 && this.env.collision.lineOfSight(c.x, c.z, e.h.frontX, e.h.frontZ))
      .sort((a, b) => a.d - b.d);
    if (!near.length) return;
    // A strong reason: the player vanished near here very recently.
    const vanishedHere = this.timeSinceSeen < 10 && !!this.lastSeen && Math.hypot(this.lastSeen.x - c.x, this.lastSeen.z - c.z) < 6;
    let chance = this.env.profile.lockerCheckChance();
    if (vanishedHere) chance += 0.25;
    if (!onEnter) chance *= 0.6;
    if (this.env.rand() < chance) this.beginLockerCheck(near[0].h);
  }

  private updateLockerCheck(dt: number, p: PlayerView) {
    const spot = this.lockerTarget!;
    if (this.lockerTimer === 0) {
      const arrived = this.follow(dt, this.T.speed.Search * 1.2);
      if (!arrived && this.stateTime < 20) return;
      this.lockerTimer = 0.0001;
    }
    this.moveSpeed = 0;
    this.faceTowards(spot.x, spot.z, dt, 6);
    this.lockerTimer += dt;
    if (this.lockerTimer < 1.1) return; // reaching for the handle
    const found = p.hiddenSpot === spot.id;
    this.env.events.lockerCheck?.(spot.id, found);
    this.lockerTarget = null;
    this.knownHideSpot = null;
    this.lockerCooldown = found ? 60 : this.T.lockerCooldown;
    if (found) {
      this.env.events.attackHit?.(this.T.lockerDamage);
      this.lastSeen = { x: spot.frontX, z: spot.frontZ, vx: 0, vz: 0 };
      this.detection = 1;
      this.setState('Recover');
    } else {
      this.idleTimer = 1.2;
    }
  }

  // ---------------------------------------------------------------- goal selection

  private pickPatrolPoint() {
    const pts = this.env.patrolPoints;
    const g = this.env.collision.grid;
    const cands: { i: number; w: number }[] = [];
    pts.forEach((p, i) => {
      if (this.recentPatrol.includes(i)) return;
      if (Math.hypot(p.x - this.x, p.z - this.z) < 4) return;
      if (!this.env.nav.passable(toCell(p.x), toCell(p.z))) return;
      const cells: number[] = [];
      const cx = toCell(p.x), cz = toCell(p.z);
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (g.inBounds(cx + dx, cz + dz)) cells.push(g.index(cx + dx, cz + dz));
      cands.push({ i, w: this.env.profile.routeWeight(cells) });
    });
    if (!cands.length) {
      this.recentPatrol = [];
      this.idleTimer = 1;
      return;
    }
    const total = cands.reduce((a, c) => a + c.w, 0);
    let t = this.env.rand() * total;
    let chosen = cands[cands.length - 1];
    for (const c of cands) { t -= c.w; if (t <= 0) { chosen = c; break; } }
    this.recentPatrol.push(chosen.i);
    if (this.recentPatrol.length > 4) this.recentPatrol.shift();
    if (!this.setGoal(pts[chosen.i])) this.idleTimer = 0.5;
  }

  private pickSearchPoint() {
    const dark = this.env.profile.darkPreference();
    const heat = this.env.profile.evidenceHeat;
    const g = this.env.collision.grid;
    const p = this.env.nav.randomPointNear(this.searchCenter.x, this.searchCenter.z, this.T.searchRadius, this.env.rand, (q) =>
      1 + dark * 2 * (1 - this.env.lightLevel(q.x, q.z)) + Math.min(2, heat[g.index(toCell(q.x), toCell(q.z))] ?? 0));
    if (!p || !this.setGoal(p)) this.idleTimer = 0.8;
  }

  // ---------------------------------------------------------------- movement

  private setGoal(p: NavPoint): boolean {
    const path = this.env.nav.findPath({ x: this.x, z: this.z }, p, { doorCost: this.env.profile.doorCost() });
    this.goal = { ...p };
    if (!path) {
      this.path = [];
      return false;
    }
    this.path = path;
    this.pathIdx = 0;
    this.stuckTimer = 0;
    this.stuckRef = { x: this.x, z: this.z };
    return true;
  }

  /** Follow the current path. Returns true once the end of the path is reached. */
  private follow(dt: number, speed: number): boolean {
    if (this.waitingDoor) {
      this.moveSpeed = 0;
      this.waitDoorTimer += dt;
      if (!this.waitingDoor.blocksMovement || this.waitDoorTimer > 2.5) this.waitingDoor = null;
      return false;
    }
    if (this.pathIdx >= this.path.length) {
      this.moveSpeed = 0;
      return true;
    }
    const target = this.path[this.pathIdx];
    const dx = target.x - this.x, dz = target.z - this.z;
    const dist = Math.hypot(dx, dz);
    const last = this.pathIdx === this.path.length - 1;
    if (dist < (last ? 0.3 : 0.55)) {
      this.pathIdx++;
      return this.pathIdx >= this.path.length;
    }
    // Open a closed door ahead.
    const ax = this.x + (dx / dist) * 1.0, az = this.z + (dz / dist) * 1.0;
    for (const [px, pz] of [[ax, az], [target.x, target.z]] as const) {
      const door = this.env.doorAt(toCell(px), toCell(pz));
      if (door && door.blocksMovement && !door.locked && door.kind !== 'exit') {
        door.requestOpen(this.x, this.z);
        this.env.events.doorOpened?.(door);
        this.waitingDoor = door;
        this.waitDoorTimer = 0;
        this.moveSpeed = 0;
        return false;
      }
    }
    const turnRate = this.state === 'Chase' ? 8 : 4;
    this.faceTowards(target.x, target.z, dt, turnRate);
    const desired = Math.atan2(dx, dz);
    const align = Math.max(0.25, Math.cos(angleDiff(desired, this.yaw)));
    const step = Math.min(dist, speed * align * dt);
    this.x += (dx / dist) * step;
    this.z += (dz / dist) * step;
    this.env.collision.resolveCircle(this, this.T.radius);
    this.moveSpeed = speed * align;
    this.stepPhase += (this.moveSpeed * dt) / (this.state === 'Chase' ? 1.5 : 1.1);
    if (this.stepPhase >= 1) {
      this.stepPhase -= 1;
      this.env.events.footstep?.(this.x, this.z, this.state === 'Chase');
    }
    // Stuck detection: re-plan if it is not making progress.
    this.stuckTimer += dt;
    if (this.stuckTimer > 1.5) {
      const moved = Math.hypot(this.x - this.stuckRef.x, this.z - this.stuckRef.z);
      this.stuckTimer = 0;
      this.stuckRef = { x: this.x, z: this.z };
      if (moved < 0.25 && this.goal) {
        this.stuckCount++;
        if (this.stuckCount > 3) {
          this.stuckCount = 0;
          this.path = [];
          this.pathIdx = 0;
          return true;
        }
        this.setGoal(this.goal);
      } else {
        this.stuckCount = 0;
      }
    }
    return false;
  }

  private faceTowards(x: number, z: number, dt: number, rate: number) {
    const desired = Math.atan2(x - this.x, z - this.z);
    const diff = angleDiff(desired, this.yaw);
    const maxTurn = rate * dt;
    this.yaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
  }

  private lookAround(dt: number) {
    this.moveSpeed = 0;
    this.yaw += Math.sin(this.stateTime * 1.3) * dt * 0.9;
  }
}

export function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
