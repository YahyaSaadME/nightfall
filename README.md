# NIGHTFALL — *The hospital remembers*

A compact first-person horror game that runs in a desktop browser. You wake up in the
reception of an abandoned hospital during a power failure. The main exit is locked, and
something is walking the halls. Restore power, get through the restricted wing, find the
exit key and survive until the shutter opens.

- Real 3D level (Three.js) with procedural PBR-style textures, a shadow-casting flashlight,
  flickering fluorescents, red emergency lighting, fog and dust in the beam.
- One stalker with a finite-state machine, grid A* navigation, line-of-sight perception,
  hearing, hiding-place checks and **adaptive behaviour** driven by your habits.
- **Zombies, weapons and an ML spawn director.** Walkers, runners and brutes spawn out of
  sight in waves chosen by a small neural network that watches how you are doing. Kill them
  with a fire-axe handle, a pistol or a shotgun (see below).
- Fully procedural Web Audio: ambience, spatial (HRTF) footsteps and breathing with wall
  occlusion, doors, alarm, a threat-driven drone and a heartbeat.
- A minimal, cinematic React + Tailwind interface.
- No backend, no accounts, no API keys, and **no external assets**: every texture, model
  and sound is generated at runtime.

Playthrough length: about 10–15 minutes.

---

## Setup and launch

Requirements: **Node.js 20+** (tested with Node 24) and a modern desktop browser with
WebGL 2 (Chrome, Edge or Firefox).

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build:

```bash
npm run build        # type-check + bundle to dist/
npm run preview      # serve dist/ locally
```

Click **New Game**, read the controls card, then click **Click to begin** so the game can
capture the mouse. Headphones are recommended.

## Controls

| Key | Action |
| --- | --- |
| **W A S D** | Move |
| **Mouse** | Look |
| **Shift** | Sprint (uses stamina; the stalker can hear it) |
| **Ctrl** or **C** | Crouch, toggled (quieter, harder to see) |
| **E** | Interact: doors, items, notes, fuse box, hide in or leave a locker |
| **F** | Flashlight (uses battery; the stalker can see it) |
| **Left click** | Shoot / swing the current weapon (gunfire is heard across the building) |
| **R** | Reload (an empty gun also reloads itself) |
| **1 2 3** or **mouse wheel** | Switch weapon: handle / pistol / shotgun |
| **Esc** | Pause and release the mouse |

The controls card is shown on first launch. You can open it again from the main menu or
the pause menu.

> **Ctrl+W:** crouch is a toggle, so you never need to hold Ctrl while walking. The page
> also asks for confirmation before the tab closes during play. In fullscreen, Chromium
> browsers lock the movement keys so browser shortcuts can't fire.

## Zombies and weapons

| Weapon | Damage | Magazine | Fire rate | Range | Noise radius |
| --- | --- | --- | --- | --- | --- |
| Fire-axe handle (1) | 40, melee, 55° arc, hits up to 2 | – | 0.7 s | 2 m | 4 m |
| Pistol (2) | 35 (×2 headshot) | 12 | 0.28 s | 45 m | 26 m |
| Shotgun (3) | 6 × 14 pellets, wide spread | 4 (loads one shell at a time) | 0.95 s | 22 m | 38 m |

You start with the handle and a pistol (12 + 12 rounds). The shotgun lies in the nurses'
station. Ammo boxes are on the floor around the hospital (walk over them) and zombies drop
some. Gunfire and swings are *noise*: the stalker and every zombie in range come to
investigate, so shooting is a trade.

| Zombie | Health | Chase speed | Damage |
| --- | --- | --- | --- |
| Walker | 60 | 2.6 m/s | 22 |
| Runner | 40 | 3.4 m/s | 16 |
| Brute | 140 | 2.2 m/s | 30 |

Zombies use the stalker's pathfinding and perception (sight cone, light level, hearing) with
slower, dumber tuning: they don't check lockers and give up sooner. They are hit by a
vertical cylinder per body, so headshots work. They flinch and are knocked back when hit.
The stalker itself can't be killed. A new zombie never appears within 14 m of you or in your
line of sight, and at most 8 are alive at once.

### The ML spawn director

Every 5 seconds (after a 20 s grace period, and at least 8 s after the previous wave) a
small neural network looks at 16 numbers (health, ammo, recent kills/damage, zombies alive,
distance to the nearest zombie and to the stalker, objective progress, ...) and picks how
many zombies to send: **none, 1, 3 or 5**. Hard rules still apply on top: never above the
cap, and at most one zombie if your health is under 25. If the model were missing, a
hand-written rule set (`fallbackProbs`) takes over, so zombies always spawn.

The model was trained on simulated encounters, not real players. Training, evaluation,
the TFLite export for phones and how to retrain are documented in [`ml/README.md`](ml/README.md);
the full evaluation is in [`ml/reports/REPORT.md`](ml/reports/REPORT.md).

## Objectives

1. Explore the reception area (the night log at the desk tells you where to go)
2. Find a fuse in the storage room
3. Restore emergency power (fuse box in maintenance, reached through storage)
4. Get the keycard from the nurses' station (its door only opens with power)
5. Reach the restricted corridor (keycard doors in the staff lockers or the reception)
6. Find the exit key (director's office)
7. Unlock the main exit (this sets off an alarm, which the stalker hears)
8. Survive while the shutter rises, then escape

Progress is checkpointed every time you complete an objective and saved to
`localStorage`, which is what **Continue** loads. Completing a later objective also
completes any earlier ones. Required items can't be lost or destroyed, and doors you have
unlocked stay unlocked, so the game can't soft-lock.

## Settings (all apply immediately and persist)

Mouse sensitivity, invert mouse Y, master volume, brightness (with a calibration swatch),
quality (Low / Medium / High: resolution scale, flashlight shadows and shadow-map size,
number of dynamic lights, dust particles) and fullscreen.

**Spawn AI** (Settings): choose which trained model decides zombie waves: deep, medium or small network, a linear model, or hand-written rules. It switches immediately, even mid-run, and is remembered. After retraining, run `npm run ml:switch -- --export-all` to refresh the bundled models.

---

## Architecture

```
src/
  main.tsx, App.tsx           React entry; creates the single Engine instance
  index.css                   Tailwind theme, film grain, vignette, animations
  game/
    Engine.ts                 Game loop, wires every system together, state API used by the UI
    state/
      GameStateManager.ts     Screen state machine (menu/playing/paused/dead/escaped) + HUD store
      Store.ts                Tiny observable store (useSyncExternalStore)
      Settings.ts             Persisted settings + quality profiles
      Checkpoint.ts           Checkpoint save/load (localStorage)
    level/
      LevelData.ts            The map grid, zones, items, lockers, patrol points, lights
      PropLayout.ts           Data-driven prop placement + collision footprints
      Grid.ts                 Grid, circle-vs-box collision, DDA line of sight
      DoorLogic.ts            Door state/animation (rendering-independent)
    render/
      GameWorld.ts            Builds the level: instanced walls, doors, props, items, signage,
                              decals, exterior; static batching (merged geometry by material)
      Textures.ts             Procedural canvas textures + bump maps
      Materials.ts            Shared material library
      Props.ts                Prop mesh builders (beds, lockers, gurneys, desks, ...)
      DoorView.ts             Swinging doors and the exit roller shutter
      Lighting.ts             Fluorescent flicker, emergency lights, light-level queries
      StalkerModel.ts         Procedural creature model + animation
      Dust.ts                 GPU dust that is only visible inside the flashlight cone
      ZombieModel.ts          Cheap shared-geometry zombie with walk / attack / death animation
      WeaponView.ts           First-person weapon models, recoil, reload and muzzle flash
    player/
      PlayerController.ts     Look, walk/sprint/crouch, stamina, health, gravity, collision, head bob
      FlashlightController.ts Shadow-casting spotlight, battery, low-battery flicker, bounce light
      Input.ts                Keyboard + pointer-lock mouse
    systems/
      WeaponSystem.ts         Bat / pistol / shotgun: ammo, reloads, hitscan and melee against zombies
      InteractionSystem.ts    Centre-screen raycast (blocked by walls) + aim-cone fallback
      InventorySystem.ts      Key items
      ObjectiveManager.ts     Linear objective chain with forward-completion
    ai/
      EnemyAI.ts              Stalker FSM, perception, hearing, movement, hiding-place checks (tunable per instance: zombies reuse it)
      ZombieSystem.ts         Zombie pool: spawning out of sight, health, ray/melee hit tests, knockback, corpses
      ZombieTypes.ts          Walker / runner / brute stats, spawn mix, caps
      SpawnDirector.ts        When and how many zombies to spawn: runs the model, applies the hard rules, keeps a log
      DirectorModel.ts        Dense-layer inference for the exported spawn-director network
      director_model.json     The deployed model (generated by ml/train.py)
      Navigation.ts           Grid A* with clearance-checked nav points + string pulling
      BehaviourProfile.ts     Adaptive habit model (deterministic, rate-limited)
    audio/
      AudioManager.ts         Procedural Web Audio engine
  ui/
    GameUI.tsx                Screen/overlay switch, fade, grain, vignette
    MainMenu.tsx, HUD.tsx, Overlays.tsx (pause, settings, controls, credits, exit),
    EndScreens.tsx (death, escape), components.tsx (buttons, sliders, toggles, keycaps)
ml/                           Spawn-director training pipeline (Python): simulator, dataset, training, TFLite export, reports
tests/
  logic.test.ts               Headless unit/integration tests (collision, nav, AI, adaptation, objectives)
  combat.test.ts              Zombies, weapons, spawn director, TFLite-vs-game parity, a scripted two-minute fight
  combat-e2e.mjs              Drives zombies, weapons and the director in the real game (headless Edge)
  e2e.mjs                     Drives the real game in a browser and saves screenshots
  shots.mjs, bench.mjs        Visual review views and a GPU frame-cost benchmark
```

The engine owns all gameplay state. React only reads two stores (UI and HUD; the HUD is
updated at 10 Hz) and calls a small set of engine methods (`newGame`, `continueGame`,
`pause`, `resume`, `restartCheckpoint`, `toMenu`, `requestPointer`).

### Game states

`loading → menu → playing ⇄ paused`, `playing → dead | escaped`, then
`dead | escaped → playing | menu`. Transitions outside that table are rejected. The
simulation advances only while the screen is `playing`, no overlay is open and the mouse
is captured, so pausing, alt-tabbing or losing pointer lock freezes the player, the enemy
and every timer. Pressing Esc (or the browser releasing the mouse) pauses the game.
Resuming captures the mouse again from the click. If the browser refuses (it enforces a
short cooldown after Esc), a "Click to continue" prompt appears.

### The stalker

**States:** `Patrol → Investigate → Search → Chase → Attack → Recover`.

- **Perception** (runs at 10 Hz). Sight needs a field-of-view cone (130°, or any direction
  within 2.2 m) *and* a grid line of sight. Walls and closed doors block sight; props don't.
  Sight range scales with your flashlight, crouching and the light level where you stand.
  A detection meter fills while you're visible, faster when you're close. Partial
  detection triggers an investigation; full detection starts a chase. A lit flashlight
  beam that falls on the stalker, or light leaking from a locker, also counts as evidence.
- **Hearing.** Footsteps (crouch 1.6 m, walk 5.5 m, sprint 13 m), doors, lockers, the
  generator and the exit alarm. Walls cut hearing range by 45%. Sounds only give an
  approximate position, jittered in proportion to distance.
- **Navigation.** A* over the level grid. Every cell has a nav point with clearance from
  props, and edges are validated against static geometry so props never split a corridor.
  Doors are entered straight on, and paths are string-pulled. The stalker opens closed
  doors (making noise) but can never pass locked doors or the exit. If it stops making
  progress it re-plans. It never teleports.
- **Hiding places.** It only checks a locker when it has a reason: it saw you get in, saw
  light leaking out, or you vanished near the locker moments ago. The adaptive locker-check
  chance also counts, with cooldowns and at most two checks per search. Finding you means
  it drags you out (45 damage).
- **Attack.** Only within 1.55 m and with line of sight, after a 0.55 s wind-up you can
  escape from. Then comes a 1.7 s recovery, and you get a 1.4 s invulnerability window
  after each hit.

### Adaptive behaviour (`BehaviourProfile.ts`)

It tracks hide rate, the fraction of movement spent sprinting, the fraction of time with
the flashlight on, and how often you return to the same cells. Every score is an
exponential moving average (time constant about 75 s) multiplied by an **adaptation
budget** that starts at 35% and grows to 100% over 5 minutes of play.

| Habit | What changes | Limit |
| --- | --- | --- |
| Frequent hiding | Higher locker-check chance during searches | capped at 55%, plus a 30 s cooldown |
| Frequent sprinting | Sprint noise is heard further; it uses door shortcuts more; patrols lean toward places where it *heard* you run | hearing +40% max |
| Heavy flashlight use | Reacts to your beam from further away and faster | sensitivity +60% max |
| Avoiding the flashlight | Searches favour dark areas | — |
| Repeated routes | Patrols are weighted toward cells where it has *evidence* of you (it saw or heard you there) | evidence decays over about 4 min |

It never uses information it couldn't have perceived: the route memory is fed only by
things the stalker actually sensed.

All tunables live in `ENEMY_TUNING` (`EnemyAI.ts`), `DEFAULT_ADAPTIVE`
(`BehaviourProfile.ts`), `PLAYER` (`PlayerController.ts`) and `FLASHLIGHT`
(`FlashlightController.ts`).

### Performance

- Walls are a single `InstancedMesh` per texture variant. All static props are merged by
  material at load time, cutting about 1,300 draw calls to about 260.
- One shadow-casting light (the flashlight) plus at most 8 point lights without shadows,
  all created up front so toggling them never recompiles shaders.
- No post-processing pass: grain and vignette are CSS overlays. Dust is a single
  `Points` draw.
- The stalker perceives at 10 Hz and re-plans paths on timers. Light-level queries are
  cached at 4 Hz.

Measured with `node tests/bench.mjs` (GPU-synchronised render loop) on an **integrated
Intel Iris Xe**:

| Resolution | High | Medium | Low |
| --- | --- | --- | --- |
| 1280×720 | 5.1 ms | 3.5 ms | 1.3 ms |
| 1920×1080 | 6.3 ms | 6.3 ms | 1.7 ms |

All are well inside the 16.7 ms budget for 60 fps. CPU-side game logic is a small
fraction of that.

---

## Testing

```bash
npm test             # 24 logic tests + 27 combat/ML tests (Node)
npm run test:combat-e2e  # 18 browser checks of zombies, weapons and the director
npm run test:e2e     # 51 end-to-end checks in headless Microsoft Edge (BROWSER=chrome for Chrome)
npm run typecheck
```

The end-to-end test starts the dev server, plays through the whole game using the real
UI and a debug hook (`window.__nightfall`, available in dev or with `?debug`), and saves
screenshots to `test-output/`.

### Tested feature checklist

| Feature | How it's verified | Result |
| --- | --- | --- |
| Game launches to the main menu | e2e | ✅ |
| Menu: Continue disabled without a save, Settings, Credits, Controls, Exit | e2e | ✅ |
| Settings change, persist and apply at runtime (incl. quality switch) | e2e | ✅ |
| New Game starts a playable session; controls shown on first launch | e2e | ✅ |
| Walking, sprinting (faster), stamina drain, crouch toggle | e2e | ✅ |
| Collision stops you walking through walls and closed doors | logic + e2e | ✅ |
| Flashlight toggles and drains the battery; batteries recharge it | e2e | ✅ |
| Interaction raycast (aiming at the night log) | e2e | ✅ |
| Doors open and close and can be walked through | logic + e2e | ✅ |
| Hiding in and leaving lockers | e2e | ✅ |
| Stalker patrols without teleporting (per-frame movement bound) | logic | ✅ |
| Stalker hears noises → investigates → searches → returns to patrol | logic + e2e | ✅ |
| Stalker detects a visible player, chases and attacks in range | logic + e2e | ✅ |
| Stalker cannot see or hear through walls and never gains detection without LOS | logic | ✅ |
| Stalker cannot path through locked doors | logic | ✅ |
| Hidden player is not detected unless seen hiding; seen hiding → locker checked, dragged out | logic | ✅ |
| Adaptive behaviour: hiding, sprinting, flashlight and route habits, all gradual and capped | logic | ✅ |
| Objective order, forward-completion, no regression | logic + e2e | ✅ |
| Progression gating: power → nurses' station, keycard → restricted wing, key → exit | logic + e2e | ✅ |
| Every battery and hiding place is reachable | logic | ✅ |
| Pause freezes the enemy; resume works | e2e | ✅ |
| Death screen → checkpoint restart (state restored, stalker respawns far away) | e2e | ✅ |
| Exit unlock → final encounter → escape sequence → completion screen with stats | e2e | ✅ |
| Still playable after repeated New Game / menu cycles; Continue resumes | e2e | ✅ |
| No page or console errors during the full run | e2e | ✅ |

## Known limitations

- **Headless runs can't test real pointer lock or audio output.** The e2e test simulates
  input through the debug hook. Pointer-lock edge cases (the browser's cooldown after Esc)
  are handled in code but were checked by reasoning, not automation. Audio code paths run
  during the e2e test, but nobody listened to the result.
- **The art is procedural, not authored.** The hospital and the stalker are built from
  primitives and canvas textures. They hold up in the dark, but they won't match
  photogrammetry or hand-made assets up close. The stalker has no skeletal mesh, so its
  animation is procedural.
- One floor level, so "gravity and floor detection" is a flat floor at y = 0 (no stairs or
  ramps).
- The sound design is synthesised. It's effective, but less rich than recorded foley.
- The browser can't close its own tab, so **Exit** explains that and offers to try.
- Safari is untested. Chromium browsers and Firefox are the targets.
