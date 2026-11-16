import * as THREE from 'three';
import type { EnemyState } from '../ai/EnemyAI';
import type { ZombieKind } from '../ai/ZombieTypes';
import { ZOMBIE_DEFS } from '../ai/ZombieTypes';
import type { MaterialLibrary } from './Materials';

export interface ZombiePose {
  speed: number;
  state: EnemyState;
  attackTimer: number;
  windup: number;
  alive: boolean;
  /** Seconds since death (0 while alive). */
  deadT: number;
  /** True while staggering from a hit. */
  flinch: boolean;
}

/** Geometry and materials are built once and shared by every zombie. */
interface Shared {
  torso: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  jaw: THREE.BufferGeometry;
  thigh: THREE.BufferGeometry;
  shin: THREE.BufferGeometry;
  upperArm: THREE.BufferGeometry;
  foreArm: THREE.BufferGeometry;
  rags: THREE.MeshStandardMaterial;
  wound: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  mouth: THREE.MeshStandardMaterial;
  eye: THREE.MeshStandardMaterial;
}
let shared: Shared | null = null;

function getShared(m: MaterialLibrary): Shared {
  if (shared) return shared;
  const cap = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 4, 8);
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  shared = {
    torso: cap(0.16, 0.42),
    head: new THREE.SphereGeometry(0.115, 12, 10),
    jaw: new THREE.SphereGeometry(0.07, 8, 6),
    thigh: cap(0.065, 0.36),
    shin: cap(0.05, 0.38),
    upperArm: cap(0.045, 0.28),
    foreArm: cap(0.038, 0.3),
    rags: std({ color: 0x2e302b, roughness: 0.97, side: THREE.DoubleSide }),
    wound: std({ color: 0x3a0a08, roughness: 0.35 }),
    skin: m.skin,
    mouth: m.mouth,
    eye: std({ color: 0x1a1612, emissive: 0x6a5a22, emissiveIntensity: 0.9, roughness: 0.2 }),
  };
  return shared;
}

/**
 * A cheap, shambling zombie (13 meshes, shared geometry and materials) so a pack of them
 * costs little next to the one hero stalker. Front faces local +Z.
 */
export class ZombieModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private chest = new THREE.Group();
  private head = new THREE.Group();
  private jaw: THREE.Mesh;
  private legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  private arms: { shoulder: THREE.Group; elbow: THREE.Group }[] = [];
  private phase = Math.random() * 6;
  private t = Math.random() * 10;
  private kind: ZombieKind = 'walker';
  private lean = 0.2;
  private fall = 0;

  constructor(m: MaterialLibrary) {
    const s = getShared(m);
    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = 0.92;

    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.x = side * 0.1;
      this.hips.add(hip);
      const thigh = new THREE.Mesh(s.thigh, s.rags);
      thigh.position.y = -0.24;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.46;
      hip.add(knee);
      const shin = new THREE.Mesh(s.shin, s.skin);
      shin.position.y = -0.24;
      knee.add(shin);
      this.legs.push({ hip, knee });
    }

    this.hips.add(this.chest);
    this.chest.position.y = 0.06;
    const torso = new THREE.Mesh(s.torso, s.rags);
    torso.position.y = 0.3;
    torso.scale.set(1.1, 1, 0.72);
    this.chest.add(torso);
    const wound = new THREE.Mesh(s.jaw, s.wound);
    wound.position.set(0.07, 0.34, 0.1);
    wound.scale.set(1.2, 1.6, 0.5);
    this.chest.add(wound);

    this.chest.add(this.head);
    this.head.position.y = 0.72;
    const skull = new THREE.Mesh(s.head, s.skin);
    skull.scale.set(0.9, 1.15, 1);
    this.head.add(skull);
    this.jaw = new THREE.Mesh(s.jaw, s.skin);
    this.jaw.position.set(0, -0.09, 0.04);
    this.head.add(this.jaw);
    const mouth = new THREE.Mesh(s.jaw, s.mouth);
    mouth.scale.set(0.8, 0.9, 0.4);
    mouth.position.set(0, -0.06, 0.1);
    this.head.add(mouth);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), s.eye);
      eye.position.set(side * 0.045, 0.03, 0.105);
      this.head.add(eye);
    }

    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.22, 0.5, 0);
      this.chest.add(shoulder);
      const upper = new THREE.Mesh(s.upperArm, s.rags);
      upper.position.y = -0.18;
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.34;
      shoulder.add(elbow);
      const fore = new THREE.Mesh(s.foreArm, s.skin);
      fore.position.y = -0.2;
      elbow.add(fore);
      this.arms.push({ shoulder, elbow });
    }

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.userData.dynamic = true;
      }
    });
    this.root.userData.dynamic = true;
  }

  setKind(kind: ZombieKind) {
    this.kind = kind;
    const sc = ZOMBIE_DEFS[kind].scale;
    this.root.scale.setScalar(sc);
    this.fall = 0;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
  }

  update(dt: number, pose: ZombiePose) {
    this.t += dt;
    if (!pose.alive) {
      // Topple backwards, then sink slightly into the floor as the body goes cold.
      this.fall = Math.min(1, pose.deadT / 0.55);
      const k = this.fall * this.fall * (3 - 2 * this.fall);
      this.body.rotation.x = -k * (Math.PI / 2 - 0.05);
      this.body.position.y = 0.12 * k - Math.max(0, pose.deadT - 4.5) * 0.25;
      this.body.position.z = -0.35 * k;
      this.arms.forEach((a, i) => { a.shoulder.rotation.x += (-1.2 - a.shoulder.rotation.x) * Math.min(1, dt * 6); a.shoulder.rotation.z = (i ? 1 : -1) * 0.5; });
      return;
    }
    const chase = pose.state === 'Chase';
    const moving = pose.speed > 0.1;
    const stride = this.kind === 'runner' ? 1.2 : 1.0;
    this.phase += (pose.speed * dt) / stride * Math.PI;
    const amp = Math.min(1, pose.speed / 2.2) * (chase ? 1 : 0.7);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);

    const targetLean = pose.state === 'Attack' ? 0.5 : chase ? 0.42 : pose.state === 'Recover' ? (pose.flinch ? -0.35 : 0.3) : 0.2;
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 7);
    this.hips.rotation.x = this.lean * 0.6;
    this.chest.rotation.x = this.lean * 0.5;
    this.hips.position.y = 0.92 - Math.abs(c) * 0.035 * amp;
    // A lurching, uneven gait: one side drags.
    this.hips.rotation.y = s * 0.14 * amp;
    this.chest.rotation.y = -s * 0.2 * amp;
    this.chest.rotation.z = Math.sin(this.phase * 0.5) * 0.08 * amp + (moving ? 0.06 : 0);

    this.legs.forEach((l, i) => {
      const ls = i === 0 ? s : -s;
      l.hip.rotation.x = -ls * 0.5 * amp - 0.08;
      l.knee.rotation.x = Math.max(0, i === 0 ? c : -c) * 0.8 * amp + (i === 1 ? 0.18 * amp : 0.08);
    });

    // Head lolls and snaps.
    this.head.rotation.z += (Math.sin(this.t * 0.9) * 0.25 + 0.2 - this.head.rotation.z) * Math.min(1, dt * 3);
    this.head.rotation.x += ((chase ? -0.3 : 0.15) - this.head.rotation.x) * Math.min(1, dt * 4);
    this.jaw.position.y = -0.09 - (chase || pose.state === 'Attack' ? 0.03 + Math.sin(this.t * 11) * 0.01 : 0.01);

    // Arms: reaching forward, clawing when chasing, a heavy overhead swing on attack.
    this.arms.forEach((a, i) => {
      let sx: number, ex: number;
      if (pose.state === 'Attack') {
        const w = pose.attackTimer / pose.windup;
        if (w < 1) { sx = -1.4 - w * 1.3; ex = -0.3; }
        else { const f = Math.min(1, (w - 1) * 4); sx = -2.7 + f * 2.1; ex = -0.2 - f * 0.6; }
      } else if (chase) {
        sx = -1.45 + (i === 0 ? s : -s) * 0.25; ex = -0.35;
      } else {
        sx = -0.95 + Math.sin(this.t * 1.1 + i * 1.7) * 0.12 + (i === 0 ? -s : s) * 0.2 * amp; ex = -0.45;
      }
      a.shoulder.rotation.x += (sx - a.shoulder.rotation.x) * Math.min(1, dt * 10);
      a.elbow.rotation.x += (ex - a.elbow.rotation.x) * Math.min(1, dt * 10);
      a.shoulder.rotation.z = (i === 0 ? -1 : 1) * 0.12;
    });
  }
}
