import index from './director_models/index.json';
import { DirectorModel, type DirectorSpec } from './DirectorModel';

/** Setting value that means "use the model the build ships with" (see `ml/switch_model.py`). */
export const AUTO = 'auto';
/** Setting value for no neural network: the hand-written rule set in SpawnDirector. */
export const RULES = 'rules';

// Each model is its own lazily-loaded chunk, so only the one you pick is downloaded.
const loaders = import.meta.glob(['./director_models/*.json', '!./director_models/index.json'], { import: 'default' }) as Record<string, () => Promise<unknown>>;

interface IndexRow { name: string; params: number; accuracy: number; macro_f1: number; mean_regret: number; policy_death_rate: number }

const COPY: Record<string, { label: string; blurb: string }> = {
  mlp_deep_bn: { label: 'Deep network', blurb: 'Largest model (30k weights). Best on validation data.' },
  mlp_medium: { label: 'Medium network', blurb: 'Mid-sized (7k weights). Best on the test set and on unseen play styles.' },
  mlp_small: { label: 'Small network', blurb: 'Tiny (1k weights). Fewest deaths in simulation.' },
  softmax_regression: { label: 'Linear model', blurb: 'Simplest baseline. Reacts to the main numbers only.' },
  [RULES]: { label: 'Hand-written rules', blurb: 'No neural network: a fixed rule set decides the waves.' },
};

export interface DirectorChoice { key: string; label: string; blurb: string; stats: string | null }

export function bundledName(): string {
  return DirectorModel.bundled().spec.model;
}

/** Resolves the stored setting to a concrete model key (unknown values fall back to the shipped model). */
export function effectiveKey(setting: string): string {
  if (setting === RULES) return RULES;
  if (setting !== AUTO && (index as IndexRow[]).some((r) => r.name === setting)) return setting;
  return bundledName();
}

export function directorChoices(): DirectorChoice[] {
  const rows = (index as IndexRow[]).slice().sort((a, b) => b.params - a.params);
  const shipped = bundledName();
  const out: DirectorChoice[] = rows.map((r) => ({
    key: r.name,
    label: (COPY[r.name]?.label ?? r.name) + (r.name === shipped ? ' (default)' : ''),
    blurb: COPY[r.name]?.blurb ?? '',
    stats: `regret ${r.mean_regret.toFixed(2)} · deaths ${(r.policy_death_rate * 100).toFixed(0)}% · accuracy ${(r.accuracy * 100).toFixed(0)}%`,
  }));
  out.push({ key: RULES, label: COPY[RULES].label, blurb: COPY[RULES].blurb, stats: null });
  return out;
}

/** Loads the model for a setting; `null` means "use the rules". */
export async function loadDirector(setting: string): Promise<DirectorModel | null> {
  const key = effectiveKey(setting);
  if (key === RULES) return null;
  if (key === bundledName()) return DirectorModel.bundled();
  const load = loaders[`./director_models/${key}.json`];
  if (!load) return DirectorModel.bundled();
  return new DirectorModel((await load()) as DirectorSpec);
}
