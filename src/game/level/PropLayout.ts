import type { AABB } from './Grid';
import { HIDE_SPOTS } from './LevelData';

export type PropType =
  | 'bed' | 'locker' | 'shelf' | 'table' | 'desk' | 'receptionDesk' | 'nurseCounter' | 'chairRow'
  | 'chair' | 'wheelchair' | 'gurney' | 'bodyGurney' | 'ivStand' | 'cabinet' | 'bench' | 'generator'
  | 'crate' | 'pillar' | 'curtain' | 'nightstand' | 'filing' | 'medCart' | 'boxes' | 'trolley' | 'fuseBox';

/** rot = rotation about Y (radians). A prop's front faces local +Z. */
export interface PropPlacement { type: PropType; x: number; z: number; rot?: number; id?: string }

/** Footprint (w along local X, d along local Z), height, and whether it blocks movement. */
export const PROP_DIMS: Record<PropType, { w: number; d: number; h: number; solid: boolean }> = {
  bed: { w: 0.95, d: 2.05, h: 0.62, solid: true },
  locker: { w: 0.6, d: 0.5, h: 1.95, solid: true },
  shelf: { w: 2.6, d: 0.55, h: 2.0, solid: true },
  table: { w: 1.6, d: 0.8, h: 0.78, solid: true },
  desk: { w: 1.5, d: 0.75, h: 0.76, solid: true },
  receptionDesk: { w: 6, d: 0.8, h: 1.05, solid: true },
  nurseCounter: { w: 3, d: 3.7, h: 1.05, solid: true },
  chairRow: { w: 2.2, d: 0.6, h: 0.85, solid: true },
  chair: { w: 0.5, d: 0.5, h: 0.9, solid: true },
  wheelchair: { w: 0.65, d: 1.0, h: 0.95, solid: true },
  gurney: { w: 0.7, d: 2.0, h: 0.9, solid: true },
  bodyGurney: { w: 0.7, d: 2.0, h: 0.9, solid: true },
  ivStand: { w: 0.36, d: 0.36, h: 1.9, solid: true },
  cabinet: { w: 1.0, d: 0.45, h: 1.9, solid: true },
  bench: { w: 2.0, d: 0.4, h: 0.45, solid: true },
  generator: { w: 2.6, d: 1.4, h: 1.5, solid: true },
  crate: { w: 1.0, d: 1.0, h: 1.0, solid: true },
  pillar: { w: 0.6, d: 0.6, h: 3, solid: true },
  curtain: { w: 2.0, d: 0.05, h: 2.0, solid: false },
  nightstand: { w: 0.5, d: 0.45, h: 0.6, solid: true },
  filing: { w: 0.5, d: 0.6, h: 1.3, solid: true },
  medCart: { w: 0.6, d: 0.45, h: 0.95, solid: true },
  boxes: { w: 0.8, d: 0.6, h: 0.9, solid: true },
  trolley: { w: 0.6, d: 1.0, h: 1.0, solid: true },
  fuseBox: { w: 0.7, d: 0.22, h: 0.9, solid: false },
};

const H = Math.PI / 2;
const P = Math.PI;

export const PROPS: PropPlacement[] = [
  // Reception
  { type: 'receptionDesk', x: 27, z: 28.6 },
  { type: 'chairRow', x: 5, z: 27.4 },
  { type: 'chairRow', x: 9, z: 27.4 },
  { type: 'chairRow', x: 5.2, z: 34.6, rot: P },
  { type: 'pillar', x: 13, z: 29 },
  { type: 'pillar', x: 13, z: 33 },
  { type: 'gurney', x: 6, z: 31.3, rot: H },
  { type: 'wheelchair', x: 16, z: 34.5, rot: 0.6 },
  { type: 'ivStand', x: 3.2, z: 29.5 },
  { type: 'medCart', x: 22.5, z: 34.6 },
  { type: 'bench', x: 31.5, z: 35.5, rot: P },
  { type: 'boxes', x: 32.8, z: 27 },
  // East corridor
  { type: 'gurney', x: 21.4, z: 13 },
  { type: 'wheelchair', x: 18.6, z: 23, rot: H },
  { type: 'ivStand', x: 21.6, z: 3 },
  { type: 'bench', x: 18.25, z: 11, rot: H },
  { type: 'trolley', x: 18.5, z: 15.5 },
  // Storage
  { type: 'shelf', x: 4.8, z: 2.35 },
  { type: 'shelf', x: 9.2, z: 2.35 },
  { type: 'shelf', x: 13.4, z: 2.35 },
  { type: 'table', x: 2.6, z: 9.4, rot: H },
  { type: 'boxes', x: 7, z: 11.4 },
  { type: 'boxes', x: 13, z: 11.4 },
  { type: 'crate', x: 14.8, z: 10.8 },
  { type: 'cabinet', x: 15.7, z: 3.9, rot: -H },
  { type: 'ivStand', x: 11, z: 5 },
  // Maintenance
  { type: 'generator', x: 5, z: 22.6 },
  { type: 'fuseBox', x: 2.11, z: 19, rot: H, id: 'fusebox' },
  { type: 'crate', x: 11.6, z: 22.6 },
  { type: 'shelf', x: 13, z: 14.35 },
  { type: 'boxes', x: 3, z: 15 },
  // Staff lockers (decorative lockers alongside the hideable ones)
  { type: 'locker', x: 27.92, z: 2.32 },
  { type: 'locker', x: 28.56, z: 2.32 },
  { type: 'locker', x: 29.2, z: 2.32 },
  { type: 'locker', x: 31.84, z: 11.68, rot: P },
  { type: 'locker', x: 32.48, z: 11.68, rot: P },
  { type: 'bench', x: 28, z: 6.5 },
  { type: 'bench', x: 29.2, z: 9.6 },
  { type: 'trolley', x: 33.2, z: 3.2 },
  // Nurses' station
  { type: 'nurseCounter', x: 29.5, z: 18.5 },
  { type: 'chair', x: 29.6, z: 19.2, rot: P },
  { type: 'medCart', x: 33.4, z: 22.6, rot: -H },
  { type: 'filing', x: 24.4, z: 15, rot: H },
  { type: 'filing', x: 24.4, z: 15.6, rot: H },
  { type: 'wheelchair', x: 26, z: 22.8, rot: -0.4 },
  // Restricted wing
  { type: 'gurney', x: 39.35, z: 24 },
  { type: 'bodyGurney', x: 36.7, z: 13 },
  { type: 'wheelchair', x: 39.3, z: 33.5, rot: P + 0.3 },
  { type: 'ivStand', x: 36.5, z: 4 },
  { type: 'trolley', x: 36.6, z: 27 },
  // Isolation ward
  { type: 'bed', x: 46.9, z: 4, rot: -H },
  { type: 'bed', x: 46.9, z: 9.5, rot: -H },
  { type: 'nightstand', x: 43.1, z: 8.7, rot: H },
  { type: 'ivStand', x: 45.6, z: 2.6 },
  { type: 'curtain', x: 46.2, z: 6.8 },
  { type: 'wheelchair', x: 43.5, z: 11, rot: 2.6 },
  // Director's office
  { type: 'desk', x: 46.2, z: 16.5, rot: P },
  { type: 'chair', x: 46.2, z: 15.5 },
  { type: 'filing', x: 47.7, z: 19, rot: -H },
  { type: 'filing', x: 47.7, z: 19.6, rot: -H },
  { type: 'shelf', x: 43.5, z: 23.7, rot: P },
  // Ward C
  { type: 'bed', x: 46.9, z: 28, rot: -H },
  { type: 'bed', x: 46.9, z: 34.3, rot: -H },
  { type: 'nightstand', x: 47.4, z: 32.4, rot: -H },
  { type: 'bodyGurney', x: 44, z: 28.5 },
  { type: 'ivStand', x: 45.4, z: 27 },
  { type: 'curtain', x: 46.2, z: 31.1 },
];

/** Every hide spot is also a (hideable) locker prop. Its door faces the hide spot's yaw. */
export const LOCKER_PROPS: PropPlacement[] = HIDE_SPOTS.map((h) => ({ type: 'locker', x: h.x, z: h.z, rot: h.yaw + Math.PI, id: h.id }));

export const ALL_PROPS: PropPlacement[] = [...PROPS, ...LOCKER_PROPS];

/** Local-space collision boxes for props whose footprint is not a single box. */
const CUSTOM_COLLIDERS: Partial<Record<PropType, AABB[]>> = {
  receptionDesk: [
    { minX: -3, maxX: 3, minZ: -0.4, maxZ: 0.4 },
    { minX: 2.2, maxX: 3, minZ: 0.4, maxZ: 2.8 },
  ],
  nurseCounter: [
    { minX: -1.5, maxX: 1.5, minZ: -1.6, maxZ: -0.8 },
    { minX: 0.7, maxX: 1.5, minZ: -0.8, maxZ: 2.1 },
  ],
};

function rotateBox(b: AABB, x: number, z: number, rot: number): AABB {
  const c = Math.cos(rot), s = Math.sin(rot);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [lx, lz] of [[b.minX, b.minZ], [b.maxX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ]]) {
    // Three.js Y rotation: x' = x cos + z sin, z' = -x sin + z cos
    const wx = x + lx * c + lz * s;
    const wz = z - lx * s + lz * c;
    minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
    minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
  }
  return { minX, maxX, minZ, maxZ };
}

export function propColliders(p: PropPlacement): AABB[] {
  const dims = PROP_DIMS[p.type];
  if (!dims.solid) return [];
  const rot = p.rot ?? 0;
  const local = CUSTOM_COLLIDERS[p.type] ?? [{ minX: -dims.w / 2, maxX: dims.w / 2, minZ: -dims.d / 2, maxZ: dims.d / 2 }];
  return local.map((b) => rotateBox(b, p.x, p.z, rot));
}

export function allPropColliders(): AABB[] {
  return ALL_PROPS.flatMap(propColliders);
}
