/* Headless logic tests: run with `npm test`. */
declare const process: { exit(code: number): never };
import { Grid, CollisionWorld, toCell } from '../src/game/level/Grid';
import { DoorLogic } from '../src/game/level/DoorLogic';
import { allPropColliders } from '../src/game/level/PropLayout';
import {
  MAP, ITEM_SPAWNS, BATTERY_SPAWNS, HIDE_SPOTS, PATROL_POINTS, PLAYER_START, ENEMY_SPAWN, EXIT_DOOR_CELL,
} from '../src/game/level/LevelData';
import { Navigation } from '../src/game/ai/Navigation';
import { BehaviourProfile } from '../src/game/ai/BehaviourProfile';
import { EnemyAI, ENEMY_TUNING, type PlayerView, type EnemyEvents, type HideSpotInfo } from '../src/game/ai/EnemyAI';
import { ObjectiveManager } from '../src/game/systems/ObjectiveManager';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  âœ“ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  âœ— ${name}\n      ${(e as Error).message}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWorld() {
  const grid = new Grid();
  const doors = new Map<string, DoorLogic>();
  grid.forEachCell((cx, cz) => {
    const k = grid.doorKind(cx, cz);
    if (k) doors.set(`${cx},${cz}`, new DoorLogic(cx, cz, k, grid.passAxis(cx, cz)));
  });
  const doorAt = (cx: number, cz: number) => doors.get(`${cx},${cz}`);
  const collision = new CollisionWorld(grid, allPropColliders(), doorAt);
  const nav = new Navigation(collision);
  return { grid, doors, doorAt, collision, nav };
}

function hideInfos(): HideSpotInfo[] {
  return HIDE_SPOTS.map((h) => ({ id: h.id, x: h.x, z: h.z, frontX: h.x - Math.sin(h.yaw) * 0.9, frontZ: h.z - Math.cos(h.yaw) * 0.9 }));
}

function makeEnemy(w = makeWorld(), seed = 1) {
  const profile = new BehaviourProfile(w.grid.w * w.grid.h);
  const log: string[] = [];
  const hits: number[] = [];
  const lockers: [string, boolean][] = [];
  const events: EnemyEvents = {
    stateChanged: (a, b) => log.push(`${a}->${b}`),
    attackHit: (d) => hits.push(d),
    lockerCheck: (id, found) => lockers.push([id, found]),
  };
  const ai = new EnemyAI({
    collision: w.collision, nav: w.nav, profile, rand: mulberry(seed), hideSpots: hideInfos(),
    patrolPoints: PATROL_POINTS, doorAt: w.doorAt, lightLevel: () => 0.2, events,
  });
  const step = (p: PlayerView) => {
    ai.update(1 / 60, p);
    for (const d of w.doors.values()) d.update(1 / 60);
  };
  return { w, ai, profile, log, hits, lockers, step };
}

function player(x: number, z: number, extra: Partial<PlayerView> = {}): PlayerView {
  return {
    x, z, vx: 0, vz: 0, crouched: false, sprinting: false, flashlightOn: false, fdx: 0, fdz: -1,
    hiddenSpot: null, alive: true, lightLevel: 0.2, invulnerable: false, ...extra,
  };
}

function unlockAll(w: ReturnType<typeof makeWorld>) {
  for (const d of w.doors.values()) if (d.kind !== 'exit') d.locked = false;
}

console.log('\nLevel & collision');

test('map rows are rectangular and enclosed', () => {
  assert(MAP.every((r) => r.length === MAP[0].length), 'row lengths differ');
  assert([...MAP[0]].every((c) => c === '#'), 'top row open');
  assert([...MAP[MAP.length - 1]].every((c) => c === '#' || c === 'X'), 'bottom row open');
  assert(MAP.every((r) => r[0] === '#' && r[r.length - 1] === '#'), 'side open');
});

test('every door sits between two walls', () => {
  const { grid } = makeWorld();
  grid.forEachCell((cx, cz) => {
    if (!grid.doorKind(cx, cz)) return;
    const ns = grid.isWall(cx, cz - 1) && grid.isWall(cx, cz + 1);
    const ew = grid.isWall(cx - 1, cz) && grid.isWall(cx + 1, cz);
    assert(ns || ew, `door ${cx},${cz} is not in a wall`);
  });
});

test('spawn, items, lockers and patrol points are not inside geometry', () => {
  const { collision } = makeWorld();
  assert(collision.pointFree(PLAYER_START.x, PLAYER_START.z, 0.3), 'player start blocked');
  assert(collision.pointFree(ENEMY_SPAWN.x, ENEMY_SPAWN.z, 0.38), 'enemy spawn blocked');
  for (const h of hideInfos()) assert(collision.pointFree(h.frontX, h.frontZ, 0.3), `locker front blocked ${h.id}`);
  for (const p of PATROL_POINTS) assert(collision.pointFree(p.x, p.z, 0.38), `patrol point blocked ${p.x},${p.z}`);
});

test('player cannot walk through walls', () => {
  const { collision } = makeWorld();
  const p = { x: PLAYER_START.x, z: PLAYER_START.z };
  for (let i = 0; i < 600; i++) { p.x -= 0.05; collision.resolveCircle(p, 0.3); }
  assert(p.x >= 2 + 0.3 - 1e-6, `went into the west wall: x=${p.x.toFixed(3)}`);
  for (let i = 0; i < 600; i++) { p.z += 0.05; collision.resolveCircle(p, 0.3); }
  assert(p.z <= 36 - 0.3 + 1e-6, `went through the south wall: z=${p.z.toFixed(3)}`);
});

test('closed doors block movement and sight; open doors do not', () => {
  const w = makeWorld();
  const door = w.doorAt(8, 3)!; // storage <-> corridor
  const p = { x: 19, z: 7 };
  for (let i = 0; i < 200; i++) { p.x -= 0.05; w.collision.resolveCircle(p, 0.3); }
  assert(p.x > 17, `walked through closed door: x=${p.x.toFixed(2)}`);
  assert(!w.collision.lineOfSight(19, 7, 12, 7), 'saw through a closed door');
  door.requestOpen(19, 7);
  for (let i = 0; i < 60; i++) door.update(1 / 60);
  assert(w.collision.lineOfSight(19, 7, 12, 7), 'cannot see through open door');
  for (let i = 0; i < 300; i++) { p.x -= 0.05; w.collision.resolveCircle(p, 0.3); }
  assert(p.x < 15, `blocked by open door: x=${p.x.toFixed(2)}`);
});

test('walls block line of sight', () => {
  const { collision } = makeWorld();
  assert(!collision.lineOfSight(8, 7, 8, 20), 'saw from storage into maintenance through a wall');
  assert(collision.lineOfSight(20, 4, 20, 30), 'corridor to reception should be visible');
});

console.log('\nProgression gating');

test('fuse and fuse box are reachable from the start; keycard and exit key are not', () => {
  const { nav } = makeWorld();
  const s = { x: PLAYER_START.x, z: PLAYER_START.z };
  assert(nav.findPath(s, { x: ITEM_SPAWNS.fuse.x + 0.6, z: ITEM_SPAWNS.fuse.z }), 'fuse unreachable');
  assert(nav.findPath(s, { x: 3, z: 19 }), 'fuse box unreachable');
  assert(!nav.findPath(s, { x: 29.5, z: 16 }), 'keycard reachable before power');
  assert(!nav.findPath(s, { x: 45, z: 18 }), 'office reachable before keycard');
});

test('power unlocks the nursesâ€™ station, keycard unlocks the restricted wing', () => {
  const w = makeWorld();
  const s = { x: PLAYER_START.x, z: PLAYER_START.z };
  for (const d of w.doors.values()) if (d.kind === 'power') d.locked = false;
  assert(w.nav.findPath(s, { x: 29.5, z: 16 }), 'keycard unreachable after power');
  assert(!w.nav.findPath(s, { x: 45, z: 18 }), 'office reachable before keycard');
  for (const d of w.doors.values()) if (d.kind === 'keycard') d.locked = false;
  assert(w.nav.findPath(s, { x: 45, z: 18 }), 'office unreachable after keycard');
  const exit = w.doorAt(EXIT_DOOR_CELL.cx, EXIT_DOOR_CELL.cz)!;
  assert(exit.kind === 'exit' && exit.locked, 'exit should start locked');
});

test('every battery and hiding place is reachable once all doors are unlocked', () => {
  const w = makeWorld();
  unlockAll(w);
  const s = { x: PLAYER_START.x, z: PLAYER_START.z };
  for (const b of BATTERY_SPAWNS) assert(w.nav.findPath(s, { x: b.x, z: b.z }), `battery ${b.id} unreachable`);
  for (const h of hideInfos()) assert(w.nav.findPath(s, { x: h.frontX, z: h.frontZ }), `locker ${h.id} unreachable`);
});

console.log('\nStalker AI');

test('patrols between points without teleporting', () => {
  const { ai, log, step } = makeEnemy();
  ai.reset(ENEMY_SPAWN.x, ENEMY_SPAWN.z, true);
  let maxStep = 0;
  let px = ai.x, pz = ai.z;
  const far = player(48, 3); // unreachable/unseen
  let travelled = 0;
  for (let i = 0; i < 60 * 40; i++) {
    step(far);
    const moved = Math.hypot(ai.x - px, ai.z - pz);
    maxStep = Math.max(maxStep, moved);
    travelled += moved;
    px = ai.x; pz = ai.z;
  }
  assert(travelled > 15, `barely moved (${travelled.toFixed(1)}m)`);
  assert(maxStep < (ENEMY_TUNING.speed.Chase * 1.2) / 60 + 0.05, `moved too far in one frame: ${maxStep}`);
  assert((ai.state as string) === 'Patrol' || (ai.state as string) === 'Investigate' || (ai.state as string) === 'Search', `unexpected state ${ai.state}; ${log.join(',')}`);
});

test('hears a door noise and investigates, then searches', () => {
  const { ai, step } = makeEnemy();
  ai.reset(20, 20, true);
  assert(ai.hearNoise(20, 8, 13, 'door'), 'did not hear door 12m down an open corridor');
  assert((ai.state as string) === 'Investigate', `expected Investigate, got ${ai.state}`);
  for (let i = 0; i < 60 * 12 && (ai.state as string) === 'Investigate'; i++) step(player(48, 3));
  assert((ai.state as string) === 'Search', `expected Search after investigating, got ${ai.state}`);
});

test('quiet noises behind walls are not heard', () => {
  const { ai } = makeEnemy();
  ai.reset(8, 7, true); // storage
  assert(!ai.hearNoise(8, 20, 5, 'step'), 'heard a footstep through a wall 13m away');
});

test('detects a visible player and chases, then attacks in range', () => {
  const { ai, hits, step } = makeEnemy();
  ai.reset(20, 6, true);
  ai.yaw = 0; // facing +Z (down the corridor)
  const p = player(20, 14, { flashlightOn: true, fdz: -1 });
  let chased = false;
  for (let i = 0; i < 60 * 10; i++) {
    step(p);
    if ((ai.state as string) === 'Chase') chased = true;
    if (hits.length) break;
  }
  assert(chased, `never chased (state ${ai.state}, detection ${ai.detection.toFixed(2)})`);
  assert(hits.length === 1 && hits[0] === ENEMY_TUNING.damage, `expected one hit, got ${hits.join(',')}`);
});

test('does not see the player through walls', () => {
  const { ai, step, w } = makeEnemy();
  ai.reset(8, 7, true); // storage, maintenance is behind the wall
  ai.yaw = 0;
  const p = player(8, 18, { flashlightOn: true, fdz: -1 });
  for (let i = 0; i < 60 * 30; i++) {
    const before = ai.detection;
    step(p);
    // It may walk around and legitimately see the player; it must never gain detection without LOS.
    if (!w.collision.lineOfSight(ai.x, ai.z, p.x, p.z)) {
      assert(ai.detection <= before + 1e-9, `detection rose without line of sight at ${ai.x.toFixed(1)},${ai.z.toFixed(1)}`);
    }
  }
  const fresh = makeEnemy();
  fresh.ai.reset(5, 7, true);
  fresh.ai.yaw = 0;
  const q = player(5, 18, { flashlightOn: true, fdz: -1 });
  for (let i = 0; i < 60 * 0.5; i++) fresh.step(q);
  assert(fresh.ai.detection === 0 && (fresh.ai.state as string) !== 'Chase', 'detected through a wall');
});

test('a hidden player who was not seen hiding is not found by sight', () => {
  const { ai, step } = makeEnemy();
  ai.reset(30, 8, true);
  const h = hideInfos().find((s) => s.id === 'locker-staff-1')!;
  const p = player(h.x, h.z, { hiddenSpot: h.id });
  for (let i = 0; i < 60 * 3; i++) step(p);
  assert(ai.detection === 0 && (ai.state as string) !== 'Chase', 'detected a hidden player');
  assert(ai.knownHideSpot === null, 'knows the hiding spot without evidence');
});

test('seeing the player enter a locker leads to that locker being checked', () => {
  const { ai, lockers, hits, step } = makeEnemy();
  const h = hideInfos().find((s) => s.id === 'locker-staff-1')!;
  ai.reset(30, 8, true);
  ai.yaw = Math.atan2(h.frontX - 30, h.frontZ - 8);
  const p = player(h.frontX, h.frontZ, { vx: 0, vz: 0 });
  for (let i = 0; i < 60 * 3 && (ai.state as string) !== 'Chase'; i++) step(p);
  assert((ai.state as string) === 'Chase', `should chase a visible player (state ${ai.state})`);
  p.hiddenSpot = h.id; // player steps into the locker while watched
  for (let i = 0; i < 60 * 15 && !lockers.length; i++) step(p);
  assert(lockers.length === 1 && lockers[0][0] === h.id && lockers[0][1], `locker not checked: ${JSON.stringify(lockers)}`);
  assert(hits[hits.length - 1] === ENEMY_TUNING.lockerDamage, 'player not dragged out');
});

test('loses the player, searches, and eventually returns to patrol', () => {
  const { ai, log, step } = makeEnemy();
  ai.reset(20, 6, true);
  ai.yaw = 0;
  const p = player(20, 12);
  for (let i = 0; i < 60 * 4 && (ai.state as string) !== 'Chase'; i++) step(p);
  assert((ai.state as string) === 'Chase', 'no chase');
  // Player vanishes behind a closed door far away.
  const gone = player(29, 7);
  let sawSearch = false;
  for (let i = 0; i < 60 * 60; i++) {
    step(gone);
    if ((ai.state as string) === 'Search') sawSearch = true;
    if ((ai.state as string) === 'Patrol' && sawSearch) break;
  }
  assert(sawSearch, `never searched: ${log.join(',')}`);
  assert((ai.state as string) === 'Patrol', `did not return to patrol: ${ai.state}`);
});

test('cannot path through locked doors', () => {
  const { ai } = makeEnemy();
  ai.reset(20, 30, true);
  const w = makeWorld();
  assert(!w.nav.findPath({ x: 20, z: 30 }, { x: 29.5, z: 20 }), 'path into the locked nurses station');
});

console.log('\nAdaptive behaviour');

test('frequent hiding raises locker-check chance gradually and within limits', () => {
  const prof = new BehaviourProfile(500);
  const before = prof.lockerCheckChance();
  prof.onHide();
  prof.update(1, { cellIndex: 1, moving: false, sprinting: false, flashlightOn: false, hidden: true });
  const immediate = prof.lockerCheckChance();
  assert(immediate - before < 0.05, 'adapted too quickly to a single hide');
  for (let t = 0; t < 400; t++) {
    if (t % 20 === 0) prof.onHide();
    prof.update(1, { cellIndex: t % 7, moving: true, sprinting: false, flashlightOn: false, hidden: false });
  }
  const later = prof.lockerCheckChance();
  assert(later > before + 0.15, `did not adapt: ${before.toFixed(2)} -> ${later.toFixed(2)}`);
  assert(later <= prof.cfg.maxLockerCheckChance + 1e-9, 'exceeded the fairness cap');
});

test('frequent sprinting increases hearing range and door shortcuts', () => {
  const prof = new BehaviourProfile(500);
  const h0 = prof.sprintHearingMultiplier(), d0 = prof.doorCost();
  for (let t = 0; t < 400; t++) prof.update(1, { cellIndex: t % 50, moving: true, sprinting: true, flashlightOn: true, hidden: false });
  assert(prof.sprintHearingMultiplier() > h0 + 0.2, 'hearing did not adapt');
  assert(prof.doorCost() < d0 - 0.8, 'door cost did not adapt');
  assert(prof.lightSensitivity() > 1.3, 'light sensitivity did not adapt');
});

test('repeated routes are detected and weight patrols only where there is evidence', () => {
  const prof = new BehaviourProfile(500);
  for (let lap = 0; lap < 40; lap++) for (const c of [10, 11, 12, 13, 14]) prof.update(2, { cellIndex: c, moving: true, sprinting: false, flashlightOn: false, hidden: false });
  assert(prof.scores().route > 0.3, `route score too low: ${prof.scores().route}`);
  assert(prof.routeWeight([10, 11]) === 1, 'weighted a route without stalker evidence');
  prof.recordEvidence(11, 1);
  assert(prof.routeWeight([10, 11]) > 1.5, 'evidence did not weight the route');
});

test('the stalker hears a sprinting player further away once it has adapted', () => {
  const a = makeEnemy();
  a.ai.reset(20, 4, true);
  const heardBefore = a.ai.hearNoise(20, 17.5, 11, 'sprint'); // 13.5m: out of range
  for (let t = 0; t < 400; t++) a.profile.update(1, { cellIndex: 5, moving: true, sprinting: true, flashlightOn: false, hidden: false });
  a.ai.reset(20, 4, true);
  const heardAfter = a.ai.hearNoise(20, 17.5, 11, 'sprint');
  assert(!heardBefore && heardAfter, `before=${heardBefore} after=${heardAfter}`);
});

console.log('\nObjectives');

test('objectives progress in order and later completion covers earlier steps', () => {
  const o = new ObjectiveManager();
  assert((o.current?.id as string) === 'explore', 'wrong first objective');
  assert(o.complete('explore') && (o.current?.id as string) === 'findFuse', 'explore did not advance');
  assert(o.complete('restorePower'), 'restorePower should complete');
  assert(o.isDone('findFuse') && (o.current?.id as string) === 'keycard', 'skipped objectives not marked done');
  assert(!o.complete('findFuse'), 'regressed to an earlier objective');
  o.complete('escape');
  assert(o.finished, 'not finished after escape');
});

test('toCell helper', () => {
  assert(toCell(0) === 0 && toCell(1.99) === 0 && toCell(2) === 1, 'toCell');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
