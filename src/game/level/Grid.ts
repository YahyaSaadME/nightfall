import { CELL, DOOR_CHARS, MAP, type DoorKind } from './LevelData';

export interface AABB { minX: number; maxX: number; minZ: number; maxZ: number }

/** The minimal door view that collision, perception and navigation depend on. */
export interface DoorState {
  readonly cx: number;
  readonly cz: number;
  readonly kind: DoorKind;
  readonly locked: boolean;
  readonly blocksSight: boolean;
  readonly blocksMovement: boolean;
  /** Everything solid right now (frame + panel while closed). */
  colliders(): AABB[];
  /** The fixed frame only (used for navigation, which treats doors as openable). */
  frame(): AABB[];
}

/** 'dynamic' = includes closed door panels; 'static' = walls, door frames and props only. */
export type CollisionMode = 'dynamic' | 'static';

/** 'x' = you walk through the door along the X axis (walls are above/below in the map). */
export type PassAxis = 'x' | 'z';

export class Grid {
  readonly w: number;
  readonly h: number;
  private readonly chars: string[][];

  constructor(map: readonly string[] = MAP) {
    this.h = map.length;
    this.w = map[0].length;
    this.chars = map.map((row) => row.split(''));
  }

  inBounds(cx: number, cz: number) {
    return cx >= 0 && cz >= 0 && cx < this.w && cz < this.h;
  }

  char(cx: number, cz: number) {
    return this.inBounds(cx, cz) ? this.chars[cz][cx] : '#';
  }

  isWall(cx: number, cz: number) {
    return this.char(cx, cz) === '#';
  }

  doorKind(cx: number, cz: number): DoorKind | undefined {
    return DOOR_CHARS[this.char(cx, cz)];
  }

  passAxis(cx: number, cz: number): PassAxis {
    return this.isWall(cx, cz - 1) && this.isWall(cx, cz + 1) ? 'x' : 'z';
  }

  index(cx: number, cz: number) {
    return cz * this.w + cx;
  }

  forEachCell(fn: (cx: number, cz: number, ch: string) => void) {
    for (let cz = 0; cz < this.h; cz++) for (let cx = 0; cx < this.w; cx++) fn(cx, cz, this.chars[cz][cx]);
  }
}

export const toCell = (v: number) => Math.floor(v / CELL);
export const cellCenter = (c: number) => c * CELL + CELL / 2;

export const JAMB = 0.4;
/** Fixed pieces of a door cell (the two jambs) plus the closed-panel footprint. */
export function doorGeometry(cx: number, cz: number, axis: PassAxis, panelThickness = 0.07) {
  const x0 = cx * CELL;
  const z0 = cz * CELL;
  const h = panelThickness / 2;
  if (axis === 'x') {
    return {
      jambs: [
        { minX: x0, maxX: x0 + CELL, minZ: z0, maxZ: z0 + JAMB },
        { minX: x0, maxX: x0 + CELL, minZ: z0 + CELL - JAMB, maxZ: z0 + CELL },
      ] as AABB[],
      panel: { minX: x0 + 1 - h, maxX: x0 + 1 + h, minZ: z0 + JAMB, maxZ: z0 + CELL - JAMB } as AABB,
    };
  }
  return {
    jambs: [
      { minX: x0, maxX: x0 + JAMB, minZ: z0, maxZ: z0 + CELL },
      { minX: x0 + CELL - JAMB, maxX: x0 + CELL, minZ: z0, maxZ: z0 + CELL },
    ] as AABB[],
    panel: { minX: x0 + JAMB, maxX: x0 + CELL - JAMB, minZ: z0 + 1 - h, maxZ: z0 + 1 + h } as AABB,
  };
}

export type DoorLookup = (cx: number, cz: number) => DoorState | undefined;

/**
 * Circle-vs-box collision against walls, door pieces and static props, plus grid
 * line-of-sight. Shared by the player, the stalker and navigation.
 */
export class CollisionWorld {
  private buckets = new Map<number, AABB[]>();
  private scratch: AABB[] = [];

  constructor(
    readonly grid: Grid,
    readonly statics: AABB[],
    readonly doorAt: DoorLookup,
  ) {
    for (const b of statics) {
      for (let cz = toCell(b.minZ); cz <= toCell(b.maxZ); cz++)
        for (let cx = toCell(b.minX); cx <= toCell(b.maxX); cx++) {
          const k = grid.index(cx, cz);
          let list = this.buckets.get(k);
          if (!list) this.buckets.set(k, (list = []));
          list.push(b);
        }
    }
  }

  /** All solid boxes overlapping the square around (x, z) of half-size r. */
  blockersNear(x: number, z: number, r: number, includeStatics = true, mode: CollisionMode = 'dynamic'): AABB[] {
    const out = this.scratch;
    out.length = 0;
    const cx0 = toCell(x - r), cx1 = toCell(x + r), cz0 = toCell(z - r), cz1 = toCell(z + r);
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++) {
        if (this.grid.isWall(cx, cz)) {
          out.push({ minX: cx * CELL, maxX: cx * CELL + CELL, minZ: cz * CELL, maxZ: cz * CELL + CELL });
          continue;
        }
        const door = this.doorAt(cx, cz);
        if (door) out.push(...(mode === 'dynamic' ? door.colliders() : door.frame()));
        if (includeStatics) {
          const list = this.buckets.get(this.grid.index(cx, cz));
          if (list) for (const b of list) if (!out.includes(b)) out.push(b);
        }
      }
    return out;
  }

  /** Pushes a circle out of every overlapping box. Returns true if anything was hit. */
  resolveCircle(p: { x: number; z: number }, r: number, includeStatics = true): boolean {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const b of this.blockersNear(p.x, p.z, r + 0.05, includeStatics)) {
        const qx = Math.max(b.minX, Math.min(p.x, b.maxX));
        const qz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
        let dx = p.x - qx;
        let dz = p.z - qz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          const push = r - d;
          p.x += (dx / d) * push;
          p.z += (dz / d) * push;
        } else {
          // Centre inside the box: leave by the shallowest face.
          const left = p.x - b.minX, right = b.maxX - p.x, top = p.z - b.minZ, bottom = b.maxZ - p.z;
          const m = Math.min(left, right, top, bottom);
          if (m === left) p.x = b.minX - r;
          else if (m === right) p.x = b.maxX + r;
          else if (m === top) p.z = b.minZ - r;
          else p.z = b.maxZ + r;
        }
        moved = hit = true;
      }
      if (!moved) break;
    }
    return hit;
  }

  pointFree(x: number, z: number, r: number, includeStatics = true, mode: CollisionMode = 'dynamic'): boolean {
    for (const b of this.blockersNear(x, z, r + 0.05, includeStatics, mode)) {
      const qx = Math.max(b.minX, Math.min(x, b.maxX));
      const qz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - qx, dz = z - qz;
      if (dx * dx + dz * dz < r * r) return false;
    }
    return true;
  }

  /**
   * Grid DDA line of sight. Walls always block, doors block while closed.
   * Props do not block sight (they are below eye level or thin).
   */
  lineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    let cx = toCell(ax), cz = toCell(az);
    const tx = toCell(bx), tz = toCell(bz);
    const dx = bx - ax, dz = bz - az;
    const stepX = Math.sign(dx), stepZ = Math.sign(dz);
    const tDeltaX = stepX !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tMaxX = stepX > 0 ? ((cx + 1) * CELL - ax) / dx : stepX < 0 ? (cx * CELL - ax) / dx : Infinity;
    let tMaxZ = stepZ > 0 ? ((cz + 1) * CELL - az) / dz : stepZ < 0 ? (cz * CELL - az) / dz : Infinity;
    let guard = 0;
    while ((cx !== tx || cz !== tz) && guard++ < 256) {
      if (tMaxX < tMaxZ) { tMaxX += tDeltaX; cx += stepX; }
      else { tMaxZ += tDeltaZ; cz += stepZ; }
      if (this.grid.isWall(cx, cz)) return false;
      const door = this.doorAt(cx, cz);
      if (door && door.blocksSight) return false;
    }
    return true;
  }
}
