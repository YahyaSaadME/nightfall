export type ObjectiveId =
  | 'explore' | 'findFuse' | 'restorePower' | 'keycard' | 'restricted' | 'exitKey' | 'unlockExit' | 'escape';

export interface Objective { id: ObjectiveId; title: string; hint: string }

export const OBJECTIVES: Objective[] = [
  { id: 'explore', title: 'Explore the reception area', hint: 'The reception desk may have records.' },
  { id: 'findFuse', title: 'Find a fuse in the storage room', hint: 'Storage is off the east corridor.' },
  { id: 'restorePower', title: 'Restore emergency power', hint: 'The fuse box is in maintenance, through storage.' },
  { id: 'keycard', title: "Obtain the keycard from the nurses' station", hint: 'The station door should open now.' },
  { id: 'restricted', title: 'Reach the restricted corridor', hint: 'Keycard doors: staff lockers or reception.' },
  { id: 'exitKey', title: 'Find the exit key', hint: "Try the director's office." },
  { id: 'unlockExit', title: 'Unlock the main exit', hint: 'The shutter is in the reception.' },
  { id: 'escape', title: 'Survive until the shutter opens — escape', hint: 'Get out.' },
];

/**
 * Linear objective chain. Completing a later objective also completes every
 * earlier one, so an unusual route can never leave the player stuck.
 */
export class ObjectiveManager {
  index = 0;
  private listeners: ((done: Objective, next: Objective | null) => void)[] = [];

  get current(): Objective | null {
    return OBJECTIVES[this.index] ?? null;
  }

  get finished() {
    return this.index >= OBJECTIVES.length;
  }

  indexOf(id: ObjectiveId) {
    return OBJECTIVES.findIndex((o) => o.id === id);
  }

  isDone(id: ObjectiveId) {
    return this.indexOf(id) < this.index;
  }

  isCurrent(id: ObjectiveId) {
    return this.current?.id === id;
  }

  /** Returns true if this call advanced the chain. */
  complete(id: ObjectiveId): boolean {
    const i = this.indexOf(id);
    if (i < this.index) return false;
    this.index = i + 1;
    const done = OBJECTIVES[i];
    const next = this.current;
    for (const l of this.listeners) l(done, next);
    return true;
  }

  onComplete(fn: (done: Objective, next: Objective | null) => void) {
    this.listeners.push(fn);
  }

  restore(index: number) {
    this.index = Math.max(0, Math.min(OBJECTIVES.length, index));
  }
}
