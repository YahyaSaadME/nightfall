/**
 * Lightweight, deterministic player-habit model. Scores move slowly (EMAs) and are
 * capped by an adaptation budget that only grows with play time, so the stalker
 * adapts gradually instead of instantly countering the player.
 */
export interface AdaptiveConfig {
  /** Seconds for a habit score to move ~63% toward the current behaviour. */
  habitTau: number;
  /** Seconds of play until the full adaptation budget is available. */
  rampSeconds: number;
  /** Adaptation budget at the start of a session (0..1). */
  startBudget: number;
  /** Hides per minute that counts as "hides a lot". */
  hidesPerMinuteHigh: number;
  /** Heat-map decay time constant (seconds). */
  heatTau: number;
  maxLockerCheckChance: number;
  baseLockerCheckChance: number;
}

export const DEFAULT_ADAPTIVE: AdaptiveConfig = {
  habitTau: 75,
  rampSeconds: 300,
  startBudget: 0.35,
  hidesPerMinuteHigh: 1.5,
  heatTau: 240,
  maxLockerCheckChance: 0.55,
  baseLockerCheckChance: 0.12,
};

export interface ProfileSample {
  cellIndex: number;
  moving: boolean;
  sprinting: boolean;
  flashlightOn: boolean;
  hidden: boolean;
}

export interface ProfileScores { hide: number; sprint: number; flashlight: number; route: number; budget: number }

export interface ProfileSnapshot {
  playTime: number; hideRate: number; sprint: number; flashlight: number; route: number;
  hides: number; sprintSeconds: number; flashSeconds: number;
}

export class BehaviourProfile {
  playTime = 0;
  /** Raw counters (for the end screen and debugging). */
  hides = 0;
  sprintSeconds = 0;
  flashSeconds = 0;

  private hideRate = 0; // EMA of hides per minute
  private sprint = 0; // EMA of fraction of moving time spent sprinting
  private flashlight = 0; // EMA of fraction of time with flashlight on
  private route = 0; // EMA of how often the player is on well-trodden cells

  /** Where the player actually walks (used only to measure repetition). */
  private readonly trail: Float32Array;
  /** Where the stalker has perceived the player (sightings / noises): evidence only. */
  readonly evidenceHeat: Float32Array;
  /** Where the stalker has heard sprinting. */
  readonly noiseHeat: Float32Array;
  private lastCell = -1;
  private hideWindow = 0;

  constructor(cellCount: number, readonly cfg: AdaptiveConfig = DEFAULT_ADAPTIVE) {
    this.trail = new Float32Array(cellCount);
    this.evidenceHeat = new Float32Array(cellCount);
    this.noiseHeat = new Float32Array(cellCount);
  }

  private ema(current: number, target: number, dt: number) {
    return current + (target - current) * (1 - Math.exp(-dt / this.cfg.habitTau));
  }

  update(dt: number, s: ProfileSample) {
    this.playTime += dt;
    if (s.moving && !s.hidden) {
      this.sprint = this.ema(this.sprint, s.sprinting ? 1 : 0, dt);
      if (s.sprinting) this.sprintSeconds += dt;
    }
    if (!s.hidden) {
      this.flashlight = this.ema(this.flashlight, s.flashlightOn ? 1 : 0, dt);
      if (s.flashlightOn) this.flashSeconds += dt;
    }
    // Hide rate: hides counted over a rolling minute window, smoothed.
    this.hideWindow = Math.max(0, this.hideWindow - dt / 60);
    this.hideRate = this.ema(this.hideRate, this.hideWindow, dt);

    if (s.cellIndex !== this.lastCell && s.cellIndex >= 0) {
      // Entering a cell the player has visited many times counts as route repetition.
      const familiarity = Math.min(1, this.trail[s.cellIndex] / 4);
      this.route = this.route + (familiarity - this.route) * 0.04;
      this.trail[s.cellIndex] += 1;
      this.lastCell = s.cellIndex;
    }
    const decay = Math.exp(-dt / this.cfg.heatTau);
    for (let i = 0; i < this.evidenceHeat.length; i++) {
      this.evidenceHeat[i] *= decay;
      this.noiseHeat[i] *= decay;
    }
  }

  onHide() {
    this.hides++;
    this.hideWindow += 1;
  }

  recordEvidence(cellIndex: number, weight = 1) {
    if (cellIndex >= 0 && cellIndex < this.evidenceHeat.length) this.evidenceHeat[cellIndex] += weight;
  }

  recordNoise(cellIndex: number, weight = 1) {
    if (cellIndex >= 0 && cellIndex < this.noiseHeat.length) this.noiseHeat[cellIndex] += weight;
  }

  /** Current adaptation budget: limits how strongly any habit can influence the AI. */
  budget() {
    const t = Math.min(1, this.playTime / this.cfg.rampSeconds);
    return this.cfg.startBudget + (1 - this.cfg.startBudget) * t;
  }

  scores(): ProfileScores {
    const b = this.budget();
    return {
      hide: Math.min(1, this.hideRate / this.cfg.hidesPerMinuteHigh) * b,
      sprint: Math.min(1, this.sprint * 1.6) * b,
      flashlight: this.flashlight * b,
      route: Math.min(1, this.route * 1.4) * b,
      budget: b,
    };
  }

  // --- Decision helpers used by the stalker -------------------------------------------

  lockerCheckChance() {
    const c = this.cfg;
    return Math.min(c.maxLockerCheckChance, c.baseLockerCheckChance + this.scores().hide * 0.45);
  }

  /** Frequent runners are heard from further away (up to +40%). */
  sprintHearingMultiplier() {
    return 1 + this.scores().sprint * 0.4;
  }

  /** Lower door cost = the stalker takes door shortcuts more readily. */
  doorCost() {
    return 2 - this.scores().sprint * 1.8;
  }

  /** Heavy flashlight users: the stalker reacts to beams from further / faster. */
  lightSensitivity() {
    return 1 + this.scores().flashlight * 0.6;
  }

  /** Players who avoid the flashlight push the search toward dark areas. */
  darkPreference() {
    const s = this.scores();
    return Math.max(0, s.budget * 0.8 - s.flashlight);
  }

  /** Patrol weighting near cells with evidence of the player's routes and noise. */
  routeWeight(cellIndices: number[]) {
    const s = this.scores();
    let ev = 0, noise = 0;
    for (const i of cellIndices) { ev += this.evidenceHeat[i] ?? 0; noise += this.noiseHeat[i] ?? 0; }
    return 1 + s.route * 2.5 * Math.min(2, ev) + s.sprint * 1.5 * Math.min(2, noise);
  }

  snapshot(): ProfileSnapshot {
    return {
      playTime: this.playTime, hideRate: this.hideRate, sprint: this.sprint, flashlight: this.flashlight,
      route: this.route, hides: this.hides, sprintSeconds: this.sprintSeconds, flashSeconds: this.flashSeconds,
    };
  }

  restore(s: ProfileSnapshot) {
    Object.assign(this, {
      playTime: s.playTime, hideRate: s.hideRate, sprint: s.sprint, flashlight: s.flashlight, route: s.route,
      hides: s.hides, sprintSeconds: s.sprintSeconds, flashSeconds: s.flashSeconds,
    });
  }
}
