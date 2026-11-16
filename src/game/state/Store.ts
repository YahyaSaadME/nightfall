import { useSyncExternalStore } from 'react';

/** Minimal observable store; components subscribe with `useStore`. */
export class Store<T extends object> {
  private listeners = new Set<() => void>();
  constructor(private state: T) {}

  get = () => this.state;

  set(patch: Partial<T> | ((s: T) => Partial<T>)) {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    let changed = false;
    for (const k in p) if (!Object.is(p[k], this.state[k])) { changed = true; break; }
    if (!changed) return;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };
}

export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
