import * as THREE from 'three';
import { SWITCH_TIME, type WeaponId } from '../systems/WeaponSystem';
import type { MaterialLibrary } from './Materials';

export interface WeaponPose {
  weapon: WeaponId;
  /** Seconds since the last attack and what it was. */
  sinceAttack: number;
  lastAttack: 'shot' | 'swing' | 'dry' | 'none';
  reloading: boolean;
  /** 0..1 progress of the current reload step. */
  reloadProgress: number;
  swapT: number;
  /** Horizontal speed (m/s) and sprint flag, for bob and lowering. */
  speed: number;
  sprinting: boolean;
  /** Distance to the nearest wall straight ahead (m). */
  wallDist: number;
  visible: boolean;
}

/**
 * First-person weapon models, parented to the camera. Built from primitives, with a small
 * emissive term so they stay readable when the flashlight is off. Includes the muzzle flash
 * (a billboard quad plus a point light that exists from the start so shaders never recompile).
 */
export class WeaponView {
  readonly root = new THREE.Group();
  readonly muzzleLight: THREE.PointLight;
  private groups: Record<WeaponId, THREE.Group>;
  private muzzles: Record<WeaponId, THREE.Object3D | null> = { bat: null, pistol: null, shotgun: null };
  private flash: THREE.Mesh;
  private flashT = 0;
  private bob = 0;
  private lowered = 0;
  private pull = 0;
  private pumpT = 0;

  constructor(_m: MaterialLibrary) {
    // Unlit: the flashlight sits ~0.3 m from the gun and would blow any lit material out to white.
    const basic = (color: number) => new THREE.MeshBasicMaterial({ color });
    const metal = basic(0x1e2022);
    const steel = basic(0x3b3f43);
    const polymer = basic(0x171716);
    const wood = basic(0x5b4228);
    const tape = basic(0x0d0d0d);
    const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      return mesh;
    };
    const cyl = (r: number, len: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
      mesh.rotation.x = Math.PI / 2; // along -Z
      mesh.position.set(x, y, z);
      return mesh;
    };

    // Pistol
    const pistol = new THREE.Group();
    pistol.add(box(0.045, 0.06, 0.2, metal, 0, 0.02, -0.08));            // slide
    pistol.add(box(0.04, 0.035, 0.17, steel, 0, -0.02, -0.075));         // frame
    const grip = box(0.04, 0.11, 0.055, polymer, 0, -0.08, 0.0);
    grip.rotation.x = -0.18;
    pistol.add(grip);
    pistol.add(box(0.012, 0.014, 0.012, steel, 0, 0.056, -0.17));        // front sight
    pistol.add(box(0.03, 0.01, 0.07, steel, 0, -0.045, -0.035));         // trigger guard
    const pm = new THREE.Object3D();
    pm.position.set(0, 0.02, -0.19);
    pistol.add(pm);
    this.muzzles.pistol = pm;

    // Shotgun
    const shotgun = new THREE.Group();
    shotgun.add(cyl(0.017, 0.62, metal, 0, 0.02, -0.28));                 // barrel
    shotgun.add(cyl(0.015, 0.5, steel, 0, -0.012, -0.22));                // magazine tube
    shotgun.add(box(0.045, 0.06, 0.2, steel, 0, 0.0, 0.0));               // receiver
    const pump = box(0.05, 0.045, 0.16, wood, 0, -0.012, -0.3);
    shotgun.add(pump);
    const stock = box(0.05, 0.085, 0.3, wood, 0, -0.02, 0.2);
    stock.rotation.x = 0.1;
    shotgun.add(stock);
    const sm = new THREE.Object3D();
    sm.position.set(0, 0.02, -0.6);
    shotgun.add(sm);
    this.muzzles.shotgun = sm;
    (shotgun.userData as { pump: THREE.Object3D }).pump = pump;

    // Bat / handle
    const bat = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.021, 0.78, 10), wood);
    shaft.position.y = 0.3;
    bat.add(shaft);
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.2, 10), tape);
    wrap.position.y = -0.04;
    bat.add(wrap);
    bat.add(box(0.028, 0.012, 0.028, steel, 0, 0.7, 0));
    bat.rotation.set(-0.45, 0, -0.18);

    this.groups = { bat, pistol, shotgun };
    for (const g of Object.values(this.groups)) {
      g.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; });
      this.root.add(g);
    }

    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffc27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), flashMat);
    this.flash.visible = false;
    this.flash.frustumCulled = false;
    this.root.add(this.flash);
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 9, 2);
    this.muzzleLight.userData.dynamic = true;
    this.root.add(this.muzzleLight);
    this.root.position.set(0.2, -0.2, -0.4);
    this.root.traverse((o) => { o.userData.dynamic = true; });
  }

  /** Call when a gun fires. */
  fireFlash(weapon: WeaponId) {
    const mz = this.muzzles[weapon];
    if (!mz) return;
    // Gun groups sit at the root's origin, so the muzzle's local position is root-local too.
    this.flash.position.copy(mz.position);
    this.muzzleLight.position.copy(mz.position);
    this.flashT = weapon === 'shotgun' ? 0.09 : 0.06;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar((weapon === 'shotgun' ? 1.6 : 1) * (0.8 + Math.random() * 0.5));
    if (weapon === 'shotgun') this.pumpT = 0.55;
  }

  update(dt: number, p: WeaponPose) {
    this.root.visible = p.visible;
    if (!p.visible) { this.flash.visible = false; this.muzzleLight.intensity = 0; return; }
    for (const id of Object.keys(this.groups) as WeaponId[]) this.groups[id].visible = id === p.weapon;
    const g = this.groups[p.weapon];

    // Walking bob
    this.bob += dt * (3 + p.speed * 1.6);
    const bobAmp = Math.min(1, p.speed / 4) * (p.sprinting ? 1.6 : 1);
    let x = 0.2 + Math.cos(this.bob) * 0.006 * bobAmp;
    let y = -0.2 + Math.abs(Math.sin(this.bob)) * 0.008 * bobAmp + Math.sin(performance.now() / 1000 * 1.6) * 0.0015;
    let z = -0.4;
    let rx = 0, ry = 0, rz = 0;

    // Lower when sprinting; slide away from walls so it does not clip through them.
    this.lowered += ((p.sprinting ? 1 : 0) - this.lowered) * Math.min(1, dt * 8);
    const near = Math.max(0, Math.min(1, (0.95 - p.wallDist) / 0.5));
    this.pull += (near - this.pull) * Math.min(1, dt * 12);
    y -= this.lowered * 0.09 + this.pull * 0.07;
    z += this.pull * 0.2;
    rx -= this.lowered * 0.35 + this.pull * 0.5;
    ry += this.lowered * 0.3;
    x += this.lowered * 0.02;

    // Weapon swap: drop out of view and come back.
    if (p.swapT > 0) {
      const k = p.swapT / SWITCH_TIME;
      y -= 0.32 * k;
      rx -= 0.7 * k;
    }

    const t = p.sinceAttack;
    if (p.weapon === 'pistol') {
      if (p.lastAttack === 'shot' && t < 0.22) {
        const k = 1 - t / 0.22;
        z += 0.05 * k; rx += 0.2 * k; y += 0.008 * k;
      }
      const slide = g.children[0];
      slide.position.z = -0.08 + (p.lastAttack === 'shot' && t < 0.08 ? 0.045 * (1 - t / 0.08) : 0);
    } else if (p.weapon === 'shotgun') {
      if (p.lastAttack === 'shot' && t < 0.4) {
        const k = Math.pow(1 - t / 0.4, 2);
        z += 0.1 * k; rx += 0.38 * k; y += 0.02 * k;
      }
      this.pumpT = Math.max(0, this.pumpT - dt);
      const pump = (g.userData as { pump: THREE.Object3D }).pump;
      const pk = this.pumpT > 0 ? Math.sin((1 - this.pumpT / 0.55) * Math.PI) : 0;
      pump.position.z = -0.3 + pk * 0.09;
    } else {
      // Bat: wind back, swing across, recover.
      if (p.lastAttack === 'swing' && t < 0.45) {
        const u = t / 0.45;
        const swing = u < 0.25 ? -u / 0.25 * 0.5 : u < 0.5 ? -0.5 + ((u - 0.25) / 0.25) * 2.1 : 1.6 - ((u - 0.5) / 0.5) * 1.6;
        rz += swing * 1.3; rx -= swing * 0.35; x -= swing * 0.18; y += swing * 0.05; z -= swing * 0.08;
      }
    }
    // Reload: tip the gun and dip it.
    if (p.reloading && p.weapon !== 'bat') {
      const k = Math.sin(Math.min(1, p.reloadProgress) * Math.PI);
      y -= 0.07 * k; rx -= 0.5 * k; rz += 0.25 * k;
    }
    // A dry-fire click twitches the gun.
    if (p.lastAttack === 'dry' && t < 0.12) rx += 0.05;

    this.root.position.set(x, y, z);
    this.root.rotation.set(rx, ry, rz);

    // Muzzle flash
    this.flashT -= dt;
    const on = this.flashT > 0;
    this.flash.visible = on;
    this.muzzleLight.intensity = on ? 16 * (this.flashT / 0.07) : 0;
  }
}
