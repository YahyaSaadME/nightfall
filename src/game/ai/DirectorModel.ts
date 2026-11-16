import spec from './director_model.json';

export interface DirectorLayer { W: number[][]; b: number[]; act: 'linear' | 'relu' | 'softmax' }
export interface DirectorSpec {
  version: number;
  model: string;
  classes: string[];
  spawn_counts: number[];
  max_alive: number;
  features: { name: string; scale: number; desc: string }[];
  layers: DirectorLayer[];
  metrics_test?: Record<string, number>;
  tflite_sha256?: string;
}

/** Raw (natural-unit) observations, keyed by the feature names in ml/features.py. */
export type DirectorObservation = Record<string, number>;

/**
 * The deployed spawn-director network (exported from the Keras model that is also shipped
 * as director.tflite). Browsers cannot run .tflite directly, so the game evaluates the same
 * weights with a tiny dense-layer forward pass; tests check it matches the TFLite output.
 */
export class DirectorModel {
  readonly classes: string[];
  readonly counts: number[];

  constructor(readonly spec: DirectorSpec) {
    this.classes = spec.classes;
    this.counts = spec.spawn_counts;
  }

  static bundled(): DirectorModel {
    return new DirectorModel(spec as unknown as DirectorSpec);
  }

  /** Feature vector in model input space: clip(raw / scale, 0, 1). */
  vector(obs: DirectorObservation): number[] {
    return this.spec.features.map((f) => {
      const v = obs[f.name];
      if (v === undefined || Number.isNaN(v)) throw new Error(`director: missing feature ${f.name}`);
      return Math.min(1, Math.max(0, v / f.scale));
    });
  }

  predict(obs: DirectorObservation): number[] {
    return this.forward(this.vector(obs));
  }

  forward(input: number[]): number[] {
    let a = input;
    for (const l of this.spec.layers) {
      const out = new Array<number>(l.b.length);
      for (let j = 0; j < out.length; j++) {
        let s = l.b[j];
        for (let i = 0; i < a.length; i++) s += a[i] * l.W[i][j];
        out[j] = l.act === 'relu' ? (s > 0 ? s : 0) : s;
      }
      if (l.act === 'softmax') {
        const m = Math.max(...out);
        let sum = 0;
        for (let j = 0; j < out.length; j++) { out[j] = Math.exp(out[j] - m); sum += out[j]; }
        for (let j = 0; j < out.length; j++) out[j] /= sum;
      }
      a = out;
    }
    return a;
  }
}
