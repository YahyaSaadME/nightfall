"""
Encounter simulator used to label training data for the spawn director.

For every sampled player state and every candidate action (spawn 0 / 1 / 3 / 5 zombies)
we play K randomised 40-second encounters with a scripted "player bot" and record what
happened (damage taken, death, ammo spent, kills). A designer-intent utility function
then scores each action and the best-scoring action becomes the training label.

The constants mirror the game (see src/game/ai/ZombieTypes.ts, systems/WeaponSystem.ts,
player/PlayerController.ts). Training data is synthetic: it comes from this model of the
game, not from real players.
"""
from __future__ import annotations

import numpy as np

from features import CLASS_COUNTS, FEATURE_NAMES, IDX, N_FEATURES

# ---------------------------------------------------------------- game constants
DT = 0.5                      # s per simulation step
STEPS = 80                    # 40 s encounter
MAX_ALIVE = 8                 # director cap (ZombieSystem.MAX_ALIVE)
MAX_NEW = max(CLASS_COUNTS)
Z = MAX_ALIVE + MAX_NEW + 1   # existing + new + stalker slot
STALKER = Z - 1

# zombie archetypes: (health, speed multiplier, damage, probability)
ZTYPES = np.array([
    [60.0, 1.00, 22.0],   # walker
    [40.0, 1.30, 16.0],   # runner
    [140.0, 0.85, 30.0],  # brute
], dtype=np.float32)
ZTYPE_P = np.array([0.60, 0.25, 0.15])
ZOMBIE_SPEED = 2.6        # chase speed of a walker, m/s
ATTACK_RANGE = 1.5
ATTACK_PERIOD = 1.4
HIT_CHANCE = 0.75
INVULN = 1.4              # player invulnerability after a hit (PLAYER.invulnAfterHit)
STALKER_DMG = 34.0
STALKER_SPEED = 3.95
STALKER_MAX_HITS = 1

PISTOL_DMG = 35.0 * 1.25      # 25 % of hits are headshots for double damage
PISTOL_SHOTS_PER_S = 2.8
PISTOL_RANGE = 14.0
SHOTGUN_DMG = 6 * 14.0
SHOTGUN_SHOTS_PER_S = 0.9
SHOTGUN_RANGE = 7.0
BAT_DMG = 40.0
BAT_SWINGS_PER_S = 1.4
BAT_RANGE = 2.0

ARCHETYPES = ["newbie", "cautious", "aggressive", "hoarder", "speedrunner"]
# skill mean, skill sd, sprint mean, ammo beta (a, b), progress beta (a, b), kill rate
_ARCH = {
    "newbie":      dict(skill=(0.25, 0.12), sprint=0.20, ammo=(2.0, 3.0), prog=(1.3, 2.0), kills=1.0),
    "cautious":    dict(skill=(0.50, 0.15), sprint=0.05, ammo=(2.5, 2.0), prog=(1.5, 1.5), kills=1.5),
    "aggressive":  dict(skill=(0.68, 0.14), sprint=0.35, ammo=(2.0, 2.5), prog=(1.5, 1.5), kills=5.0),
    "hoarder":     dict(skill=(0.55, 0.15), sprint=0.10, ammo=(4.0, 1.5), prog=(1.5, 1.5), kills=0.8),
    "speedrunner": dict(skill=(0.60, 0.15), sprint=0.70, ammo=(1.5, 3.5), prog=(3.0, 1.5), kills=2.0),
}
TRAIN_ARCHETYPES = ["newbie", "cautious", "aggressive", "hoarder"]


def _beta(rng, ab, n):
    return rng.beta(ab[0], ab[1], n)


def sample_states(n: int, rng: np.random.Generator, archetypes: list[str]):
    """Sample plausible player states. Returns (raw (n, F), skill (n,), archetype index (n,))."""
    arch_idx = rng.integers(0, len(archetypes), n)
    raw = np.zeros((n, N_FEATURES), dtype=np.float32)
    skill = np.zeros(n, dtype=np.float32)
    for k, name in enumerate(archetypes):
        m = arch_idx == k
        c = int(m.sum())
        if c == 0:
            continue
        a = _ARCH[name]
        sk = np.clip(rng.normal(a["skill"][0], a["skill"][1], c), 0.02, 0.98)
        skill[m] = sk
        sprint = np.clip(rng.normal(a["sprint"], 0.12, c), 0, 1)
        prog = _beta(rng, a["prog"], c)
        ammo = _beta(rng, a["ammo"], c) * 60
        ammo[rng.random(c) < 0.08] = 0
        since_damage = np.where(rng.random(c) < 0.25, rng.uniform(60, 120, c), rng.exponential(28, c))
        kill_rate = rng.poisson(a["kills"] * (0.6 + 0.8 * rng.random(c)))
        since_kill = np.where(kill_rate > 0, rng.uniform(0, 60, c), rng.uniform(40, 150, c))
        alive = rng.choice(np.arange(9), size=c, p=[0.34, 0.20, 0.15, 0.11, 0.08, 0.06, 0.03, 0.02, 0.01])
        nearest = np.where(alive > 0, rng.uniform(2, 28, c), 30.0)
        loss = np.where(since_damage < 60, rng.exponential(35, c), 0.0)
        regen = np.maximum(0, since_damage - 9) * 2.5
        health = np.clip(100 - np.maximum(0, loss - regen), 3, 100)
        wp = np.where(ammo > 0, np.where((rng.random(c) < 0.45) & (prog > 0.3), 1.0, 0.5), 0.0)
        acc = np.clip(0.15 + 0.65 * sk + rng.normal(0, 0.08, c), 0.05, 0.95)
        acc = np.where((rng.random(c) < 0.25) & (kill_rate == 0), 0.5, acc)
        stalker_active = rng.random(c) < np.where(prog < 0.15, 0.15, 0.65)
        stalker = np.where(stalker_active, rng.uniform(3, 45, c), 30.0)
        r = raw[m]
        r[:, IDX["health"]] = health
        r[:, IDX["stamina"]] = np.clip(100 - 60 * sprint * rng.random(c), 5, 100)
        r[:, IDX["ammo_total"]] = ammo
        r[:, IDX["weapon_power"]] = wp
        r[:, IDX["battery"]] = rng.uniform(5, 100, c)
        r[:, IDX["zombies_alive"]] = alive
        r[:, IDX["nearest_zombie_m"]] = nearest
        r[:, IDX["since_damage_s"]] = since_damage
        r[:, IDX["since_kill_s"]] = since_kill
        r[:, IDX["kills_60s"]] = np.where(since_kill < 60, np.maximum(1, kill_rate), 0)
        r[:, IDX["accuracy_60s"]] = acc
        r[:, IDX["since_spawn_s"]] = rng.uniform(8, 130, c)
        r[:, IDX["progress"]] = prog
        r[:, IDX["sprint_frac_60s"]] = sprint
        r[:, IDX["light_level"]] = rng.beta(1.2, 3.0, c)
        r[:, IDX["stalker_dist_m"]] = stalker
        raw[m] = r
    return raw, skill, arch_idx


# ---------------------------------------------------------------- encounter simulation

def _simulate(raw: np.ndarray, skill: np.ndarray, count: int, K: int, seed: int) -> dict:
    """K rollouts per state for one action. Common random numbers: same seed => same draws."""
    rng = np.random.default_rng(seed)
    N = raw.shape[0]
    f = lambda name: raw[:, IDX[name]][:, None, None]  # noqa: E731

    alive_n = raw[:, IDX["zombies_alive"]].astype(np.int32)
    idx = np.arange(Z)[None, None, :]
    is_exist = idx < MAX_ALIVE
    is_new = (idx >= MAX_ALIVE) & (idx < MAX_ALIVE + MAX_NEW)
    exist_mask = is_exist & (idx < alive_n[:, None, None])
    new_mask = is_new & ((idx - MAX_ALIVE) < count)

    # --- draws (independent of `count`, so every action sees the same world)
    shape = (N, K, Z)
    ztype = rng.choice(3, size=shape, p=ZTYPE_P)
    hp = ZTYPES[ztype, 0].copy()
    spd = ZTYPES[ztype, 1] * ZOMBIE_SPEED * rng.normal(1.0, 0.08, shape).astype(np.float32)
    dmg = ZTYPES[ztype, 2].copy()
    # existing zombies fan out behind the nearest one
    near = f("nearest_zombie_m")
    gaps = rng.exponential(2.5, shape).astype(np.float32)
    exist_d = near + np.cumsum(np.where(is_exist, gaps, 0), axis=2) - gaps
    # new zombies spawn as a loose cluster 14-32 m away
    base = rng.uniform(14, 32, (N, K, 1)).astype(np.float32)
    new_d = base + rng.exponential(2.0, shape).astype(np.float32)
    d = np.where(is_exist, exist_d, np.where(is_new, new_d, 0)).astype(np.float32)
    # activation: new zombies wander until they notice the player
    sprint = f("sprint_frac_60s")
    light = f("light_level")
    mean_act = 10.0 * np.clip(1.3 - 0.7 * sprint - 0.3 * light, 0.25, 1.4)
    act = np.where(is_new, rng.exponential(1.0, shape) * mean_act, 0.0).astype(np.float32)
    # stalker slot
    st = raw[:, IDX["stalker_dist_m"]][:, None]
    st_on = (st < 30.0)
    d[:, :, STALKER] = np.broadcast_to(st, (N, K))
    hp[:, :, STALKER] = 1e9
    spd[:, :, STALKER] = STALKER_SPEED
    dmg[:, :, STALKER] = STALKER_DMG
    act[:, :, STALKER] = rng.exponential(15.0, (N, K)) + 4.0
    alive = exist_mask | new_mask
    alive[:, :, STALKER] = st_on
    d = np.where(alive, d, 1e6)

    health0 = raw[:, IDX["health"]][:, None].repeat(K, 1).astype(np.float32)
    health = health0.copy()
    ammo0 = raw[:, IDX["ammo_total"]]
    ammo = ammo0[:, None].repeat(K, 1).astype(np.float32)
    wp = raw[:, IDX["weapon_power"]][:, None]
    sk = skill[:, None]
    acc = (raw[:, IDX["accuracy_60s"]][:, None] * rng.normal(1.0, 0.1, (N, K))).clip(0.05, 0.97).astype(np.float32)
    kite = np.where(wp > 0, 1.4 * sk, 0.0).astype(np.float32)  # skilled shooters back-pedal
    melee_acc = (0.55 + 0.35 * sk).astype(np.float32)

    inv = np.zeros((N, K), dtype=np.float32)
    atk_cd = np.zeros(shape, dtype=np.float32)
    kills = np.zeros((N, K), dtype=np.float32)
    st_hits = np.zeros((N, K), dtype=np.int32)
    ammo_dry = np.zeros((N, K), dtype=bool)
    ranged_ok0 = (wp > 0) & (ammo > 0)

    t = 0.0
    ar = np.arange(Z)[None, None, :]
    for _ in range(STEPS):
        t += DT
        active = alive & (act <= t)
        # movement
        closing = np.maximum(0.0, spd - kite[:, :, None] * (ar != STALKER)) * DT
        d = np.where(active, np.maximum(0.8, d - closing), d)

        # player targets the nearest active zombie (not the stalker: bullets pass through it)
        targ_d = np.where(active & (ar != STALKER), d, 1e6)
        ti = targ_d.argmin(axis=2)
        td = np.take_along_axis(targ_d, ti[:, :, None], axis=2)[:, :, 0]
        have_target = td < 1e5

        can_range = (wp > 0) & (ammo > 0)
        use_shotgun = can_range & (wp >= 1.0) & (td < SHOTGUN_RANGE)
        use_pistol = can_range & ~use_shotgun & (td < PISTOL_RANGE)
        shots = np.where(use_shotgun, SHOTGUN_SHOTS_PER_S, np.where(use_pistol, PISTOL_SHOTS_PER_S, 0.0)) * DT
        shots = np.minimum(shots * (0.7 + 0.5 * rng.random((N, K))), ammo)
        n_shots = np.minimum(np.floor(shots + rng.random((N, K))), np.floor(np.maximum(ammo, 0)))
        eff_acc = np.where(use_shotgun, np.clip(acc + 0.25 - 0.03 * np.maximum(0, td - 2), 0.1, 0.98),
                           np.clip(acc - 0.015 * np.maximum(0, td - 5), 0.05, 0.97))
        hits = rng.binomial(n_shots.astype(np.int32), eff_acc.clip(0, 1))
        per_hit = np.where(use_shotgun, SHOTGUN_DMG, PISTOL_DMG)
        dmg_out = (hits * per_hit).astype(np.float32)
        ammo = ammo - n_shots
        ammo_dry |= ranged_ok0 & (ammo <= 0)

        melee = have_target & ~(use_shotgun | use_pistol) & (td < BAT_RANGE)
        swings = np.floor(BAT_SWINGS_PER_S * DT + rng.random((N, K)))
        mhits = rng.binomial(swings.astype(np.int32), np.broadcast_to(melee_acc.clip(0, 1), (N, K)))
        dmg_out = dmg_out + np.where(melee, mhits * BAT_DMG, 0.0)

        dmg_out = np.where(have_target, dmg_out, 0.0)
        tmask = ar == ti[:, :, None]
        hp = hp - tmask * dmg_out[:, :, None]
        died_z = alive & (hp <= 0) & (ar != STALKER)
        kills += died_z.sum(axis=2)
        alive = alive & ~died_z
        d = np.where(died_z, 1e6, d)

        # zombie attacks (player is invulnerable for INVULN s after a hit)
        contact = alive & (act <= t) & (d < ATTACK_RANGE)
        # The stalker cannot be killed, but the player hides / breaks line of sight: it lands
        # at most STALKER_MAX_HITS hits per encounter.
        contact[:, :, STALKER] &= st_hits < STALKER_MAX_HITS
        atk_cd = atk_cd - DT
        ready = contact & (atk_cd <= 0)
        want = ready.any(axis=2)
        worst = np.where(ready, dmg, 0.0).max(axis=2)
        landed = want & (inv <= 0) & (rng.random((N, K)) < HIT_CHANCE)
        st_hits = st_hits + (landed & ready[:, :, STALKER] & (worst >= STALKER_DMG))
        health = health - np.where(landed, worst, 0.0)
        inv = np.where(landed, INVULN, np.maximum(0.0, inv - DT))
        atk_cd = np.where(ready, ATTACK_PERIOD, atk_cd)
        # no regen mid-encounter (regen delay is 9 s and fights are short)
        if (health <= 0).all():
            break

    health = np.maximum(health, 0)
    live_threat = (alive & (act <= t) & (d < 8.0) & (ar != STALKER)).sum(axis=2)
    return dict(
        loss=((health0 - health) / 100.0).astype(np.float32),
        died=(health <= 0),
        dry=ammo_dry & (live_threat > 0),
        ammo_used=((ammo0[:, None] - ammo) / 60.0).astype(np.float32),
        kills=kills,
    )


def utility(raw: np.ndarray, count: int, out: dict) -> np.ndarray:
    """
    Designer intent: keep the player in a 'tense but winnable' band.
      * aim for an expected health loss `tau` that rises when the player is bored
        (no damage / kills / spawns for a while) and falls when they are fragile
        (low health or ammo);
      * dying is very bad, running dry of ammo with zombies still on you is bad;
      * never go above the live-zombie cap.
    Returns (N,) expected utility for this action.
    """
    g = lambda n: raw[:, IDX[n]]  # noqa: E731
    clip01 = lambda x: np.clip(x, 0, 1)  # noqa: E731
    boredom = 0.5 * clip01(g("since_damage_s") / 60) + 0.3 * clip01(g("since_kill_s") / 60) + 0.2 * clip01(g("since_spawn_s") / 90)
    fragility = 0.7 * (1 - g("health") / 100) + 0.3 * (1 - clip01(g("ammo_total") / 30))
    confidence = 0.10 * g("accuracy_60s") + 0.06 * g("weapon_power")
    tau = np.clip(0.12 + 0.30 * boredom - 0.14 * fragility + confidence, 0.0, 0.48)
    tau = np.minimum(tau, 0.5 * g("health") / 100.0)  # never aim to take more damage than the player can afford
    e_loss = out["loss"].mean(axis=1)
    p_die = out["died"].mean(axis=1)
    p_dry = out["dry"].mean(axis=1)
    over_cap = np.maximum(0, g("zombies_alive") + count - MAX_ALIVE)
    crowd = (count / MAX_NEW) * fragility * 2.0
    # Engagement: a bored, capable player should be given something to fight. Without this term a
    # strong player takes no damage whatever we spawn, every action ties, and argmax would pick 'none'.
    engagement = np.clip(out["kills"].mean(axis=1) / MAX_NEW, 0, 1)
    engage_reward = (0.4 + 2.0 * boredom) * (1 - fragility) * engagement
    return (-(((e_loss - tau) / 0.12) ** 2) - 25.0 * p_die - 2.0 * p_dry - crowd - 2.5 * over_cap + engage_reward).astype(np.float32)


def label_states(raw: np.ndarray, skill: np.ndarray, K: int, seed: int):
    """Returns (utilities (N, A), expected_loss (N, A), p_die (N, A))."""
    A = len(CLASS_COUNTS)
    U = np.zeros((raw.shape[0], A), dtype=np.float32)
    L = np.zeros_like(U)
    P = np.zeros_like(U)
    jitter = np.random.default_rng(seed + 1).uniform(0, 1e-3, U.shape).astype(np.float32)  # random tie-break
    for a, c in enumerate(CLASS_COUNTS):
        out = _simulate(raw, skill, c, K, seed)
        U[:, a] = utility(raw, c, out) + jitter[:, a]
        L[:, a] = out["loss"].mean(axis=1)
        P[:, a] = out["died"].mean(axis=1)
    return U, L, P


def heuristic_policy(raw: np.ndarray) -> np.ndarray:
    """A hand-written director (what you would write without ML). Used as a baseline."""
    g = lambda n: raw[:, IDX[n]]  # noqa: E731
    alive = g("zombies_alive")
    room = MAX_ALIVE - alive
    calm = (g("since_damage_s") > 25) & (g("health") > 60) & (g("ammo_total") > 8)
    act = np.zeros(raw.shape[0], dtype=np.int64)
    act[(alive < 3) & (g("since_spawn_s") > 20)] = 1
    act[calm & (alive < 2)] = 2
    act[calm & (alive == 0) & (g("progress") > 0.5)] = 3
    act[(g("health") < 35) | (g("ammo_total") < 4)] = 0
    # honour the cap
    cnt = np.array(CLASS_COUNTS)
    while True:
        bad = cnt[act] > room
        if not bad.any():
            break
        act[bad] -= 1
    return act
