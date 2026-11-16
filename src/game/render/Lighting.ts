import * as THREE from 'three';
import { LIGHTS, WALL_H, type LightDef } from '../level/LevelData';
import type { CollisionWorld } from '../level/Grid';
import { add, box } from './Props';
import type { MaterialLibrary } from './Materials';
import { rng } from './Textures';

interface LightInstance {
  def: LightDef;
  light?: THREE.PointLight;
  emissive: THREE.MeshStandardMaterial;
  /** Current output 0..1. */
  level: number;
  base: number;
  flickerTimer: number;
  flickerOn: boolean;
  /** Seconds of a dropout burst remaining. */
  burst: number;
  nextBurst: number;
  phase: number;
}

const FLUORO_COLOR = 0xd9e4dc;
const EMERGENCY_COLOR = 0xff3020;

/**
 * Ceiling fixtures and the small budget of real point lights. Faulty tubes flicker
 * before power is restored; emergency lights and some tubes come on afterwards.
 */
export class LightingController {
  readonly group = new THREE.Group();
  private lights: LightInstance[] = [];
  private rand = rng(311);
  powered = false;
  /** Fired when a light visibly flickers off/on (for buzz/click sounds). */
  onFlicker?: (x: number, z: number) => void;
  intensityScale = 1;

  constructor(m: MaterialLibrary, private readonly collision: CollisionWorld, maxDynamic: number) {
    let dynamicCount = 0;
    for (const def of LIGHTS) {
      const emissive = new THREE.MeshStandardMaterial({
        color: def.kind === 'fluoro' ? 0xd8ddd4 : 0x3a0806,
        emissive: def.kind === 'fluoro' ? FLUORO_COLOR : EMERGENCY_COLOR,
        emissiveIntensity: 0,
        roughness: 0.4,
      });
      const fixture = new THREE.Group();
      fixture.position.set(def.x, WALL_H, def.z);
      fixture.rotation.y = def.rot ?? 0;
      if (def.kind === 'fluoro') {
        add(fixture, box(1.25, 0.07, 0.34), m.paintedMetal, 0, -0.035, 0);
        add(fixture, box(1.18, 0.012, 0.26), emissive, 0, -0.076, 0);
        add(fixture, box(1.2, 0.01, 0.01), m.darkMetal, 0, -0.084, 0.06);
        add(fixture, box(1.2, 0.01, 0.01), m.darkMetal, 0, -0.084, -0.06);
      } else {
        add(fixture, box(0.34, 0.12, 0.16), m.darkMetal, 0, -0.06, 0);
        add(fixture, box(0.12, 0.08, 0.1), emissive, -0.08, -0.14, 0.02);
        add(fixture, box(0.12, 0.08, 0.1), emissive, 0.08, -0.14, 0.02);
      }
      fixture.traverse((o) => { (o as THREE.Mesh).castShadow = false; });
      this.group.add(fixture);

      const inst: LightInstance = { def, emissive, level: 0, base: 0, flickerTimer: this.rand() * 2, flickerOn: true, burst: 0, nextBurst: 1 + this.rand() * 3, phase: this.rand() * 10 };
      if (def.dynamic && dynamicCount < maxDynamic) {
        dynamicCount++;
        const isF = def.kind === 'fluoro';
        const light = new THREE.PointLight(isF ? FLUORO_COLOR : EMERGENCY_COLOR, 0, isF ? 13 : 10, 2);
        light.position.set(def.x, WALL_H - (isF ? 0.25 : 0.3), def.z);
        light.castShadow = false;
        this.group.add(light);
        inst.light = light;
      }
      this.lights.push(inst);
    }
    this.setPowered(false);
  }

  setPowered(on: boolean) {
    this.powered = on;
    for (const l of this.lights) {
      const { mode } = l.def;
      if (mode === 'dead') l.base = 0;
      else if (mode === 'faulty') l.base = on ? 1 : 0.85;
      else l.base = on ? 1 : 0;
    }
  }

  private peak(l: LightInstance) {
    if (l.def.kind === 'emergency') return 9;
    return l.def.mode === 'faulty' ? 15 : 18;
  }

  update(dt: number) {
    for (const l of this.lights) {
      let target = l.base;
      if (target > 0) {
        if (l.def.kind === 'fluoro') {
          // Unstable tube: long stable stretches broken by bursts of rapid flicker.
          if (l.burst > 0) {
            l.burst -= dt;
            l.flickerTimer -= dt;
            if (l.flickerTimer <= 0) {
              l.flickerOn = !l.flickerOn;
              l.flickerTimer = 0.03 + this.rand() * 0.12;
              if (!l.flickerOn) this.onFlicker?.(l.def.x, l.def.z);
            }
            if (l.burst <= 0) {
              l.flickerOn = true;
              l.nextBurst = 2 + this.rand() * (this.powered ? 9 : 5);
            }
          } else {
            l.nextBurst -= dt;
            if (l.nextBurst <= 0) {
              l.burst = 0.3 + this.rand() * (l.def.mode === 'faulty' && !this.powered ? 1.6 : 0.6);
              l.flickerTimer = 0;
              // Faulty tubes before power also spend long spells dark.
              if (l.def.mode === 'faulty' && !this.powered && this.rand() < 0.35) {
                l.flickerOn = false;
                l.burst = 2 + this.rand() * 4;
                l.flickerTimer = l.burst + 1;
              }
            }
          }
          target *= l.flickerOn ? 0.92 + Math.sin((l.phase += dt * 120)) * 0.03 : 0.04;
        } else {
          // Emergency: slow, heavy pulse.
          l.phase += dt;
          target *= 0.75 + 0.25 * Math.sin(l.phase * 1.4);
        }
      }
      // Tubes snap; emergency lamps fade.
      const k = l.def.kind === 'fluoro' ? 40 : 4;
      l.level += (target - l.level) * Math.min(1, dt * k);
      l.emissive.emissiveIntensity = l.level * (l.def.kind === 'fluoro' ? 2.2 : 3.2);
      if (l.light) l.light.intensity = l.level * this.peak(l) * this.intensityScale;
    }
  }

  /** Quality budget: lights beyond `n` are disabled (fixtures still glow). */
  setMaxDynamic(n: number) {
    let i = 0;
    for (const l of this.lights) if (l.light) l.light.visible = i++ < n;
  }

  /** Approximate illumination 0..1 at a floor position (fixed lights only). */
  lightLevelAt(x: number, z: number): number {
    let sum = 0;
    for (const l of this.lights) {
      if (!l.light || !l.light.visible || l.level < 0.05) continue;
      const d = Math.hypot(l.def.x - x, l.def.z - z);
      const range = l.def.kind === 'fluoro' ? 9 : 6;
      if (d > range) continue;
      if (!this.collision.lineOfSight(l.def.x, l.def.z, x, z)) continue;
      sum += l.level * (1 - d / range) * (l.def.kind === 'fluoro' ? 1 : 0.6);
    }
    return Math.min(1, sum);
  }

  /** The faulty tubes that buzz (for spatial hum). */
  buzzSources() {
    return this.lights.filter((l) => l.light && l.def.kind === 'fluoro').map((l) => ({ x: l.def.x, z: l.def.z, level: () => l.level }));
  }
}
