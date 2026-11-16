import { createContext, useContext } from 'react';
import type { Engine } from '../game/Engine';

export const EngineContext = createContext<Engine | null>(null);

export function useEngine() {
  return useContext(EngineContext);
}
