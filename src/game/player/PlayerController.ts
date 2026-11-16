import * as THREE from 'three';
import type { CollisionWorld } from '../level/Grid';
import type { Input } from './Input';

export const PLAYER = {
  radius: 0.3,
  eye: 1.62,
  crouchEye: 1.02,
  walk: 2.5,
  sprint: 4.6,
  crouch: 1.25,
  accel: 11,
  staminaDrain: 21,
  staminaRegen: 13,
  staminaRegenDelay: 0.9,
  exhaustedUntil: 35,
  maxHealth: 100,
  regenDelay: 9,
  regenRate: 2.5,
  invulnAfterHit: 1.4,
};

export interface LookSettings { sensitivity: number; invertY: boolean }

export interface StepEvent { sprinting: boolean; crouched: boolean; speed: number }

/** First-person body: look, walk/sprint/crouch, stamina, health, gravity and collision. */
export class PlayerController {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  crouched = false;
  private crouchT = 0;
  stamina = 100;
  exhausted = false;
  health = PLAYER.maxHealth;
  sprinting = false;
  moving = false;
  hiddenSpot: string | null = null;
  invulnerable = 0;
  private sinceDamage = 99;
  private sinceSprint = 99;
  private vy = 0;
  private stepPhase = 0;
  private bob = 0;
  private bobAmp = 0;
  private shake = 0;
  /** Extra camera roll/pitch for death and hits. */
  fallT = 0;
  onStep?: (e: StepEvent) => void;

  get alive() {
    return this.health > 0;
  }

  get eyeHeight() {
    return THREE.MathUtils.lerp(PLAYER.eye, PLAYER.crouchEye, this.crouchT);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  reset(x: number, z: number, yaw: number) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.crouched = false;
    this.crouchT = 0;
    this.stamina = 100;
    this.exhausted = false;
    this.health = PLAYER.maxHealth;
    this.hiddenSpot = null;
    this.invulnerable = 0;
    this.sinceDamage = 99;
    this.fallT = 0;
    this.vy = 0;
    this.shake = 0;
  }

  look(input: Input, s: LookSettings, limits?: { yaw: number; range: number; pitch: number }) {
    const k = 0.0022 * s.sensitivity;
    this.yaw -= input.mouseDX * k;
    this.pitch -= input.mouseDY * k * (s.invertY ? -1 : 1);
    if (limits) {
      const d = Math.atan2(Math.sin(this.yaw - limits.yaw), Math.cos(this.yaw - limits.yaw));
      this.yaw = limits.yaw + THREE.MathUtils.clamp(d, -limits.range, limits.range);
      this.pitch = THREE.MathUtils.clamp(this.pitch, -limits.pitch, limits.pitch);
    } else {
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
    }
  }

  update(dt: number, input: Input, collision: CollisionWorld, look: LookSettings) {
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.sinceDamage += dt;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (this.sinceDamage > PLAYER.regenDelay && this.health < PLAYER.maxHealth && this.alive) {
      this.health = Math.min(PLAYER.maxHealth, this.health + PLAYER.regenRate * dt);
    }
    if (!this.alive) return;

    if (this.hiddenSpot) {
      this.sprinting = false;
      this.moving = false;
      this.vel.set(0, 0, 0);
      this.regenStamina(dt, 1.4);
      return;
    }

    this.look(input, look);
    if (input.wasPressed('ControlLeft', 'ControlRight', 'KeyC')) this.crouched = !this.crouched;

    const f = THREE.MathUtils.clamp((input.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (input.isDown('KeyS', 'ArrowDown') ? 1 : 0) + input.axisF, -1, 1);
    const r = THREE.MathUtils.clamp((input.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (input.isDown('KeyA', 'ArrowLeft') ? 1 : 0) + input.axisR, -1, 1);
    const wish = new THREE.Vector3();
    if (f || r) {
      const fwd = this.forward();
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      // Normalised direction, scaled by stick deflection (keyboard is always full strength).
      wish.addScaledVector(fwd, f).addScaledVector(right, r).normalize().multiplyScalar(Math.min(1, Math.hypot(f, r)));
    }
    const wantsSprint = input.isDown('ShiftLeft', 'ShiftRight') && f > 0 && !this.exhausted && this.stamina > 0;
    if (wantsSprint && this.crouched) this.crouched = false; // sprinting stands you up
    this.sprinting = wantsSprint && wish.lengthSq() > 0;
    const speed = this.sprinting ? PLAYER.sprint : this.crouched ? PLAYER.crouch : PLAYER.walk;

    // Accelerate toward the wished velocity.
    const target = wish.multiplyScalar(speed);
    const a = 1 - Math.exp(-PLAYER.accel * dt);
    this.vel.x += (target.x - this.vel.x) * a;
    this.vel.z += (target.z - this.vel.z) * a;
    const horiz = Math.hypot(this.vel.x, this.vel.z);
    this.moving = horiz > 0.3;

    // Stamina
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt);
      this.sinceSprint = 0;
      if (this.stamina <= 0) this.exhausted = true;
    } else {
      this.sinceSprint += dt;
      if (this.sinceSprint > PLAYER.staminaRegenDelay) this.regenStamina(dt, this.moving ? 0.7 : 1.2);
    }
    if (this.exhausted && this.stamina >= PLAYER.exhaustedUntil) this.exhausted = false;

    // Integrate with sub-steps so fast movement never tunnels through thin geometry.
    const steps = Math.max(1, Math.ceil((horiz * dt) / 0.1));
    for (let i = 0; i < steps; i++) {
      this.pos.x += (this.vel.x * dt) / steps;
      this.pos.z += (this.vel.z * dt) / steps;
      collision.resolveCircle(this.pos, PLAYER.radius);
    }
    // Gravity and floor (the hospital is a single level at y = 0).
    this.vy -= 9.81 * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= 0) { this.pos.y = 0; this.vy = 0; }

    // Crouch blend
    this.crouchT += ((this.crouched ? 1 : 0) - this.crouchT) * Math.min(1, dt * 9);

    // Footsteps and head bob
    const stride = this.sprinting ? 0.95 : this.crouched ? 0.6 : 0.78;
    if (this.moving) {
      this.stepPhase += (horiz * dt) / stride;
      this.bob += (horiz * dt) / stride * Math.PI;
      if (this.stepPhase >= 1) {
        this.stepPhase -= 1;
        this.onStep?.({ sprinting: this.sprinting, crouched: this.crouched, speed: horiz });
      }
    }
    const targetAmp = this.moving ? (this.sprinting ? 0.055 : this.crouched ? 0.018 : 0.03) : 0;
    this.bobAmp += (targetAmp - this.bobAmp) * Math.min(1, dt * 6);
  }

  private regenStamina(dt: number, mult: number) {
    this.stamina = Math.min(100, this.stamina + PLAYER.staminaRegen * mult * dt);
  }

  damage(amount: number): boolean {
    if (this.invulnerable > 0 || !this.alive) return false;
    this.health = Math.max(0, this.health - amount);
    this.invulnerable = PLAYER.invulnAfterHit;
    this.sinceDamage = 0;
    this.shake = 1;
    return true;
  }

  /** Writes the first-person camera transform. */
  applyCamera(camera: THREE.PerspectiveCamera, time: number) {
    const bobY = Math.abs(Math.sin(this.bob)) * this.bobAmp;
    const bobX = Math.cos(this.bob) * this.bobAmp * 0.6;
    const breath = Math.sin(time * 1.6) * 0.004;
    const shakeX = (Math.random() - 0.5) * this.shake * 0.05;
    const shakeY = (Math.random() - 0.5) * this.shake * 0.05;
    const eye = this.eyeHeight * (1 - this.fallT * 0.8);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    camera.position.set(this.pos.x, this.pos.y + eye + bobY + breath, this.pos.z).addScaledVector(right, bobX);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = this.yaw + shakeX;
    camera.rotation.x = this.pitch + shakeY + this.fallT * 0.6;
    camera.rotation.z = -bobX * 0.4 + this.fallT * 1.2;
  }
}
