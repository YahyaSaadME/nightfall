import type { ItemId } from '../level/LevelData';

export const ITEM_LABELS: Record<ItemId, string> = {
  fuse: 'Ceramic fuse',
  keycard: 'Staff keycard',
  exitKey: 'Exit key',
};

/** Key items only. Batteries are consumed on pickup. */
export class InventorySystem {
  private items = new Set<ItemId>();
  private listeners: (() => void)[] = [];

  has(id: ItemId) {
    return this.items.has(id);
  }

  add(id: ItemId) {
    this.items.add(id);
    this.emit();
  }

  remove(id: ItemId) {
    this.items.delete(id);
    this.emit();
  }

  list(): ItemId[] {
    return [...this.items];
  }

  restore(items: ItemId[]) {
    this.items = new Set(items);
    this.emit();
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}
