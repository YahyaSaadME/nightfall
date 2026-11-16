import * as THREE from 'three';
import { DoorLogic } from '../level/DoorLogic';
import { JAMB, type PassAxis } from '../level/Grid';
import { CELL, WALL_H, type DoorKind } from '../level/LevelData';
import type { MaterialLibrary } from './Materials';
import { add, box } from './Props';

const DOOR_H = 2.3;
const OPEN_ANGLE = 1.75;

/** A door with its frame, lintel and animated panel (or roller shutter for the exit). */
export class DoorView extends DoorLogic {
  readonly root = new THREE.Group();
  /** Meshes the player can aim at to interact. */
  readonly interactMeshes: THREE.Mesh[] = [];
  private pivot = new THREE.Group();
  private shutter?: THREE.Mesh;
  private statusLed?: THREE.MeshStandardMaterial;

  constructor(cx: number, cz: number, kind: DoorKind, axis: PassAxis, m: MaterialLibrary) {
    super(cx, cz, kind, axis);
    const x0 = cx * CELL, z0 = cz * CELL;
    this.root.position.set(x0 + 1, 0, z0 + 1);
    // Build along local X = the opening width; rotate so the opening lines up with the wall.
    const inner = new THREE.Group();
    inner.rotation.y = axis === 'x' ? Math.PI / 2 : 0;
    this.root.add(inner);
    const open = CELL - JAMB * 2; // 1.2m

    // Jambs (full depth) and lintel
    for (const s of [-1, 1]) add(inner, box(JAMB, WALL_H, CELL), m.walls[1], s * (open / 2 + JAMB / 2), WALL_H / 2, 0);
    add(inner, box(open, WALL_H - DOOR_H, CELL), m.walls[1], 0, DOOR_H + (WALL_H - DOOR_H) / 2, 0);
    // Steel frame trims on both faces
    for (const face of [-1, 1]) {
      for (const s of [-1, 1]) add(inner, box(0.07, DOOR_H, 0.05), m.frame, s * (open / 2 + 0.035), DOOR_H / 2, face * (CELL / 2 + 0.02));
      add(inner, box(open + 0.14, 0.07, 0.05), m.frame, 0, DOOR_H + 0.035, face * (CELL / 2 + 0.02));
    }
    // Tunnel lining so the 2m deep opening reads as a vestibule
    for (const s of [-1, 1]) add(inner, box(0.02, DOOR_H, CELL - 0.02), m.frame, s * (open / 2 - 0.01), DOOR_H / 2, 0);

    if (kind === 'exit') {
      const sh = add(inner, box(open + 0.02, DOOR_H, 0.08), m.shutter, 0, DOOR_H / 2, 0.6);
      this.shutter = sh;
      this.interactMeshes.push(sh);
      add(inner, box(open + 0.2, 0.3, 0.3), m.darkMetal, 0, DOOR_H + 0.15, 0.6);
    } else {
      this.pivot.position.set(-open / 2, 0, 0);
      inner.add(this.pivot);
      const mat = kind === 'normal' ? m.door : m.doorRestricted;
      const panel = add(this.pivot, box(open - 0.02, DOOR_H - 0.03, 0.05), mat, open / 2, DOOR_H / 2, 0);
      this.interactMeshes.push(panel);
      // Push bars / handles on both faces
      for (const f of [-1, 1]) {
        add(panel, box(0.04, 0.03, 0.06), m.chrome, open / 2 - 0.15, -0.1, f * 0.05);
        add(panel, box(0.14, 0.025, 0.025), m.chrome, open / 2 - 0.2, -0.1, f * 0.075);
      }
      if (kind !== 'normal') {
        // Card reader / power indicator beside the door
        this.statusLed = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 1.2 });
        for (const f of [-1, 1]) {
          const reader = add(inner, box(0.1, 0.16, 0.03), m.darkMetal, open / 2 + 0.25, 1.2, f * (CELL / 2 + 0.02));
          add(reader, box(0.03, 0.03, 0.01), this.statusLed, 0, 0.05, f * 0.02);
        }
      }
    }
  }

  /** Parts that animate and must not be merged into static batches. */
  get dynamicParts(): THREE.Object3D[] {
    return this.shutter ? [this.shutter] : [this.pivot];
  }

  setLocked(locked: boolean) {
    this.locked = locked;
    if (this.statusLed) {
      this.statusLed.emissive.setHex(locked ? 0xff2010 : 0x20ff60);
      this.statusLed.emissiveIntensity = locked ? 1.2 : 0.8;
    }
  }

  override update(dt: number) {
    super.update(dt);
    if (this.shutter) {
      // Rolls up into the housing: shrink from the bottom, keep the top edge fixed.
      const k = 0.88;
      this.shutter.scale.y = 1 - this.openAmount * k;
      this.shutter.position.y = DOOR_H / 2 + (this.openAmount * k * DOOR_H) / 2;
    } else {
      // Ease the swing for weight. swingSign is +1 when opened from the low side of the
      // passage axis; a negative rotation swings the panel toward the high side.
      const t = this.openAmount;
      const eased = t * t * (3 - 2 * t);
      this.pivot.rotation.y = -this.swingSign * eased * OPEN_ANGLE;
    }
  }
}
