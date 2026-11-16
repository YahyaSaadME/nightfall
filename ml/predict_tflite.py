"""
Run the exported spawn-director TFLite model on one player state, the way a phone app would.

    python predict_tflite.py                       # a built-in example
    python predict_tflite.py health=35 ammo_total=4 zombies_alive=3 nearest_zombie_m=6

Inputs are RAW values in natural units (see FEATURES in features.py). They are scaled with
clip(raw / scale, 0, 1) exactly as in training, using the table stored in director_model.json,
so a mobile app only needs that JSON and director.tflite.

Uses `ai_edge_litert` (the standalone LiteRT runtime, which is what you would ship) when it is
installed, otherwise TensorFlow's bundled interpreter.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

EXPORT = Path(__file__).parent / "export"

try:
    from ai_edge_litert.interpreter import Interpreter  # type: ignore
except ImportError:  # pragma: no cover
    import tensorflow as tf

    Interpreter = tf.lite.Interpreter

EXAMPLE = dict(
    health=100, stamina=100, ammo_total=40, weapon_power=0.5, battery=80, zombies_alive=0, nearest_zombie_m=30,
    since_damage_s=90, since_kill_s=90, kills_60s=0, accuracy_60s=0.6, since_spawn_s=90, progress=0.6,
    sprint_frac_60s=0.1, light_level=0.3, stalker_dist_m=30,
)


def main() -> None:
    spec = json.loads((EXPORT / "director_model.json").read_text())
    obs = dict(EXAMPLE)
    for arg in sys.argv[1:]:
        k, v = arg.split("=")
        if k not in obs:
            raise SystemExit(f"unknown feature {k!r}; choose from {', '.join(obs)}")
        obs[k] = float(v)

    x = np.array([[min(1.0, max(0.0, obs[f["name"]] / f["scale"])) for f in spec["features"]]], dtype=np.float32)
    it = Interpreter(model_path=str(EXPORT / "director.tflite"))
    it.allocate_tensors()
    it.set_tensor(it.get_input_details()[0]["index"], x)
    it.invoke()
    probs = it.get_tensor(it.get_output_details()[0]["index"])[0]

    tier = int(probs.argmax())
    print("input :", {k: obs[k] for k in obs})
    for name, count, p in zip(spec["classes"], spec["spawn_counts"], probs):
        print(f"  {name:<7} (spawn {count}) {p:6.1%}")
    print(f"-> spawn {spec['spawn_counts'][tier]} zombie(s) [{spec['classes'][tier]}]")


if __name__ == "__main__":
    main()
