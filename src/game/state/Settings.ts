import { Store } from './Store';
import { isTouchDevice } from './Device';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  sensitivity: number;
  volume: number;
  brightness: number;
  quality: Quality;
  invertY: boolean;
  fullscreen: boolean;
  /** Spawn-director AI: 'auto' (the shipped model), a model name from ml/models, or 'rules'. */
  directorModel: string;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  volume: 0.8,
  brightness: 1,
  quality: 'high',
  invertY: false,
  fullscreen: false,
  directorModel: 'auto',
};

export interface QualityProfile {
  pixelRatio: number;
  shadows: boolean;
  shadowMap: number;
  dust: number;
  maxLights: number;
  textureScale: number;
  anisotropy: number;
}

export function qualityProfile(q: Quality): QualityProfile {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  switch (q) {
    case 'low': return { pixelRatio: Math.min(dpr, 1) * 0.75, shadows: false, shadowMap: 512, dust: 120, maxLights: 4, textureScale: 1, anisotropy: 2 };
    case 'medium': return { pixelRatio: Math.min(dpr, 1.25), shadows: true, shadowMap: 512, dust: 260, maxLights: 8, textureScale: 1, anisotropy: 4 };
    default: return { pixelRatio: Math.min(dpr, 1.75), shadows: true, shadowMap: 1024, dust: 420, maxLights: 8, textureScale: 1, anisotropy: 8 };
  }
}

const KEY = 'nightfall.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw), fullscreen: false };
  } catch { /* storage unavailable */ }
  // Phones start on Low (no flashlight shadows, 0.75x resolution); players can raise it in Settings.
  return { ...DEFAULT_SETTINGS, quality: isTouchDevice ? 'low' : DEFAULT_SETTINGS.quality };
}

export const settingsStore = new Store<Settings>(load());

settingsStore.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settingsStore.get()));
  } catch { /* storage unavailable */ }
});
