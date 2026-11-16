import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CollisionWorld, Grid } from '../level/Grid';
import { CELL, WALL_H, ITEM_SPAWNS, BATTERY_SPAWNS, HIDE_SPOTS, type ItemId } from '../level/LevelData';
import { ALL_PROPS, allPropColliders } from '../level/PropLayout';
import type { MaterialLibrary } from './Materials';
import { PropBuilder, add, box, cyl } from './Props';
import { DoorView } from './DoorView';
import { LightingController } from './Lighting';
import { rng, signTexture, type TexOpts } from './Textures';

export interface LockerRef { group: THREE.Group; door: THREE.Group; meshes: THREE.Mesh[] }

export interface WorldBuild {
  root: THREE.Group;
  grid: Grid;
  collision: CollisionWorld;
  doors: DoorView[];
  doorAt: (cx: number, cz: number) => DoorView | undefined;
  exitDoor: DoorView;
  occluders: THREE.Object3D[];
  lockers: Map<string, LockerRef>;
  items: Map<ItemId | string, THREE.Object3D>;
  patientLog: THREE.Object3D;
  fuseBox: THREE.Object3D;
  fuseInserted: THREE.Object3D;
  fuseLed: THREE.MeshStandardMaterial;
  lighting: LightingController;
  outsideLight: THREE.PointLight;
}

export function buildWorld(m: MaterialLibrary, tex: TexOpts, maxLights: number): WorldBuild {
  const root = new THREE.Group();
  root.name = 'world';
  const grid = new Grid();
  const W = grid.w * CELL, H = grid.h * CELL;

  // ---------------------------------------------------------------- floor & ceiling
  const floorGeo = new THREE.PlaneGeometry(W, H);
  floorGeo.rotateX(-Math.PI / 2);
  const fm = m.floor;
  (fm.map as THREE.Texture).repeat.set(W / 4, H / 4);
  (fm.bumpMap as THREE.Texture).repeat.set(W / 4, H / 4);
  const floor = new THREE.Mesh(floorGeo, fm);
  floor.position.set(W / 2, 0, H / 2);
  floor.receiveShadow = true;
  root.add(floor);

  const ceilGeo = new THREE.PlaneGeometry(W, H);
  ceilGeo.rotateX(Math.PI / 2);
  const cm = m.ceiling;
  (cm.map as THREE.Texture).repeat.set(W / 2, H / 2);
  (cm.bumpMap as THREE.Texture).repeat.set(W / 2, H / 2);
  const ceiling = new THREE.Mesh(ceilGeo, cm);
  ceiling.position.set(W / 2, WALL_H, H / 2);
  ceiling.receiveShadow = true;
  root.add(ceiling);

  // ---------------------------------------------------------------- walls (instanced, 3 variants)
  const wallCells: [number, number][][] = [[], [], []];
  grid.forEachCell((cx, cz) => {
    if (!grid.isWall(cx, cz)) return;
    let exposed = false;
    for (let dz = -1; dz <= 1 && !exposed; dz++)
      for (let dx = -1; dx <= 1; dx++) if (grid.inBounds(cx + dx, cz + dz) && !grid.isWall(cx + dx, cz + dz)) { exposed = true; break; }
    if (!exposed) return;
    const h = (cx * 73856093) ^ (cz * 19349663);
    const v = Math.abs(h) % 7 === 0 ? 2 : Math.abs(h) % 2;
    wallCells[v].push([cx, cz]);
  });
  const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
  const occluders: THREE.Object3D[] = [];
  const mtx = new THREE.Matrix4();
  wallCells.forEach((cells, v) => {
    const inst = new THREE.InstancedMesh(wallGeo, m.walls[v], cells.length);
    cells.forEach(([cx, cz], i) => {
      mtx.makeTranslation(cx * CELL + 1, WALL_H / 2, cz * CELL + 1);
      inst.setMatrixAt(i, mtx);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    root.add(inst);
    occluders.push(inst);
  });

  // ---------------------------------------------------------------- doors
  const doors: DoorView[] = [];
  const doorMap = new Map<number, DoorView>();
  grid.forEachCell((cx, cz) => {
    const kind = grid.doorKind(cx, cz);
    if (!kind) return;
    const d = new DoorView(cx, cz, kind, grid.passAxis(cx, cz), m);
    doors.push(d);
    doorMap.set(grid.index(cx, cz), d);
    root.add(d.root);
    d.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !d.interactMeshes.includes(o as THREE.Mesh)) occluders.push(o); });
  });
  const doorAt = (cx: number, cz: number) => (grid.inBounds(cx, cz) ? doorMap.get(grid.index(cx, cz)) : undefined);
  const exitDoor = doors.find((d) => d.kind === 'exit')!;

  const collision = new CollisionWorld(grid, allPropColliders(), doorAt);

  // ---------------------------------------------------------------- props
  const builder = new PropBuilder(m);
  const lockers = new Map<string, LockerRef>();
  let fuseBox: THREE.Object3D = root;
  for (const p of ALL_PROPS) {
    const g = builder.build(p);
    root.add(g);
    if (p.type === 'locker' && p.id) {
      const meshes: THREE.Mesh[] = [];
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      lockers.set(p.id, { group: g, door: g.userData.door as THREE.Group, meshes });
    }
    if (p.id === 'fusebox') fuseBox = g;
  }

  // Fuse slot (inside the fuse box) and status LED
  const fuseLed = new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xff1a0a, emissiveIntensity: 1.5 });
  add(fuseBox, box(0.04, 0.04, 0.02), fuseLed, 0.22, 1.86, 0.115);
  const fuseInserted = new THREE.Group();
  add(fuseInserted, cyl(0.022, 0.022, 0.1, 12), m.ceramic, 0, 0, 0, 0, 0, 0);
  for (const s of [-1, 1]) add(fuseInserted, cyl(0.025, 0.025, 0.02, 12), m.brass, 0, s * 0.05, 0);
  fuseInserted.position.set(0.215, 1.1, 0.13);
  fuseInserted.visible = false;
  fuseBox.add(fuseInserted);

  // ---------------------------------------------------------------- items
  const items = new Map<string, THREE.Object3D>();
  const fuse = new THREE.Group();
  add(fuse, cyl(0.024, 0.024, 0.11, 14), m.ceramic, 0, 0, 0);
  for (const s of [-1, 1]) add(fuse, cyl(0.027, 0.027, 0.022, 14), m.brass, 0, s * 0.055, 0);
  fuse.rotation.z = Math.PI / 2;
  fuse.rotation.y = 0.4;
  placeItem(fuse, ITEM_SPAWNS.fuse.x, ITEM_SPAWNS.fuse.y + 0.027, ITEM_SPAWNS.fuse.z);
  items.set('fuse', fuse);

  const card = new THREE.Group();
  add(card, box(0.086, 0.003, 0.054), m.keycard, 0, 0, 0);
  add(card, box(0.086, 0.0035, 0.012), m.darkMetal, 0, 0, 0.012);
  add(card, box(0.02, 0.0035, 0.025), m.decals.blood[0], 0.02, 0, -0.01);
  card.rotation.y = 0.7;
  placeItem(card, ITEM_SPAWNS.keycard.x, ITEM_SPAWNS.keycard.y + 0.002, ITEM_SPAWNS.keycard.z);
  items.set('keycard', card);

  const key = new THREE.Group();
  add(key, new THREE.TorusGeometry(0.018, 0.005, 8, 16), m.brass, -0.045, 0, 0, Math.PI / 2, 0, 0);
  add(key, box(0.07, 0.006, 0.008), m.brass, 0.0, 0, 0);
  add(key, box(0.012, 0.006, 0.02), m.brass, 0.028, 0, 0.012);
  add(key, box(0.04, 0.003, 0.03), m.decals.blood[1], -0.09, 0, 0.0);
  add(key, box(0.035, 0.002, 0.05), m.hazard, -0.085, 0.002, 0.005);
  key.rotation.y = -0.5;
  placeItem(key, ITEM_SPAWNS.exitKey.x, ITEM_SPAWNS.exitKey.y + 0.004, ITEM_SPAWNS.exitKey.z);
  items.set('exitKey', key);

  for (const b of BATTERY_SPAWNS) {
    const bat = new THREE.Group();
    add(bat, cyl(0.022, 0.022, 0.07, 14), m.battery, 0, 0.035, 0);
    add(bat, cyl(0.016, 0.016, 0.008, 12), m.batteryCap, 0, 0.074, 0);
    add(bat, cyl(0.0225, 0.0225, 0.012, 14), m.batteryCap, 0, 0.006, 0);
    placeItem(bat, b.x, b.y, b.z);
    items.set(b.id, bat);
  }

  // Reception patient log (clipboard)
  const patientLog = new THREE.Group();
  add(patientLog, box(0.24, 0.012, 0.32), m.wood, 0, 0, 0);
  add(patientLog, box(0.21, 0.003, 0.27), m.decals.paper[0], 0, 0.008, 0.01);
  add(patientLog, box(0.08, 0.015, 0.03), m.chrome, 0, 0.01, -0.14);
  patientLog.position.set(26, 1.07, 28.55);
  patientLog.rotation.y = 0.25;
  root.add(patientLog);

  function placeItem(obj: THREE.Object3D, x: number, y: number, z: number) {
    obj.position.set(x, y, z);
    obj.userData.dynamic = true;
    root.add(obj);
  }

  // ---------------------------------------------------------------- signage
  const sign = (text: string, sub: string, style: 'plain' | 'red' | 'exit', x: number, y: number, z: number, ry: number, w = 0.9, h = 0.22) => {
    const mat = new THREE.MeshStandardMaterial({
      map: signTexture(text, sub, tex, style), roughness: 0.6,
      emissive: style === 'exit' ? 0xff3020 : 0x000000, emissiveIntensity: style === 'exit' ? 0.5 : 0,
      emissiveMap: style === 'exit' ? signTexture(text, sub, tex, style) : null,
    });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    s.position.set(x, y, z);
    s.rotation.y = ry;
    root.add(s);
    return s;
  };
  const E = Math.PI / 2;
  // Door lintel signs: east/west faces (passage along X) or north/south faces.
  sign('STORAGE', '', 'plain', 18.005, 2.6, 7, E);
  sign('MAINTENANCE', '', 'plain', 18.005, 2.6, 19, E, 1.1);
  sign('STAFF', 'LOCKER ROOM', 'plain', 21.995, 2.6, 7, -E);
  sign("NURSES' STATION", 'POWER-LOCKED', 'plain', 21.995, 2.6, 19, -E, 1.2);
  sign('RESTRICTED', 'AUTHORISED STAFF ONLY', 'red', 33.995, 2.6, 31, -E, 1.2, 0.28);
  sign('RESTRICTED', 'AUTHORISED STAFF ONLY', 'red', 33.995, 2.6, 7, -E, 1.2, 0.28);
  sign('ISOLATION', 'WARD A', 'plain', 39.995, 2.6, 7, -E);
  sign('DIRECTOR', 'PRIVATE', 'plain', 39.995, 2.6, 19, -E);
  sign('WARD C', 'DO NOT ENTER', 'red', 39.995, 2.6, 31, -E);
  sign('EXIT', '', 'exit', 19, 2.62, 35.995, Math.PI, 0.6, 0.16);
  sign('RECEPTION', '', 'plain', 27, 2.5, 26.005, 0, 1.4, 0.3);
  sign('EAST CORRIDOR', 'STORAGE  ·  MAINTENANCE  ·  STAFF', 'plain', 22.6, 2.55, 26.005, 0, 1.3, 0.3);

  // ---------------------------------------------------------------- decals
  const r = rng(2024);
  const decal = (mat: THREE.Material, x: number, z: number, size: number, rot = r() * Math.PI * 2, y = 0.004) => {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    d.rotation.x = -Math.PI / 2;
    d.rotation.z = rot;
    d.position.set(x, y, z);
    d.receiveShadow = true;
    root.add(d);
  };
  // Story decals
  decal(m.decals.drag[0], 23.5, 30.5, 3, 0.15);
  decal(m.decals.drag[0], 20.2, 23.5, 3, Math.PI / 2 + 0.1);
  decal(m.decals.blood[0], 20.4, 21.5, 1.6);
  decal(m.decals.blood[1], 44.5, 31.5, 2.2);
  decal(m.decals.blood[0], 38.6, 14, 1.4);
  decal(m.decals.blood[1], 3.6, 31, 1.0);
  decal(m.decals.paper[0], 25.5, 30, 0.9);
  decal(m.decals.paper[1], 44.2, 18.6, 1.0);
  decal(m.decals.paper[0], 29, 21.5, 0.8);
  // Ambient grime scattered over walkable floor
  let placed = 0;
  for (let i = 0; i < 400 && placed < 70; i++) {
    const x = 2 + r() * (W - 4), z = 2 + r() * (H - 4);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (grid.isWall(cx, cz) || grid.doorKind(cx, cz)) continue;
    const kind = r();
    const mat = kind < 0.45 ? m.decals.stain[Math.floor(r() * 3)] : kind < 0.75 ? m.decals.debris[Math.floor(r() * 2)] : kind < 0.92 ? m.decals.paper[Math.floor(r() * 2)] : m.decals.blood[Math.floor(r() * 2)];
    decal(mat, x, z, 0.6 + r() * 1.6, undefined, 0.003 + placed * 0.00002);
    placed++;
  }
  // Wall-base stains are part of the wall texture; add hanging cables from missing ceiling tiles.
  for (const [x, z] of [[11, 33], [20.5, 10], [38.5, 22], [6, 20], [45, 9]]) {
    const len = 0.6 + r() * 0.9;
    add(root, cyl(0.008, 0.008, len, 5), m.rubber, x, WALL_H - len / 2, z, 0.1, 0, 0.15);
  }
  // Maintenance pipes along the ceiling
  for (const z of [14.6, 15.0]) add(root, cyl(0.06, 0.06, 13.6, 10), m.paintedMetal, 9, 2.7, z, 0, 0, Math.PI / 2);
  add(root, cyl(0.05, 0.05, 9.5, 10), m.darkMetal, 2.5, 2.75, 19, Math.PI / 2, 0, 0);

  // ---------------------------------------------------------------- outside (visible once the shutter opens)
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), m.exterior);
  outside.position.set(19, 0, 52);
  root.add(outside);
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x1a2a38, fog: false });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), skyMat);
  sky.position.set(19, 10, 66);
  sky.rotation.y = Math.PI;
  root.add(sky);
  const outsideLight = new THREE.PointLight(0x7f9ec0, 0, 18, 1.6);
  outsideLight.position.set(19, 2.6, 41);
  root.add(outsideLight);

  // ---------------------------------------------------------------- lighting
  const lighting = new LightingController(m, collision, maxLights);
  root.add(lighting.group);

  // Merge every static mesh that shares a material into one draw call.
  const keep = new Set<THREE.Object3D>([
    ...doors.flatMap((d) => d.dynamicParts),
    ...[...lockers.values()].map((l) => l.group),
    ...items.values(),
    patientLog,
    fuseBox,
  ]);
  batchStatic(root, keep);

  // Static geometry never moves: skip per-frame matrix updates.
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.userData.dynamic) return;
    let p: THREE.Object3D | null = o;
    while (p) { if (p.userData.dynamic) return; p = p.parent; }
    if (doors.some((d) => d.dynamicParts.some((p) => isDescendant(o, p)))) return;
    if ([...lockers.values()].some((l) => isDescendant(o, l.door))) return;
    o.matrixAutoUpdate = false;
  });

  void HIDE_SPOTS;
  return {
    root, grid, collision, doors, doorAt, exitDoor, occluders, lockers, items, patientLog, fuseBox, fuseInserted, fuseLed,
    lighting, outsideLight,
  };
}

/**
 * Static batching: bakes world transforms into merged geometries grouped by material
 * (and shadow casting), cutting ~1300 draw calls down to a few dozen.
 */
function batchStatic(root: THREE.Object3D, keep: Set<THREE.Object3D>) {
  root.updateMatrixWorld(true);
  const groups = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();
  const remove: THREE.Mesh[] = [];
  const kept = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (keep.has(p)) return true;
    return false;
  };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material) || kept(m)) return;
    if (m.children.some((c) => (c as THREE.Mesh).isMesh && kept(c))) return;
    const g = m.geometry.index ? m.geometry.clone() : null;
    if (!g) return;
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv || !g.attributes.normal) return;
    g.morphAttributes = {};
    g.applyMatrix4(m.matrixWorld);
    const mat = m.material as THREE.Material;
    const cast = m.castShadow && !mat.transparent;
    const key = `${mat.uuid}|${cast}`;
    let entry = groups.get(key);
    if (!entry) groups.set(key, (entry = { mat, cast, geos: [] }));
    entry.geos.push(g);
    remove.push(m);
  });
  for (const m of remove) {
    // Re-parent any (non-mesh) children before removing.
    for (const c of [...m.children]) if (!(c as THREE.Mesh).isMesh) m.parent?.add(c);
    m.parent?.remove(m);
  }
  for (const { mat, cast, geos } of groups.values()) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.renderOrder = mat.transparent ? 1 : 0;
    root.add(mesh);
    geos.forEach((g) => g.dispose());
  }
}

function isDescendant(o: THREE.Object3D, ancestor: THREE.Object3D) {
  let p: THREE.Object3D | null = o;
  while (p) { if (p === ancestor) return true; p = p.parent; }
  return false;
}
