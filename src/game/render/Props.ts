import * as THREE from 'three';
import type { MaterialLibrary } from './Materials';
import type { PropPlacement, PropType } from '../level/PropLayout';
import { rng } from './Textures';

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) geoCache.set(key, (g = make()));
  return g;
}
export const box = (w: number, h: number, d: number) => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
export const cyl = (rt: number, rb: number, h: number, seg = 12) =>
  cached(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const torus = (r: number, t: number) => cached(`t${r},${t}`, () => new THREE.TorusGeometry(r, t, 8, 24));
const sphere = (r: number) => cached(`s${r}`, () => new THREE.SphereGeometry(r, 16, 12));
const capsule = (r: number, l: number) => cached(`k${r},${l}`, () => new THREE.CapsuleGeometry(r, l, 6, 12));

export function add(
  parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material,
  x: number, y: number, z: number, rx = 0, ry = 0, rz = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Builds prop meshes. Every prop is modelled with its front facing local +Z, origin on the floor. */
export class PropBuilder {
  private rand = rng(4242);
  constructor(private readonly m: MaterialLibrary) {}

  build(p: PropPlacement): THREE.Group {
    const g = new THREE.Group();
    g.name = p.id ?? p.type;
    this.builders[p.type](g);
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.rot ?? 0;
    return g;
  }

  private builders: Record<PropType, (g: THREE.Group) => void> = {
    bed: (g) => this.bed(g),
    locker: (g) => this.locker(g),
    shelf: (g) => this.shelf(g),
    table: (g) => this.table(g),
    desk: (g) => this.desk(g),
    receptionDesk: (g) => this.receptionDesk(g),
    nurseCounter: (g) => this.nurseCounter(g),
    chairRow: (g) => this.chairRow(g),
    chair: (g) => this.chair(g),
    wheelchair: (g) => this.wheelchair(g),
    gurney: (g) => this.gurney(g, false),
    bodyGurney: (g) => this.gurney(g, true),
    ivStand: (g) => this.ivStand(g),
    cabinet: (g) => this.cabinet(g),
    bench: (g) => this.bench(g),
    generator: (g) => this.generator(g),
    crate: (g) => this.crate(g),
    pillar: (g) => add(g, box(0.6, 3, 0.6), this.m.walls[0], 0, 1.5, 0),
    curtain: (g) => this.curtain(g),
    nightstand: (g) => this.nightstand(g),
    filing: (g) => this.filing(g),
    medCart: (g) => this.medCart(g),
    boxes: (g) => this.boxes(g),
    trolley: (g) => this.trolley(g),
    fuseBox: (g) => this.fuseBox(g),
  };

  private legs(g: THREE.Group, w: number, d: number, h: number, r = 0.02, mat = this.m.chrome) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, cyl(r, r, h, 8), mat, (sx * w) / 2, h / 2, (sz * d) / 2);
  }

  private bed(g: THREE.Group) {
    const m = this.m;
    this.legs(g, 0.84, 1.9, 0.42, 0.022);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, cyl(0.05, 0.05, 0.04, 10), m.rubber, sx * 0.42, 0.04, sz * 0.95, 0, 0, Math.PI / 2);
    add(g, box(0.92, 0.07, 2.0), m.paintedMetal, 0, 0.44, 0);
    add(g, box(0.88, 0.15, 1.94), m.mattress, 0, 0.55, 0);
    // Crumpled sheet and pillow
    add(g, box(0.94, 0.04, 1.25), m.sheet, 0.01, 0.645, 0.3, 0.03, 0.02, 0.02);
    add(g, box(0.5, 0.06, 0.6), m.sheet, -0.2, 0.68, 0.55, 0.2, 0.5, 0.15);
    add(g, box(0.55, 0.11, 0.34), m.sheet, 0, 0.68, -0.75, 0.08, 0.1, 0);
    // Head and foot boards, side rail
    add(g, box(0.96, 0.55, 0.05), m.paintedMetal, 0, 0.78, -1.0);
    add(g, box(0.96, 0.35, 0.05), m.paintedMetal, 0, 0.65, 1.0);
    add(g, box(0.03, 0.03, 1.2), m.chrome, 0.46, 0.8, -0.2);
    for (const z of [-0.75, 0.35]) add(g, box(0.03, 0.22, 0.03), m.chrome, 0.46, 0.68, z);
  }

  private locker(g: THREE.Group) {
    const m = this.m;
    add(g, box(0.6, 1.95, 0.46), m.locker, 0, 0.975, -0.02);
    // Door on a hinge pivot (left edge), so hiding places can animate it.
    const pivot = new THREE.Group();
    pivot.position.set(-0.29, 0, 0.215);
    g.add(pivot);
    const door = add(pivot, box(0.57, 1.88, 0.025), m.locker, 0.285, 0.97, 0.0);
    add(door, box(0.03, 0.12, 0.03), m.chrome, 0.22, 0.05, 0.03);
    add(g, box(0.6, 0.04, 0.5), m.darkMetal, 0, 1.97, 0);
    g.userData.door = pivot;
  }

  private shelf(g: THREE.Group) {
    const m = this.m;
    for (const sx of [-1.28, 1.28]) for (const sz of [-0.25, 0.25]) add(g, box(0.04, 2.0, 0.04), m.paintedMetal, sx, 1.0, sz);
    const r = this.rand;
    for (const y of [0.1, 0.6, 1.1, 1.6]) {
      add(g, box(2.6, 0.03, 0.55), m.paintedMetal, 0, y, 0);
      // Clutter
      let x = -1.15;
      while (x < 1.05) {
        const w = 0.2 + r() * 0.35;
        const kind = r();
        if (kind < 0.45) {
          const h = 0.15 + r() * 0.25;
          add(g, box(w, h, 0.3 + r() * 0.15), m.cardboard, x + w / 2, y + 0.015 + h / 2, (r() - 0.5) * 0.1, 0, (r() - 0.5) * 0.2);
        } else if (kind < 0.7) {
          for (let k = 0; k < 3; k++) add(g, cyl(0.035, 0.035, 0.18, 8), m.plastic, x + 0.05 + k * 0.08, y + 0.105, (r() - 0.5) * 0.25);
        } else if (kind < 0.85) {
          add(g, box(w, 0.08, 0.35), m.sheet, x + w / 2, y + 0.055, 0);
        }
        x += w + 0.04 + r() * 0.1;
      }
    }
  }

  private table(g: THREE.Group) {
    const m = this.m;
    add(g, box(1.6, 0.04, 0.8), m.paintedMetal, 0, 0.76, 0);
    this.legs(g, 1.5, 0.7, 0.74, 0.02, m.darkMetal);
    add(g, box(1.5, 0.02, 0.7), m.paintedMetal, 0, 0.18, 0);
    add(g, box(0.4, 0.18, 0.2), m.hazard, -0.45, 0.87, -0.1, 0, 0.2, 0);
    add(g, box(0.3, 0.005, 0.22), m.decals.paper[0], 0.3, 0.783, 0.12, 0, 0.4, 0);
  }

  private desk(g: THREE.Group) {
    const m = this.m;
    add(g, box(1.5, 0.04, 0.75), m.wood, 0, 0.74, 0);
    add(g, box(0.45, 0.7, 0.7), m.wood, 0.5, 0.36, 0);
    add(g, box(0.04, 0.72, 0.7), m.wood, -0.71, 0.36, 0);
    add(g, box(1.4, 0.5, 0.02), m.wood, 0, 0.45, -0.34);
    for (let i = 0; i < 3; i++) add(g, box(0.12, 0.02, 0.02), m.brass, 0.5, 0.18 + i * 0.22, 0.36);
    // Lamp & papers
    add(g, cyl(0.07, 0.09, 0.03, 12), m.darkMetal, -0.55, 0.775, -0.2);
    add(g, cyl(0.012, 0.012, 0.35, 6), m.darkMetal, -0.55, 0.94, -0.2, 0.3, 0, 0);
    add(g, cyl(0.04, 0.1, 0.12, 12), m.darkMetal, -0.55, 1.08, -0.13, 0.9, 0, 0);
    add(g, box(0.32, 0.005, 0.24), m.decals.paper[1], -0.1, 0.763, 0.05, 0, 0.3, 0);
  }

  private receptionDesk(g: THREE.Group) {
    const m = this.m;
    // Main counter (front faces +Z toward the waiting area)
    add(g, box(6, 1.02, 0.08), m.laminate, 0, 0.51, 0.36);
    add(g, box(6.1, 0.04, 0.42), m.wood, 0, 1.04, 0.24);
    add(g, box(6, 0.04, 0.7), m.laminate, 0, 0.74, -0.05);
    add(g, box(0.06, 0.74, 0.7), m.laminate, -2.97, 0.37, -0.05);
    // Return
    add(g, box(0.08, 1.02, 2.4), m.laminate, 2.96, 0.51, 1.6);
    add(g, box(0.5, 0.04, 2.45), m.wood, 2.82, 1.04, 1.6);
    add(g, box(0.7, 0.74, 2.4), m.laminate, 2.6, 0.37, 1.6);
    // Monitors, keyboard, phone, bell
    this.monitor(g, -1.2, 0.76, -0.15, 0.2);
    this.monitor(g, 1.4, 0.76, -0.15, -0.3);
    add(g, box(0.45, 0.02, 0.15), m.plastic, -1.2, 0.77, 0.1);
    add(g, box(0.2, 0.08, 0.22), m.darkMetal, 0.2, 0.8, -0.1);
    add(g, cyl(0.05, 0.06, 0.04, 12), m.brass, 2.0, 1.08, 0.25);
    add(g, box(0.32, 0.005, 0.24), m.decals.paper[0], 0.6, 1.063, 0.25, 0, 0.3, 0);
    add(g, box(0.3, 0.12, 0.25), m.cardboard, -2.4, 0.82, -0.1, 0, 0.2, 0);
  }

  private nurseCounter(g: THREE.Group) {
    const m = this.m;
    // Segment A (-1.5..1.5, z -1.6..-0.8) and segment B (0.7..1.5, z -0.8..2.1)
    add(g, box(3, 1.02, 0.08), m.laminate, 0, 0.51, -1.56);
    add(g, box(3.05, 0.04, 0.82), m.wood, 0, 1.04, -1.2);
    add(g, box(3, 0.74, 0.7), m.laminate, 0, 0.37, -1.2);
    add(g, box(0.08, 1.02, 2.9), m.laminate, 1.46, 0.51, 0.65);
    add(g, box(0.82, 0.04, 2.95), m.wood, 1.1, 1.04, 0.65);
    add(g, box(0.7, 0.74, 2.9), m.laminate, 1.1, 0.37, 0.65);
    this.monitor(g, 1.1, 1.06, 0.3, -Math.PI / 2);
    this.monitor(g, -0.6, 1.06, -1.25, Math.PI);
    add(g, box(0.25, 0.08, 0.3), m.plastic, 0.3, 1.1, -1.25);
    for (let i = 0; i < 4; i++) add(g, box(0.06, 0.25, 0.22), m.plastic, -1.2 + i * 0.08, 1.18, -1.3);
    add(g, box(0.3, 0.005, 0.22), m.decals.paper[1], 0.9, 1.063, -1.0);
  }

  private monitor(g: THREE.Group, x: number, y: number, z: number, ry: number) {
    const mon = new THREE.Group();
    mon.position.set(x, y, z);
    mon.rotation.y = ry;
    add(mon, box(0.42, 0.34, 0.36), this.m.plastic, 0, 0.24, -0.05);
    add(mon, box(0.34, 0.26, 0.01), this.m.screen, 0, 0.25, 0.135);
    add(mon, box(0.22, 0.05, 0.2), this.m.plastic, 0, 0.025, 0);
    g.add(mon);
  }

  private chairRow(g: THREE.Group) {
    const m = this.m;
    add(g, box(2.2, 0.05, 0.06), m.chrome, 0, 0.38, 0);
    for (const x of [-0.95, 0.95]) {
      add(g, box(0.05, 0.38, 0.05), m.chrome, x, 0.19, 0);
      add(g, box(0.05, 0.03, 0.5), m.chrome, x, 0.015, 0);
    }
    for (let i = 0; i < 4; i++) {
      const x = -0.81 + i * 0.54;
      const tilt = i === 2 ? 0.25 : 0;
      add(g, box(0.48, 0.05, 0.45), m.seatPlastic, x, 0.44, 0.02, -0.05, 0, tilt * 0.3);
      add(g, box(0.48, 0.42, 0.04), m.seatPlastic, x, 0.68, -0.22, -0.15 - tilt, 0, 0);
    }
  }

  private chair(g: THREE.Group) {
    const m = this.m;
    add(g, box(0.46, 0.06, 0.44), m.seatPlastic, 0, 0.47, 0);
    add(g, box(0.44, 0.45, 0.05), m.seatPlastic, 0, 0.74, -0.21, -0.1, 0, 0);
    add(g, cyl(0.025, 0.025, 0.4, 8), m.chrome, 0, 0.25, 0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      add(g, box(0.03, 0.03, 0.26), m.chrome, Math.sin(a) * 0.13, 0.04, Math.cos(a) * 0.13, 0, a, 0);
    }
  }

  private wheelchair(g: THREE.Group) {
    const m = this.m;
    for (const sx of [-1, 1]) {
      add(g, torus(0.3, 0.018), m.rubber, sx * 0.31, 0.3, 0.05, 0, Math.PI / 2, 0);
      add(g, torus(0.27, 0.008), m.chrome, sx * 0.33, 0.3, 0.05, 0, Math.PI / 2, 0);
      add(g, cyl(0.05, 0.05, 0.03, 10), m.rubber, sx * 0.24, 0.05, 0.42, 0, 0, Math.PI / 2);
      add(g, box(0.02, 0.02, 0.6), m.chrome, sx * 0.24, 0.5, 0.15);
      add(g, box(0.02, 0.55, 0.02), m.chrome, sx * 0.24, 0.75, -0.15, -0.12, 0, 0);
      add(g, box(0.02, 0.4, 0.02), m.chrome, sx * 0.24, 0.3, 0.42);
    }
    add(g, box(0.46, 0.04, 0.42), m.sheet, 0, 0.5, 0.15);
    add(g, box(0.46, 0.42, 0.02), m.mattress, 0, 0.78, -0.16, -0.12, 0, 0);
    add(g, box(0.4, 0.02, 0.12), m.darkMetal, 0, 0.12, 0.5);
  }

  private gurney(g: THREE.Group, body: boolean) {
    const m = this.m;
    add(g, box(0.66, 0.05, 1.96), m.chrome, 0, 0.72, 0);
    add(g, box(0.6, 0.07, 1.9), m.mattress, 0, 0.78, 0);
    for (const sz of [-0.85, 0.85]) {
      add(g, box(0.04, 0.68, 0.04), m.chrome, 0.28, 0.36, sz);
      add(g, box(0.04, 0.68, 0.04), m.chrome, -0.28, 0.36, sz);
      for (const sx of [-0.28, 0.28]) add(g, cyl(0.04, 0.04, 0.03, 10), m.rubber, sx, 0.04, sz, 0, 0, Math.PI / 2);
    }
    add(g, box(0.6, 0.02, 1.7), m.chrome, 0, 0.22, 0);
    if (body) {
      // A covered body: torso, head and legs under a draped sheet.
      add(g, capsule(0.2, 0.9), m.sheet, 0, 0.98, -0.1, Math.PI / 2, 0, 0).scale.set(1.05, 1, 0.55);
      add(g, sphere(0.13), m.sheet, 0, 0.95, -0.82).scale.set(1, 0.85, 1.1);
      add(g, capsule(0.09, 0.6), m.sheet, 0.09, 0.9, 0.62, Math.PI / 2, 0, 0);
      add(g, capsule(0.09, 0.6), m.sheet, -0.09, 0.9, 0.62, Math.PI / 2, 0, 0);
      add(g, box(0.72, 0.4, 0.01), m.sheet, 0, 0.62, 0, 0, Math.PI / 2, 0).scale.set(1, 1, 1);
      add(g, box(0.01, 0.35, 1.9), m.sheet, 0.33, 0.66, 0, 0, 0, 0.12);
      add(g, box(0.01, 0.35, 1.9), m.sheet, -0.33, 0.66, 0, 0, 0, -0.12);
      // An arm slipping out from under the sheet
      add(g, capsule(0.035, 0.42), m.skin, 0.36, 0.7, -0.25, 0.2, 0, 0.35);
    } else {
      add(g, box(0.62, 0.04, 1.1), m.sheet, 0.02, 0.835, 0.35, 0, 0.06, 0.04);
    }
  }

  private ivStand(g: THREE.Group) {
    const m = this.m;
    add(g, cyl(0.012, 0.012, 1.85, 8), m.chrome, 0, 0.95, 0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      add(g, box(0.02, 0.02, 0.3), m.chrome, Math.sin(a) * 0.14, 0.06, Math.cos(a) * 0.14, 0, a, 0);
      add(g, sphere(0.02), m.rubber, Math.sin(a) * 0.28, 0.02, Math.cos(a) * 0.28);
    }
    add(g, box(0.36, 0.012, 0.012), m.chrome, 0, 1.86, 0);
    add(g, box(0.12, 0.2, 0.04), m.ivBag, 0.15, 1.7, 0);
    add(g, cyl(0.003, 0.003, 0.9, 4), m.ivBag, 0.15, 1.15, 0, 0.1, 0, 0);
  }

  private cabinet(g: THREE.Group) {
    const m = this.m;
    add(g, box(1.0, 1.9, 0.44), m.paintedMetal, 0, 0.95, 0);
    add(g, box(0.92, 1.1, 0.01), m.glass, 0, 1.3, 0.225);
    for (const y of [0.9, 1.3, 1.65]) {
      add(g, box(0.9, 0.02, 0.38), m.paintedMetal, 0, y, 0);
      for (let i = 0; i < 6; i++) if (this.rand() < 0.6) add(g, cyl(0.03, 0.03, 0.12, 8), m.plastic, -0.38 + i * 0.15, y + 0.07, 0.05);
    }
    add(g, box(0.96, 0.6, 0.01), m.paintedMetal, 0, 0.35, 0.225);
  }

  private bench(g: THREE.Group) {
    const m = this.m;
    add(g, box(2.0, 0.05, 0.38), m.wood, 0, 0.43, 0);
    for (const x of [-0.85, 0.85]) add(g, box(0.05, 0.42, 0.34), m.darkMetal, x, 0.21, 0);
  }

  private generator(g: THREE.Group) {
    const m = this.m;
    add(g, box(2.6, 1.3, 1.3), m.darkMetal, 0, 0.75, 0);
    add(g, box(2.7, 0.1, 1.4), m.hazard, 0, 0.05, 0);
    add(g, box(1.2, 0.8, 0.02), m.locker, -0.5, 0.8, 0.66);
    for (let i = 0; i < 3; i++) add(g, cyl(0.07, 0.07, 0.03, 16), m.chrome, 0.5 + i * 0.25, 1.1, 0.66, Math.PI / 2, 0, 0);
    add(g, cyl(0.08, 0.08, 1.6, 10), m.paintedMetal, 1.0, 2.15, -0.3);
    add(g, cyl(0.06, 0.06, 2.2, 10), m.paintedMetal, -0.9, 1.9, -0.55, 0, 0, Math.PI / 2);
    add(g, box(0.4, 0.3, 0.3), m.darkMetal, 1.0, 1.5, -0.3);
  }

  private crate(g: THREE.Group) {
    const m = this.m;
    add(g, box(1.0, 1.0, 1.0), m.wood, 0, 0.5, 0);
    for (const y of [0.15, 0.85]) add(g, box(1.02, 0.08, 1.02), m.darkMetal, 0, y, 0);
  }

  private curtain(g: THREE.Group) {
    const geo = cached('curtain', () => {
      const p = new THREE.PlaneGeometry(2.0, 1.9, 40, 6);
      const pos = p.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        pos.setZ(i, Math.sin(x * 9) * 0.05 + Math.sin(x * 23) * 0.015 + (y < -0.5 ? Math.sin(x * 4) * 0.04 : 0));
      }
      p.computeVertexNormals();
      return p;
    });
    add(g, geo, this.m.curtain, 0, 1.05, 0);
    add(g, cyl(0.012, 0.012, 2.1, 6), this.m.chrome, 0, 2.0, 0, 0, 0, Math.PI / 2);
  }

  private nightstand(g: THREE.Group) {
    const m = this.m;
    add(g, box(0.5, 0.6, 0.45), m.paintedMetal, 0, 0.3, 0);
    add(g, box(0.44, 0.15, 0.01), m.paintedMetal, 0, 0.47, 0.226);
    add(g, box(0.1, 0.015, 0.02), m.chrome, 0, 0.47, 0.24);
    add(g, cyl(0.035, 0.03, 0.1, 10), m.plastic, -0.15, 0.65, -0.1);
  }

  private filing(g: THREE.Group) {
    const m = this.m;
    add(g, box(0.5, 1.3, 0.6), m.paintedMetal, 0, 0.65, 0);
    for (let i = 0; i < 4; i++) {
      add(g, box(0.46, 0.28, 0.01), m.paintedMetal, 0, 0.2 + i * 0.31, 0.302);
      add(g, box(0.12, 0.02, 0.025), m.chrome, 0, 0.27 + i * 0.31, 0.31);
    }
  }

  private medCart(g: THREE.Group) {
    const m = this.m;
    add(g, box(0.6, 0.8, 0.45), m.paintedMetal, 0, 0.5, 0);
    add(g, box(0.64, 0.03, 0.49), m.plastic, 0, 0.915, 0);
    for (let i = 0; i < 4; i++) add(g, box(0.56, 0.17, 0.01), m.plastic, 0, 0.2 + i * 0.19, 0.226);
    for (const sx of [-0.25, 0.25]) for (const sz of [-0.18, 0.18]) add(g, cyl(0.04, 0.04, 0.03, 10), m.rubber, sx, 0.05, sz, 0, 0, Math.PI / 2);
  }

  private boxes(g: THREE.Group) {
    const m = this.m;
    add(g, box(0.8, 0.45, 0.6), m.cardboard, 0, 0.225, 0);
    add(g, box(0.6, 0.35, 0.5), m.cardboard, 0.05, 0.625, 0.02, 0, 0.2, 0);
    add(g, box(0.4, 0.25, 0.35), m.cardboard, -0.1, 0.925, 0, 0, -0.3, 0.05);
  }

  private trolley(g: THREE.Group) {
    const m = this.m;
    add(g, box(0.6, 0.02, 1.0), m.chrome, 0, 0.18, 0);
    for (const sx of [-0.28, 0.28]) for (const sz of [-0.48, 0.48]) {
      add(g, box(0.025, 0.95, 0.025), m.chrome, sx, 0.55, sz);
      add(g, cyl(0.04, 0.04, 0.03, 10), m.rubber, sx, 0.04, sz, 0, 0, Math.PI / 2);
    }
    add(g, box(0.55, 0.65, 0.95), m.sheet, 0, 0.55, 0);
    add(g, box(0.5, 0.15, 0.6), m.sheet, 0.02, 0.92, 0.1, 0.1, 0.2, 0.1);
  }

  private fuseBox(g: THREE.Group) {
    const m = this.m;
    add(g, box(0.7, 0.9, 0.2), m.paintedMetal, 0, 1.35, 0);
    add(g, box(0.62, 0.8, 0.02), m.darkMetal, 0, 1.35, 0.1);
    // Open door hanging to the side
    add(g, box(0.02, 0.86, 0.66), m.paintedMetal, 0.37, 1.35, 0.42, 0, 0.25, 0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      add(g, box(0.1, 0.16, 0.03), m.darkMetal, -0.22 + c * 0.145, 1.62 - r * 0.26, 0.115);
    }
    add(g, cyl(0.03, 0.03, 0.5, 8), m.darkMetal, 0, 2.05, 0.02);
    add(g, box(0.18, 0.12, 0.01), m.hazard, 0, 1.86, 0.112);
  }
}
