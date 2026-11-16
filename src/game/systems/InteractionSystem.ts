import * as THREE from 'three';

export interface Prompt { text: string; key?: string; locked?: boolean }

export interface Interactable {
  id: string;
  /** Meshes that can be aimed at. */
  targets: THREE.Object3D[];
  /** World position used for range and the proximity fallback. */
  position: THREE.Vector3;
  range?: number;
  /** null = currently not interactable (e.g. already collected). */
  prompt(): Prompt | null;
  interact(): void;
}

/**
 * Centre-screen raycast against interactable meshes, blocked by walls/doors.
 * Small items also get a narrow aim-cone fallback so they are easy to pick up.
 */
export class InteractionSystem {
  private items = new Map<string, Interactable>();
  private meshOwner = new Map<THREE.Object3D, Interactable>();
  private raycaster = new THREE.Raycaster();
  private targets: THREE.Object3D[] = [];
  private dirty = true;
  focused: Interactable | null = null;

  constructor(private readonly occluders: THREE.Object3D[]) {
    this.raycaster.far = 3;
  }

  register(i: Interactable) {
    this.items.set(i.id, i);
    for (const t of i.targets) t.traverse((o) => this.meshOwner.set(o, i));
    this.dirty = true;
  }

  get(id: string) {
    return this.items.get(id);
  }

  update(camera: THREE.Camera) {
    if (this.dirty) {
      this.targets = [...this.occluders, ...[...this.items.values()].flatMap((i) => i.targets)];
      this.dirty = false;
    }
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    let found: Interactable | null = null;
    const hits = this.raycaster.intersectObjects(this.targets, true);
    for (const h of hits) {
      if (!h.object.visible) continue;
      const owner = this.meshOwner.get(h.object);
      if (owner) {
        if (h.distance <= (owner.range ?? 2.3) && owner.prompt()) found = owner;
      }
      break; // first visible hit decides (walls block)
    }
    if (!found) found = this.coneFallback(camera);
    this.focused = found;
  }

  private coneFallback(camera: THREE.Camera): Interactable | null {
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());
    let best: Interactable | null = null;
    let bestDot = Math.cos(0.2);
    for (const i of this.items.values()) {
      if (i.range !== undefined && i.range > 2.3) continue;
      const to = i.position.clone().sub(origin);
      const d = to.length();
      if (d > 1.9 || d < 0.05) continue;
      const dot = to.divideScalar(d).dot(dir);
      if (dot <= bestDot) continue;
      if (!i.targets.some((t) => t.visible)) continue;
      // Make sure nothing solid is in between.
      this.raycaster.set(origin, to);
      const block = this.raycaster.intersectObjects(this.occluders, true)[0];
      if (block && block.distance < d - 0.1) continue;
      if (!i.prompt()) continue;
      best = i;
      bestDot = dot;
    }
    return best;
  }

  interact(): boolean {
    if (!this.focused) return false;
    this.focused.interact();
    return true;
  }
}
