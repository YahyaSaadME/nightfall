import * as THREE from 'three';
import { isTouchDevice } from './state/Device';
import { loadDirector } from './ai/DirectorRegistry';
import { AudioManager } from './audio/AudioManager';
import { BehaviourProfile } from './ai/BehaviourProfile';
import { EnemyAI, ENEMY_TUNING, type AIEnv, type HideSpotInfo, type PlayerView } from './ai/EnemyAI';
import { Navigation } from './ai/Navigation';
import { SpawnDirector, DirectorTelemetry, type DirectorDecision } from './ai/SpawnDirector';
import { ZombieSystem, type ZombieEvents } from './ai/ZombieSystem';
import { ZOMBIE_POOL } from './ai/ZombieTypes';
import { toCell } from './level/Grid';
import {
  BATTERY_SPAWNS, ENEMY_SPAWN, EXIT_TRIGGER_Z, HIDE_SPOTS, ITEM_SPAWNS, MENU_CAMERA, MENU_STALKER, PATROL_POINTS,
  PICKUP_SPAWNS, PLAYER_START, zoneAt, type ItemId, type PickupDef, type PickupKind,
} from './level/LevelData';
import { FlashlightController, FLASHLIGHT } from './player/FlashlightController';
import { Input } from './player/Input';
import { PlayerController } from './player/PlayerController';
import { Dust } from './render/Dust';
import { buildWorld, type WorldBuild } from './render/GameWorld';
import { createMaterials, type MaterialLibrary } from './render/Materials';
import { StalkerModel } from './render/StalkerModel';
import { WeaponView } from './render/WeaponView';
import { ZombieModel } from './render/ZombieModel';
import { clearCheckpoint, loadCheckpoint, saveCheckpoint, type Checkpoint } from './state/Checkpoint';
import { hud, setScreen, ui } from './state/GameStateManager';
import { qualityProfile, settingsStore, type QualityProfile, type Settings } from './state/Settings';
import { InteractionSystem, type Prompt } from './systems/InteractionSystem';
import { InventorySystem, ITEM_LABELS } from './systems/InventorySystem';
import { OBJECTIVES, ObjectiveManager } from './systems/ObjectiveManager';
import { AMMO_PICKUP, WEAPONS, WeaponSystem, type AttackResult, type WeaponId } from './systems/WeaponSystem';

const NOISE = { walk: 5.5, sprint: 13, crouch: 1.6, doorOpen: 8, doorClose: 11, locker: 6, generator: 28 };

interface Sequence { kind: 'death' | 'escape'; t: number }

const PATIENT_LOG = {
  title: 'Night log — Ward desk',
  body: '03:12  Mains failure. Backup fuse is in STORAGE, off the east corridor. Fuse box is in MAINTENANCE, through storage. Keycard is kept at the NURSES’ STATION. Exit key: DIRECTOR’s office, restricted wing. Do not let it out of Ward C.',
};

/**
 * Owns the renderer, scene and every gameplay system, and runs the main loop.
 * React only talks to it through the public methods and the UI/HUD stores.
 */
export class Engine {
  readonly audio = new AudioManager();
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(72, 1, 0.05, 90);
  private hemi = new THREE.HemisphereLight(0x8d9ba6, 0x1c1814, 0.06);
  private materials!: MaterialLibrary;
  private world!: WorldBuild;
  readonly input = new Input();
  private player = new PlayerController();
  private flashlight!: FlashlightController;
  private interaction!: InteractionSystem;
  private inventory = new InventorySystem();
  private objectives = new ObjectiveManager();
  private profile!: BehaviourProfile;
  private nav!: Navigation;
  private aiEnv!: AIEnv;
  private enemy!: EnemyAI;
  private stalker!: StalkerModel;
  private menuStalker!: StalkerModel;
  private dust!: Dust;
  private quality: QualityProfile = qualityProfile('high');
  private settings: Settings = settingsStore.get();
  private hideSpots: HideSpotInfo[] = [];

  // Weapons, zombies and the ML spawn director
  private weapons = new WeaponSystem();
  private weaponView!: WeaponView;
  private zombies!: ZombieSystem;
  private zombieModels: ZombieModel[] = [];
  private zombieSerial: number[] = [];
  private director = new SpawnDirector();
  private telemetry = new DirectorTelemetry();
  private pickups: { def: PickupDef; mesh: THREE.Object3D; drop: boolean; ttl: number }[] = [];
  private zombiesEnabled = true;
  private zombieNoticeShown = false;
  private dirClock = 0;
  private kills = 0;
  private fireBuffer = 0;
  private lastMag = 0;
  private lastReloading = false;
  private dropCounter = 0;
  private pickupT = 0;

  private raf = 0;
  private last = 0;
  private time = 0;
  private running = false;
  private power = false;
  private exitUnlocked = false;
  private picked = new Set<string>();
  private runTime = 0;
  private deaths = 0;
  private batteriesTaken = 0;
  private sequence: Sequence | null = null;
  private ambientTimer = 25;
  private hudTimer = 0;
  private lightTimer = 0;
  private playerLight = 0;
  private threat = 0;
  private stingerCooldown = 0;
  private checkpoint: Checkpoint | null = null;
  private hideT = 0;
  private hideFrom = new THREE.Vector3();
  private lockerAnims = new Map<string, { t: number; dur: number }>();
  private noticeTimer = 0;
  private menuT = 0;
  private frameTime = 1 / 60;
  private escapeFrom = new THREE.Vector3();
  /** Debug/testing: simulate without pointer lock. */
  noPointerLock = false;

  constructor(private readonly container: HTMLElement) {
    // Phones have no pointer lock or keyboard: the on-screen touch controls feed `input` instead.
    if (isTouchDevice) this.noPointerLock = true;
  }

  // ================================================================== setup

  async init(onProgress: (p: number) => void) {
    const step = async (p: number) => { onProgress(p); await new Promise((r) => setTimeout(r, 0)); };
    this.settings = settingsStore.get();
    this.quality = qualityProfile(this.settings.quality);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'block h-full w-full';
    this.container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x020203);
    this.scene.fog = new THREE.FogExp2(0x040405, 0.052);
    this.scene.add(this.hemi);
    await step(0.1);

    const anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
    const texOpts = { anisotropy, size: 1 };
    this.materials = createMaterials(texOpts);
    await step(0.45);
    this.world = buildWorld(this.materials, texOpts, 8);
    this.scene.add(this.world.root);
    await step(0.7);

    this.flashlight = new FlashlightController(this.scene);
    this.dust = new Dust(420);
    this.scene.add(this.dust.points);
    this.nav = new Navigation(this.world.collision);
    this.hideSpots = HIDE_SPOTS.map((h) => ({ id: h.id, x: h.x, z: h.z, frontX: h.x - Math.sin(h.yaw) * 0.9, frontZ: h.z - Math.cos(h.yaw) * 0.9 }));
    this.profile = new BehaviourProfile(this.world.grid.w * this.world.grid.h);
    this.aiEnv = {
      collision: this.world.collision,
      nav: this.nav,
      profile: this.profile,
      rand: Math.random,
      hideSpots: this.hideSpots,
      patrolPoints: PATROL_POINTS,
      doorAt: (cx, cz) => this.world.doorAt(cx, cz),
      lightLevel: (x, z) => this.world.lighting.lightLevelAt(x, z),
      events: {
        spotted: () => this.onSpotted(),
        attackWindup: () => this.audio.shriek(this.enemy.x, this.enemy.z),
        attackHit: (dmg) => this.onPlayerHit(dmg),
        doorOpened: (d) => this.audio.door(d.cx * 2 + 1, d.cz * 2 + 1, true, !this.losToPlayer(d.cx * 2 + 1, d.cz * 2 + 1)),
        lockerCheck: (id, found) => this.onLockerChecked(id, found),
        footstep: (x, z, running) => this.audio.enemyStep(x, z, running, !this.losToPlayer(x, z)),
      },
    };
    this.enemy = new EnemyAI(this.aiEnv);
    this.stalker = new StalkerModel(this.materials);
    this.stalker.root.visible = false;
    this.scene.add(this.stalker.root);
    this.menuStalker = new StalkerModel(this.materials);
    this.menuStalker.root.position.set(MENU_STALKER.x, 0, MENU_STALKER.z);
    this.menuStalker.root.rotation.y = 0;
    this.scene.add(this.menuStalker.root);

    // Zombies reuse the stalker's navigation and perception with their own tuning and health.
    this.zombies = new ZombieSystem({
      collision: this.world.collision,
      nav: this.nav,
      profile: new BehaviourProfile(this.world.grid.w * this.world.grid.h),
      rand: Math.random,
      hideSpots: [],
      patrolPoints: PATROL_POINTS,
      doorAt: this.aiEnv.doorAt,
      lightLevel: this.aiEnv.lightLevel,
    }, this.zombieEvents(), Math.random);
    for (let i = 0; i < ZOMBIE_POOL; i++) {
      const zm = new ZombieModel(this.materials);
      zm.root.visible = false;
      this.scene.add(zm.root);
      this.zombieModels.push(zm);
      this.zombieSerial.push(-1);
    }
    // The weapon is a child of the camera; its muzzle light exists from the start so no shader recompiles on the first shot.
    this.weaponView = new WeaponView(this.materials);
    this.weaponView.root.visible = false;
    this.camera.add(this.weaponView.root);
    this.scene.add(this.camera);
    this.buildPickups();
    await step(0.85);

    this.interaction = new InteractionSystem(this.world.occluders);
    this.registerInteractables();
    this.player.onStep = (e) => {
      this.audio.footstep(e.sprinting ? 1.3 : 1, e.crouched);
      const r = e.crouched ? NOISE.crouch : e.sprinting ? NOISE.sprint : NOISE.walk;
      this.noise(this.player.pos.x, this.player.pos.z, r, e.sprinting ? 'sprint' : 'step');
    };
    this.world.lighting.onFlicker = () => { /* buzz handled continuously */ };

    this.input.attach();
    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('pointerdown', this.unlockAudio, { capture: true });
    window.addEventListener('keydown', this.unlockAudio, { capture: true });
    this.renderer.domElement.addEventListener('click', this.onCanvasClick);
    settingsStore.subscribe(() => this.applySettings(settingsStore.get()));

    this.applySettings(this.settings);
    this.resetWorld();
    this.world.lighting.setPowered(true); // the menu shot uses the lit corridor
    this.onResize();
    // Compile shaders up front so the first frames do not hitch.
    this.setMenuCamera(0);
    this.renderer.compile(this.scene, this.camera);
    await step(1);

    ui.set({ hasSave: !!loadCheckpoint() });
    setScreen('menu');
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('pointerdown', this.unlockAudio, { capture: true });
    window.removeEventListener('keydown', this.unlockAudio, { capture: true });
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }

  // ================================================================== interactables

  private registerInteractables() {
    const w = this.world;
    for (const d of w.doors) {
      const center = new THREE.Vector3(d.cx * 2 + 1, 1.2, d.cz * 2 + 1);
      this.interaction.register({
        id: d.id,
        targets: d.interactMeshes,
        position: center,
        range: 2.6,
        prompt: (): Prompt | null => {
          if (d.kind === 'exit') {
            if (this.exitUnlocked) return d.openAmount < 0.92 ? { text: 'The shutter is rising…', locked: true } : null;
            if (!this.inventory.has('exitKey')) return { text: 'Main exit — locked. Needs the exit key', locked: true };
            return { text: 'Unlock the main exit', key: 'E' };
          }
          if (d.locked) {
            if (d.kind === 'power') return { text: 'Door control offline — no power', locked: true };
            if (d.kind === 'keycard') return this.inventory.has('keycard') ? { text: 'Swipe keycard', key: 'E' } : { text: 'Keycard required', locked: true };
          }
          return { text: d.isOpen ? 'Close door' : 'Open door', key: 'E' };
        },
        interact: () => {
          if (d.kind === 'exit') {
            if (!this.exitUnlocked && this.inventory.has('exitKey')) this.unlockExit();
            else if (!this.exitUnlocked) this.audio.doorLocked(center.x, center.z);
            return;
          }
          if (d.locked) {
            if (d.kind === 'keycard' && this.inventory.has('keycard')) {
              d.setLocked(false);
              this.audio.beep(true);
              this.openDoor(d);
            } else {
              this.audio.beep(false);
              this.audio.doorLocked(center.x, center.z);
            }
            return;
          }
          if (d.isOpen) {
            d.requestClose();
            this.audio.door(center.x, center.z, false);
            this.noise(center.x, center.z, NOISE.doorClose, 'door');
          } else this.openDoor(d);
        },
      });
    }

    const keyItems: ItemId[] = ['fuse', 'keycard', 'exitKey'];
    for (const id of keyItems) {
      const obj = w.items.get(id)!;
      const s = ITEM_SPAWNS[id];
      this.interaction.register({
        id: `item-${id}`,
        targets: [obj],
        position: new THREE.Vector3(s.x, s.y, s.z),
        prompt: () => (this.picked.has(id) ? null : { text: `Take ${ITEM_LABELS[id].toLowerCase()}`, key: 'E' }),
        interact: () => this.pickKeyItem(id),
      });
    }

    for (const b of BATTERY_SPAWNS) {
      const obj = w.items.get(b.id)!;
      this.interaction.register({
        id: `item-${b.id}`,
        targets: [obj],
        position: new THREE.Vector3(b.x, b.y, b.z),
        prompt: () => {
          if (this.picked.has(b.id)) return null;
          return this.flashlight.battery >= 95 ? { text: 'Battery — flashlight is full', locked: true } : { text: 'Take battery', key: 'E' };
        },
        interact: () => {
          if (this.picked.has(b.id) || this.flashlight.battery >= 95) return;
          this.picked.add(b.id);
          obj.visible = false;
          this.flashlight.recharge(FLASHLIGHT.batteryPickup);
          this.batteriesTaken++;
          this.audio.pickup('battery');
          this.notice('Battery', 'Flashlight recharged.', 2.5);
        },
      });
    }

    this.interaction.register({
      id: 'patient-log',
      targets: [w.patientLog],
      position: w.patientLog.position.clone(),
      prompt: () => ({ text: 'Read the night log', key: 'E' }),
      interact: () => {
        this.notice(PATIENT_LOG.title, PATIENT_LOG.body, 14);
        this.audio.pickup('key');
        this.objectives.complete('explore');
      },
    });

    this.interaction.register({
      id: 'fuse-box',
      targets: [w.fuseBox],
      position: new THREE.Vector3(2.2, 1.35, 19),
      prompt: () => {
        if (this.power) return null;
        return this.inventory.has('fuse') ? { text: 'Insert fuse', key: 'E' } : { text: 'Fuse box — a fuse is missing', locked: true };
      },
      interact: () => {
        if (!this.power && this.inventory.has('fuse')) this.restorePower();
      },
    });

    for (const spot of this.hideSpots) {
      const locker = w.lockers.get(spot.id)!;
      this.interaction.register({
        id: `hide-${spot.id}`,
        targets: [locker.group],
        position: new THREE.Vector3(spot.x, 1, spot.z),
        prompt: () => {
          if (this.player.hiddenSpot) return this.player.hiddenSpot === spot.id ? { text: 'Leave locker', key: 'E' } : null;
          return { text: 'Hide in locker', key: 'E' };
        },
        interact: () => (this.player.hiddenSpot ? this.leaveLocker(false) : this.enterLocker(spot)),
      });
    }

    this.objectives.onComplete((done, next) => {
      this.audio.objective();
      hud.set({ objectiveDoneAt: performance.now(), objectiveDoneTitle: done.title });
      if (done.id === 'findFuse' && !this.enemy.active) this.awakenStalker();
      if (next) this.saveCheckpointNow();
    });
  }

  private openDoor(d: { cx: number; cz: number; requestOpen(x: number, z: number): void }) {
    d.requestOpen(this.player.pos.x, this.player.pos.z);
    const x = d.cx * 2 + 1, z = d.cz * 2 + 1;
    this.audio.door(x, z, true);
    this.noise(x, z, NOISE.doorOpen, 'door');
  }

  private pickKeyItem(id: ItemId) {
    if (this.picked.has(id)) return;
    this.picked.add(id);
    this.world.items.get(id)!.visible = false;
    this.inventory.add(id);
    this.audio.pickup('key');
    if (id === 'fuse') {
      this.objectives.complete('findFuse');
      this.notice('Ceramic fuse', 'The fuse box is in maintenance — through the storage room.', 5);
    } else if (id === 'keycard') {
      this.objectives.complete('keycard');
      this.notice('Staff keycard', 'Opens the restricted doors (staff lockers, reception).', 5);
    } else {
      this.objectives.complete('exitKey');
      this.notice('Exit key', 'The main exit is in the reception.', 5);
    }
  }

  private restorePower() {
    this.inventory.remove('fuse');
    this.power = true;
    this.world.fuseInserted.visible = true;
    this.world.fuseLed.emissive.setHex(0x20ff50);
    this.world.lighting.setPowered(true);
    for (const d of this.world.doors) if (d.kind === 'power') d.setLocked(false);
    this.audio.powerOn(2.5, 19);
    this.noise(2.5, 19, NOISE.generator, 'impact');
    this.objectives.complete('restorePower');
    this.notice('Emergency power restored', 'Somewhere down the corridor, a door control clicks on.', 5);
  }

  private unlockExit() {
    this.exitUnlocked = true;
    this.inventory.remove('exitKey');
    const d = this.world.exitDoor;
    d.locked = false;
    d.targetOpen = true;
    const x = d.cx * 2 + 1, z = d.cz * 2 + 1;
    this.audio.startAlarm(x, z - 1);
    if (!this.enemy.active) this.awakenStalker();
    this.objectives.complete('unlockExit');
    this.noise(x, z - 2, 400, 'alarm');
    this.notice('The shutter is opening', 'The alarm is loud. It heard that. Survive until the way is clear.', 6);
  }

  private awakenStalker() {
    this.enemy.reset(ENEMY_SPAWN.x, ENEMY_SPAWN.z, true);
    this.stalker.root.visible = true;
    // Announce it without giving away the exact position: a crash from that wing.
    this.audio.impact(ENEMY_SPAWN.x, ENEMY_SPAWN.z, true);
    window.setTimeout(() => this.audio.distantSteps(ENEMY_SPAWN.x, ENEMY_SPAWN.z + 2), 1800);
  }

  // ================================================================== hiding

  private enterLocker(spot: HideSpotInfo) {
    const p = this.player;
    p.hiddenSpot = spot.id;
    this.hideFrom.copy(p.pos);
    this.hideT = 0;
    const def = HIDE_SPOTS.find((h) => h.id === spot.id)!;
    p.yaw = def.yaw;
    p.pitch = 0;
    p.crouched = false;
    p.pos.set(spot.x, 0, spot.z);
    this.animateLocker(spot.id);
    this.audio.locker(spot.x, spot.z);
    this.audio.setHidden(true);
    this.profile.onHide();
    this.noise(spot.x, spot.z, NOISE.locker, 'door');
  }

  private leaveLocker(forced: boolean) {
    const p = this.player;
    const id = p.hiddenSpot;
    if (!id) return;
    const spot = this.hideSpots.find((h) => h.id === id)!;
    const def = HIDE_SPOTS.find((h) => h.id === id)!;
    const fx = -Math.sin(def.yaw), fz = -Math.cos(def.yaw);
    let placed = false;
    for (const d of [0.75, 0.95, 1.2]) {
      const x = spot.x + fx * d, z = spot.z + fz * d;
      if (this.world.collision.pointFree(x, z, 0.3)) { p.pos.set(x, 0, z); placed = true; break; }
    }
    if (!placed) p.pos.set(spot.frontX, 0, spot.frontZ);
    this.world.collision.resolveCircle(p.pos, 0.3);
    p.hiddenSpot = null;
    this.setLockerVisible(id, true);
    this.animateLocker(id);
    this.audio.locker(spot.x, spot.z, forced);
    this.audio.setHidden(false);
    if (forced) {
      // Face the thing that dragged you out.
      p.yaw = Math.atan2(-(this.enemy.x - p.pos.x), -(this.enemy.z - p.pos.z));
    }
  }

  private setLockerVisible(id: string, visible: boolean) {
    const l = this.world.lockers.get(id);
    if (l) l.door.visible = visible;
  }

  private animateLocker(id: string, dur = 0.7) {
    this.lockerAnims.set(id, { t: 0, dur });
  }

  private onLockerChecked(id: string, found: boolean) {
    const s = this.hideSpots.find((h) => h.id === id)!;
    this.animateLocker(id, found ? 0.5 : 1.2);
    this.audio.locker(s.x, s.z, found);
    if (found && this.player.hiddenSpot === id) this.leaveLocker(true);
  }

  // ================================================================== damage / AI events

  private onPlayerHit(dmg: number) {
    if (this.sequence) return;
    if (this.player.hiddenSpot) this.leaveLocker(true);
    if (!this.player.damage(dmg)) return;
    this.audio.hurt();
    hud.set({ damageAt: performance.now() });
    if (!this.player.alive) this.beginSequence('death');
  }

  private onSpotted() {
    if (this.stingerCooldown <= 0) {
      this.audio.stinger();
      this.stingerCooldown = 10;
    }
  }

  private losToPlayer(x: number, z: number) {
    return this.world.collision.lineOfSight(x, z, this.player.pos.x, this.player.pos.z);
  }

  // ================================================================== state API (used by UI)

  newGame() {
    this.unlockAudio();
    clearCheckpoint();
    this.resetWorld();
    this.deaths = 0;
    this.runTime = 0;
    this.batteriesTaken = 0;
    this.profile = new BehaviourProfile(this.world.grid.w * this.world.grid.h);
    this.aiEnv.profile = this.profile;
    this.player.reset(PLAYER_START.x, PLAYER_START.z, PLAYER_START.yaw);
    this.flashlight.battery = FLASHLIGHT.startBattery;
    this.flashlight.on = false;
    this.saveCheckpointNow();
    this.enterPlay();
    this.notice('Power failure', isTouchDevice ? 'You wake beside a gurney in the dark reception. Tap the light button for your flashlight.' : 'You wake beside a gurney in the dark reception. Press F for your flashlight.', 7);
    if (ui.get().firstLaunch) ui.set({ overlay: 'controls' });
    else this.requestPointer();
  }

  continueGame() {
    const c = loadCheckpoint();
    if (!c) return this.newGame();
    this.unlockAudio();
    this.applyCheckpoint(c);
    this.enterPlay();
    this.requestPointer();
  }

  restartCheckpoint() {
    const c = this.checkpoint ?? loadCheckpoint();
    if (!c) return this.newGame();
    this.applyCheckpoint(c);
    this.enterPlay();
    this.requestPointer();
  }

  pause() {
    if (ui.get().screen !== 'playing' || this.sequence) return;
    setScreen('paused');
    this.input.reset();
    this.audio.setDucked(true);
    if (document.pointerLockElement) document.exitPointerLock();
    hud.set({ prompt: null });
  }

  resume() {
    if (ui.get().screen !== 'paused') return;
    setScreen('playing');
    this.audio.setDucked(false);
    this.requestPointer();
  }

  toMenu() {
    if (this.player.alive && !this.sequence && (ui.get().screen === 'paused' || ui.get().screen === 'playing')) this.saveCheckpointNow();
    this.sequence = null;
    this.audio.stopAlarm();
    this.audio.setThreat(0);
    this.audio.setHidden(false);
    this.audio.setDucked(false);
    this.audio.updateEnemyVoice(0, 0, false, 0, true);
    if (document.pointerLockElement) document.exitPointerLock();
    this.input.enabled = false;
    ui.set({ fade: 0, needsPointer: false, hasSave: !!loadCheckpoint() });
    setScreen('menu');
    this.resetWorld();
    this.world.lighting.setPowered(true); // the menu shot uses the lit corridor
  }

  /** Called from a user gesture (button click / canvas click). */
  requestPointer() {
    if (this.noPointerLock) { ui.set({ needsPointer: false, pointerError: null }); return; }
    const el = this.renderer.domElement;
    try {
      const r = el.requestPointerLock({ unadjustedMovement: true }) as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') {
        r.catch(() => {
          // Some platforms reject unadjustedMovement; retry plain.
          const r2 = el.requestPointerLock() as unknown as Promise<void> | undefined;
          if (r2 && typeof r2.catch === 'function') r2.catch(() => ui.set({ needsPointer: true, pointerError: 'Click to continue — the browser needs a moment before capturing the mouse again.' }));
        });
      }
    } catch {
      ui.set({ needsPointer: true });
    }
  }

  dismissControls() {
    ui.set({ overlay: 'none' });
    this.requestPointer();
  }

  private enterPlay() {
    this.sequence = null;
    this.input.reset();
    this.input.enabled = true;
    this.menuStalker.root.visible = false;
    ui.set({ fade: 0, needsPointer: !document.pointerLockElement && !this.noPointerLock, pointerError: null });
    setScreen('playing');
    this.audio.setDucked(false);
    this.hudTimer = 0;
    this.pushHud();
  }

  // ================================================================== world state & checkpoints

  private resetWorld() {
    this.power = false;
    this.exitUnlocked = false;
    this.picked.clear();
    this.inventory.restore([]);
    this.objectives.restore(0);
    for (const d of this.world.doors) { d.setLocked(d.kind !== 'normal'); d.snap(false); d.update(0); }
    this.world.lighting.setPowered(false);
    this.world.fuseInserted.visible = false;
    this.world.fuseLed.emissive.setHex(0xff1a0a);
    for (const [, obj] of this.world.items) obj.visible = true;
    for (const id of this.world.lockers.keys()) this.setLockerVisible(id, true);
    this.world.outsideLight.intensity = 0;
    this.enemy.reset(ENEMY_SPAWN.x, ENEMY_SPAWN.z, false);
    this.stalker.root.visible = false;
    this.menuStalker.root.visible = true;
    this.player.reset(PLAYER_START.x, PLAYER_START.z, PLAYER_START.yaw);
    this.flashlight.on = false;
    this.audio.stopAlarm();
    this.audio.setPowerHum(false);
    this.threat = 0;
    this.lockerAnims.clear();
    this.resetCombat();
  }

  private snapshot(): Checkpoint {
    const p = this.player;
    return {
      version: 1,
      player: { x: p.pos.x, z: p.pos.z, yaw: p.yaw, health: p.health, battery: this.flashlight.battery },
      inventory: this.inventory.list(),
      objective: this.objectives.index,
      power: this.power,
      exitUnlocked: this.exitUnlocked,
      doors: this.world.doors.map((d) => ({ id: d.id, locked: d.locked, open: d.targetOpen })),
      picked: [...this.picked],
      profile: this.profile.snapshot(),
      stats: this.stats(),
      weapons: this.weapons.snapshot(),
    };
  }

  private saveCheckpointNow() {
    // Never checkpoint while hidden: restore the position in front of the locker instead.
    const c = this.snapshot();
    if (this.player.hiddenSpot) {
      const s = this.hideSpots.find((h) => h.id === this.player.hiddenSpot)!;
      c.player.x = s.frontX;
      c.player.z = s.frontZ;
    }
    this.checkpoint = c;
    saveCheckpoint(c);
    ui.set({ hasSave: true });
  }

  private applyCheckpoint(c: Checkpoint) {
    this.resetWorld();
    this.checkpoint = c;
    this.inventory.restore(c.inventory);
    this.objectives.restore(c.objective);
    c.picked.forEach((id) => this.picked.add(id));
    for (const [id, obj] of this.world.items) obj.visible = !this.picked.has(id);
    for (const pk of this.pickups) pk.mesh.visible = pk.drop ? false : !this.picked.has(pk.def.id);
    if (c.weapons) this.weapons.restore(c.weapons);
    this.power = c.power;
    this.world.lighting.setPowered(c.power);
    this.audio.setPowerHum(c.power);
    this.world.fuseInserted.visible = c.power;
    this.world.fuseLed.emissive.setHex(c.power ? 0x20ff50 : 0xff1a0a);
    for (const s of c.doors) {
      const d = this.world.doors.find((x) => x.id === s.id);
      if (!d || d.kind === 'exit') continue;
      d.setLocked(s.locked);
      d.snap(s.open);
      d.update(0);
    }
    if (c.exitUnlocked) {
      // Restart the final encounter from the beginning of the shutter opening.
      this.exitUnlocked = true;
      const d = this.world.exitDoor;
      d.locked = false;
      d.snap(false);
      d.targetOpen = true;
      this.audio.startAlarm(d.cx * 2 + 1, d.cz * 2);
    }
    this.profile = new BehaviourProfile(this.world.grid.w * this.world.grid.h);
    this.profile.restore(c.profile);
    this.aiEnv.profile = this.profile;
    this.player.reset(c.player.x, c.player.z, c.player.yaw);
    this.player.health = Math.max(c.player.health, 60);
    this.flashlight.battery = Math.max(c.player.battery, 35);
    this.flashlight.on = false;
    this.runTime = c.stats.time;
    this.deaths = c.stats.deaths;
    this.batteriesTaken = c.stats.batteries;
    this.kills = c.stats.kills ?? 0;
    // The stalker is active once the fuse has been taken; respawn it far from the player.
    const fuseIdx = OBJECTIVES.findIndex((o) => o.id === 'findFuse');
    if (c.objective > fuseIdx) {
      const spawn = this.farthestPatrolPoint();
      this.enemy.reset(spawn.x, spawn.z, true);
      this.stalker.root.visible = true;
      if (c.exitUnlocked) this.noise(this.world.exitDoor.cx * 2 + 1, this.world.exitDoor.cz * 2 - 1, 400, 'alarm');
    }
  }

  private farthestPatrolPoint() {
    const from = { x: this.player.pos.x, z: this.player.pos.z };
    let best = { x: ENEMY_SPAWN.x, z: ENEMY_SPAWN.z };
    let bestLen = -1;
    for (const p of PATROL_POINTS) {
      const path = this.nav.findPath(from, p);
      if (!path) continue;
      const len = this.nav.pathLength(from, path);
      if (len > bestLen) { bestLen = len; best = p; }
    }
    return best;
  }

  private stats() {
    return { time: this.runTime, deaths: this.deaths, hides: this.profile.hides, batteries: this.batteriesTaken, sprintSeconds: this.profile.sprintSeconds, kills: this.kills };
  }

  // ================================================================== sequences

  private beginSequence(kind: 'death' | 'escape') {
    if (this.sequence) return;
    this.sequence = { kind, t: 0 };
    this.input.reset();
    hud.set({ prompt: null });
    if (kind === 'death') {
      this.deaths++;
      ui.set({ fadeColor: 'red' });
    } else {
      ui.set({ fadeColor: 'black' });
      this.escapeFrom.copy(this.player.pos);
      this.enemy.active = false;
      this.audio.setThreat(0);
    }
  }

  private updateSequence(dt: number) {
    const s = this.sequence!;
    s.t += dt;
    if (s.kind === 'death') {
      this.player.fallT = Math.min(1, s.t / 1.1) ** 2;
      this.player.applyCamera(this.camera, this.time);
      ui.set({ fade: Math.min(1, Math.max(0, (s.t - 0.6) / 1.6)) });
      if (s.t > 2.4) {
        this.sequence = null;
        this.input.enabled = false;
        if (document.pointerLockElement) document.exitPointerLock();
        ui.set({ stats: this.stats(), needsPointer: false });
        this.audio.setThreat(0);
        this.audio.stopAlarm();
        setScreen('dead');
      }
    } else {
      // Walk out into the night.
      const p = this.player;
      p.pos.z = this.escapeFrom.z + s.t * 1.7;
      p.pos.x += (19 - p.pos.x) * Math.min(1, dt * 1.5);
      // Turn to face out of the building (+Z is yaw = PI).
      p.yaw += Math.atan2(Math.sin(Math.PI - p.yaw), Math.cos(Math.PI - p.yaw)) * Math.min(1, dt * 2);
      p.pitch += (0.12 - p.pitch) * Math.min(1, dt * 1.2);
      p.applyCamera(this.camera, this.time);
      this.world.outsideLight.intensity = Math.min(1, s.t / 2) * 6;
      ui.set({ fade: Math.min(1, Math.max(0, (s.t - 2.6) / 1.8)) });
      if (s.t > 4.8) {
        this.sequence = null;
        this.input.enabled = false;
        this.audio.stopAlarm();
        if (document.pointerLockElement) document.exitPointerLock();
        this.objectives.complete('escape');
        clearCheckpoint();
        ui.set({ stats: this.stats(), hasSave: false, needsPointer: false });
        setScreen('escaped');
      }
    }
  }

  // ================================================================== main loop

  private loop = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const raw = Math.max(0, (now - this.last) / 1000);
    const dt = Math.min(0.05, raw);
    this.last = now;
    if (raw > 0 && raw < 1) this.frameTime += (raw - this.frameTime) * 0.05;
    this.time += dt;
    const screen = ui.get().screen;

    if (screen === 'menu') {
      this.updateMenu(dt);
      this.render();
    } else if (screen === 'playing') {
      if (this.sequence) {
        this.updateSequence(dt);
        this.updateWorldVisuals(dt);
        this.render();
      } else if (this.canSimulate()) {
        this.update(dt);
        this.render();
      } else {
        // Waiting for a click to capture the mouse: hold the frame, keep the world frozen.
        this.render();
      }
    } else if (screen === 'dead' || screen === 'escaped') {
      this.updateWorldVisuals(dt * 0.3);
      this.render();
    }
    // 'paused': nothing advances and the last frame stays on screen.
    this.input.endFrame();
  };

  private canSimulate() {
    const s = ui.get();
    return s.overlay === 'none' && (!!document.pointerLockElement || this.noPointerLock);
  }

  private update(dt: number) {
    const p = this.player;
    this.runTime += dt;
    this.stingerCooldown -= dt;

    // Input actions
    if (this.input.wasPressed('KeyF')) {
      if (this.flashlight.toggle()) {
        this.audio.flashlightClick(this.flashlight.on);
        // A light switching on in its view is a change the stalker can react to.
        if (this.flashlight.on && this.enemy.active) {
          const sens = this.profile.lightSensitivity();
          const d = Math.hypot(this.enemy.x - p.pos.x, this.enemy.z - p.pos.z);
          if (d < 14 * sens && this.losToPlayer(this.enemy.x, this.enemy.z)) this.noise(p.pos.x, p.pos.z, 14 * sens, 'light');
        }
      } else {
        this.notice('Flashlight', 'The battery is dead. Find a battery.', 3);
      }
    }
    if (this.input.wasPressed('KeyE')) this.interaction.interact();

    // Player
    if (p.hiddenSpot) {
      const def = HIDE_SPOTS.find((h) => h.id === p.hiddenSpot)!;
      p.look(this.input, this.settings, { yaw: def.yaw, range: 0.45, pitch: 0.35 });
      p.update(dt, this.input, this.world.collision, this.settings);
      this.hideT = Math.min(1, this.hideT + dt / 0.35);
      if (this.hideT >= 1) this.setLockerVisible(p.hiddenSpot, false);
    } else {
      p.update(dt, this.input, this.world.collision, this.settings);
    }
    this.applyPlayerCamera();

    this.flashlight.update(dt, this.camera, this.rayWalls);
    // Interaction focus
    if (p.hiddenSpot) this.interaction.focused = this.interaction.get(`hide-${p.hiddenSpot}`) ?? null;
    else this.interaction.update(this.camera);

    this.updateWeapons(dt);

    // Enemies
    const view = this.playerView();
    if (this.enemy.active) {
      this.enemy.update(dt, view);
      // Bodies do not overlap.
      if (!p.hiddenSpot) {
        const dx = p.pos.x - this.enemy.x, dz = p.pos.z - this.enemy.z;
        const d = Math.hypot(dx, dz), min = ENEMY_TUNING.radius + 0.3;
        if (d < min && d > 0.0001) {
          p.pos.x += (dx / d) * (min - d);
          p.pos.z += (dz / d) * (min - d);
          this.world.collision.resolveCircle(p.pos, 0.3);
        }
      }
    }
    this.updateZombies(dt, view);
    this.updateWorldVisuals(dt);

    // Habits
    this.profile.update(dt, {
      cellIndex: this.world.grid.index(toCell(p.pos.x), toCell(p.pos.z)),
      moving: p.moving, sprinting: p.sprinting, flashlightOn: this.flashlight.on, hidden: !!p.hiddenSpot,
    });

    // Location-based objectives
    const zone = zoneAt(p.pos.x, p.pos.z);
    if (zone && zone.id !== 'reception' && this.objectives.isCurrent('explore')) this.objectives.complete('explore');
    if (zone?.id === 'restricted' && !this.objectives.isDone('restricted')) this.objectives.complete('restricted');
    const exit = this.world.exitDoor;
    if (this.exitUnlocked && !exit.blocksMovement && p.pos.z > EXIT_TRIGGER_Z && !p.hiddenSpot) this.beginSequence('escape');

    this.updateAudio(dt);
    this.updateAmbientScares(dt);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.pushHud();
    }
    if (this.noticeTimer > 0) {
      this.noticeTimer -= dt;
      if (this.noticeTimer <= 0) hud.set({ notice: null });
    }
  }

  private applyPlayerCamera() {
    const p = this.player;
    if (p.hiddenSpot && this.hideT < 1) {
      // Step back into the locker.
      p.applyCamera(this.camera, this.time);
      const target = this.camera.position.clone();
      const k = this.hideT * this.hideT * (3 - 2 * this.hideT);
      this.camera.position.set(
        THREE.MathUtils.lerp(this.hideFrom.x, target.x, k),
        target.y,
        THREE.MathUtils.lerp(this.hideFrom.z, target.z, k),
      );
      return;
    }
    p.applyCamera(this.camera, this.time);
  }

  /** Doors, lights, locker doors, stalker model, dust: everything visual that animates. */
  private updateWorldVisuals(dt: number) {
    for (const d of this.world.doors) d.update(dt);
    this.world.lighting.update(dt);
    for (const [id, a] of this.lockerAnims) {
      a.t += dt;
      const l = this.world.lockers.get(id);
      if (!l) continue;
      const k = Math.min(1, a.t / a.dur);
      l.door.rotation.y = -Math.sin(k * Math.PI) * 1.4;
      if (k >= 1) { l.door.rotation.y = 0; this.lockerAnims.delete(id); }
    }
    if (this.enemy.active || this.stalker.root.visible) {
      this.stalker.root.position.set(this.enemy.x, 0, this.enemy.z);
      this.stalker.root.rotation.y = this.enemy.yaw;
      this.stalker.update(dt, {
        speed: this.enemy.moveSpeed, state: this.enemy.state, attackTimer: this.enemy.attackTimer,
        windup: ENEMY_TUNING.windup, lockerReach: !!this.enemy.lockerTarget,
      });
    }
    this.updateCombatVisuals(dt);
    const exit = this.world.exitDoor;
    if (this.exitUnlocked && !this.sequence) this.world.outsideLight.intensity = exit.openAmount * 3;
    this.dust.update(dt, this.camera, this.flashlight.pos, this.flashlight.dir, this.flashlight.output, this.renderer.getPixelRatio());
  }

  private rayWalls = (() => {
    const rc = new THREE.Raycaster();
    rc.far = 10;
    return (o: THREE.Vector3, d: THREE.Vector3) => {
      rc.set(o, d);
      const h = rc.intersectObjects(this.world.occluders, false)[0];
      return h ? h.distance : 10;
    };
  })();

  private playerView(): PlayerView {
    const p = this.player;
    this.lightTimer -= 1 / 60;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.25;
      this.playerLight = this.world.lighting.lightLevelAt(p.pos.x, p.pos.z);
    }
    const fd = this.flashlight.dir;
    const fl = Math.hypot(fd.x, fd.z) || 1;
    return {
      x: p.pos.x, z: p.pos.z, vx: p.vel.x, vz: p.vel.z,
      crouched: p.crouched, sprinting: p.sprinting,
      flashlightOn: this.flashlight.output > 0.25,
      fdx: fd.x / fl, fdz: fd.z / fl,
      hiddenSpot: p.hiddenSpot, alive: p.alive && !this.sequence,
      lightLevel: this.playerLight,
      invulnerable: p.invulnerable > 0,
    };
  }

  private updateAudio(dt: number) {
    const a = this.audio;
    const c = this.camera;
    const fwd = c.getWorldDirection(new THREE.Vector3());
    a.setListener(c.position.x, c.position.y, c.position.z, fwd.x, fwd.y, fwd.z);
    const e = this.enemy;
    let target = 0;
    if (e.active) {
      const d = Math.hypot(e.x - this.player.pos.x, e.z - this.player.pos.z);
      const occluded = !this.losToPlayer(e.x, e.z);
      if (e.state === 'Chase' || e.state === 'Attack') target = 1;
      else if (e.state === 'Recover') target = 0.8;
      else if (e.state === 'Search' || e.state === 'Investigate') target = Math.max(0.15, Math.min(0.75, 1 - d / 18));
      else target = Math.max(0, Math.min(0.5, 1 - d / 14));
      const intensity = e.state === 'Chase' ? 1 : e.state === 'Search' || e.state === 'Investigate' ? 0.5 : 0.2;
      a.updateEnemyVoice(e.x, e.z, d < 22, intensity, occluded);
    } else {
      a.updateEnemyVoice(0, 0, false, 0, true);
    }
    for (const z of this.zombies.living()) {
      const d = Math.hypot(z.ai.x - this.player.pos.x, z.ai.z - this.player.pos.z);
      if (z.ai.state === 'Chase' || z.ai.state === 'Attack') target = Math.max(target, d < 20 ? 0.55 + Math.min(0.3, (20 - d) / 40) : 0.3);
      else if (d < 12) target = Math.max(target, 0.2);
    }
    if (this.exitUnlocked) target = Math.max(target, 0.45);
    this.threat += (target - this.threat) * Math.min(1, dt * 1.2);
    a.setThreat(this.threat);
    a.update(dt);
  }

  private updateAmbientScares(dt: number) {
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = 35 + Math.random() * 45;
    if (this.threat > 0.3) return;
    const p = this.player.pos;
    const candidates = PATROL_POINTS.filter((q) => { const d = Math.hypot(q.x - p.x, q.z - p.z); return d > 12 && d < 32; });
    if (!candidates.length) return;
    const q = candidates[Math.floor(Math.random() * candidates.length)];
    const occluded = !this.losToPlayer(q.x, q.z);
    if (Math.random() < 0.5) this.audio.distantSteps(q.x, q.z);
    else this.audio.impact(q.x, q.z, occluded);
  }

  private updateMenu(dt: number) {
    this.menuT += dt;
    this.setMenuCamera(this.menuT);
    this.world.lighting.update(dt);
    this.menuStalker.update(dt, { speed: 0, state: 'Patrol', attackTimer: 0, windup: 1, lockerReach: false });
    this.dust.update(dt, this.camera, this.flashlight.pos, this.flashlight.dir, 0, this.renderer.getPixelRatio());
    for (const d of this.world.doors) d.update(dt);
  }

  private setMenuCamera(t: number) {
    const f = MENU_CAMERA.from, to = MENU_CAMERA.to;
    this.camera.position.set(f.x + Math.sin(t * 0.11) * 0.25, f.y + Math.sin(t * 0.37) * 0.03, f.z + Math.sin(t * 0.07) * 0.4);
    this.camera.lookAt(to.x + Math.sin(t * 0.13) * 0.3, to.y + Math.sin(t * 0.21) * 0.05, to.z);
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
  }

  // ================================================================== combat: weapons, zombies, pickups

  /** A sound at (x, z): the stalker and every zombie get a chance to hear it. */
  private noise(x: number, z: number, radius: number, kind: Parameters<EnemyAI['hearNoise']>[3]) {
    this.enemy.hearNoise(x, z, radius, kind);
    this.zombies.hearNoise(x, z, radius, kind);
  }

  private resetCombat() {
    this.zombies.clear();
    this.weapons.reset();
    this.telemetry.reset(0);
    this.director.reset();
    this.dirClock = 0;
    this.kills = 0;
    this.fireBuffer = 0;
    this.lastMag = this.weapons.mag.pistol;
    this.lastReloading = false;
    this.zombieNoticeShown = false;
    this.zombieSerial.fill(-1);
    for (const m of this.zombieModels) m.root.visible = false;
    this.weaponView.root.visible = false;
    for (const pk of [...this.pickups]) {
      if (pk.drop) this.removePickup(pk);
      else pk.mesh.visible = true;
    }
  }

  private zombieEvents(): ZombieEvents {
    return {
      attackWindup: (z) => this.audio.zombieGroan(z.ai.x, z.ai.z, true, !this.losToPlayer(z.ai.x, z.ai.z)),
      attackHit: (_z, dmg) => this.onPlayerHit(dmg),
      footstep: (z, running) => {
        if (Math.hypot(z.ai.x - this.player.pos.x, z.ai.z - this.player.pos.z) < 12) this.audio.enemyStep(z.ai.x, z.ai.z, running, !this.losToPlayer(z.ai.x, z.ai.z));
      },
      doorOpened: (_z, d) => this.audio.door(d.cx * 2 + 1, d.cz * 2 + 1, true, !this.losToPlayer(d.cx * 2 + 1, d.cz * 2 + 1)),
      damaged: (z, _amt, head) => this.audio.zombieHit(z.ai.x, z.ai.z, head),
      killed: (z) => {
        this.kills++;
        this.telemetry.onKill(this.dirClock);
        this.audio.zombieDie(z.ai.x, z.ai.z);
        this.maybeDropAmmo(z.ai.x, z.ai.z);
      },
    };
  }

  // ---- weapons

  private updateWeapons(dt: number) {
    const w = this.weapons, p = this.player, inp = this.input;
    w.update(dt);
    const canAct = !p.hiddenSpot && p.alive && !this.sequence;
    if (canAct) {
      (['bat', 'pistol', 'shotgun'] as WeaponId[]).forEach((id, i) => {
        if (inp.wasPressed(`Digit${i + 1}`) && w.switchTo(id)) this.audio.reload('shell');
      });
      if (inp.wheel !== 0 && w.cycle(inp.wheel > 0 ? 1 : -1)) this.audio.reload('shell');
      if (inp.wasPressed('KeyR')) w.startReload();
      if (inp.wasPressed('Mouse0')) this.fireBuffer = 0.18;
      else if (w.current === 'bat' && inp.isDown('Mouse0')) this.fireBuffer = Math.max(this.fireBuffer, 0.05);
      if (this.fireBuffer > 0) {
        this.fireBuffer -= dt;
        const res = w.attack(this.shotContext(), this.zombies);
        if (res.kind !== 'none') {
          this.fireBuffer = 0;
          this.onAttack(res);
        }
      }
    } else {
      this.fireBuffer = 0;
    }
    // Reload sounds: when a reload begins, and for every shell the shotgun loads.
    if (w.reloading && !this.lastReloading) this.audio.reload(w.current === 'shotgun' ? 'shell' : 'mag');
    else if (w.reloading && w.current === 'shotgun' && w.mag.shotgun > this.lastMag) this.audio.reload('shell');
    this.lastReloading = w.reloading;
    this.lastMag = w.mag[w.current];
  }

  private shotCtx = {
    o: { x: 0, y: 0, z: 0 },
    dir: { x: 0, y: 0, z: -1 },
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    rand: Math.random,
    wallDist: (o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, max: number) => this.rayWallsTo(o, d, max),
  };
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpC = new THREE.Vector3();
  private wallRay = new THREE.Raycaster();

  private shotContext() {
    const cam = this.camera;
    cam.updateMatrixWorld(true);
    const dir = cam.getWorldDirection(this.tmpA);
    const right = this.tmpB.setFromMatrixColumn(cam.matrixWorld, 0);
    const up = this.tmpC.setFromMatrixColumn(cam.matrixWorld, 1);
    const c = this.shotCtx;
    c.o.x = cam.position.x; c.o.y = cam.position.y; c.o.z = cam.position.z;
    c.dir.x = dir.x; c.dir.y = dir.y; c.dir.z = dir.z;
    c.right.x = right.x; c.right.y = right.y; c.right.z = right.z;
    c.up.x = up.x; c.up.y = up.y; c.up.z = up.z;
    return c;
  }

  /** Distance to the first wall or door along a ray (Infinity if none within `max`). */
  private rayWallsTo(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, max: number) {
    this.wallRay.set(this.tmpA.set(o.x, o.y, o.z), this.tmpB.set(d.x, d.y, d.z));
    this.wallRay.far = max;
    const h = this.wallRay.intersectObjects(this.world.occluders, false)[0];
    return h ? h.distance : Infinity;
  }

  private onAttack(res: AttackResult) {
    const p = this.player;
    if (res.kind === 'dry') { this.audio.dryFire(); return; }
    if (res.kind === 'shot') {
      this.audio.gunshot(res.weapon === 'shotgun' ? 'shotgun' : 'pistol');
      if (res.weapon === 'shotgun') this.audio.pump();
      this.weaponView.fireFlash(res.weapon);
      p.pitch = Math.min(1.45, p.pitch + (res.weapon === 'shotgun' ? 0.04 : 0.016));
      this.telemetry.onShot(this.dirClock, res.hit);
    } else {
      this.audio.melee(res.hit);
    }
    // Gunfire carries through the whole building.
    this.noise(p.pos.x, p.pos.z, res.noise, 'impact');
    if (res.hit) {
      const now = performance.now();
      hud.set({ hitAt: now, killAt: res.kills > 0 ? now : hud.get().killAt });
      this.audio.hitMarker(res.kills > 0);
    }
  }

  // ---- zombies and the director

  private progress() {
    return this.objectives.index / Math.max(1, OBJECTIVES.length - 1);
  }

  private directorObservation() {
    const p = this.player;
    const near = this.zombies.nearestAlive(p.pos.x, p.pos.z);
    const stalker = this.enemy.active ? Math.hypot(this.enemy.x - p.pos.x, this.enemy.z - p.pos.z) : 30;
    return {
      health: p.health,
      stamina: p.stamina,
      ammo_total: this.weapons.totalRounds(),
      weapon_power: this.weapons.power(),
      battery: this.flashlight.battery,
      zombies_alive: this.zombies.aliveCount,
      nearest_zombie_m: near ? near.dist : 30,
      ...this.telemetry.snapshot(this.dirClock),
      progress: this.progress(),
      light_level: this.playerLight,
      stalker_dist_m: stalker,
    };
  }

  private applyDecision(d: DirectorDecision) {
    if (d.count <= 0) return;
    const p = this.player.pos;
    const made = this.zombies.spawnWave(d.count, { x: p.x, z: p.z }, PATROL_POINTS, this.progress());
    if (!made.length) return;
    this.telemetry.onSpawn(this.dirClock);
    if (!this.zombieNoticeShown) {
      this.zombieNoticeShown = true;
      this.notice('Something is moving', 'The dead walk these halls. Click to swing or shoot, R reloads. Gunfire is loud.', 6);
    }
  }

  private updateZombies(dt: number, view: PlayerView) {
    this.dirClock += dt;
    this.telemetry.sample(this.dirClock, dt, this.player.sprinting);
    const p = this.player;
    this.zombies.update(dt, view, { pos: p.pos, hidden: !!p.hiddenSpot, radius: 0.3 });
    for (const z of this.zombies.living()) {
      z.groanT -= dt;
      if (z.groanT > 0) continue;
      const hunting = z.ai.state === 'Chase' || z.ai.state === 'Attack';
      z.groanT = hunting ? 2.5 + Math.random() * 2.5 : 5 + Math.random() * 7;
      if (Math.hypot(z.ai.x - p.pos.x, z.ai.z - p.pos.z) < 30) this.audio.zombieGroan(z.ai.x, z.ai.z, hunting, !this.losToPlayer(z.ai.x, z.ai.z));
    }
    if (this.zombiesEnabled && !p.hiddenSpot) {
      const d = this.director.update(dt, this.dirClock, this.telemetry.sinceSpawn(this.dirClock), () => this.directorObservation());
      if (d) this.applyDecision(d);
    }
    this.pickupT -= dt;
    if (this.pickupT <= 0) { this.pickupT = 0.1; this.updatePickups(0.1); }
  }

  // ---- pickups

  private pickupMaterials?: Record<'ammo9' | 'shells' | 'metal' | 'wood' | 'band', THREE.MeshStandardMaterial>;

  private makePickupMesh(kind: PickupKind): THREE.Object3D {
    const mats = (this.pickupMaterials ??= {
      ammo9: new THREE.MeshStandardMaterial({ color: 0x52623e, roughness: 0.6, emissive: 0x161d0e, emissiveIntensity: 1 }),
      shells: new THREE.MeshStandardMaterial({ color: 0x8a2c22, roughness: 0.55, emissive: 0x240a08, emissiveIntensity: 1 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x3a3d3f, roughness: 0.35, metalness: 0.85, emissive: 0x0e0f10 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x8a6240, roughness: 0.6, emissive: 0x1b1006 }),
      band: new THREE.MeshStandardMaterial({ color: 0xc9b46a, roughness: 0.4, metalness: 0.6, emissive: 0x2a2208 }),
    });
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    if (kind === 'shotgun') {
      const barrel = add(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 10), mats.metal, 0, 0.04, 0);
      barrel.rotation.z = Math.PI / 2;
      add(new THREE.BoxGeometry(0.28, 0.07, 0.07), mats.wood, -0.36, 0.045, 0);
      add(new THREE.BoxGeometry(0.2, 0.05, 0.06), mats.wood, 0.1, 0.03, 0);
      g.position.y = 0.05;
    } else {
      const mat = kind === 'ammo9' ? mats.ammo9 : mats.shells;
      add(new THREE.BoxGeometry(0.24, 0.11, 0.15), mat, 0, 0.055, 0);
      add(new THREE.BoxGeometry(0.245, 0.025, 0.05), mats.band, 0, 0.06, 0);
    }
    g.traverse((o) => { o.userData.dynamic = true; });
    return g;
  }

  private buildPickups() {
    for (const def of PICKUP_SPAWNS) {
      const mesh = this.makePickupMesh(def.kind);
      mesh.position.x = def.x;
      mesh.position.z = def.z;
      mesh.rotation.y = (def.x * 7.3 + def.z * 3.1) % (Math.PI * 2);
      this.scene.add(mesh);
      this.pickups.push({ def, mesh, drop: false, ttl: Infinity });
    }
  }

  private removePickup(pk: { mesh: THREE.Object3D }) {
    this.scene.remove(pk.mesh);
    this.pickups = this.pickups.filter((q) => q !== pk);
  }

  private maybeDropAmmo(x: number, z: number) {
    // Enough drops to keep a competent player supplied, few enough that ammo still matters.
    const hasShotgun = this.weapons.has('shotgun');
    if (Math.random() > 0.3) return;
    const kind: PickupKind = hasShotgun && Math.random() < 0.4 ? 'shells' : 'ammo9';
    const def: PickupDef = { id: `drop-${this.dropCounter++}`, kind, x, z };
    const mesh = this.makePickupMesh(kind);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(mesh);
    this.pickups.push({ def, mesh, drop: true, ttl: 50 });
  }

  private updatePickups(step: number) {
    const p = this.player;
    if (p.hiddenSpot || !p.alive) return;
    for (const pk of [...this.pickups]) {
      if (pk.drop) {
        pk.ttl -= step;
        if (pk.ttl <= 0) { this.removePickup(pk); continue; }
      }
      if (!pk.mesh.visible) continue;
      if (Math.hypot(pk.def.x - p.pos.x, pk.def.z - p.pos.z) > 1.05) continue;
      this.collectPickup(pk);
    }
  }

  private collectPickup(pk: { def: PickupDef; mesh: THREE.Object3D; drop: boolean }) {
    const { kind, id } = pk.def;
    if (kind === 'shotgun') {
      this.weapons.addAmmo('shell', AMMO_PICKUP.shell);
      this.weapons.addWeapon('shotgun');
      this.weapons.switchTo('shotgun');
      this.audio.pickup('key');
      this.notice('Shotgun', 'Press 3 to equip. Six pellets, close range, very loud.', 5);
    } else {
      const type = kind === 'ammo9' ? '9mm' : 'shell';
      const got = this.weapons.addAmmo(type, AMMO_PICKUP[type]);
      if (got <= 0) return; // already full: leave it for later
      this.audio.pickupAmmo();
      this.notice(kind === 'ammo9' ? '9mm rounds' : 'Shotgun shells', `+${got}`, 1.6);
    }
    if (pk.drop) this.removePickup(pk);
    else { pk.mesh.visible = false; this.picked.add(id); }
  }

  /** Models, pickups and the weapon view: everything visual that follows the combat state. */
  private updateCombatVisuals(dt: number) {
    const zs = this.zombies.zombies;
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i], m = this.zombieModels[i];
      m.root.visible = z.used;
      if (!z.used) continue;
      if (this.zombieSerial[i] !== z.serial) { this.zombieSerial[i] = z.serial; m.setKind(z.kind); }
      m.root.position.set(z.ai.x, 0, z.ai.z);
      m.root.rotation.y = z.ai.yaw;
      m.update(dt, {
        speed: z.ai.moveSpeed, state: z.ai.state, attackTimer: z.ai.attackTimer, windup: z.ai.T.windup,
        alive: z.alive, deadT: z.deadT, flinch: z.alive && z.ai.state === 'Recover',
      });
    }
    const t = performance.now() / 1000;
    for (const pk of this.pickups) {
      if (!pk.mesh.visible) continue;
      pk.mesh.rotation.y += dt * 0.6;
      pk.mesh.position.y = pk.def.kind === 'shotgun' ? 0.04 + Math.sin(t * 2 + pk.def.x) * 0.012 : Math.sin(t * 2 + pk.def.x) * 0.012;
    }
    const w = this.weapons, p = this.player;
    const cam = this.camera.getWorldDirection(this.tmpA);
    this.weaponView.update(dt, {
      weapon: w.current, sinceAttack: w.sinceAttack, lastAttack: w.lastAttack, reloading: w.reloading,
      reloadProgress: w.reloading ? 1 - Math.max(0, w.reloadT) / Math.max(0.01, w.def.reload) : 0,
      swapT: w.swapT, speed: Math.hypot(p.vel.x, p.vel.z), sprinting: p.sprinting,
      wallDist: this.rayWalls(this.camera.position, cam),
      visible: ui.get().screen === 'playing' && !this.sequence && !p.hiddenSpot && p.alive,
    });
  }

  // ================================================================== HUD

  private notice(title: string, body: string, seconds: number) {
    hud.set({ notice: { title, body, at: performance.now() } });
    this.noticeTimer = seconds;
  }

  private pushHud() {
    const p = this.player;
    const obj = this.objectives.current;
    let hint = obj?.hint ?? '';
    if (obj?.id === 'escape') hint = `Shutter ${Math.round(this.world.exitDoor.openAmount * 100)}% open`;
    const focused = this.interaction.focused;
    hud.set({
      health: Math.round(p.health),
      stamina: Math.round(p.stamina),
      staminaVisible: p.stamina < 99 || p.sprinting,
      battery: Math.ceil(this.flashlight.battery),
      flashlightOn: this.flashlight.on,
      prompt: focused ? focused.prompt() : null,
      objectiveIndex: this.objectives.index,
      objectiveTitle: obj?.title ?? '',
      objectiveHint: hint,
      inventory: this.inventory.list(),
      hidden: !!p.hiddenSpot,
      crouched: p.crouched,
      threat: Math.round(this.threat * 20) / 20,
      lowHealth: p.health < 35,
      weapon: this.weapons.current,
      weaponName: this.weapons.def.name,
      ownedWeapons: this.weapons.list(),
      mag: this.weapons.def.ammo ? this.weapons.mag[this.weapons.current] : 0,
      reserve: this.weapons.def.ammo ? this.weapons.reserve[this.weapons.def.ammo] : 0,
      magSize: this.weapons.def.mag,
      reloading: this.weapons.reloading,
      zombiesAlive: this.zombies.aliveCount,
    });
  }

  // ================================================================== settings & platform events

  private directorSetting = '';

  /** Loads the spawn-director model chosen in Settings and swaps it in (the latest choice wins). */
  private syncDirectorModel(setting: string) {
    if (setting === this.directorSetting) return;
    this.directorSetting = setting;
    loadDirector(setting)
      .then((m) => { if (this.directorSetting === setting) this.director.setModel(m); })
      .catch((err) => {
        console.error('director model failed to load, using rules', err);
        if (this.directorSetting === setting) this.director.setModel(null);
      });
  }

  applySettings(s: Settings) {
    const prevQuality = this.settings.quality;
    this.settings = s;
    this.syncDirectorModel(s.directorModel);
    this.audio.setVolume(s.volume);
    if (!this.renderer) return;
    this.quality = qualityProfile(s.quality);
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.toneMappingExposure = 0.95 * s.brightness;
    this.hemi.intensity = 0.05 * s.brightness * s.brightness;
    this.world.lighting.intensityScale = 0.8 + 0.2 * s.brightness;
    const shadowsChanged = this.renderer.shadowMap.enabled !== this.quality.shadows;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.flashlight.setShadows(this.quality.shadows, this.quality.shadowMap);
    this.world.lighting.setMaxDynamic(this.quality.maxLights);
    this.dust.points.geometry.setDrawRange(0, this.quality.dust);
    if (shadowsChanged || prevQuality !== s.quality) {
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
        else if (m) m.needsUpdate = true;
      });
    }
    this.onResize();
    const fsActive = !!document.fullscreenElement;
    if (s.fullscreen && !fsActive) {
      document.documentElement.requestFullscreen?.().then(() => {
        // In fullscreen Chromium lets us keep Ctrl+W etc. from closing the tab while crouching.
        (navigator as unknown as { keyboard?: { lock?: (k: string[]) => Promise<void> } }).keyboard?.lock?.(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyC'])?.catch(() => {});
      }).catch(() => settingsStore.set({ fullscreen: false }));
    } else if (!s.fullscreen && fsActive) {
      void document.exitFullscreen?.();
    }
  }

  private onResize = () => {
    if (!this.renderer) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (ui.get().screen === 'paused') this.render();
  };

  private onPointerLockChange = () => {
    const locked = !!document.pointerLockElement;
    const s = ui.get();
    if (locked) {
      ui.set({ needsPointer: false, pointerError: null });
      this.input.reset();
    } else if (s.screen === 'playing' && !this.sequence && s.overlay === 'none' && !this.noPointerLock) {
      // Escape (or the browser) released the mouse: pause the game.
      this.pause();
    }
  };

  private onPointerLockError = () => {
    if (ui.get().screen === 'playing') ui.set({ needsPointer: true, pointerError: 'Click to continue — the browser needs a moment before capturing the mouse again.' });
  };

  private onVisibility = () => {
    if (document.hidden) this.pause();
    this.last = performance.now();
  };

  private onFullscreenChange = () => {
    const fs = !!document.fullscreenElement;
    if (settingsStore.get().fullscreen !== fs) settingsStore.set({ fullscreen: fs });
    this.onResize();
  };

  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    const s = ui.get().screen;
    if (s === 'playing' || s === 'paused') {
      // Guards against Ctrl+W while crouching. Progress is also checkpointed.
      e.preventDefault();
      e.returnValue = '';
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    // Without pointer lock (debug) Escape would not pause on its own.
    if (e.code === 'Escape' && this.noPointerLock && ui.get().screen === 'playing') this.pause();
  };

  private onCanvasClick = () => {
    if (ui.get().screen === 'playing' && !document.pointerLockElement && ui.get().overlay === 'none') this.requestPointer();
  };

  /** Browsers only allow audio after a user gesture; every click/key tries to unlock it. */
  private unlockAudio = () => {
    this.audio.unlock();
    this.addBuzzOnce();
    this.audio.setVolume(this.settings.volume);
  };

  private buzzAdded = false;
  private addBuzzOnce() {
    if (this.buzzAdded || !this.world || !this.audio.hasContext) return;
    this.buzzAdded = true;
    for (const b of this.world.lighting.buzzSources()) this.audio.addBuzz(b.x, b.z, b.level);
  }

  // ================================================================== debug / automated testing

  debugApi() {
    return {
      state: () => ({
        screen: ui.get().screen,
        fps: Math.round(1 / this.frameTime),
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        objective: this.objectives.current?.id ?? 'done',
        objectiveIndex: this.objectives.index,
        player: { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw, health: this.player.health, stamina: this.player.stamina, hidden: this.player.hiddenSpot, crouched: this.player.crouched },
        battery: this.flashlight.battery,
        flashlightOn: this.flashlight.on,
        inventory: this.inventory.list(),
        power: this.power,
        exitOpen: this.world.exitDoor.openAmount,
        enemy: { active: this.enemy.active, state: this.enemy.state, x: this.enemy.x, z: this.enemy.z, detection: this.enemy.detection },
        zombies: [...this.zombies.living()].map((z) => ({ id: z.id, kind: z.kind, health: z.health, state: z.ai.state, x: z.ai.x, z: z.ai.z })),
        weapons: { current: this.weapons.current, owned: this.weapons.list(), mag: { ...this.weapons.mag }, reserve: { ...this.weapons.reserve }, reloading: this.weapons.reloading },
        kills: this.kills,
        profile: this.profile.scores(),
        prompt: this.interaction.focused?.prompt()?.text ?? null,
        focused: this.interaction.focused?.id ?? null,
        doors: this.world.doors.map((d) => ({ id: d.id, kind: d.kind, locked: d.locked, open: d.openAmount })),
      }),
      setNoPointerLock: (v: boolean) => { this.noPointerLock = v; ui.set({ needsPointer: false }); },
      teleport: (x: number, z: number, yaw?: number, pitch?: number) => {
        this.player.pos.set(x, 0, z);
        if (yaw !== undefined) this.player.yaw = yaw;
        if (pitch !== undefined) this.player.pitch = pitch;
      },
      key: (code: string, down: boolean) => this.input.simulate(code, down),
      look: (yaw: number, pitch: number) => { this.player.yaw = yaw; this.player.pitch = pitch; },
      interactWith: (id: string) => { const i = this.interaction.get(id); if (i && i.prompt()) { i.interact(); return true; } return false; },
      enemyTo: (x: number, z: number, active = true) => { this.enemy.reset(x, z, active); this.stalker.root.visible = active; },
      enemyNoise: (x: number, z: number, r: number) => this.noise(x, z, r, 'door'),
      damage: (n: number) => { this.player.invulnerable = 0; this.onPlayerHit(n); },
      setBattery: (b: number) => { this.flashlight.battery = b; },
      /** Turn the zombie director on or off (the end-to-end test disables it so scripted runs are not interrupted). */
      setZombies: (on: boolean) => { this.zombiesEnabled = on; this.director.enabled = on; if (!on) this.zombies.clear(); },
      spawnZombie: (x: number, z: number, kind: 'walker' | 'runner' | 'brute' = 'walker', aware = true) =>
        !!this.zombies.spawn(kind, x, z, aware, { x: this.player.pos.x, z: this.player.pos.z }),
      /** Ask the director to decide right now (ignores the timer); returns the decision. */
      directorTick: () => { const d = this.director.decide(this.dirClock, this.directorObservation()); this.applyDecision(d); return d; },
      directorLog: () => this.director.log.map((d) => ({ ...d })),
      director: () => ({ enabled: this.director.enabled, usingModel: this.director.usingModel, modelName: this.director.modelName, last: this.director.last, clock: this.dirClock }),
      giveWeapon: (id: WeaponId) => { this.weapons.addWeapon(id); this.weapons.addAmmo(WEAPONS[id].ammo ?? '9mm', 12); },
      giveAmmo: (n: number) => { this.weapons.addAmmo('9mm', n); this.weapons.addAmmo('shell', n); },
      selectWeapon: (id: WeaponId) => this.weapons.switchTo(id),
      openExitNow: () => { this.world.exitDoor.openAmount = 1; },
      /** Renders `frames` frames back-to-back (GPU-synchronised) and returns ms per frame. */
      bench: (frames = 120) => {
        const gl = this.renderer.getContext();
        this.render();
        gl.finish();
        const t0 = performance.now();
        for (let i = 0; i < frames; i++) {
          this.camera.rotation.y += 0.01;
          this.render();
        }
        gl.finish();
        return (performance.now() - t0) / frames;
      },
    };
  }
}
