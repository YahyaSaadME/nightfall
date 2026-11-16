"""
Generate the director dataset: sample player states, simulate every candidate action,
label each state with the best action. Writes ml/data/*.

    python make_dataset.py [--n 48000] [--ood 6000] [--k 16]
"""
from __future__ import annotations

import argparse
import json
import os
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

import simulator as sim
from features import CLASS_COUNTS, CLASS_NAMES, FEATURE_NAMES, to_model_input

DATA = Path(__file__).parent / "data"
CHUNK = 1000


def _work(args):
    n, seed, archetypes, k = args
    rng = np.random.default_rng(seed)
    raw, skill, arch = sim.sample_states(n, rng, archetypes)
    U, L, P = sim.label_states(raw, skill, k, seed + 7919)
    return raw, skill, arch, U, L, P


def build(n: int, seed: int, archetypes: list[str], k: int, workers: int):
    sizes = [CHUNK] * (n // CHUNK) + ([n % CHUNK] if n % CHUNK else [])
    jobs = [(s, seed * 100003 + i, archetypes, k) for i, s in enumerate(sizes)]
    with ProcessPoolExecutor(max_workers=workers) as ex:
        parts = list(ex.map(_work, jobs))
    raw = np.concatenate([p[0] for p in parts])
    skill = np.concatenate([p[1] for p in parts])
    arch = np.concatenate([p[2] for p in parts])
    U = np.concatenate([p[3] for p in parts])
    L = np.concatenate([p[4] for p in parts])
    P = np.concatenate([p[5] for p in parts])
    return raw, skill, arch, U, L, P


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=48000)
    ap.add_argument("--ood", type=int, default=6000)
    ap.add_argument("--k", type=int, default=16)
    ap.add_argument("--seed", type=int, default=2025)
    args = ap.parse_args()

    DATA.mkdir(exist_ok=True)
    workers = max(1, min(os.cpu_count() or 2, 8))
    t0 = time.time()
    print(f"generating {args.n} in-distribution + {args.ood} out-of-distribution states "
          f"(K={args.k} rollouts x {len(CLASS_COUNTS)} actions) on {workers} workers")

    raw, skill, arch, U, L, P = build(args.n, args.seed, sim.TRAIN_ARCHETYPES, args.k, workers)
    oraw, oskill, oarch, oU, oL, oP = build(args.ood, args.seed + 1, ["speedrunner"], args.k, workers)

    y, oy = U.argmax(1), oU.argmax(1)
    np.savez_compressed(
        DATA / "director_dataset.npz",
        raw=raw, X=to_model_input(raw), y=y, U=U, loss=L, p_die=P, skill=skill, arch=arch,
        ood_raw=oraw, ood_X=to_model_input(oraw), ood_y=oy, ood_U=oU, ood_loss=oL, ood_p_die=oP,
    )

    df = pd.DataFrame(raw, columns=FEATURE_NAMES)
    df["archetype"] = [sim.TRAIN_ARCHETYPES[i] for i in arch]
    df["label"] = [CLASS_NAMES[i] for i in y]
    for a, nm in enumerate(CLASS_NAMES):
        df[f"U_{nm}"] = U[:, a]
    df.head(3000).round(3).to_csv(DATA / "sample_3000_rows.csv", index=False)

    dist = lambda v: {CLASS_NAMES[i]: round(float((v == i).mean()), 4) for i in range(len(CLASS_NAMES))}  # noqa: E731
    margin = np.sort(U, axis=1)
    meta = {
        "generated_seconds": round(time.time() - t0, 1),
        "n_train_pool": int(len(y)),
        "n_ood": int(len(oy)),
        "rollouts_per_state_action": args.k,
        "encounter_seconds": sim.STEPS * sim.DT,
        "class_names": CLASS_NAMES,
        "class_counts": CLASS_COUNTS,
        "label_distribution": dist(y),
        "ood_label_distribution": dist(oy),
        "archetypes_in_pool": sim.TRAIN_ARCHETYPES,
        "archetype_held_out": "speedrunner",
        "mean_expected_hp_loss_per_action": {CLASS_NAMES[a]: round(float(L[:, a].mean()), 4) for a in range(4)},
        "mean_death_prob_per_action": {CLASS_NAMES[a]: round(float(P[:, a].mean()), 4) for a in range(4)},
        "mean_utility_per_action": {CLASS_NAMES[a]: round(float(U[:, a].mean()), 4) for a in range(4)},
        "label_margin_best_minus_second": {
            "mean": round(float((margin[:, -1] - margin[:, -2]).mean()), 4),
            "p10": round(float(np.percentile(margin[:, -1] - margin[:, -2], 10)), 4),
            "share_below_0.1": round(float(((margin[:, -1] - margin[:, -2]) < 0.1).mean()), 4),
        },
        "note": "Synthetic: labels come from Monte-Carlo rollouts of ml/simulator.py, not from real players.",
    }
    (DATA / "dataset_meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
