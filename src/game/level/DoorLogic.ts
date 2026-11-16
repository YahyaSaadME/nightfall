import { doorGeometry, type AABB, type PassAxis } from './Grid';
import type { DoorKind } from './LevelData';

export const SHUTTER_OPEN_SECONDS = 24;

/** Door state and animation progress, independent of rendering. */
export class DoorLogic {
  readonly id: string;
  locked: boolean;
  /** 0 = closed, 1 = fully open. */
  openAmount = 0;
  targetOpen = false;
  /** +1 / -1: which side the panel swings toward. */
  swingSign = 1;
  private readonly geo: ReturnType<typeof doorGeometry>;

  constructor(
    readonly cx: number,
    readonly cz: number,
    readonly kind: DoorKind,
    readonly axis: PassAxis,
  ) {
    this.id = `door-${cx}-${cz}`;
    this.locked = kind !== 'normal';
    this.geo = doorGeometry(cx, cz, axis, kind === 'exit' ? 0.2 : 0.07);
  }

  get isOpen() { return this.targetOpen; }
  get blocksSight() { return this.openAmount < 0.35; }
  get blocksMovement() { return this.kind === 'exit' ? this.openAmount < 0.92 : this.openAmount < 0.6; }
  get moving() { return this.openAmount !== (this.targetOpen ? 1 : 0); }

  colliders(): AABB[] {
    return this.blocksMovement ? [...this.geo.jambs, this.geo.panel] : this.geo.jambs;
  }

  frame(): AABB[] {
    return this.geo.jambs;
  }

  /** Swing away from whoever opens it. */
  requestOpen(fromX: number, fromZ: number) {
    if (this.locked || this.targetOpen) return;
    const cxw = this.cx * 2 + 1, czw = this.cz * 2 + 1;
    const side = this.axis === 'x' ? Math.sign(cxw - fromX) : Math.sign(czw - fromZ);
    this.swingSign = side === 0 ? 1 : side;
    this.targetOpen = true;
  }

  requestClose() {
    if (this.kind === 'exit') return;
    this.targetOpen = false;
  }

  update(dt: number) {
    const speed = this.kind === 'exit' ? 1 / SHUTTER_OPEN_SECONDS : 2.4;
    const t = this.targetOpen ? 1 : 0;
    if (this.openAmount < t) this.openAmount = Math.min(t, this.openAmount + speed * dt);
    else if (this.openAmount > t) this.openAmount = Math.max(t, this.openAmount - speed * dt);
  }

  snap(open: boolean) {
    this.targetOpen = open;
    this.openAmount = open ? 1 : 0;
  }
}
