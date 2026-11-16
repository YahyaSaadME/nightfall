import { CELL } from '../level/LevelData';
import { cellCenter, toCell, type CollisionWorld, type Grid } from '../level/Grid';

export interface NavPoint { x: number; z: number }

export interface PathOptions {
  /** Extra cost for routing through a closed door (lower = more willing to use door shortcuts). */
  doorCost?: number;
}

const SQRT2 = Math.SQRT2;
const SAMPLE_OFFSETS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let z = -0.6; z <= 0.61; z += 0.3) for (let x = -0.6; x <= 0.61; x += 0.3) out.push([x, z]);
  return out.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2));
})();

/**
 * Grid A* where every floor cell owns a "nav point": its centre, or the nearest spot
 * inside the cell with clearance from props. Edges are validated with clearance checks
 * against static geometry (cached), so props never split a corridor. Doors are nodes
 * at their centre; locked doors and the exit are impassable. Paths are string-pulled.
 */
export class Navigation {
  private readonly grid: Grid;
  private readonly points: (NavPoint | null)[];
  private readonly edgeCache = new Map<number, boolean>();

  constructor(private readonly world: CollisionWorld, readonly agentRadius = 0.38) {
    this.grid = world.grid;
    this.points = new Array(this.grid.w * this.grid.h).fill(null);
    this.grid.forEachCell((cx, cz) => {
      if (this.grid.isWall(cx, cz)) return;
      const ccx = cellCenter(cx), ccz = cellCenter(cz);
      if (this.grid.doorKind(cx, cz)) {
        this.points[this.grid.index(cx, cz)] = { x: ccx, z: ccz };
        return;
      }
      for (const [ox, oz] of SAMPLE_OFFSETS) {
        if (this.clear(ccx + ox, ccz + oz, agentRadius + 0.05)) {
          this.points[this.grid.index(cx, cz)] = { x: ccx + ox, z: ccz + oz };
          return;
        }
      }
    });
  }

  private clear(x: number, z: number, r: number) {
    return this.world.pointFree(x, z, r, true, 'static');
  }

  isDoorCell(cx: number, cz: number) {
    return this.grid.doorKind(cx, cz) !== undefined;
  }

  pointOf(cx: number, cz: number): NavPoint | null {
    return this.grid.inBounds(cx, cz) ? this.points[this.grid.index(cx, cz)] : null;
  }

  passable(cx: number, cz: number): boolean {
    if (!this.pointOf(cx, cz)) return false;
    const kind = this.grid.doorKind(cx, cz);
    if (kind) {
      if (kind === 'exit') return false;
      const door = this.world.doorAt(cx, cz);
      if (door && door.locked) return false;
    }
    return true;
  }

  /** Clearance-checked straight segment between two nav points (static geometry only). */
  private edgeClear(a: number, b: number): boolean {
    const key = a < b ? a * 100000 + b : b * 100000 + a;
    const cached = this.edgeCache.get(key);
    if (cached !== undefined) return cached;
    const pa = this.points[a]!, pb = this.points[b]!;
    const ok = this.segmentClear(pa, pb);
    this.edgeCache.set(key, ok);
    return ok;
  }

  private segmentClear(a: NavPoint, b: NavPoint) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
    for (let k = 0; k <= steps; k++) {
      const x = a.x + (dx * k) / steps, z = a.z + (dz * k) / steps;
      if (this.grid.isWall(toCell(x), toCell(z))) return false;
      if (!this.clear(x, z, this.agentRadius)) return false;
    }
    return true;
  }

  /** Closest passable nav point to a world position. */
  nearestPassable(x: number, z: number, maxRing = 4): NavPoint | null {
    const cx = toCell(x), cz = toCell(z);
    if (this.passable(cx, cz) && !this.isDoorCell(cx, cz)) {
      if (this.clear(x, z, this.agentRadius)) return { x, z };
      return this.pointOf(cx, cz);
    }
    let best: NavPoint | null = null;
    let bestD = Infinity;
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let dz = -ring; dz <= ring; dz++)
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          if (!this.passable(cx + dx, cz + dz)) continue;
          const p = this.pointOf(cx + dx, cz + dz)!;
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < bestD) { bestD = d; best = p; }
        }
      if (best) return best;
    }
    return null;
  }

  findPath(from: NavPoint, to: NavPoint, opts: PathOptions = {}): NavPoint[] | null {
    const g = this.grid;
    let sx = toCell(from.x), sz = toCell(from.z);
    if (!this.passable(sx, sz)) {
      const s = this.nearestPassable(from.x, from.z);
      if (!s) return null;
      sx = toCell(s.x); sz = toCell(s.z);
    }
    const goalP = this.nearestPassable(to.x, to.z);
    if (!goalP) return null;
    const gx = toCell(goalP.x), gz = toCell(goalP.z);
    const doorCost = opts.doorCost ?? 2;
    const n = g.w * g.h;
    const gScore = new Float32Array(n).fill(Infinity);
    const fScore = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const open: number[] = [];
    const s = g.index(sx, sz), goal = g.index(gx, gz);
    gScore[s] = 0;
    fScore[s] = this.h(sx, sz, gx, gz);
    open.push(s);
    let found = s === goal;
    while (open.length && !found) {
      // Small grid: a linear scan for the lowest f beats maintaining a heap.
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (fScore[open[i]] < fScore[open[bi]]) bi = i;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % g.w, cz = (cur / g.w) | 0;
      const curDoor = this.isDoorCell(cx, cz);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!this.passable(nx, nz)) continue;
          const nDoor = this.isDoorCell(nx, nz);
          if (dx && dz) {
            if (curDoor || nDoor) continue; // doors are entered straight on
            if (g.isWall(cx + dx, cz) || g.isWall(cx, cz + dz)) continue;
          }
          const ni = g.index(nx, nz);
          if (closed[ni] || !this.edgeClear(cur, ni)) continue;
          let cost = dx && dz ? SQRT2 : 1;
          if (nDoor) {
            const door = this.world.doorAt(nx, nz);
            if (door && door.blocksMovement) cost += doorCost;
          }
          const t = gScore[cur] + cost;
          if (t < gScore[ni]) {
            gScore[ni] = t;
            came[ni] = cur;
            fScore[ni] = t + this.h(nx, nz, gx, gz);
            open.push(ni);
          }
        }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let c = goal; ; c = came[c]) {
      cells.push(c);
      if (c === s || came[c] < 0) break;
    }
    cells.reverse();
    const raw = cells.map((c) => ({ ...this.points[c]! }));
    raw[raw.length - 1] = { x: goalP.x, z: goalP.z };
    return this.smooth(raw, from);
  }

  private h(ax: number, az: number, bx: number, bz: number) {
    const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
    return dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
  }

  /** Door cells and their neighbours stay pinned so agents line up with doorways. */
  private smooth(path: NavPoint[], from: NavPoint): NavPoint[] {
    if (path.length <= 1) return path;
    const pinned = path.map((p) => this.isDoorCell(toCell(p.x), toCell(p.z)));
    for (let i = 0; i < path.length; i++)
      if (pinned[i] && this.isDoorCell(toCell(path[i].x), toCell(path[i].z))) {
        if (i > 0) pinned[i - 1] = true;
        if (i < path.length - 1) pinned[i + 1] = true;
      }
    const out: NavPoint[] = [];
    let anchor: NavPoint = from;
    let i = 0;
    while (i < path.length) {
      if (pinned[i]) {
        out.push(path[i]);
        anchor = path[i];
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < path.length && !pinned[j + 1] && this.walkable(anchor, path[j + 1])) j++;
      out.push(path[j]);
      anchor = path[j];
      i = j + 1;
    }
    return out;
  }

  /** Straight walk between two points without crossing doors, walls or props. */
  walkable(a: NavPoint, b: NavPoint): boolean {
    const dx = b.x - a.x, dz = b.z - a.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.25));
    for (let k = 1; k <= steps; k++) {
      const x = a.x + (dx * k) / steps, z = a.z + (dz * k) / steps;
      const cx = toCell(x), cz = toCell(z);
      if (this.grid.isWall(cx, cz) || this.isDoorCell(cx, cz)) return false;
      if (!this.clear(x, z, this.agentRadius)) return false;
    }
    return true;
  }

  pathLength(from: NavPoint, path: NavPoint[]) {
    let len = 0, px = from.x, pz = from.z;
    for (const p of path) { len += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z; }
    return len;
  }

  /** A random reachable nav point within `radius` metres of (x, z), optionally weighted. */
  randomPointNear(x: number, z: number, radius: number, rand: () => number, score?: (p: NavPoint) => number): NavPoint | null {
    const candidates: NavPoint[] = [];
    const r = Math.ceil(radius / CELL);
    const cx = toCell(x), cz = toCell(z);
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx, nz = cz + dz;
        if (!this.passable(nx, nz) || this.isDoorCell(nx, nz)) continue;
        const p = this.pointOf(nx, nz)!;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d > radius) continue;
        // Prefer places connected to the search centre without going through walls.
        if (d > CELL * 2.5 && !this.world.lineOfSight(x, z, p.x, p.z)) continue;
        candidates.push(p);
      }
    if (!candidates.length) return null;
    if (!score) return candidates[Math.floor(rand() * candidates.length)];
    const weights = candidates.map((p) => Math.max(0.05, score(p)));
    const total = weights.reduce((a, b) => a + b, 0);
    let t = rand() * total;
    for (let i = 0; i < candidates.length; i++) { t -= weights[i]; if (t <= 0) return candidates[i]; }
    return candidates[candidates.length - 1];
  }
}
