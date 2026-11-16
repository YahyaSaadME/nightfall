import * as THREE from 'three';

export const FLASHLIGHT = {
  drainPerSecond: 0.75,
  batteryPickup: 45,
  startBattery: 80,
  intensity: 58,
  distance: 28,
  angle: 0.62,
};

/**
 * A real shadow-casting spotlight held slightly right of the camera. The beam lags
 * the view a little for weight, dims as the battery runs down and stutters near empty.
 */
export class FlashlightController {
  readonly spot: THREE.SpotLight;
  /** Faint bounce light around the player so close surfaces read when the beam hits them. */
  readonly bounce: THREE.PointLight;
  on = false;
  battery = FLASHLIGHT.startBattery;
  readonly dir = new THREE.Vector3(0, 0, -1);
  readonly pos = new THREE.Vector3();
  private flicker = 1;
  private flickerTimer = 0;
  private hitPoint = new THREE.Vector3();
  output = 0;

  constructor(scene: THREE.Scene) {
    this.spot = new THREE.SpotLight(0xfff0dc, 0, FLASHLIGHT.distance, FLASHLIGHT.angle, 0.88, 2);
    this.spot.shadow.camera.near = 0.15;
    this.spot.shadow.camera.far = FLASHLIGHT.distance;
    this.spot.shadow.bias = -0.0004;
    this.spot.shadow.normalBias = 0.03;
    this.spot.userData.dynamic = true;
    this.spot.target.userData.dynamic = true;
    scene.add(this.spot, this.spot.target);
    this.bounce = new THREE.PointLight(0xffe8d0, 0, 6, 2);
    this.bounce.userData.dynamic = true;
    scene.add(this.bounce);
  }

  setShadows(enabled: boolean, mapSize: number) {
    this.spot.castShadow = enabled;
    if (this.spot.shadow.mapSize.x !== mapSize) {
      this.spot.shadow.mapSize.set(mapSize, mapSize);
      this.spot.shadow.map?.dispose();
      this.spot.shadow.map = null;
    }
  }

  /** Returns true if the state changed. */
  toggle(): boolean {
    if (!this.on && this.battery <= 0) return false;
    this.on = !this.on;
    return true;
  }

  recharge(amount: number) {
    this.battery = Math.min(100, this.battery + amount);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, raycastWalls: (o: THREE.Vector3, d: THREE.Vector3) => number) {
    if (this.on) {
      this.battery = Math.max(0, this.battery - FLASHLIGHT.drainPerSecond * dt);
      if (this.battery <= 0) this.on = false;
    }
    // Beam lags the view slightly.
    const camDir = camera.getWorldDirection(new THREE.Vector3());
    this.dir.lerp(camDir, 1 - Math.exp(-dt * 16)).normalize();
    const right = new THREE.Vector3().crossVectors(camDir, camera.up).normalize();
    this.pos.copy(camera.position).addScaledVector(right, 0.18).add(new THREE.Vector3(0, -0.16, 0)).addScaledVector(camDir, 0.1);
    this.spot.position.copy(this.pos);
    this.spot.target.position.copy(this.pos).addScaledVector(this.dir, 6);
    this.spot.target.updateMatrixWorld();

    // Low battery: dimmer, warmer and erratic.
    const b = this.battery / 100;
    this.flickerTimer -= dt;
    if (b < 0.15 && this.flickerTimer <= 0) {
      this.flicker = Math.random() < 0.25 ? 0.1 + Math.random() * 0.3 : 1;
      this.flickerTimer = 0.04 + Math.random() * (b < 0.06 ? 0.2 : 0.6);
    } else if (b >= 0.15) {
      this.flicker = 1;
    }
    const level = this.on ? Math.min(1, 0.35 + b * 2.2) * this.flicker : 0;
    this.output += (level - this.output) * Math.min(1, dt * 30);
    this.spot.intensity = FLASHLIGHT.intensity * this.output;
    this.spot.color.setHSL(0.09, 0.35 + (1 - Math.min(1, b * 3)) * 0.3, 0.92);

    // Bounce: place the fill light near whatever the beam hits.
    const dist = Math.min(raycastWalls(this.pos, this.dir), 8);
    this.hitPoint.copy(this.pos).addScaledVector(this.dir, Math.max(0.3, dist - 0.4));
    this.bounce.position.copy(this.hitPoint);
    this.bounce.intensity = this.output * 0.9 * Math.max(0.2, 1 - dist / 9);
  }
}
