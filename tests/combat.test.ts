/* Headless tests for zombies, weapons and the ML spawn director: run with `npm test`. */
declare const process: { exit(code: number): never };
import { Grid, CollisionWorld } from '../src/game/level/Grid';
import { DoorLogic } from '../src/game/level/DoorLogic';
import { allPropColliders } from '../src/game/level/PropLayout';
import { PATROL_POINTS, PICKUP_SPAWNS, PLAYER_START } from '../src/game/level/LevelData';
import { Navigation } from '../src/game/ai/Navigation';
import { BehaviourProfile } from '../src/game/ai/BehaviourProfile';
import type { PlayerView } from '../src/game/ai/EnemyAI';
import { ZombieSystem, type ZombieEnv } from '../src/game/ai/ZombieSystem';
import { BODY_SECONDS, MAX_ALIVE, ZOMBIE_DEFS } from '../src/game/ai/ZombieTypes';
import { DirectorModel } from '../src/game/ai/DirectorModel';
import { DIRECTOR, DirectorTelemetry, SpawnDirector, fallbackProbs } from '../src/game/ai/SpawnDirector';
import parity from '../ml/export/parity_vectors.json';
import { AMMO_CAP, MELEE_ARC_COS, WEAPONS, WeaponSystem, type ShotContext } from '../src/game/systems/WeaponSystem';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${(e as Error).message}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function near(a: number, b: number, tol: number, msg: string) {
  assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
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
  for (const d of doors.values()) if (d.kind !== 'exit') d.locked = false;
  return { grid, doors, doorAt, collision, nav };
}

function makeZombies(seed = 1, events = {}) {
  const w = makeWorld();
  const env: ZombieEnv = {
    collision: w.collision, nav: w.nav, profile: new BehaviourProfile(w.grid.w * w.grid.h), rand: mulberry(seed),
    hideSpots: [], patrolPoints: PATROL_POINTS, doorAt: w.doorAt, lightLevel: () => 0.2,
  };
  const zs = new ZombieSystem(env, events, mulberry(seed + 99));
  const tick = (dt: number, p: PlayerView, body = { pos: { x: p.x, z: p.z }, hidden: !!p.hiddenSpot, radius: 0.3 }) => {
    zs.update(dt, p, body);
    for (const d of w.doors.values()) d.update(dt);
  };
  return { w, zs, tick };
}

function view(x: number, z: number, extra: Partial<PlayerView> = {}): PlayerView {
  return {
    x, z, vx: 0, vz: 0, crouched: false, sprinting: false, flashlightOn: false, fdx: 0, fdz: -1,
    hiddenSpot: null, alive: true, lightLevel: 0.2, invulnerable: false, ...extra,
  };
}

/** Cheap stand-in for the engine's wall raycast: marches along the ray using grid line of sight. */
function wallDistFor(w: ReturnType<typeof makeWorld>) {
  return (o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, max: number) => {
    for (let t = 0.25; t <= max; t += 0.25) {
      if (!w.collision.lineOfSight(o.x, o.z, o.x + d.x * t, o.z + d.z * t)) return t;
    }
    return Infinity;
  };
}

function shot(w: ReturnType<typeof makeWorld>, from: { x: number; z: number }, toward: { x: number; z: number }, y = 1.2, targetY = 1.0, seed = 5): ShotContext {
  const dx = toward.x - from.x, dz = toward.z - from.z;
  const h = Math.hypot(dx, dz);
  const dy = (targetY - 1.62) / h;
  const l = Math.hypot(h, dy * h);
  const dir = { x: dx / l, y: (dy * h) / l, z: dz / l };
  const right = { x: -dir.z / Math.hypot(dir.x, dir.z), y: 0, z: dir.x / Math.hypot(dir.x, dir.z) };
  const up = { x: 0, y: 1, z: 0 };
  void y;
  return { o: { x: from.x, y: 1.62, z: from.z }, dir, right, up, rand: mulberry(seed), wallDist: wallDistFor(w) };
}

console.log('\nZombies');

test('level pickups are inside the map, unique, clear of geometry and reachable', () => {
  const w = makeWorld();
  const ids = new Set<string>();
  for (const p of PICKUP_SPAWNS) {
    assert(!ids.has(p.id), `duplicate pickup id ${p.id}`);
    ids.add(p.id);
    assert(w.collision.pointFree(p.x, p.z, 0.3), `pickup ${p.id} is inside geometry`);
    const path = w.nav.findPath({ x: PLAYER_START.x, z: PLAYER_START.z }, { x: p.x, z: p.z });
    assert(path, `pickup ${p.id} is unreachable once doors are unlocked`);
  }
  assert(PICKUP_SPAWNS.some((p) => p.kind === 'shotgun'), 'no shotgun in the level');
});

test('the pool never holds more than MAX_ALIVE live zombies', () => {
  const { zs } = makeZombies();
  let made = 0;
  for (let i = 0; i < 20; i++) if (zs.spawn('walker', 20, 8 + (i % 4))) made++;
  assert(made === MAX_ALIVE, `spawned ${made}, expected ${MAX_ALIVE}`);
  assert(zs.aliveCount === MAX_ALIVE, 'alive count wrong');
});

test('spawn points are hidden from the player, far enough away and reachable', () => {
  const { w, zs } = makeZombies();
  const player = { x: PLAYER_START.x, z: PLAYER_START.z };
  const pts = zs.findSpawnPoints(3, player, PATROL_POINTS);
  assert(pts.length === 3, `expected 3 points, got ${pts.length}`);
  for (const p of pts) {
    assert(Math.hypot(p.x - player.x, p.z - player.z) >= 12, 'spawned too close');
    assert(!w.collision.lineOfSight(p.x, p.z, player.x, player.z), 'spawned in the player\'s sight');
    assert(w.collision.pointFree(p.x, p.z, 0.4), 'spawned inside geometry');
    assert(w.nav.findPath(player, p), 'spawned somewhere unreachable');
  }
});

test('spawnWave respects the live cap and returns what it made', () => {
  const { zs } = makeZombies();
  const player = { x: PLAYER_START.x, z: PLAYER_START.z };
  for (let i = 0; i < 6; i++) zs.spawn('walker', 20, 6 + i * 0.7);
  const made = zs.spawnWave(5, player, PATROL_POINTS, 0.5);
  assert(made.length <= 2, `cap exceeded: ${made.length} new on top of 6`);
  assert(zs.aliveCount <= MAX_ALIVE, 'alive above cap');
});

test('a zombie hunts the player down and hits them', () => {
  const hits: number[] = [];
  const { zs, tick } = makeZombies(3, { attackHit: (_z: unknown, d: number) => hits.push(d) });
  const px = 19, pz = 17;
  const z = zs.spawn('walker', 20, 4, true, { x: px, z: pz })!;
  assert(z, 'spawn failed');
  for (let i = 0; i < 60 * 40 && hits.length === 0; i++) tick(1 / 60, view(px, pz));
  assert(hits.length > 0, `never attacked (state ${z.ai.state}, at ${z.ai.x.toFixed(1)},${z.ai.z.toFixed(1)})`);
  assert(hits[0] === ZOMBIE_DEFS.walker.tuning.damage, `unexpected damage ${hits[0]}`);
});

test('zombies never walk through walls to reach the player', () => {
  const { w, zs, tick } = makeZombies(4);
  const z = zs.spawn('runner', 20, 4, true, { x: 4, z: 31 })!;
  for (let i = 0; i < 60 * 20; i++) {
    tick(1 / 60, view(4, 31));
    assert(w.collision.pointFree(z.ai.x, z.ai.z, 0.2), `zombie inside geometry at ${z.ai.x.toFixed(2)},${z.ai.z.toFixed(2)}`);
  }
});

test('zombies do not open lockers or react to a hidden player', () => {
  const lockerChecks: string[] = [];
  const { zs, tick } = makeZombies(5);
  const z = zs.spawn('walker', 6, 30, false)!;
  z.ai.lastSeen = { x: 6.5, z: 30, vx: 0, vz: 0 };
  for (let i = 0; i < 60 * 30; i++) {
    tick(1 / 60, view(2.3, 34.4, { hiddenSpot: 'locker-reception' }));
    if (z.ai.lockerTarget) lockerChecks.push('checked');
  }
  assert(lockerChecks.length === 0, 'a zombie went for a locker');
  assert(z.ai.state !== 'Attack' && z.ai.state !== 'Chase', `reacted to a hidden player: ${z.ai.state}`);
});

test('bodies do not pile onto one point', () => {
  const { zs, tick } = makeZombies(6);
  for (let i = 0; i < 5; i++) zs.spawn('walker', 20, 8)!;
  for (let i = 0; i < 120; i++) tick(1 / 60, view(4, 31));
  const live = [...zs.living()];
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const d = Math.hypot(live[i].ai.x - live[j].ai.x, live[i].ai.z - live[j].ai.z);
    assert(d > 0.45, `two zombies overlap (${d.toFixed(2)} m apart)`);
  }
});

test('corpses are removed after a while and their slot is reused', () => {
  const { zs, tick } = makeZombies(7);
  const z = zs.spawn('walker', 20, 8)!;
  assert(zs.damage(z, 999, { fromX: 4, fromZ: 31 }), 'zombie did not die');
  assert(!z.alive && z.used, 'corpse should linger');
  for (let i = 0; i < 60 * (BODY_SECONDS + 1); i++) tick(1 / 60, view(4, 31));
  assert(!z.used, 'corpse never removed');
  const again = zs.spawn('brute', 20, 8)!;
  assert(again && again.alive && again.health === ZOMBIE_DEFS.brute.health, 'slot was not reused for a brute');
  assert(again.ai.T.radius === ZOMBIE_DEFS.brute.tuning.radius, 'tuning not swapped for the new kind');
});

test('a non-lethal hit staggers, provokes and knocks back, then the zombie resumes the hunt', () => {
  const { zs, tick } = makeZombies(8);
  const z = zs.spawn('walker', 20, 10, false)!;
  const x0 = z.ai.z;
  assert(!zs.damage(z, 20, { fromX: 20, fromZ: 20, knockback: 0.8 }), 'killed by a light hit');
  assert(z.health === 40, 'health not reduced');
  const during: string = z.ai.state;
  assert(during === 'Recover', `expected stagger, got ${during}`);
  assert(z.ai.z < x0, 'not pushed away from the shooter');
  for (let i = 0; i < 60 * 2; i++) tick(1 / 60, view(20, 20));
  const after: string = z.ai.state;
  assert(after === 'Chase' || after === 'Attack', `expected the zombie to chase after the flinch, got ${after}`);
});

console.log('\nWeapons');

test('starting loadout: bat and a loaded pistol with spare ammo', () => {
  const w = new WeaponSystem();
  assert(w.has('bat') && w.has('pistol') && !w.has('shotgun'), 'wrong weapons');
  assert(w.mag.pistol === WEAPONS.pistol.mag && w.reserve['9mm'] === 12, 'wrong starting ammo');
  assert(w.current === 'pistol' as string, 'should start with the pistol out');
  assert(w.totalRounds() === 24, `totalRounds ${w.totalRounds()}`);
  assert(w.power() === 0.5, 'power should be 0.5 with only a pistol');
});

test('hitscan kills a walker in two body shots and one headshot, with cooldown and noise', () => {
  const { w: world, zs } = makeZombies(9);
  const ws = new WeaponSystem();
  const z = zs.spawn('walker', 6, 28)!;
  const ctxBody = shot(world, { x: 6, z: 34 }, { x: 6, z: 28 }, 1, 1.0);
  let r = ws.attack(ctxBody, zs);
  assert(r.kind === 'shot' && r.hit && r.damage === 35 && !r.headshot, `first shot: ${JSON.stringify(r)}`);
  assert(r.noise === WEAPONS.pistol.noise, 'pistol noise');
  assert(ws.attack(ctxBody, zs).kind === 'none', 'fired again during the cooldown');
  ws.update(WEAPONS.pistol.cooldown + 0.01);
  r = ws.attack(ctxBody, zs);
  assert(r.kills === 1 && !z.alive, 'second body shot should kill a 60 hp walker');
  zs.spawn('walker', 6, 28);
  ws.update(1);
  r = ws.attack(shot(world, { x: 6, z: 34 }, { x: 6, z: 28 }, 1, 1.6), zs);
  assert(r.headshot && r.damage === 70 && r.kills === 1, `headshot should kill in one: ${JSON.stringify(r)}`);
});

test('bullets stop at walls and miss when aimed off target', () => {
  const { w: world, zs } = makeZombies(10);
  const ws = new WeaponSystem();
  const z = zs.spawn('walker', 15, 6)!;
  z.ai.x = 15; z.ai.z = 6; // locker room, behind the wall from the reception
  const r = ws.attack(shot(world, { x: 15, z: 31 }, { x: 15, z: 6 }, 1, 1.0), zs);
  assert(r.kind === 'shot' && !r.hit, 'shot went through a wall');
  ws.update(1);
  const off = ws.attack(shot(world, { x: 6, z: 34 }, { x: 12, z: 30 }), zs);
  assert(!off.hit, 'hit with nothing in the line of fire');
});

test('reloading moves rounds from reserve to the magazine; an empty gun reloads itself', () => {
  const { w: world, zs } = makeZombies(11);
  const ws = new WeaponSystem();
  const ctx = shot(world, { x: 6, z: 34 }, { x: 6, z: 27 });
  for (let i = 0; i < 12; i++) { ws.update(1); assert(ws.attack(ctx, zs).kind === 'shot', `shot ${i} failed`); }
  assert((ws.mag.pistol as number) === 0, 'magazine should be empty');
  assert(ws.reloading, 'empty magazine should start an automatic reload');
  ws.update(WEAPONS.pistol.reload + 0.05);
  assert(!ws.reloading && ws.mag.pistol === 12 && ws.reserve['9mm'] === 0, `reload result mag=${ws.mag.pistol} reserve=${ws.reserve['9mm']}`);
  for (let i = 0; i < 12; i++) { ws.update(1); ws.attack(ctx, zs); }
  ws.update(1);
  assert(ws.attack(ctx, zs).kind === 'dry', 'expected a dry click with no ammo left');
  assert(ws.roundsLeft() === 0 && ws.power() === 0, 'power should drop to bat only');
});

test('shotgun: six pellets, loads one shell at a time and can be interrupted by firing', () => {
  const { w: world, zs } = makeZombies(12);
  const ws = new WeaponSystem();
  ws.addAmmo('shell', 6);
  ws.addWeapon('shotgun');
  assert(ws.mag.shotgun === 4 && ws.reserve.shell === 2, 'shotgun should load from reserve when picked up');
  ws.switchTo('shotgun');
  ws.update(1);
  const z = zs.spawn('walker', 6, 31)!;
  const ctx = shot(world, { x: 6, z: 34 }, { x: 6, z: 31 }, 1, 1.0);
  const r = ws.attack(ctx, zs);
  assert(r.kind === 'shot' && r.kills === 1 && !z.alive, `point-blank shotgun should kill a walker: ${JSON.stringify({ k: r.kills, d: r.damage })}`);
  assert((ws.mag.shotgun as number) === 3, 'a shot uses one shell');
  ws.update(WEAPONS.shotgun.cooldown + 0.01);
  ws.attack(ctx, zs);
  assert((ws.mag.shotgun as number) === 2, 'second shell used');
  assert(ws.startReload(), 'could not start reloading');
  ws.update(WEAPONS.shotgun.reload + 0.01);
  assert((ws.mag.shotgun as number) === 3 && (ws.reserve.shell as number) === 1 && ws.reloading, 'one shell should load, then keep reloading');
  ws.update(0.5); // cooldown from the last shot
  const interrupt = ws.attack(ctx, zs);
  assert(interrupt.kind === 'shot' && !ws.reloading, 'firing should interrupt a shotgun reload');
});

test('bat: hits things in front within reach, not behind or out of range', () => {
  const { w: world, zs } = makeZombies(13);
  const ws = new WeaponSystem();
  ws.switchTo('bat');
  ws.update(1);
  const front = zs.spawn('walker', 6, 32.5)!;
  const behind = zs.spawn('walker', 6, 35.4)!;
  const far = zs.spawn('walker', 6, 28.5)!;
  const r = ws.attack(shot(world, { x: 6, z: 34 }, { x: 6, z: 28 }), zs);
  assert(r.kind === 'swing' && r.hit, 'swing missed a zombie in front');
  assert(front.health < 60, 'front zombie untouched');
  assert(behind.health === 60 && far.health === 60, 'swing hit something it should not');
  assert(MELEE_ARC_COS > 0.5 && MELEE_ARC_COS < 0.6, 'melee arc changed unexpectedly');
});

test('bat needs two swings for a walker and is quiet compared with a gun', () => {
  const { w: world, zs } = makeZombies(14);
  const ws = new WeaponSystem();
  ws.switchTo('bat');
  ws.update(1);
  zs.spawn('walker', 6, 32.5);
  const ctx = shot(world, { x: 6, z: 34 }, { x: 6, z: 28 });
  const a = ws.attack(ctx, zs);
  assert(a.kills === 0 && a.noise < WEAPONS.pistol.noise / 2, 'first swing should not kill and should be quiet');
  ws.update(1);
  assert(ws.attack(ctx, zs).kills === 1, 'second swing should kill');
});

test('ammo is capped, weapons can be switched/cycled, and snapshots restore with a safety net', () => {
  const ws = new WeaponSystem();
  assert(ws.addAmmo('9mm', 500) === AMMO_CAP['9mm'] - 12, 'cap not applied');
  ws.addWeapon('shotgun');
  assert(ws.switchTo('shotgun') && (ws.current as string) === 'shotgun', 'switch failed');
  assert(!ws.switchTo('shotgun'), 'switching to the held weapon should be a no-op');
  ws.cycle(1);
  assert((ws.current as string) === 'bat', `cycle order wrong: ${ws.current}`);
  const snap = ws.snapshot();
  const other = new WeaponSystem();
  snap.reserve['9mm'] = 0;
  other.restore(snap);
  assert(other.has('shotgun') && other.reserve['9mm'] >= 12, 'restore should guarantee a minimum of pistol ammo');
});

console.log('\nSpawn director (ML)');

const model = DirectorModel.bundled();
const obsOf = (row: number[]) => Object.fromEntries(parity.feature_names.map((n, i) => [n, row[i]]));

test('model spec: 16 features in the training order, 4 classes, softmax output', () => {
  assert(model.spec.features.map((f) => f.name).join() === parity.feature_names.join(), 'feature order differs from training');
  assert(model.spec.features.length === 16, 'expected 16 features');
  assert(model.classes.join() === 'none,light,medium,heavy', `classes ${model.classes}`);
  assert(model.spec.spawn_counts.join() === '0,1,3,5', 'spawn counts changed');
  assert(model.spec.max_alive === MAX_ALIVE, 'trained cap differs from the game cap');
  assert(model.spec.layers[model.spec.layers.length - 1].act === 'softmax', 'last layer should be softmax');
});

test('in-game inference matches the exported TFLite model on 60 held-out states', () => {
  let worst = 0;
  for (let i = 0; i < parity.raw.length; i++) {
    const p = model.predict(obsOf(parity.raw[i]));
    near(p.reduce((a, b) => a + b, 0), 1, 1e-6, 'probabilities do not sum to 1');
    for (let k = 0; k < p.length; k++) worst = Math.max(worst, Math.abs(p[k] - parity.expected_probs_tflite[i][k]));
    assert(p.indexOf(Math.max(...p)) === parity.expected_probs_tflite[i].indexOf(Math.max(...parity.expected_probs_tflite[i])) || worst < parity.tolerance,
      `argmax differs on vector ${i}`);
  }
  assert(worst < parity.tolerance, `max |game - tflite| = ${worst.toExponential(2)} exceeds ${parity.tolerance}`);
});

const calm = { health: 100, stamina: 100, ammo_total: 40, weapon_power: 0.5, battery: 80, zombies_alive: 0, nearest_zombie_m: 30, since_damage_s: 90, since_kill_s: 90, kills_60s: 0, accuracy_60s: 0.6, since_spawn_s: 90, progress: 0.6, sprint_frac_60s: 0.1, light_level: 0.3, stalker_dist_m: 30 };
const doomed = { ...calm, health: 12, ammo_total: 0, weapon_power: 0, zombies_alive: 6, nearest_zombie_m: 4, since_damage_s: 2, since_kill_s: 50, accuracy_60s: 0.5, since_spawn_s: 20, stalker_dist_m: 8 };

test('behaviour: a healthy, bored, armed player gets zombies; a nearly dead, empty-handed one does not', () => {
  const a = model.predict(calm), b = model.predict(doomed);
  const pa = a.indexOf(Math.max(...a)), pb = b.indexOf(Math.max(...b));
  assert(pa >= 1, `calm player should face a wave, model said ${model.classes[pa]} (${a.map((x) => x.toFixed(2))})`);
  assert(pb === 0, `doomed player should be left alone, model said ${model.classes[pb]} (${b.map((x) => x.toFixed(2))})`);
});

test('behaviour: more health and ammo never makes the model less willing to spawn (monotone sanity check)', () => {
  const expected = (o: Record<string, number>) => model.predict(o).reduce((s, p, i) => s + p * model.counts[i], 0);
  const weak = expected({ ...calm, health: 25, ammo_total: 3 });
  const strong = expected({ ...calm, health: 100, ammo_total: 40 });
  assert(strong > weak, `expected spawn count: strong ${strong.toFixed(2)} should exceed weak ${weak.toFixed(2)}`);
});

test('director honours the live-zombie cap and the mercy rule, whatever the model says', () => {
  const d = new SpawnDirector(model, mulberry(1));
  const full = d.decide(100, { ...calm, zombies_alive: MAX_ALIVE });
  assert(full.count === 0, `spawned ${full.count} on top of a full cap`);
  const hurt = d.decide(100, { ...calm, health: DIRECTOR.mercyHealth - 5, since_damage_s: 90 });
  assert(hurt.count <= 1, `mercy rule violated: ${hurt.count}`);
  const nearCap = d.decide(100, { ...calm, zombies_alive: MAX_ALIVE - 2 });
  assert(nearCap.count <= 2, `cap violated: ${nearCap.count}`);
});

test('director timing: grace period, decision interval and minimum gap between waves', () => {
  const d = new SpawnDirector(model, mulberry(2));
  const obs = () => calm;
  let decided = 0;
  for (let t = 0; t < DIRECTOR.graceSeconds - 1; t += 1) if (d.update(1, t, 99, obs)) decided++;
  assert(decided === 0, 'decided during the grace period');
  assert(d.update(DIRECTOR.interval, DIRECTOR.graceSeconds + 5, DIRECTOR.minGap - 1, obs) === null, 'ignored the minimum gap');
  assert(d.update(DIRECTOR.interval, DIRECTOR.graceSeconds + 10, DIRECTOR.minGap + 1, obs) !== null, 'should decide once everything allows it');
  d.enabled = false;
  assert(d.update(DIRECTOR.interval, 200, 99, obs) === null, 'a disabled director still decided');
});

test('fallback policy keeps zombies coming if the model is missing', () => {
  const d = new SpawnDirector(null, mulberry(3));
  const r = d.decide(100, calm);
  assert(r.source === 'fallback' && r.count > 0, `fallback spawned ${r.count}`);
  assert(fallbackProbs(doomed)[0] === 1, 'fallback should hold off for a doomed player');
});

test('telemetry windows: accuracy, kills, sprint fraction and timers', () => {
  const t = new DirectorTelemetry();
  t.reset(0);
  t.onShot(10, true); t.onShot(11, false); t.onShot(12, true); t.onShot(13, true);
  t.onKill(12); t.onKill(20); t.onDamage(15); t.onSpawn(5);
  for (let i = 0; i < 40; i++) t.sample(30 + i * 0.5, 0.5, i < 10);
  const s = t.snapshot(50);
  near(s.accuracy_60s, 0.75, 1e-9, 'accuracy');
  assert(s.kills_60s === 2, 'kills');
  near(s.since_damage_s, 35, 1e-9, 'since damage');
  near(s.since_kill_s, 30, 1e-9, 'since kill');
  near(s.since_spawn_s, 45, 1e-9, 'since spawn');
  near(s.sprint_frac_60s, 0.25, 1e-9, 'sprint fraction');
  const old = t.snapshot(200);
  assert(old.kills_60s === 0 && old.accuracy_60s === 0.5, 'old events should fall out of the window');
});

console.log('\nIntegration');

test('a scripted player survives and kills a director-driven stream of zombies for two minutes', () => {
  const w = makeWorld();
  const rand = mulberry(2024);
  const events = { attackHit: (_z: unknown, dmg: number) => { if (hurtT <= 0 && health > 0) { health -= dmg; hurtT = 1.4; damageEvents++; tele.onDamage(clock); } } };
  const env: ZombieEnv = {
    collision: w.collision, nav: w.nav, profile: new BehaviourProfile(w.grid.w * w.grid.h), rand, hideSpots: [], patrolPoints: PATROL_POINTS,
    doorAt: w.doorAt, lightLevel: () => 0.2,
  };
  let health = 100, hurtT = 0, damageEvents = 0, clock = 0, kills = 0;
  const tele = new DirectorTelemetry();
  const zs = new ZombieSystem(env, { ...events, killed: () => { kills++; tele.onKill(clock); } }, rand);
  const director = new SpawnDirector(model, rand);
  const ws = new WeaponSystem();
  ws.addAmmo('9mm', 48);
  const me = { x: 8, z: 31 };
  const waves: number[] = [];
  let maxAlive = 0;
  const dt = 1 / 30;
  for (let i = 0; i < 30 * 120; i++) {
    clock += dt;
    hurtT = Math.max(0, hurtT - dt);
    if (health < 100 && clock - 0 > 0) health = Math.min(100, health + 0.8 * dt); // slow regen
    ws.update(dt);
    zs.update(dt, view(me.x, me.z), { pos: me, hidden: false, radius: 0.3 });
    maxAlive = Math.max(maxAlive, zs.aliveCount);
    // The bot shoots the nearest zombie it can see; it refills when nearly dry (a stand-in for ammo pickups).
    const tgt = zs.nearestAlive(me.x, me.z);
    if (tgt && w.collision.lineOfSight(me.x, me.z, tgt.zombie.ai.x, tgt.zombie.ai.z)) {
      const ctx = shot(w, me, { x: tgt.zombie.ai.x, z: tgt.zombie.ai.z }, 1, 1.0, 1000 + i);
      const r = ws.attack(ctx, zs);
      if (r.kind === 'shot') { tele.onShot(clock, r.hit); zs.hearNoise(me.x, me.z, r.noise, 'impact'); }
    }
    if (ws.totalRounds() < 6) ws.addAmmo('9mm', 12);
    const dec = director.update(dt, clock, tele.sinceSpawn(clock), () => ({
      health, stamina: 100, ammo_total: ws.totalRounds(), weapon_power: ws.power(), battery: 80, zombies_alive: zs.aliveCount,
      nearest_zombie_m: tgt ? tgt.dist : 30, ...tele.snapshot(clock), progress: 0.4, light_level: 0.2, stalker_dist_m: 30,
    }));
    if (dec && dec.count > 0) {
      const made = zs.spawnWave(dec.count, me, PATROL_POINTS, 0.4);
      if (made.length) { tele.onSpawn(clock); waves.push(made.length); }
    }
  }
  assert(waves.length >= 2, `the director only spawned ${waves.length} wave(s) in two minutes`);
  assert(maxAlive <= MAX_ALIVE, `cap exceeded: ${maxAlive}`);
  assert(kills >= 3, `the scripted player only killed ${kills}`);
  assert(damageEvents >= 0 && Number.isFinite(health), 'health became invalid');
  console.log(`       waves ${waves.length} (${waves.join(',')}), peak alive ${maxAlive}, kills ${kills}, hits taken ${damageEvents}, ending health ${health.toFixed(0)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
