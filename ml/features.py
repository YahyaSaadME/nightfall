"""
Feature contract shared by the simulator, the trainer and the game.

Every model input is `clip(raw / scale, 0, 1)`. The same table is written to
`src/game/ai/director_model.json` so the TypeScript side builds the vector from the
same definition instead of re-implementing it.
"""
from __future__ import annotations

import numpy as np

# name, scale (raw value that maps to 1.0), description
FEATURES: list[tuple[str, float, str]] = [
    ("health",          100.0, "Player health, 0-100"),
    ("stamina",         100.0, "Player stamina, 0-100"),
    ("ammo_total",       60.0, "Rounds available across all firearms (magazine + reserve)"),
    ("weapon_power",      1.0, "Best usable weapon: 0 bat, 0.5 pistol, 1 shotgun"),
    ("battery",         100.0, "Flashlight battery, 0-100"),
    ("zombies_alive",     8.0, "Zombies currently alive"),
    ("nearest_zombie_m", 30.0, "Distance to the nearest zombie in metres (30 = none / far)"),
    ("since_damage_s",   60.0, "Seconds since the player last took damage"),
    ("since_kill_s",     60.0, "Seconds since the player last killed a zombie"),
    ("kills_60s",        10.0, "Kills in the last 60 s"),
    ("accuracy_60s",      1.0, "Hit ratio of shots fired in the last 60 s (0.5 if none)"),
    ("since_spawn_s",    90.0, "Seconds since the director last spawned zombies"),
    ("progress",          1.0, "Objective progress, 0-1"),
    ("sprint_frac_60s",   1.0, "Fraction of the last 60 s spent sprinting"),
    ("light_level",       1.0, "Ambient light at the player, 0-1"),
    ("stalker_dist_m",   30.0, "Distance to the stalker in metres (30 = inactive / far)"),
]
FEATURE_NAMES = [f[0] for f in FEATURES]
FEATURE_SCALES = np.array([f[1] for f in FEATURES], dtype=np.float32)
N_FEATURES = len(FEATURES)

# Output classes: how many zombies the director spawns.
CLASS_NAMES = ["none", "light", "medium", "heavy"]
CLASS_COUNTS = [0, 1, 3, 5]
N_CLASSES = len(CLASS_NAMES)

IDX = {n: i for i, n in enumerate(FEATURE_NAMES)}


def to_model_input(raw: np.ndarray) -> np.ndarray:
    """raw (N, F) in natural units -> model input in [0, 1]."""
    return np.clip(raw / FEATURE_SCALES, 0.0, 1.0).astype(np.float32)
