"""
Train, evaluate and export the spawn-director models.

    python train.py [--epochs 80] [--cv 5] [--quick]

Models
  Keras (all converted to TFLite):  softmax_regression, mlp_small, mlp_medium, mlp_deep_bn
  scikit-learn (comparison only):   random_forest, hist_gradient_boosting
  Reference policies:               oracle (upper bound), heuristic (hand-written), always_none, majority

Everything measured is written to ml/reports/. The Keras model with the lowest validation
regret is exported for the game (ml/export/, src/game/ai/director_model.json, public/models/).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import time
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import sklearn  # noqa: E402
import tensorflow as tf  # noqa: E402
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier  # noqa: E402
from sklearn.metrics import (  # noqa: E402
    accuracy_score, balanced_accuracy_score, brier_score_loss, classification_report, confusion_matrix,
    f1_score, log_loss, precision_recall_fscore_support, roc_auc_score, roc_curve,
)
from sklearn.model_selection import StratifiedKFold, train_test_split  # noqa: E402
from tensorflow import keras  # noqa: E402
from tensorflow.keras import layers  # noqa: E402

import simulator as sim  # noqa: E402
from features import CLASS_COUNTS, CLASS_NAMES, FEATURES, FEATURE_NAMES, N_CLASSES, N_FEATURES  # noqa: E402

ROOT = Path(__file__).parent
GAME = ROOT.parent
DATA = ROOT / "data"
REPORTS = ROOT / "reports"
MODELS = ROOT / "models"
EXPORT = ROOT / "export"
SEED = 42

plt.rcParams.update({"figure.dpi": 130, "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True,
                     "grid.alpha": 0.25, "font.size": 9})
PALETTE = ["#4c78a8", "#f58518", "#54a24b", "#e45756", "#72b7b2", "#b279a2", "#9d755d", "#bab0ac"]


# ------------------------------------------------------------------ metrics

def policy_stats(pred, U, L, P):
    r = np.arange(len(pred))
    best = U.max(1)
    regret = best - U[r, pred]
    return {
        "mean_regret": float(regret.mean()),
        "optimal_rate": float((pred == U.argmax(1)).mean()),
        "near_optimal_rate": float((regret < 0.25).mean()),
        "policy_exp_hp_loss": float(L[r, pred].mean()),
        "policy_death_rate": float(P[r, pred].mean()),
    }


def ece_score(y, probs, bins=15):
    conf = probs.max(1)
    pred = probs.argmax(1)
    edges = np.linspace(0, 1, bins + 1)
    e = 0.0
    for i in range(bins):
        m = (conf > edges[i]) & (conf <= edges[i + 1])
        if m.any():
            e += m.mean() * abs((pred[m] == y[m]).mean() - conf[m].mean())
    return float(e)


def evaluate(y, probs, pred, U, L, P, with_probs=True):
    if probs is not None:
        # Quantised TFLite softmax outputs only sum to ~1; renormalise before scoring.
        probs = probs / np.maximum(probs.sum(1, keepdims=True), 1e-9)
    m = {
        "accuracy": float(accuracy_score(y, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, average="macro")),
        "weighted_f1": float(f1_score(y, pred, average="weighted")),
        "ordinal_mae_tiers": float(np.abs(pred - y).mean()),
        "within_one_tier": float((np.abs(pred - y) <= 1).mean()),
    }
    p, r, f, s = precision_recall_fscore_support(y, pred, labels=range(N_CLASSES), zero_division=0)
    m["per_class"] = {CLASS_NAMES[i]: {"precision": float(p[i]), "recall": float(r[i]), "f1": float(f[i]), "support": int(s[i])}
                      for i in range(N_CLASSES)}
    cm = confusion_matrix(y, pred, labels=range(N_CLASSES))
    m["confusion_matrix"] = cm.tolist()
    if with_probs and probs is not None:
        onehot = np.eye(N_CLASSES)[y]
        pc = np.clip(probs, 1e-7, 1.0)
        pc = pc / pc.sum(1, keepdims=True)
        m["log_loss"] = float(log_loss(y, pc, labels=range(N_CLASSES)))
        m["top2_accuracy"] = float((np.argsort(-probs, 1)[:, :2] == y[:, None]).any(1).mean())
        m["brier"] = float(((probs - onehot) ** 2).sum(1).mean())
        m["roc_auc_macro_ovr"] = float(roc_auc_score(y, probs, multi_class="ovr", average="macro", labels=list(range(N_CLASSES))))
        m["ece"] = ece_score(y, probs)
    m.update(policy_stats(pred, U, L, P))
    return m


# ------------------------------------------------------------------ models

def build_keras(name: str) -> keras.Model:
    inp = keras.Input((N_FEATURES,), name="features")
    if name == "softmax_regression":
        x = layers.Dense(N_CLASSES, activation="softmax", name="out")(inp)
    elif name == "mlp_small":
        x = layers.Dense(32, activation="relu")(inp)
        x = layers.Dense(16, activation="relu")(x)
        x = layers.Dense(N_CLASSES, activation="softmax", name="out")(x)
    elif name == "mlp_medium":
        x = layers.Dense(64, activation="relu")(inp)
        x = layers.Dropout(0.1)(x)
        x = layers.Dense(64, activation="relu")(x)
        x = layers.Dense(32, activation="relu")(x)
        x = layers.Dense(N_CLASSES, activation="softmax", name="out")(x)
    elif name == "mlp_deep_bn":
        x = inp
        for units, drop in ((128, 0.2), (128, 0.2), (64, 0.1)):
            x = layers.Dense(units)(x)
            x = layers.BatchNormalization()(x)
            x = layers.ReLU()(x)
            x = layers.Dropout(drop)(x)
        x = layers.Dense(32, activation="relu")(x)
        x = layers.Dense(N_CLASSES, activation="softmax", name="out")(x)
    else:
        raise ValueError(name)
    m = keras.Model(inp, x, name=name)
    m.compile(optimizer=keras.optimizers.Adam(2e-3), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    return m


def fit_keras(name, Xtr, ytr, Xva, yva, epochs, verbose=0):
    keras.utils.set_random_seed(SEED)
    m = build_keras(name)
    cbs = [
        keras.callbacks.EarlyStopping(monitor="val_loss", patience=10, restore_best_weights=True),
        keras.callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=4, min_lr=1e-5),
    ]
    t0 = time.time()
    h = m.fit(Xtr, ytr, validation_data=(Xva, yva), epochs=epochs, batch_size=256, callbacks=cbs, verbose=verbose)
    return m, pd.DataFrame(h.history), time.time() - t0


def build_sklearn(name):
    if name == "random_forest":
        return RandomForestClassifier(n_estimators=300, max_depth=18, min_samples_leaf=3, n_jobs=-1, random_state=SEED)
    if name == "hist_gradient_boosting":
        return HistGradientBoostingClassifier(max_iter=400, learning_rate=0.08, max_leaf_nodes=31, early_stopping=True,
                                              validation_fraction=0.12, n_iter_no_change=15, random_state=SEED)
    raise ValueError(name)


KERAS_MODELS = ["softmax_regression", "mlp_small", "mlp_medium", "mlp_deep_bn"]
SK_MODELS = ["random_forest", "hist_gradient_boosting"]


# ------------------------------------------------------------------ tflite

def _convert(model: keras.Model, variant: str, rep_x: np.ndarray) -> bytes:
    def make():
        try:
            return tf.lite.TFLiteConverter.from_keras_model(model)
        except Exception:  # Keras 3 fallback: export a SavedModel first
            d = ROOT / "_tmp_saved_model"
            shutil.rmtree(d, ignore_errors=True)
            model.export(str(d))
            return tf.lite.TFLiteConverter.from_saved_model(str(d))

    c = make()
    if variant == "fp32":
        pass
    elif variant == "fp16":
        c.optimizations = [tf.lite.Optimize.DEFAULT]
        c.target_spec.supported_types = [tf.float16]
    elif variant == "dynamic_int8":
        c.optimizations = [tf.lite.Optimize.DEFAULT]
    elif variant == "int8_full":
        c.optimizations = [tf.lite.Optimize.DEFAULT]

        def rep():
            for i in range(0, 500):
                yield [rep_x[i:i + 1].astype(np.float32)]
        c.representative_dataset = rep
    else:
        raise ValueError(variant)
    return c.convert()


def tflite_predict(content: bytes, X: np.ndarray) -> np.ndarray:
    it = tf.lite.Interpreter(model_content=content, num_threads=1)
    inp, out = it.get_input_details()[0], it.get_output_details()[0]
    it.resize_tensor_input(inp["index"], [len(X), X.shape[1]])
    it.allocate_tensors()
    it.set_tensor(inp["index"], X.astype(np.float32))
    it.invoke()
    return it.get_tensor(out["index"]).copy()


def tflite_latency_us(content: bytes, X: np.ndarray, runs=3000) -> dict:
    it = tf.lite.Interpreter(model_content=content, num_threads=1)
    inp, out = it.get_input_details()[0], it.get_output_details()[0]
    it.resize_tensor_input(inp["index"], [1, X.shape[1]])
    it.allocate_tensors()
    for i in range(200):
        it.set_tensor(inp["index"], X[i:i + 1]); it.invoke(); it.get_tensor(out["index"])
    ts = []
    for i in range(runs):
        x = X[i % len(X):i % len(X) + 1]
        t = time.perf_counter_ns()
        it.set_tensor(inp["index"], x); it.invoke(); it.get_tensor(out["index"])
        ts.append((time.perf_counter_ns() - t) / 1000)
    ts = np.array(ts)
    return {"mean_us": float(ts.mean()), "p50_us": float(np.percentile(ts, 50)), "p95_us": float(np.percentile(ts, 95)),
            "p99_us": float(np.percentile(ts, 99))}


def callable_latency_us(fn, X, runs=300) -> dict:
    for i in range(20):
        fn(X[i:i + 1])
    ts = []
    for i in range(runs):
        t = time.perf_counter_ns()
        fn(X[i:i + 1])
        ts.append((time.perf_counter_ns() - t) / 1000)
    ts = np.array(ts)
    return {"mean_us": float(ts.mean()), "p50_us": float(np.percentile(ts, 50)), "p95_us": float(np.percentile(ts, 95)),
            "p99_us": float(np.percentile(ts, 99))}


# ------------------------------------------------------------------ game export

def keras_to_game_json(model: keras.Model) -> list[dict]:
    """Dense / BatchNorm / ReLU / Dropout stack -> [{W, b, act}] with BatchNorm folded in."""
    out: list[dict] = []
    pending = None

    def flush():
        nonlocal pending
        if pending is not None:
            out.append(pending)
            pending = None

    for l in model.layers:
        cls = l.__class__.__name__
        if cls == "Dense":
            flush()
            W, b = [np.array(w, dtype=np.float64) for w in l.get_weights()]
            act = l.get_config()["activation"]
            pending = {"W": W, "b": b, "act": {"linear": "linear", "relu": "relu", "softmax": "softmax"}[act]}
        elif cls == "BatchNormalization":
            gamma, beta, mean, var = [np.array(w, dtype=np.float64) for w in l.get_weights()]
            scale = gamma / np.sqrt(var + l.epsilon)
            pending["W"] = pending["W"] * scale[None, :]
            pending["b"] = (pending["b"] - mean) * scale + beta
        elif cls == "ReLU":
            pending["act"] = "relu"
        elif cls in ("InputLayer", "Dropout"):
            continue
        else:
            raise ValueError(f"unsupported layer for game export: {cls}")
    flush()
    return [{"W": np.round(p["W"], 7).tolist(), "b": np.round(p["b"], 7).tolist(), "act": p["act"]} for p in out]


def numpy_forward(layers_json: list[dict], X: np.ndarray) -> np.ndarray:
    a = X.astype(np.float64)
    for l in layers_json:
        z = a @ np.array(l["W"]) + np.array(l["b"])
        if l["act"] == "relu":
            z = np.maximum(z, 0)
        elif l["act"] == "softmax":
            z = np.exp(z - z.max(1, keepdims=True)); z = z / z.sum(1, keepdims=True)
        a = z
    return a


# ------------------------------------------------------------------ plots

def plot_confusion(cm, title, path):
    cm = np.array(cm)
    norm = cm / np.maximum(cm.sum(1, keepdims=True), 1)
    fig, ax = plt.subplots(figsize=(4.4, 4))
    im = ax.imshow(norm, cmap="Blues", vmin=0, vmax=1)
    ax.grid(False)
    for i in range(N_CLASSES):
        for j in range(N_CLASSES):
            ax.text(j, i, f"{norm[i, j]:.0%}\n({cm[i, j]})", ha="center", va="center", fontsize=7.5,
                    color="white" if norm[i, j] > 0.55 else "black")
    ax.set_xticks(range(N_CLASSES), CLASS_NAMES); ax.set_yticks(range(N_CLASSES), CLASS_NAMES)
    ax.set_xlabel("predicted"); ax.set_ylabel("oracle label"); ax.set_title(title, fontsize=9)
    fig.colorbar(im, fraction=0.046); fig.tight_layout(); fig.savefig(path); plt.close(fig)


def plot_roc(y, probs, title, path):
    fig, ax = plt.subplots(figsize=(4.4, 4))
    for i in range(N_CLASSES):
        fpr, tpr, _ = roc_curve((y == i).astype(int), probs[:, i])
        ax.plot(fpr, tpr, color=PALETTE[i], label=f"{CLASS_NAMES[i]} (AUC {roc_auc_score((y == i).astype(int), probs[:, i]):.3f})")
    ax.plot([0, 1], [0, 1], "k--", lw=0.8)
    ax.set_xlabel("false positive rate"); ax.set_ylabel("true positive rate"); ax.set_title(title, fontsize=9)
    ax.legend(fontsize=7, loc="lower right"); fig.tight_layout(); fig.savefig(path); plt.close(fig)


def plot_calibration(y, probs, title, path, bins=12):
    conf, pred = probs.max(1), probs.argmax(1)
    edges = np.linspace(0, 1, bins + 1)
    xs, ys, ns = [], [], []
    for i in range(bins):
        m = (conf > edges[i]) & (conf <= edges[i + 1])
        if m.sum() >= 10:
            xs.append(conf[m].mean()); ys.append((pred[m] == y[m]).mean()); ns.append(m.sum())
    fig, ax = plt.subplots(figsize=(4.4, 4))
    ax.plot([0, 1], [0, 1], "k--", lw=0.8, label="perfect")
    ax.plot(xs, ys, "o-", color=PALETTE[0], label="model")
    ax.set_xlabel("confidence"); ax.set_ylabel("accuracy"); ax.set_title(title, fontsize=9)
    ax.legend(fontsize=7); fig.tight_layout(); fig.savefig(path); plt.close(fig)


def plot_history(h: pd.DataFrame, title, path):
    fig, axs = plt.subplots(1, 2, figsize=(8, 3.2))
    axs[0].plot(h["loss"], label="train"); axs[0].plot(h["val_loss"], label="val"); axs[0].set_title("loss")
    axs[1].plot(h["accuracy"], label="train"); axs[1].plot(h["val_accuracy"], label="val"); axs[1].set_title("accuracy")
    for a in axs:
        a.set_xlabel("epoch"); a.legend(fontsize=7)
    fig.suptitle(title, fontsize=9); fig.tight_layout(); fig.savefig(path); plt.close(fig)


def permutation_importance(predict, X, y, repeats=3, n=4000, seed=0):
    rng = np.random.default_rng(seed)
    idx = rng.choice(len(X), size=min(n, len(X)), replace=False)
    Xs, ys = X[idx], y[idx]
    base = f1_score(ys, predict(Xs).argmax(1), average="macro")
    res = {}
    for j, name in enumerate(FEATURE_NAMES):
        drops = []
        for _ in range(repeats):
            Xp = Xs.copy()
            Xp[:, j] = rng.permutation(Xp[:, j])
            drops.append(base - f1_score(ys, predict(Xp).argmax(1), average="macro"))
        res[name] = float(np.mean(drops))
    return res


def md_table(df: pd.DataFrame, floatfmt="{:.4f}") -> str:
    cols = list(df.columns)
    lines = ["| " + " | ".join(str(c) for c in cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    for _, r in df.iterrows():
        cells = []
        for c in cols:
            v = r[c]
            cells.append(floatfmt.format(v) if isinstance(v, (float, np.floating)) and not np.isnan(v) else ("" if (isinstance(v, float) and np.isnan(v)) else str(v)))
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


# ------------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=80)
    ap.add_argument("--cv", type=int, default=5, help="k for cross-validation (0 disables)")
    ap.add_argument("--quick", action="store_true", help="few epochs, no CV (smoke test)")
    args = ap.parse_args()
    if args.quick:
        args.epochs, args.cv = 3, 0

    t_start = time.time()
    for d in (REPORTS, MODELS, EXPORT, REPORTS / "models"):
        d.mkdir(parents=True, exist_ok=True)
    keras.utils.set_random_seed(SEED)

    D = np.load(DATA / "director_dataset.npz")
    X, y, raw, U, L, P = D["X"], D["y"], D["raw"], D["U"], D["loss"], D["p_die"]
    oX, oy, oraw, oU, oL, oP = D["ood_X"], D["ood_y"], D["ood_raw"], D["ood_U"], D["ood_loss"], D["ood_p_die"]
    idx = np.arange(len(y))
    i_tr, i_tmp = train_test_split(idx, test_size=0.30, stratify=y, random_state=SEED)
    i_va, i_te = train_test_split(i_tmp, test_size=0.50, stratify=y[i_tmp], random_state=SEED)
    split = {"train": i_tr, "val": i_va, "test": i_te}
    print(f"train {len(i_tr)}  val {len(i_va)}  test {len(i_te)}  ood {len(oy)}")

    sets = {
        "val": (X[i_va], y[i_va], raw[i_va], U[i_va], L[i_va], P[i_va]),
        "test": (X[i_te], y[i_te], raw[i_te], U[i_te], L[i_te], P[i_te]),
        "ood": (oX, oy, oraw, oU, oL, oP),
    }

    results: dict[str, dict] = {}      # model -> {split -> metrics}
    meta: dict[str, dict] = {}         # model -> misc info
    probs_store: dict[str, dict] = {}  # model -> split -> probs

    # ---- reference policies (no training)
    def ref_eval(name, fn):
        results[name] = {}
        for s, (_, ys, rs, Us, Ls, Ps) in sets.items():
            pred = fn(rs, ys, Us)
            results[name][s] = evaluate(ys, None, pred, Us, Ls, Ps, with_probs=False)
        meta[name] = {"kind": "reference"}

    majority = int(np.bincount(y[i_tr]).argmax())
    ref_eval("oracle", lambda r, ys, Us: Us.argmax(1))
    ref_eval("heuristic_rules", lambda r, ys, Us: sim.heuristic_policy(r))
    ref_eval("always_none", lambda r, ys, Us: np.zeros(len(ys), dtype=np.int64))
    ref_eval("majority_class", lambda r, ys, Us: np.full(len(ys), majority, dtype=np.int64))

    # ---- trained models
    keras_models: dict[str, keras.Model] = {}
    histories: dict[str, pd.DataFrame] = {}
    for name in KERAS_MODELS:
        print(f"\n== training {name}")
        m, hist, secs = fit_keras(name, X[i_tr], y[i_tr], X[i_va], y[i_va], args.epochs)
        keras_models[name], histories[name] = m, hist
        meta[name] = {"kind": "keras", "params": int(m.count_params()), "train_seconds": round(secs, 1),
                      "epochs_run": int(len(hist)), "best_val_loss": float(hist["val_loss"].min())}
        results[name], probs_store[name] = {}, {}
        for s, (Xs, ys, _, Us, Ls, Ps) in sets.items():
            pr = m.predict(Xs, batch_size=2048, verbose=0)
            probs_store[name][s] = pr
            results[name][s] = evaluate(ys, pr, pr.argmax(1), Us, Ls, Ps)
        print(f"   test acc {results[name]['test']['accuracy']:.4f}  macroF1 {results[name]['test']['macro_f1']:.4f}  "
              f"regret {results[name]['test']['mean_regret']:.4f}  ({secs:.0f}s, {len(hist)} epochs)")

    sk_models = {}
    for name in SK_MODELS:
        print(f"\n== training {name}")
        t0 = time.time()
        m = build_sklearn(name).fit(X[i_tr], y[i_tr])
        secs = time.time() - t0
        sk_models[name] = m
        meta[name] = {"kind": "sklearn", "train_seconds": round(secs, 1)}
        results[name], probs_store[name] = {}, {}
        for s, (Xs, ys, _, Us, Ls, Ps) in sets.items():
            pr = m.predict_proba(Xs)
            probs_store[name][s] = pr
            results[name][s] = evaluate(ys, pr, pr.argmax(1), Us, Ls, Ps)
        print(f"   test acc {results[name]['test']['accuracy']:.4f}  macroF1 {results[name]['test']['macro_f1']:.4f}  "
              f"regret {results[name]['test']['mean_regret']:.4f}  ({secs:.0f}s)")

    # ---- per-model reports
    trained = KERAS_MODELS + SK_MODELS
    importance = {}
    for name in trained:
        d = REPORTS / "models" / name
        d.mkdir(parents=True, exist_ok=True)
        (d / "metrics.json").write_text(json.dumps({"info": meta[name], "metrics": results[name]}, indent=2))
        pt = probs_store[name]["test"]
        plot_confusion(results[name]["test"]["confusion_matrix"], f"{name} - test", d / "confusion_test.png")
        plot_confusion(results[name]["ood"]["confusion_matrix"], f"{name} - held-out archetype", d / "confusion_ood.png")
        plot_roc(sets["test"][1], pt, f"{name} - test ROC (one-vs-rest)", d / "roc_test.png")
        plot_calibration(sets["test"][1], pt, f"{name} - calibration (test)", d / "calibration_test.png")
        (d / "classification_report.txt").write_text(
            classification_report(sets["test"][1], pt.argmax(1), target_names=CLASS_NAMES, digits=4, zero_division=0))
        if name in histories:
            histories[name].to_csv(d / "history.csv", index=False)
            plot_history(histories[name], name, d / "history.png")
        pred_fn = (lambda M: (lambda A: M.predict(A, batch_size=4096, verbose=0)))(keras_models[name]) if name in keras_models \
            else sk_models[name].predict_proba
        importance[name] = permutation_importance(pred_fn, X[i_te], y[i_te])
        (d / "feature_importance.json").write_text(json.dumps(importance[name], indent=2))

    # ---- cross-validation on train+val (test untouched)
    cv_rows = []
    if args.cv:
        print(f"\n== {args.cv}-fold cross-validation")
        pool = np.concatenate([i_tr, i_va])
        skf = StratifiedKFold(args.cv, shuffle=True, random_state=SEED)
        for name in trained:
            for fold, (a, b) in enumerate(skf.split(pool, y[pool])):
                ia, ib = pool[a], pool[b]
                if name in KERAS_MODELS:
                    ia2, iv2 = train_test_split(ia, test_size=0.1, stratify=y[ia], random_state=SEED)
                    mm, _, _ = fit_keras(name, X[ia2], y[ia2], X[iv2], y[iv2], args.epochs)
                    pr = mm.predict(X[ib], batch_size=4096, verbose=0)
                    keras.backend.clear_session()
                else:
                    mm = build_sklearn(name).fit(X[ia], y[ia])
                    pr = mm.predict_proba(X[ib])
                ev = evaluate(y[ib], pr, pr.argmax(1), U[ib], L[ib], P[ib])
                cv_rows.append({"model": name, "fold": fold, "accuracy": ev["accuracy"], "macro_f1": ev["macro_f1"],
                                "log_loss": ev["log_loss"], "mean_regret": ev["mean_regret"], "policy_death_rate": ev["policy_death_rate"]})
            print(f"   {name}: macroF1 {np.mean([r['macro_f1'] for r in cv_rows if r['model'] == name]):.4f}")
        pd.DataFrame(cv_rows).to_csv(REPORTS / "cv_folds.csv", index=False)

    # ---- TFLite conversion, parity, size, latency
    print("\n== TFLite conversion")
    tfl_rows = []
    tfl_bytes: dict[tuple[str, str], bytes] = {}
    Xte, yte, _, Ute, Lte, Pte = sets["test"]
    for name in KERAS_MODELS:
        md = MODELS / name
        md.mkdir(parents=True, exist_ok=True)
        keras_models[name].save(md / "model.keras")
        k_probs = probs_store[name]["test"]
        for variant in ("fp32", "fp16", "dynamic_int8", "int8_full"):
            try:
                content = _convert(keras_models[name], variant, X[i_tr])
            except Exception as e:  # keep going: report the failure instead of hiding it
                tfl_rows.append({"model": name, "variant": variant, "error": str(e)[:200]})
                print(f"   {name}/{variant}: FAILED {e}")
                continue
            (md / f"model_{variant}.tflite").write_bytes(content)
            tfl_bytes[(name, variant)] = content
            pr = tflite_predict(content, Xte)
            ev = evaluate(yte, pr, pr.argmax(1), Ute, Lte, Pte)
            lat = tflite_latency_us(content, Xte)
            tfl_rows.append({
                "model": name, "variant": variant, "size_kb": len(content) / 1024,
                "test_accuracy": ev["accuracy"], "test_macro_f1": ev["macro_f1"], "test_mean_regret": ev["mean_regret"],
                "test_policy_death_rate": ev["policy_death_rate"],
                "max_abs_prob_diff_vs_keras": float(np.abs(pr - k_probs).max()),
                "argmax_agreement_vs_keras": float((pr.argmax(1) == k_probs.argmax(1)).mean()),
                "latency_mean_us": lat["mean_us"], "latency_p50_us": lat["p50_us"], "latency_p95_us": lat["p95_us"],
                "latency_p99_us": lat["p99_us"],
            })
            print(f"   {name}/{variant}: {len(content) / 1024:.1f} KB  acc {ev['accuracy']:.4f}  "
                  f"diff {tfl_rows[-1]['max_abs_prob_diff_vs_keras']:.2e}  p50 {lat['p50_us']:.1f} us")
    tfl = pd.DataFrame(tfl_rows)
    tfl.to_csv(REPORTS / "tflite_variants.csv", index=False)

    # ---- latency of the non-TFLite runtimes (for context)
    lat_rows = []
    for name in KERAS_MODELS:
        mm = keras_models[name]
        lat_rows.append({"model": name, "runtime": "keras_eager", **callable_latency_us(lambda a, mm=mm: mm(a, training=False).numpy(), Xte)})
    for name in SK_MODELS:
        mm = sk_models[name]
        lat_rows.append({"model": name, "runtime": "sklearn", **callable_latency_us(mm.predict_proba, Xte, runs=100)})
    pd.DataFrame(lat_rows).to_csv(REPORTS / "latency_other_runtimes.csv", index=False)

    # ---- summary tables
    rows = []
    for name, per in results.items():
        r = {"model": name, "kind": meta[name]["kind"], "params": meta[name].get("params", np.nan)}
        for s in ("val", "test", "ood"):
            for k in ("accuracy", "macro_f1", "mean_regret", "policy_death_rate"):
                r[f"{s}_{k}"] = per[s][k]
        for k in ("balanced_accuracy", "log_loss", "roc_auc_macro_ovr", "ece", "ordinal_mae_tiers", "within_one_tier",
                  "near_optimal_rate", "policy_exp_hp_loss"):
            r[f"test_{k}"] = per["test"].get(k, np.nan)
        r["train_seconds"] = meta[name].get("train_seconds", np.nan)
        rows.append(r)
    summary = pd.DataFrame(rows)
    summary.to_csv(REPORTS / "summary.csv", index=False)

    # ---- pick the model to ship: lowest validation regret among Keras (TFLite-convertible) models
    cand = summary[summary["model"].isin(KERAS_MODELS)].sort_values(["val_mean_regret", "params"])
    best = cand.iloc[0]["model"]
    print(f"\n== deploying {best}")

    # ---- comparison plots
    order = ["oracle"] + trained + ["heuristic_rules", "always_none", "majority_class"]
    sm = summary.set_index("model").loc[order]
    fig, axs = plt.subplots(1, 4, figsize=(15, 3.8))
    for ax, (col, ttl, better) in zip(axs, [("test_accuracy", "Accuracy (test)", "higher"), ("test_macro_f1", "Macro-F1 (test)", "higher"),
                                            ("test_mean_regret", "Mean regret (test)", "lower"), ("test_policy_death_rate", "Death rate under policy (test)", "lower")]):
        colors = [PALETTE[3] if m == best else (PALETTE[7] if meta[m]["kind"] == "reference" else PALETTE[0]) for m in order]
        ax.barh(order, sm[col].values, color=colors); ax.invert_yaxis(); ax.set_title(f"{ttl} - {better} is better", fontsize=9)
    fig.tight_layout(); fig.savefig(REPORTS / "comparison_models.png"); plt.close(fig)

    fig, ax = plt.subplots(figsize=(7, 3.6))
    w = 0.27
    xs = np.arange(len(trained))
    for k, s in enumerate(("val", "test", "ood")):
        ax.bar(xs + (k - 1) * w, [summary.set_index("model").loc[m, f"{s}_macro_f1"] for m in trained], w, label=s, color=PALETTE[k])
    ax.set_xticks(xs, trained, rotation=20, ha="right"); ax.set_ylabel("macro-F1"); ax.legend(title="split"); ax.set_title("Generalisation: val / test / held-out player archetype", fontsize=9)
    fig.tight_layout(); fig.savefig(REPORTS / "comparison_generalisation.png"); plt.close(fig)

    fig, ax = plt.subplots(figsize=(6.4, 4))
    for i, name in enumerate(KERAS_MODELS):
        t = tfl[(tfl["model"] == name) & tfl["size_kb"].notna()]
        ax.scatter(t["size_kb"], t["latency_p50_us"], s=60, color=PALETTE[i], label=name)
        for _, r in t.iterrows():
            ax.annotate(r["variant"], (r["size_kb"], r["latency_p50_us"]), fontsize=6, xytext=(3, 3), textcoords="offset points")
    ax.set_xscale("log"); ax.set_xlabel("TFLite size (KB)"); ax.set_ylabel("p50 latency, single sample (us)"); ax.legend(fontsize=7)
    ax.set_title("TFLite size vs latency (desktop CPU, 1 thread)", fontsize=9)
    fig.tight_layout(); fig.savefig(REPORTS / "comparison_tflite.png"); plt.close(fig)

    imp = pd.DataFrame(importance).T[FEATURE_NAMES]
    imp.to_csv(REPORTS / "feature_importance.csv")
    fig, ax = plt.subplots(figsize=(6.5, 4.2))
    s = imp.loc[best].sort_values()
    ax.barh(s.index, s.values, color=PALETTE[0]); ax.set_title(f"Permutation importance - {best} (drop in macro-F1)", fontsize=9)
    fig.tight_layout(); fig.savefig(REPORTS / "feature_importance_best.png"); plt.close(fig)

    ds = json.loads((DATA / "dataset_meta.json").read_text())
    fig, axs = plt.subplots(1, 2, figsize=(9, 3.2))
    axs[0].bar(CLASS_NAMES, [ds["label_distribution"][c] for c in CLASS_NAMES], color=PALETTE[:4]); axs[0].set_title("Oracle label distribution", fontsize=9)
    axs[1].bar(CLASS_NAMES, [ds["mean_expected_hp_loss_per_action"][c] for c in CLASS_NAMES], color=PALETTE[:4])
    axs[1].set_title("Mean simulated HP loss if this action is always taken", fontsize=9)
    fig.tight_layout(); fig.savefig(REPORTS / "dataset_overview.png"); plt.close(fig)

    # test-set predictions for every model
    pred_df = pd.DataFrame({"index": i_te, "oracle": yte})
    for name in trained:
        pred_df[name] = probs_store[name]["test"].argmax(1)
        pred_df[f"{name}_conf"] = probs_store[name]["test"].max(1).round(4)
    pred_df.to_csv(REPORTS / "predictions_test.csv", index=False)

    # ---- game export (the chosen model)
    best_model = keras_models[best]
    gj = keras_to_game_json(best_model)
    ref = numpy_forward(gj, Xte)
    assert np.abs(ref - probs_store[best]["test"]).max() < 1e-4, "game JSON forward pass disagrees with Keras"
    fp32 = tfl_bytes[(best, "fp32")]
    spec = {
        "version": 1,
        "model": best,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "classes": CLASS_NAMES,
        "spawn_counts": CLASS_COUNTS,
        "max_alive": sim.MAX_ALIVE,
        "features": [{"name": n, "scale": s, "desc": d} for n, s, d in FEATURES],
        "layers": gj,
        "metrics_test": {k: results[best]["test"][k] for k in ("accuracy", "macro_f1", "mean_regret", "policy_death_rate")},
        "tflite_sha256": hashlib.sha256(fp32).hexdigest(),
    }
    (EXPORT / "director_model.json").write_text(json.dumps(spec, separators=(",", ":")))
    (EXPORT / "director.tflite").write_bytes(fp32)
    if (best, "fp16") in tfl_bytes:
        (EXPORT / "director_fp16.tflite").write_bytes(tfl_bytes[(best, "fp16")])
    best_model.save(EXPORT / "director.keras")

    # parity vectors: raw inputs + expected outputs (TFLite fp32) for the TypeScript tests
    pv = np.random.default_rng(3).choice(len(Xte), 60, replace=False)
    raw_te = sets["test"][2][pv]
    tfl_out = tflite_predict(fp32, Xte[pv])
    (EXPORT / "parity_vectors.json").write_text(json.dumps({
        "feature_names": FEATURE_NAMES,
        "raw": np.round(raw_te, 5).tolist(),
        "expected_probs_tflite": np.round(tfl_out, 7).tolist(),
        "tolerance": 2e-4,
    }))
    game_json = GAME / "src" / "game" / "ai" / "director_model.json"
    game_json.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(EXPORT / "director_model.json", game_json)
    pub = GAME / "public" / "models"
    pub.mkdir(parents=True, exist_ok=True)
    shutil.copy(EXPORT / "director.tflite", pub / "director.tflite")
    shutil.copy(EXPORT / "director_model.json", pub / "director_model.json")
    shutil.rmtree(ROOT / "_tmp_saved_model", ignore_errors=True)

    # ---- written report
    env = {"python": platform.python_version(), "tensorflow": tf.__version__, "keras": keras.__version__,
           "numpy": np.__version__, "scikit_learn": sklearn.__version__, "platform": platform.platform(), "seed": SEED,
           "total_seconds": round(time.time() - t_start, 1)}
    (REPORTS / "environment.json").write_text(json.dumps(env, indent=2))
    (REPORTS / "metrics.json").write_text(json.dumps({"environment": env, "models": meta, "results": results,
                                                     "deployed_model": best}, indent=2))
    write_report(summary, tfl, pd.DataFrame(cv_rows), pd.DataFrame(lat_rows), results, meta, ds, env, best, imp, args)
    print(f"\nDone in {time.time() - t_start:.0f}s. Reports: {REPORTS}")


def write_report(summary, tfl, cv, lat, results, meta, ds, env, best, imp, args):
    L = []
    add = L.append
    add("# Spawn-director models: evaluation report\n")
    add(f"_Generated {time.strftime('%Y-%m-%d %H:%M')} - TensorFlow {env['tensorflow']}, scikit-learn {env['scikit_learn']}, "
        f"Python {env['python']}, seed {env['seed']}._\n")
    add("## What the models do\n")
    add("Given 16 numbers describing the player's current situation (health, ammo, recent kills/damage, zombies alive, ...), "
        "predict how many zombies the director should spawn: **none / light (1) / medium (3) / heavy (5)**. "
        "The label for each training state is the action with the best simulated outcome, see *How labels were made*.\n")
    add("## How labels were made (and what that means for these numbers)\n")
    add("There is no real-player data yet. `ml/simulator.py` plays 16 randomised 40 s encounters for each of the four actions in "
        "each sampled state, using the game's real constants (zombie speed/damage, weapon stats, the 1.4 s invulnerability window). "
        "A designer-intent utility (aim for a target amount of health loss that grows when the player is bored and shrinks when they are "
        "fragile, punish death and running dry, respect the live-zombie cap) scores each action; the best one is the label. "
        f"So every score below measures **how well a model reproduces that simulated oracle**, not how fun the game is. "
        f"Held-out check: the `{ds['archetype_held_out']}` player archetype was never used for training.\n")
    add(f"Dataset: {ds['n_train_pool']:,} states (70/15/15 train/val/test, stratified) + {ds['n_ood']:,} held-out-archetype states. "
        f"Label distribution: " + ", ".join(f"{k} {v:.1%}" for k, v in ds["label_distribution"].items()) + ". "
        f"{ds['label_margin_best_minus_second']['share_below_0.1']:.1%} of labels have a margin under 0.1 utility between best and second-best action "
        "(near-ties, so some 'errors' are harmless).\n")
    add("![dataset](dataset_overview.png)\n")

    add("## Headline results (test split)\n")
    cols = ["model", "kind", "params", "test_accuracy", "test_balanced_accuracy", "test_macro_f1", "test_log_loss", "test_roc_auc_macro_ovr",
            "test_mean_regret", "test_policy_death_rate"]
    order = ["oracle"] + [m for m in summary["model"] if m not in ("oracle", "heuristic_rules", "always_none", "majority_class")] + \
            ["heuristic_rules", "always_none", "majority_class"]
    t = summary.set_index("model").loc[order].reset_index()[cols]
    add(md_table(t) + "\n")
    add("*Mean regret* = average utility lost versus the oracle action (0 is perfect). *Death rate under policy* = simulated chance of dying "
        "if the model's action is taken. The hand-written rule baseline and the trivial baselines are included to show what the ML buys.\n")
    add("![models](comparison_models.png)\n")

    add("## Generalisation to an unseen player archetype\n")
    g = summary[summary["kind"].isin(["keras", "sklearn"])][["model", "val_macro_f1", "test_macro_f1", "ood_macro_f1", "ood_accuracy", "ood_mean_regret", "ood_policy_death_rate"]]
    add(md_table(g) + "\n")
    add("![generalisation](comparison_generalisation.png)\n")

    if len(cv):
        add(f"## {args.cv}-fold cross-validation (train+val pool)\n")
        agg = cv.groupby("model").agg(["mean", "std"]).drop(columns="fold")
        agg.columns = [f"{a}_{b}" for a, b in agg.columns]
        add(md_table(agg.reset_index()[["model", "accuracy_mean", "accuracy_std", "macro_f1_mean", "macro_f1_std", "mean_regret_mean", "mean_regret_std"]]) + "\n")

    add("## TFLite variants (phone deployment)\n")
    tt = tfl.copy()
    keep = [c for c in ["model", "variant", "size_kb", "test_accuracy", "test_macro_f1", "test_mean_regret", "max_abs_prob_diff_vs_keras",
                        "argmax_agreement_vs_keras", "latency_p50_us", "latency_p99_us"] if c in tt.columns]
    add(md_table(tt[keep]) + "\n")
    add("Latency is measured on this desktop CPU with one thread; phone CPUs are slower, but every model here is a few KB and a few thousand MACs, "
        "so expect tens of microseconds to well under a millisecond. Each decision happens roughly every 5 s.\n")
    add("![tflite](comparison_tflite.png)\n")

    add("## Per-class results of the deployed model (test)\n")
    pc = results[best]["test"]["per_class"]
    add(md_table(pd.DataFrame([{"class": k, **v} for k, v in pc.items()])) + "\n")
    add(f"Per-model confusion matrices, ROC curves, calibration plots, training curves and classification reports are in `models/<name>/`.\n")
    add("## What drives the decision\n")
    add("![importance](feature_importance_best.png)\n")
    top = imp.loc[best].sort_values(ascending=False).head(5)
    add("Top features for the deployed model: " + ", ".join(f"`{k}` ({v:.3f})" for k, v in top.items()) + ".\n")

    add(f"## Deployed model: `{best}`\n")
    add(f"Chosen because it has the lowest validation regret among the TFLite-convertible models. Artifacts: `ml/export/director.tflite` (fp32), "
        "`director_fp16.tflite`, `director_model.json` (copied to `src/game/ai/`), `parity_vectors.json`.\n")
    add("## Caveats\n")
    add("- Labels are simulator-derived; retrain on logged real play (the game keeps a director log, see `debugApi().directorLog()`) before trusting balance.\n"
        "- The player bot in the simulator is simple (stand and fight, shoot the nearest target); real players kite, hide and use doors.\n"
        "- Near-tie labels cap achievable accuracy, which is why regret and death-rate are reported next to accuracy.\n")
    (REPORTS / "REPORT.md").write_text("\n".join(L), encoding="utf-8")


if __name__ == "__main__":
    main()
