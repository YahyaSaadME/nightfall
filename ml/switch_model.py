"""Switch which trained model the game uses, without retraining.

    python switch_model.py --list              # compare the trained models, shows which one is live
    python switch_model.py mlp_medium          # deploy that model to the game
    python switch_model.py mlp_small --variant fp16   # use the fp16 TFLite as director.tflite
    python switch_model.py --export-all        # bundle ALL models for the in-game "Spawn AI" picker (Settings)

Reads the already-trained models/<name>/ folders (made by train.py) and rewrites:
    export/director_model.json, director.tflite, director_fp16.tflite, director.keras, parity_vectors.json
    ../src/game/ai/director_model.json   (what the game loads)
    ../public/models/director.tflite + director_model.json
Then run `npm test` (checks the game's inference still matches the TFLite file) and redeploy.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import time

import numpy as np
import pandas as pd
from tensorflow import keras

import simulator as sim
import train as T
from features import CLASS_COUNTS, CLASS_NAMES, FEATURES, FEATURE_NAMES


def live_model() -> str:
    try:
        return json.loads((T.EXPORT / "director_model.json").read_text()).get("model", "?")
    except Exception:
        return "?"


def list_models() -> None:
    s = pd.read_csv(T.REPORTS / "summary.csv").set_index("model")
    cols = ["params", "val_mean_regret", "test_accuracy", "test_macro_f1", "test_mean_regret", "test_policy_death_rate", "ood_mean_regret"]
    t = s.loc[[m for m in T.KERAS_MODELS if m in s.index], cols].round(4)
    t.insert(0, "live", ["<== in the game" if m == live_model() else "" for m in t.index])
    print(t.to_string())
    print("\nLower regret / death rate is better. Switch with:  python switch_model.py <name>")


def export_all() -> None:
    """Write every trained Keras model as game JSON so players can pick one in Settings."""
    out = T.GAME / "src" / "game" / "ai" / "director_models"
    out.mkdir(parents=True, exist_ok=True)
    results = json.loads((T.REPORTS / "metrics.json").read_text())["results"]
    index = []
    for name in T.KERAS_MODELS:
        p = T.MODELS / name / "model.keras"
        if not p.exists():
            print(f"skip {name}: not trained")
            continue
        model = keras.models.load_model(p)
        gj = T.keras_to_game_json(model)
        t = results[name]["test"]
        spec = {
            "version": 1, "model": name, "classes": CLASS_NAMES, "spawn_counts": CLASS_COUNTS, "max_alive": sim.MAX_ALIVE,
            "features": [{"name": n, "scale": s, "desc": d} for n, s, d in FEATURES], "layers": gj,
            "metrics_test": {k: t[k] for k in ("accuracy", "macro_f1", "mean_regret", "policy_death_rate")},
        }
        (out / f"{name}.json").write_text(json.dumps(spec, separators=(",", ":")))
        index.append({"name": name, "params": int(model.count_params()), **spec["metrics_test"]})
        print(f"exported {name} ({model.count_params()} params)")
    (out / "index.json").write_text(json.dumps(index, indent=1))
    print(f"-> {out}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--export-all", action="store_true", help="bundle every trained model for the in-game picker")
    ap.add_argument("name", nargs="?", choices=T.KERAS_MODELS, help="trained model to deploy")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--variant", default="fp32", choices=["fp32", "fp16"], help="which TFLite file becomes director.tflite")
    args = ap.parse_args()
    if args.export_all:
        export_all()
        return
    if args.list or not args.name:
        list_models()
        return

    name = args.name
    mdir = T.MODELS / name
    if not (mdir / "model.keras").exists():
        raise SystemExit(f"{mdir / 'model.keras'} not found - run `npm run ml:train` first")

    model = keras.models.load_model(mdir / "model.keras")
    gj = T.keras_to_game_json(model)

    # parity vectors: same recipe as train.py, but any held-out-sized sample of the dataset works
    D = np.load(T.DATA / "director_dataset.npz")
    X, raw = D["X"], D["raw"]
    pv = np.random.default_rng(3).choice(len(X), 60, replace=False)
    ref = T.numpy_forward(gj, X[pv])
    keras_out = model.predict(X[pv], verbose=0)
    assert np.abs(ref - keras_out).max() < 1e-4, "game JSON forward pass disagrees with Keras"

    fp32 = (mdir / "model_fp32.tflite").read_bytes()
    fp16_path = mdir / "model_fp16.tflite"
    shipped = fp32 if args.variant == "fp32" else fp16_path.read_bytes()
    tfl_out = T.tflite_predict(shipped, X[pv])
    metrics = json.loads((T.REPORTS / "metrics.json").read_text())["results"][name]["test"]

    spec = {
        "version": 1,
        "model": name,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "classes": CLASS_NAMES,
        "spawn_counts": CLASS_COUNTS,
        "max_alive": sim.MAX_ALIVE,
        "features": [{"name": n, "scale": s, "desc": d} for n, s, d in FEATURES],
        "layers": gj,
        "metrics_test": {k: metrics[k] for k in ("accuracy", "macro_f1", "mean_regret", "policy_death_rate")},
        "tflite_sha256": hashlib.sha256(shipped).hexdigest(),
    }
    E = T.EXPORT
    (E / "director_model.json").write_text(json.dumps(spec, separators=(",", ":")))
    (E / "director.tflite").write_bytes(shipped)
    if fp16_path.exists():
        (E / "director_fp16.tflite").write_bytes(fp16_path.read_bytes())
    model.save(E / "director.keras")
    (E / "parity_vectors.json").write_text(json.dumps({
        "feature_names": FEATURE_NAMES,
        "raw": np.round(raw[pv], 5).tolist(),
        "expected_probs_tflite": np.round(tfl_out, 7).tolist(),
        "tolerance": 2e-4,
    }))

    game_json = T.GAME / "src" / "game" / "ai" / "director_model.json"
    shutil.copy(E / "director_model.json", game_json)
    pub = T.GAME / "public" / "models"
    pub.mkdir(parents=True, exist_ok=True)
    shutil.copy(E / "director.tflite", pub / "director.tflite")
    shutil.copy(E / "director_model.json", pub / "director_model.json")

    # keep the report's "deployed_model" in sync
    mp = T.REPORTS / "metrics.json"
    m = json.loads(mp.read_text())
    m["deployed_model"] = name
    mp.write_text(json.dumps(m, indent=2))

    print(f"Deployed '{name}' ({args.variant}) -> {game_json}")
    print("Next: `npm test` from the project root, then `npm run deploy`.")


if __name__ == "__main__":
    main()
