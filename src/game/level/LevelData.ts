/**
 * Static level definition for the abandoned hospital.
 * Grid: 1 char = one 2m x 2m cell. World X = column * CELL, world Z = row * CELL.
 *
 *  #  wall          .  floor
 *  D  normal door   P  power-locked door (opens after emergency power)
 *  K  keycard door  X  main exit (roller shutter, needs exit key + power)
 */
export const CELL = 2;
export const WALL_H = 3;

export const MAP: readonly string[] = [
  '#########################', // 0
  '#.......#..#.....#..#...#', // 1   storage | corridor | locker room | restricted | ward A
  '#.......#..#.....#..#...#', // 2
  '#.......D..D.....K..D...#', // 3
  '#.......#..#.....#..#...#', // 4
  '#.......#..#.....#..#...#', // 5
  '####D####..#######..#####', // 6
  '#.......#..#.....#..#...#', // 7   maintenance | corridor | nurses' station | restricted | office
  '#.......#..#.....#..#...#', // 8
  '#.......D..P.....#..D...#', // 9
  '#.......#..#.....#..#...#', // 10
  '#.......#..#.....#..#...#', // 11
  '#########..#######..#####', // 12
  '#................#..#...#', // 13  reception | restricted | ward C
  '#................#..#...#', // 14
  '#................K..D...#', // 15
  '#................#..#...#', // 16
  '#................#..#...#', // 17
  '#########X###############', // 18
];

export type DoorKind = 'normal' | 'power' | 'keycard' | 'exit';
export const DOOR_CHARS: Record<string, DoorKind> = { D: 'normal', P: 'power', K: 'keycard', X: 'exit' };

export interface Zone { id: ZoneId; name: string; x0: number; x1: number; z0: number; z1: number }
export type ZoneId =
  | 'reception' | 'storage' | 'maintenance' | 'corridor' | 'lockers'
  | 'nurses' | 'restricted' | 'wardA' | 'office' | 'wardC';

/** Inclusive cell ranges. */
export const ZONES: Zone[] = [
  { id: 'reception', name: 'Reception', x0: 1, x1: 16, z0: 13, z1: 17 },
  { id: 'storage', name: 'Storage', x0: 1, x1: 7, z0: 1, z1: 5 },
  { id: 'maintenance', name: 'Maintenance', x0: 1, x1: 7, z0: 7, z1: 11 },
  { id: 'corridor', name: 'East Corridor', x0: 9, x1: 10, z0: 1, z1: 12 },
  { id: 'lockers', name: 'Staff Lockers', x0: 12, x1: 16, z0: 1, z1: 5 },
  { id: 'nurses', name: "Nurses' Station", x0: 12, x1: 16, z0: 7, z1: 11 },
  { id: 'restricted', name: 'Restricted Wing', x0: 18, x1: 19, z0: 1, z1: 17 },
  { id: 'wardA', name: 'Isolation Ward', x0: 21, x1: 23, z0: 1, z1: 5 },
  { id: 'office', name: "Director's Office", x0: 21, x1: 23, z0: 7, z1: 11 },
  { id: 'wardC', name: 'Ward C', x0: 21, x1: 23, z0: 13, z1: 17 },
];

export function zoneAt(x: number, z: number): Zone | undefined {
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  return ZONES.find((r) => cx >= r.x0 && cx <= r.x1 && cz >= r.z0 && cz <= r.z1);
}

export interface V2 { x: number; z: number }
export interface V3 { x: number; y: number; z: number }

export type ItemId = 'fuse' | 'keycard' | 'exitKey';

export const PLAYER_START = { x: 8, z: 31, yaw: -0.65 };
export const ENEMY_SPAWN: V2 = { x: 31, z: 8 };

/** Key item and battery placements (y = resting height). */
export const ITEM_SPAWNS: Record<ItemId, V3> = {
  fuse: { x: 2.65, y: 0.8, z: 9.4 },
  keycard: { x: 29.4, y: 1.07, z: 17.35 },
  exitKey: { x: 46.2, y: 0.8, z: 16.45 },
};

export const BATTERY_SPAWNS: (V3 & { id: string })[] = [
  { id: 'bat-reception', x: 5.2, y: 0.47, z: 27.4 },
  { id: 'bat-storage', x: 9.4, y: 0.94, z: 2.35 },
  { id: 'bat-maint', x: 11.6, y: 1.03, z: 22.4 },
  { id: 'bat-corridor', x: 21.5, y: 0.03, z: 10.2 },
  { id: 'bat-lockers', x: 29.5, y: 0.47, z: 9.6 },
  { id: 'bat-nurses', x: 33.4, y: 0.98, z: 22.6 },
  { id: 'bat-restricted', x: 39.25, y: 0.93, z: 23.8 },
  { id: 'bat-wardA', x: 43.1, y: 0.63, z: 8.7 },
  { id: 'bat-wardC', x: 47.4, y: 0.63, z: 32.4 },
];

/** Lockers the player can hide in. yaw = direction the locker door faces (0 = -Z). */
export interface HideSpotDef { id: string; x: number; z: number; yaw: number }
const FACE_PX = -Math.PI / 2; // facing +X
const FACE_NX = Math.PI / 2; // facing -X
const FACE_PZ = Math.PI; // facing +Z
const FACE_NZ = 0; // facing -Z
export const HIDE_SPOTS: HideSpotDef[] = [
  { id: 'locker-reception', x: 2.32, z: 34.4, yaw: FACE_PX },
  { id: 'locker-storage', x: 2.32, z: 4.6, yaw: FACE_PX },
  { id: 'locker-maint', x: 15.68, z: 22.8, yaw: FACE_NX },
  { id: 'locker-staff-1', x: 26.0, z: 2.32, yaw: FACE_PZ },
  { id: 'locker-staff-2', x: 26.64, z: 2.32, yaw: FACE_PZ },
  { id: 'locker-staff-3', x: 27.28, z: 2.32, yaw: FACE_PZ },
  { id: 'locker-staff-4', x: 31.2, z: 11.68, yaw: FACE_NZ },
  { id: 'locker-nurses', x: 33.68, z: 15.2, yaw: FACE_NX },
  { id: 'locker-wardA', x: 42.32, z: 3.0, yaw: FACE_PX },
  { id: 'locker-office', x: 47.68, z: 22.6, yaw: FACE_NX },
  { id: 'locker-wardC', x: 42.32, z: 34.8, yaw: FACE_PX },
];

export const PATROL_POINTS: V2[] = [
  { x: 6, z: 30 }, { x: 15, z: 33 }, { x: 28, z: 34 },
  { x: 20, z: 6 }, { x: 20, z: 19 },
  { x: 7, z: 7 }, { x: 9, z: 20 },
  { x: 30, z: 6 }, { x: 26.5, z: 20.5 },
  { x: 38, z: 6 }, { x: 38, z: 18 }, { x: 38, z: 32 },
  { x: 45, z: 6.5 }, { x: 44, z: 20 }, { x: 45, z: 30 },
];

export type PickupKind = 'ammo9' | 'shells' | 'shotgun';
export interface PickupDef { id: string; kind: PickupKind; x: number; z: number }
/**
 * Floor pickups, collected by walking over them. Every position is a patrol point, which the
 * tests already verify is clear of walls and props. 9mm: +12, shells: +6, shotgun: the weapon.
 */
export const PICKUP_SPAWNS: PickupDef[] = [
  { id: 'pk-ammo-reception', kind: 'ammo9', x: 15, z: 33 },
  { id: 'pk-ammo-storage', kind: 'ammo9', x: 7, z: 7 },
  { id: 'pk-ammo-maint', kind: 'ammo9', x: 9, z: 20 },
  { id: 'pk-ammo-corridor', kind: 'ammo9', x: 20, z: 19 },
  { id: 'pk-ammo-lockers', kind: 'ammo9', x: 30, z: 6 },
  { id: 'pk-shotgun-nurses', kind: 'shotgun', x: 26.5, z: 20.5 },
  { id: 'pk-ammo-restricted', kind: 'ammo9', x: 38, z: 6 },
  { id: 'pk-shells-restricted', kind: 'shells', x: 38, z: 18 },
  { id: 'pk-shells-office', kind: 'shells', x: 44, z: 20 },
  { id: 'pk-ammo-wardA', kind: 'ammo9', x: 45, z: 6.5 },
  { id: 'pk-shells-wardC', kind: 'shells', x: 45, z: 30 },
];

export type LightKind = 'fluoro' | 'emergency';
export type LightMode = 'dead' | 'faulty' | 'powered';
export interface LightDef { x: number; z: number; kind: LightKind; mode: LightMode; dynamic: boolean; rot?: number }
/**
 * dynamic = owns a real point light (kept to a small budget). 'faulty' lights flicker
 * before power is restored; 'powered' only switch on after the fuse box is repaired.
 */
export const LIGHTS: LightDef[] = [
  { x: 12, z: 31, kind: 'fluoro', mode: 'faulty', dynamic: true },
  { x: 20, z: 16, kind: 'fluoro', mode: 'faulty', dynamic: true, rot: Math.PI / 2 },
  { x: 29, z: 19, kind: 'fluoro', mode: 'powered', dynamic: true },
  { x: 20, z: 8, kind: 'emergency', mode: 'powered', dynamic: true },
  { x: 8, z: 18.6, kind: 'emergency', mode: 'powered', dynamic: true },
  { x: 38, z: 10, kind: 'emergency', mode: 'powered', dynamic: true },
  { x: 38, z: 28, kind: 'emergency', mode: 'powered', dynamic: true },
  { x: 30, z: 33, kind: 'emergency', mode: 'powered', dynamic: true },
  // Fixtures without their own light (visual only)
  { x: 5, z: 31, kind: 'fluoro', mode: 'dead', dynamic: false },
  { x: 22, z: 31, kind: 'fluoro', mode: 'dead', dynamic: false },
  { x: 28, z: 29, kind: 'fluoro', mode: 'dead', dynamic: false },
  { x: 20, z: 5, kind: 'fluoro', mode: 'dead', dynamic: false, rot: Math.PI / 2 },
  { x: 20, z: 24, kind: 'fluoro', mode: 'dead', dynamic: false, rot: Math.PI / 2 },
  { x: 9, z: 7, kind: 'fluoro', mode: 'dead', dynamic: false },
  { x: 9, z: 19, kind: 'fluoro', mode: 'dead', dynamic: false },
  { x: 29, z: 7, kind: 'fluoro', mode: 'dead', dynamic: false },
  { x: 38, z: 19, kind: 'fluoro', mode: 'dead', dynamic: false, rot: Math.PI / 2 },
  { x: 45, z: 7, kind: 'fluoro', mode: 'dead', dynamic: false },
  { x: 45, z: 19, kind: 'fluoro', mode: 'dead', dynamic: false },
  { x: 45, z: 31, kind: 'fluoro', mode: 'dead', dynamic: false },
];

/** Exit trigger: once the shutter is open, walking past this Z escapes. */
export const EXIT_DOOR_CELL = { cx: 9, cz: 18 };
export const EXIT_TRIGGER_Z = 36.4;

/** The menu camera looks up the east corridor from the reception toward the stalker. */
export const MENU_CAMERA = { from: { x: 17.6, y: 1.5, z: 33.6 }, to: { x: 14.8, y: 1.5, z: 4 } };
export const MENU_STALKER = { x: 20.1, z: 21.6 };
