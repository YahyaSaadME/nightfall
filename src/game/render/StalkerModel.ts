import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MaterialLibrary } from './Materials';
import type { EnemyState } from '../ai/EnemyAI';

const capsule = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 6, 12);

function limb(parent: THREE.Object3D, mat: THREE.Material, r: number, len: number, y: number): { pivot: THREE.Group; end: THREE.Group } {
  const pivot = new THREE.Group();
  pivot.position.y = y;
  parent.add(pivot);
  const mesh = new THREE.Mesh(capsule(r, len), mat);
  mesh.position.y = -len / 2;
  mesh.castShadow = true;
  pivot.add(mesh);
  const end = new THREE.Group();
  end.position.y = -len - r * 0.5;
  pivot.add(end);
  return { pivot, end };
}

export interface StalkerPose {
  speed: number;
  state: EnemyState;
  attackTimer: number;
  windup: number;
  lockerReach: boolean;
}

/**
 * Procedural humanoid: ~2.3m tall, emaciated, hunched, with overlong arms that hang
 * below the knees and a head cocked to one side. Front faces local +Z.
 */
export class StalkerModel {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private chest = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private jaw: THREE.Mesh;
  private legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  private arms: { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Group; fingers: THREE.Group[] }[] = [];
  private gown: THREE.Mesh;
  private hair: THREE.Mesh;
  private phase = 0;
  private t = 0;
  private twitch = 0;
  private twitchTarget = new THREE.Euler();
  private lean = 0.3;

  constructor(m: MaterialLibrary) {
    const skin = m.skin;
    this.root.add(this.hips);
    this.hips.position.y = 1.18;

    // Pelvis
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), skin);
    pelvis.scale.set(1.15, 0.7, 0.8);
    pelvis.castShadow = true;
    this.hips.add(pelvis);

    // Legs: long, thin, knees slightly bent
    for (const s of [-1, 1]) {
      const thigh = limb(this.hips, skin, 0.05, 0.52, 0);
      thigh.pivot.position.x = s * 0.11;
      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), skin);
      thigh.end.add(knee);
      const shin = limb(thigh.end, skin, 0.04, 0.52, 0);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.26), skin);
      foot.position.set(0, -0.56, 0.08);
      foot.castShadow = true;
      shin.pivot.add(foot);
      this.legs.push({ hip: thigh.pivot, knee: shin.pivot });
    }

    // Spine and ribcage
    this.hips.add(this.spine);
    this.spine.position.y = 0.06;
    const abdomen = new THREE.Mesh(capsule(0.1, 0.26), skin);
    abdomen.position.y = 0.2;
    abdomen.scale.set(1, 1, 0.75);
    abdomen.castShadow = true;
    this.spine.add(abdomen);
    this.spine.add(this.chest);
    this.chest.position.y = 0.38;
    // Emaciated chest: a narrow core with ribs pressing through the skin
    const core = new THREE.Mesh(capsule(0.12, 0.26), skin);
    core.position.y = 0.16;
    core.scale.set(1.15, 1, 0.68);
    this.chest.add(core);
    for (let i = 0; i < 6; i++) {
      const r = 0.125 - Math.abs(i - 2) * 0.008;
      const rib = new THREE.Mesh(new THREE.TorusGeometry(r, 0.011, 6, 18, Math.PI * 1.15), skin);
      rib.rotation.set(Math.PI / 2 + 0.25, 0, -Math.PI * 0.075);
      rib.scale.set(1.18, 0.72, 1);
      rib.position.set(0, 0.04 + i * 0.055, 0.0);
      this.chest.add(rib);
    }
    for (const s of [-1, 1]) {
      const collar = new THREE.Mesh(capsule(0.014, 0.16), skin);
      collar.rotation.z = Math.PI / 2 + s * 0.25;
      collar.position.set(s * 0.1, 0.33, 0.06);
      this.chest.add(collar);
    }
    // Protruding spine ridge
    for (let i = 0; i < 6; i++) {
      const v = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), skin);
      v.position.set(0, -0.05 + i * 0.075, -0.1);
      this.chest.add(v);
    }
    // Shoulders
    const yoke = new THREE.Mesh(capsule(0.06, 0.34), skin);
    yoke.rotation.z = Math.PI / 2;
    yoke.position.y = 0.34;
    yoke.castShadow = true;
    this.chest.add(yoke);

    // Arms: overlong with spindly fingers
    for (const s of [-1, 1]) {
      const upper = limb(this.chest, skin, 0.036, 0.46, 0.34);
      upper.pivot.position.x = s * 0.25;
      upper.pivot.rotation.z = s * 0.12;
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), skin);
      upper.end.add(elbow);
      const fore = limb(upper.end, skin, 0.028, 0.52, 0);
      const hand = new THREE.Group();
      hand.position.y = -0.56;
      fore.pivot.add(hand);
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.03), skin);
      palm.position.y = -0.05;
      hand.add(palm);
      const fingers: THREE.Group[] = [];
      for (let f = 0; f < 4; f++) {
        const len = 0.24 + (f === 1 || f === 2 ? 0.06 : 0);
        const fg = limb(hand, skin, 0.0075, len, -0.1);
        fg.pivot.position.x = -0.03 + f * 0.02;
        fg.pivot.rotation.x = 0.15;
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.045, 6), m.claw);
        claw.rotation.x = Math.PI;
        claw.position.y = -0.02;
        fg.end.add(claw);
        fingers.push(fg.pivot);
      }
      this.arms.push({ shoulder: upper.pivot, elbow: fore.pivot, hand, fingers });
    }

    // Neck and elongated head, cocked to the side
    this.chest.add(this.neck);
    this.neck.position.y = 0.4;
    const neckMesh = new THREE.Mesh(capsule(0.045, 0.14), skin);
    neckMesh.position.y = 0.08;
    this.neck.add(neckMesh);
    this.neck.add(this.head);
    this.head.position.y = 0.2;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 16), skin);
    skull.scale.set(0.85, 1.3, 1.0);
    skull.position.y = 0.08;
    skull.castShadow = true;
    this.head.add(skull);
    // Sunken sockets with a faint glint
    for (const s of [-1, 1]) {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), m.mouth);
      socket.position.set(s * 0.042, 0.1, 0.093);
      socket.scale.set(1.1, 0.8, 0.6);
      this.head.add(socket);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), m.eye);
      eye.position.set(s * 0.042, 0.1, 0.1);
      this.head.add(eye);
    }
    // Hanging jaw with dark mouth
    this.jaw = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), skin);
    this.jaw.scale.set(0.9, 0.9, 0.85);
    this.jaw.position.set(0, -0.05, 0.03);
    this.head.add(this.jaw);
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), m.mouth);
    mouth.scale.set(1, 1.6, 0.5);
    mouth.position.set(0, -0.02, 0.085);
    this.head.add(mouth);

    // Long, lank black hair hanging over the face
    const strands: THREE.BufferGeometry[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const theta = rnd() * Math.PI * 2;
      const phi = rnd() * 1.25;
      const front = Math.cos(theta - Math.PI / 2) > 0.2; // strands rooted toward the face hang longest
      const len = (front ? 0.55 : 0.4) + rnd() * 0.3;
      const g = new THREE.PlaneGeometry(0.012 + rnd() * 0.01, len, 1, 4);
      g.translate(0, -len / 2, 0);
      // Slight curl outward along the length
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) p.setZ(k, p.getZ(k) + Math.pow(-p.getY(k) / len, 2) * 0.04);
      const root = new THREE.Vector3(Math.sin(phi) * Math.cos(theta) * 0.1, 0.08 + Math.cos(phi) * 0.15, Math.sin(phi) * Math.sin(theta) * 0.12);
      const mtx = new THREE.Matrix4().makeRotationY(-theta + Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(root.x * 1.08, root.y, root.z * 1.08));
      g.applyMatrix4(mtx);
      strands.push(g);
    }
    this.hair = new THREE.Mesh(mergeGeometries(strands), m.hair);
    this.hair.castShadow = true;
    this.head.add(this.hair);

    // Torn hospital gown
    const gownGeo = new THREE.CylinderGeometry(0.2, 0.3, 0.72, 18, 6, true, Math.PI * 0.2, Math.PI * 1.6);
    const pos = gownGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < -0.2) pos.setY(i, y - Math.abs(Math.sin(i * 1.7)) * 0.12);
    }
    gownGeo.computeVertexNormals();
    this.gown = new THREE.Mesh(gownGeo, m.gown);
    this.gown.position.y = 0.12;
    this.gown.castShadow = true;
    this.hips.add(this.gown);

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).castShadow = true;
        o.userData.dynamic = true;
      }
    });
  }

  /** Animate from the AI's state. */
  update(dt: number, pose: StalkerPose) {
    this.t += dt;
    const moving = pose.speed > 0.1;
    const chase = pose.state === 'Chase';
    const stride = chase ? 1.6 : 1.15;
    this.phase += (pose.speed * dt) / stride * Math.PI;
    const amp = Math.min(1, pose.speed / 2) * (chase ? 1.1 : 0.75);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);

    // Posture
    const targetLean = chase ? 0.62 : pose.state === 'Attack' ? 0.4 : pose.state === 'Recover' ? 0.5 : 0.3;
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 4);
    this.spine.rotation.x = this.lean * 0.6;
    this.chest.rotation.x = this.lean * 0.5 + (pose.state === 'Recover' ? Math.sin(this.t * 7) * 0.05 : 0);
    this.hips.position.y = 1.18 - Math.abs(c) * 0.04 * amp - (chase ? 0.06 : 0);
    this.hips.rotation.y = s * 0.12 * amp;
    this.chest.rotation.y = -s * 0.18 * amp;
    this.chest.rotation.z = Math.sin(this.phase * 0.5) * 0.04;

    // Legs
    this.legs.forEach((l, i) => {
      const ls = i === 0 ? s : -s;
      l.hip.rotation.x = -ls * 0.55 * amp - (chase ? 0.2 : 0.05);
      l.knee.rotation.x = Math.max(0, (i === 0 ? c : -c)) * 0.9 * amp + 0.12;
    });

    // Head: cocked, with occasional violent twitches
    this.twitch -= dt;
    if (this.twitch <= 0) {
      this.twitch = 0.6 + Math.random() * 3;
      this.twitchTarget.set((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.8, 0.35 + (Math.random() - 0.5) * 0.5);
    }
    const looking = !moving && (pose.state === 'Search' || pose.state === 'Investigate' || pose.state === 'Patrol');
    const k = Math.min(1, dt * (Math.random() < 0.05 ? 30 : 6));
    this.head.rotation.x += ((chase ? -0.5 : this.twitchTarget.x - this.lean * 0.4) - this.head.rotation.x) * k;
    this.head.rotation.y += ((looking ? Math.sin(this.t * 0.9) * 0.9 : this.twitchTarget.y * 0.4) - this.head.rotation.y) * k;
    this.head.rotation.z += (this.twitchTarget.z - this.head.rotation.z) * k;
    this.jaw.position.y = -0.05 - (chase || pose.state === 'Attack' ? 0.03 + Math.sin(this.t * 13) * 0.008 : 0.008);

    // Arms
    this.arms.forEach((a, i) => {
      const side = i === 0 ? -1 : 1;
      let sx: number, ex: number;
      if (pose.state === 'Attack') {
        const w = pose.attackTimer / pose.windup;
        if (w < 1) { sx = -0.3 - w * 2.3; ex = -0.4 - w * 0.6; }
        else { const f = Math.min(1, (w - 1) * 4); sx = -2.6 + f * 2.2; ex = -1.0 + f * 0.7; }
      } else if (pose.lockerReach && i === 1) {
        sx = -1.3; ex = -0.3;
      } else if (chase) {
        sx = -0.9 + (i === 0 ? s : -s) * 0.45; ex = -0.6;
      } else {
        sx = (i === 0 ? -s : s) * 0.32 * amp + 0.08 + Math.sin(this.t * 1.3 + i) * 0.03;
        ex = -0.15 - Math.max(0, (i === 0 ? s : -s)) * 0.25 * amp;
      }
      a.shoulder.rotation.x += (sx - a.shoulder.rotation.x) * Math.min(1, dt * 10);
      a.elbow.rotation.x += (ex - a.elbow.rotation.x) * Math.min(1, dt * 10);
      a.shoulder.rotation.z = side * (0.1 + (chase ? 0.15 : 0));
      const curl = pose.state === 'Attack' ? 0.9 : 0.25 + Math.sin(this.t * 2 + i) * 0.1;
      a.fingers.forEach((f, j) => (f.rotation.x = curl + j * 0.04));
    });

    this.gown.rotation.y = Math.sin(this.t * 1.7) * 0.05 + s * 0.06 * amp;
    // Hair hangs with gravity: counter the head and torso pitch, sway with movement.
    const pitch = this.head.rotation.x + this.chest.rotation.x + this.spine.rotation.x;
    this.hair.rotation.x = -pitch * 0.85 + Math.sin(this.phase) * 0.05 * amp;
    this.hair.rotation.z = -this.head.rotation.z * 0.8 + Math.sin(this.t * 0.8) * 0.03;
  }
}
