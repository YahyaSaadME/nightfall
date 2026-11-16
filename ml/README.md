# Spawn-director ML pipeline

A neural network decides **how many zombies to spawn** (none / 1 / 3 / 5) from 16 numbers
describing the player's current situation. This folder holds everything needed to
regenerate the data, retrain, evaluate and export the model, including the **TFLite**
file for phones.

> **Read this first.** There is no real-player data yet. Training labels come from a
> Monte-Carlo simulator of the game (`simulator.py`), so every metric measures how well a
> model reproduces *that simulated oracle*, not how fun the game is. The in-game director
> logs each decision with its 16 inputs (`window.__nightfall.directorLog()` in dev builds);
> that log is the starting point for retraining on real play.

## What's here

| Path | What it is |
| --- | --- |
| `features.py` | The 16 input features, their scales and the 4 output classes. The single source of truth: it is copied into the exported model JSON. |
| `simulator.py` | Encounter simulator + designer-intent utility that labels each state with its best action. Mirrors the game's real constants. |
| `make_dataset.py` | Samples player states, simulates every action, writes `data/`. |
| `train.py` | Trains 4 Keras models + 2 scikit-learn models, evaluates everything, converts to TFLite, writes `reports/`, `models/`, `export/` and the game's model files. |
| `predict_tflite.py` | Runs `export/director.tflite` on one state, the way a phone app would. |
| `data/` | `director_dataset.npz` (full data), `sample_3000_rows.csv` (readable sample), `dataset_meta.json`. |
| `models/<name>/` | Every trained Keras model (`model.keras`) and its four TFLite variants. |
| `reports/` | **All evaluation data.** Start with `reports/REPORT.md`. |
| `export/` | What ships: `director.tflite`, `director_fp16.tflite`, `director_model.json`, `parity_vectors.json`. |

## Retrain

```bash
npm run ml:setup     # once: Python 3.12 venv with TensorFlow (TF has no Python 3.15 build)
npm run ml:data      # ~5 min: 48,000 states + 6,000 held-out-archetype states
npm run ml:train     # ~25 min with 5-fold CV (add --cv 0 for ~3 min, --quick for a smoke test)
npm test             # checks the game's inference still matches the new TFLite file
```

`train.py` writes the deployed model to `src/game/ai/director_model.json` (bundled into the
game) and `public/models/`. If you change a weapon, zombie or player constant in the game,
update the mirrored constants in `simulator.py` and regenerate the data.

## Switch the deployed model (no retraining)

`train.py` ships whichever Keras model has the lowest validation regret, but every trained model is kept in `models/`.

```bash
npm run ml:switch -- --list          # compare them; shows which one the game uses
npm run ml:switch -- mlp_medium      # deploy a different one (mlp_small | mlp_medium | mlp_deep_bn | softmax_regression)
npm test                             # parity check: game inference vs the TFLite file
npm run deploy                       # publish to Cloudflare
```

## How labels are made

1. Sample a plausible player state: health, ammo, how long since damage/kills, zombies
   alive, where the stalker is, and so on. States come from four player archetypes
   (`newbie`, `cautious`, `aggressive`, `hoarder`). A fifth, `speedrunner`, is **held out**
   and used only to test generalisation.
2. For each action (spawn 0, 1, 3 or 5 zombies) simulate 16 randomised 40-second encounters
   with a scripted player (shoots the nearest zombie, melees when dry) and record damage
   taken, death, ammo spent. The same random draws are reused across actions.
3. Score each action with a utility that encodes design intent: aim for a target amount of
   health loss that rises when the player is bored and falls when they are fragile, punish
   death and running dry heavily, and never exceed the live-zombie cap.
4. The best-scoring action is the label.

About one label in five is a near-tie (the best and second-best action differ by under 0.1
utility), so perfect accuracy is not possible and not the goal. Reports therefore also give
**regret** (utility lost against the oracle) and the **simulated death rate** of each model's
policy, which matter more than raw accuracy.

## Models compared

| Model | Type | Converts to TFLite |
| --- | --- | --- |
| `softmax_regression` | linear baseline | yes |
| `mlp_small` | 16-32-16-4 | yes |
| `mlp_medium` | 16-64-64-32-4, dropout | yes |
| `mlp_deep_bn` | 128-128-64-32 with batch-norm and dropout | yes |
| `random_forest`, `hist_gradient_boosting` | scikit-learn, for comparison | no |
| `oracle`, `heuristic_rules`, `always_none`, `majority_class` | reference policies | – |

The Keras model with the lowest *validation regret* is the one exported to the game.

## Using the model on a phone

`export/director.tflite` takes a `[1, 16]` float32 tensor and returns `[1, 4]` probabilities
(none, light, medium, heavy). The input is `clip(raw / scale, 0, 1)` per feature. Scales and
feature order are in `export/director_model.json` under `features`.

```kotlin
// Android (Kotlin), org.tensorflow:tensorflow-lite or com.google.ai.edge.litert:litert
val interpreter = Interpreter(loadModelFile("director.tflite"))
val input = arrayOf(FloatArray(16))   // fill with clip(raw[i] / scale[i], 0f, 1f)
val output = arrayOf(FloatArray(4))
interpreter.run(input, output)
val tier = output[0].indices.maxBy { output[0][it] }   // spawn counts: 0, 1, 3, 5
```

```bash
python predict_tflite.py health=35 ammo_total=4 zombies_alive=3 nearest_zombie_m=6
```

Browsers can't run `.tflite` files directly, so the web game evaluates the *same weights*
from `director_model.json` with a plain dense-layer forward pass (`src/game/ai/DirectorModel.ts`).
`tests/combat.test.ts` loads 60 held-out states with the TFLite model's own outputs and fails
if the game's numbers drift from them by more than 2e-4.

The game itself currently has keyboard-and-mouse controls only; the TFLite file is the
phone-ready *model*, not a touch-screen port of the game.

## Reproducibility

Seeds are fixed (`SEED = 42` for training and splits; dataset seed 2025). TensorFlow ops on
CPU are deterministic enough that reruns land within a fraction of a percent. Library
versions and wall-clock times are in `reports/environment.json`.
