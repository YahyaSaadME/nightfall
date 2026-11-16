import * as THREE from 'three';

/**
 * Procedural texture generation (no external assets). Every generator paints a
 * colour canvas and, where useful, a matching height canvas used as a bump map.
 */
export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
type G = CanvasRenderingContext2D;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d', { willReadFrequently: false })! };
}

function pair(w: number, h: number) {
  const col = canvas(w, h);
  const bump = canvas(w, h);
  bump.g.fillStyle = '#808080';
  bump.g.fillRect(0, 0, w, h);
  return { col, bump, w, h };
}

function grain(g: G, w: number, h: number, amount: number, rand: Rand, mono = true) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] = clamp255(d[i] + n);
    d[i + 1] = clamp255(d[i + 1] + (mono ? n : (rand() - 0.5) * amount));
    d[i + 2] = clamp255(d[i + 2] + (mono ? n : (rand() - 0.5) * amount));
  }
  g.putImageData(img, 0, 0);
}
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function blotch(g: G, x: number, y: number, r: number, color: string, alpha: number) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, withAlpha(color, alpha));
  grad.addColorStop(0.6, withAlpha(color, alpha * 0.5));
  grad.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function withAlpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function blotches(g: G, w: number, h: number, rand: Rand, n: number, rMin: number, rMax: number, color: string, aMin: number, aMax: number, yBias = 0) {
  for (let i = 0; i < n; i++) {
    const y = yBias ? h - Math.pow(rand(), 1 + yBias) * h : rand() * h;
    blotch(g, rand() * w, y, rMin + rand() * (rMax - rMin), color, aMin + rand() * (aMax - aMin));
  }
}

function crack(gs: G[], x: number, y: number, len: number, rand: Rand, styles: string[], width: number) {
  let a = rand() * Math.PI * 2;
  const pts: [number, number][] = [[x, y]];
  for (let i = 0; i < len; i++) {
    a += (rand() - 0.5) * 0.9;
    x += Math.cos(a) * 6;
    y += Math.sin(a) * 6;
    pts.push([x, y]);
    if (rand() < 0.06 && len > 6) crack(gs, x, y, Math.floor(len * 0.4), rand, styles, width * 0.7);
  }
  gs.forEach((g, k) => {
    g.strokeStyle = styles[k];
    g.lineWidth = width;
    g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    g.stroke();
  });
}

function streaks(g: G, w: number, rand: Rand, n: number, color: string, alpha: number, maxLen: number, fromY = 0) {
  for (let i = 0; i < n; i++) {
    const x = rand() * w;
    const width = 2 + rand() * 10;
    const len = 60 + rand() * maxLen;
    const grad = g.createLinearGradient(0, fromY, 0, fromY + len);
    grad.addColorStop(0, withAlpha(color, alpha * (0.5 + rand() * 0.5)));
    grad.addColorStop(1, withAlpha(color, 0));
    g.fillStyle = grad;
    g.fillRect(x, fromY, width, len);
  }
}

function irregular(g: G, cx: number, cy: number, r: number, rand: Rand) {
  g.beginPath();
  const n = 9 + Math.floor(rand() * 6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.55 + rand() * 0.6);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.8;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
}

export interface TexOpts { anisotropy: number; size: number }

function toTex(c: HTMLCanvasElement, opts: TexOpts, color = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = opts.anisotropy;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export interface TexSet { map: THREE.Texture; bump: THREE.Texture }

// ------------------------------------------------------------------------------------ walls

/** 2m x 3m wall face: off-white plaster over a green wainscot, bumper rail, stains, cracks. */
export function wallTexture(variant: number, o: TexOpts): TexSet {
  const W = 512 * o.size, H = 768 * o.size;
  const s = o.size;
  const rand = rng(101 + variant * 17);
  const { col, bump } = pair(W, H);
  const g = col.g, b = bump.g;
  const wainscot = H * (1 - 1.0 / 3);
  const railY = H * (1 - 0.95 / 3);

  g.fillStyle = '#a7a593';
  g.fillRect(0, 0, W, H);
  blotches(g, W, H, rand, 40, 40 * s, 200 * s, '#6d6650', 0.03, 0.1);
  blotches(g, W, H, rand, 20, 30 * s, 120 * s, '#c8c6b2', 0.05, 0.12);
  // Lower painted band
  g.fillStyle = '#4f5d52';
  g.fillRect(0, wainscot, W, H - wainscot);
  blotches(g, W, H - wainscot, rand, 25, 20 * s, 90 * s, '#2b3229', 0.05, 0.18);
  // Bumper rail
  g.fillStyle = '#34322c';
  g.fillRect(0, railY - 9 * s, W, 18 * s);
  g.fillStyle = 'rgba(200,190,170,0.18)';
  g.fillRect(0, railY - 9 * s, W, 2 * s);
  b.fillStyle = '#c8c8c8';
  b.fillRect(0, railY - 9 * s, W, 18 * s);
  b.fillStyle = '#9a9a9a';
  b.fillRect(0, wainscot - 2 * s, W, 3 * s);
  // Baseboard
  g.fillStyle = '#1f1d19';
  g.fillRect(0, H - 22 * s, W, 22 * s);
  b.fillStyle = '#b0b0b0';
  b.fillRect(0, H - 22 * s, W, 22 * s);
  // Water streaks from the ceiling and rust from the rail
  streaks(g, W, rand, 6 + variant * 3, '#5a4a30', 0.22, 420 * s);
  streaks(g, W, rand, 4, '#3b2a1a', 0.18, 120 * s, railY + 9 * s);
  // Grime toward the floor
  const grime = g.createLinearGradient(0, H * 0.72, 0, H);
  grime.addColorStop(0, 'rgba(25,20,14,0)');
  grime.addColorStop(1, 'rgba(25,20,14,0.5)');
  g.fillStyle = grime;
  g.fillRect(0, H * 0.72, W, H * 0.28);
  // Damp creeping up from the floor and down from the ceiling (soft, large-scale)
  const damp = g.createLinearGradient(0, 0, 0, H * 0.25);
  damp.addColorStop(0, 'rgba(60,52,36,0.28)');
  damp.addColorStop(1, 'rgba(60,52,36,0)');
  g.fillStyle = damp;
  g.fillRect(0, 0, W, H * 0.25);
  // Peeling paint: few, low-contrast flakes with a lit upper edge and a thin shadow
  for (let i = 0; i < 1 + variant; i++) {
    const cx = rand() * W, cy = (0.1 + rand() * 0.7) * wainscot, r = (10 + rand() * 26) * s;
    const shape = rng(i * 31 + variant * 7);
    g.save();
    g.translate(0, 2 * s);
    irregular(g, cx, cy, r, shape);
    g.fillStyle = 'rgba(40,34,24,0.22)';
    g.fill();
    g.restore();
    irregular(g, cx, cy, r, rng(i * 31 + variant * 7));
    g.fillStyle = 'rgba(178,172,150,0.55)';
    g.fill();
    irregular(b, cx, cy, r, rng(i * 31 + variant * 7));
    b.fillStyle = '#9a9a9a';
    b.fill();
  }
  // Scuffs from gurneys along the rail height
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = `rgba(30,26,20,${0.08 + rand() * 0.14})`;
    g.lineWidth = (1 + rand() * 2.5) * s;
    const x = rand() * W, y = railY + (rand() - 0.5) * 70 * s;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (20 + rand() * 90) * s, y + (rand() - 0.5) * 6 * s); g.stroke();
  }
  // Hairline cracks
  for (let i = 0; i < 2 + variant; i++)
    crack([g, b], rand() * W, rand() * H * 0.7, 8 + Math.floor(rand() * 14), rand, ['rgba(25,22,18,0.45)', '#4a4a4a'], 1.0 * s);
  // Dried smear on the darker variant
  if (variant === 2) {
    for (let i = 0; i < 5; i++) {
      g.fillStyle = `rgba(62,14,10,${0.25 + rand() * 0.2})`;
      g.beginPath();
      g.ellipse(180 * s + i * 34 * s, 470 * s + i * 6 * s, 26 * s, 9 * s, 0.1, 0, Math.PI * 2);
      g.fill();
    }
    streaks(g, W, rand, 3, '#3e0e0a', 0.35, 90 * s, 470 * s);
  }
  grain(g, W, H, 16, rand);
  grain(b, W, H, 22, rand);
  return { map: toTex(col.c, o), bump: toTex(bump.c, o, false) };
}

// ------------------------------------------------------------------------------------ floor

/** 4m x 4m of worn vinyl tiles (8 x 8). */
export function floorTexture(o: TexOpts): TexSet {
  const W = 1024 * o.size, H = W;
  const s = o.size;
  const rand = rng(7);
  const { col, bump } = pair(W, H);
  const g = col.g, b = bump.g;
  const n = 8, t = W / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const light = (x + y) % 2 === 0;
      const base = light ? [128, 125, 114] : [92, 92, 86];
      const v = (rand() - 0.5) * 14;
      g.fillStyle = `rgb(${base[0] + v},${base[1] + v},${base[2] + v * 0.8})`;
      g.fillRect(x * t, y * t, t, t);
      // per-tile wear
      for (let k = 0; k < 3; k++) blotch(g, x * t + rand() * t, y * t + rand() * t, (10 + rand() * 40) * s, '#3b352a', 0.08 + rand() * 0.1);
      if (rand() < 0.12) {
        // cracked / lifted tile
        crack([g, b], x * t + rand() * t, y * t + rand() * t, 6 + Math.floor(rand() * 8), rand, ['rgba(20,18,14,0.7)', '#404040'], 1.2 * s);
      }
    }
  // Grout
  g.strokeStyle = '#34312b';
  b.strokeStyle = '#3c3c3c';
  g.lineWidth = b.lineWidth = 3 * s;
  for (let i = 0; i <= n; i++) {
    for (const ctx of [g, b]) {
      ctx.beginPath(); ctx.moveTo(i * t, 0); ctx.lineTo(i * t, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * t); ctx.lineTo(W, i * t); ctx.stroke();
    }
  }
  // Dirt, water marks and scuffs
  blotches(g, W, H, rand, 30, 40 * s, 220 * s, '#2a241a', 0.06, 0.16);
  blotches(g, W, H, rand, 10, 20 * s, 70 * s, '#15120d', 0.15, 0.3);
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(20,18,15,${0.1 + rand() * 0.2})`;
    g.lineWidth = (1 + rand() * 3) * s;
    g.beginPath();
    const x = rand() * W, y = rand() * H, a = rand() * Math.PI;
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * 60 * s, y + Math.sin(a) * 30 * s, x + Math.cos(a + 0.4) * 140 * s, y + Math.sin(a + 0.4) * 80 * s);
    g.stroke();
  }
  grain(g, W, H, 14, rand);
  grain(b, W, H, 18, rand);
  const map = toTex(col.c, o, true, true);
  const bmp = toTex(bump.c, o, false, true);
  return { map, bump: bmp };
}

// ------------------------------------------------------------------------------------ ceiling

/** 2m x 2m of stained acoustic tiles in a T-bar grid; one tile in four sets is missing. */
export function ceilingTexture(o: TexOpts): TexSet {
  const W = 512 * o.size, H = W;
  const s = o.size;
  const rand = rng(23);
  const { col, bump } = pair(W, H);
  const g = col.g, b = bump.g;
  const n = 3, t = W / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const missing = x === 2 && y === 0;
      g.fillStyle = missing ? '#0c0b0a' : `rgb(${150 + rand() * 10},${147 + rand() * 10},${134 + rand() * 8})`;
      g.fillRect(x * t, y * t, t, t);
      if (missing) {
        // Exposed void: cables and duct shadow
        g.strokeStyle = 'rgba(60,55,45,0.8)';
        g.lineWidth = 3 * s;
        g.beginPath(); g.moveTo(x * t, y * t + t * 0.3); g.bezierCurveTo(x * t + t * 0.4, y * t + t * 0.9, x * t + t * 0.6, y * t + t * 0.1, x * t + t, y * t + t * 0.6); g.stroke();
        b.fillStyle = '#202020';
        b.fillRect(x * t, y * t, t, t);
        continue;
      }
      // Acoustic pinholes
      g.fillStyle = 'rgba(60,58,50,0.35)';
      for (let k = 0; k < 220; k++) g.fillRect(x * t + rand() * t, y * t + rand() * t, 1.5 * s, 1.5 * s);
    }
  // Water stain rings
  for (let i = 0; i < 4; i++) {
    const cx = rand() * W, cy = rand() * H, r = (30 + rand() * 80) * s;
    blotch(g, cx, cy, r, '#6b5232', 0.25);
    g.strokeStyle = 'rgba(90,64,34,0.35)';
    g.lineWidth = 3 * s;
    g.beginPath(); g.arc(cx, cy, r * 0.8, 0, Math.PI * 2); g.stroke();
  }
  blotches(g, W, H, rand, 12, 30 * s, 120 * s, '#2a2418', 0.05, 0.15);
  // T-bar grid
  g.fillStyle = '#6e6c64';
  b.fillStyle = '#c0c0c0';
  for (let i = 0; i <= n; i++) {
    for (const ctx of [g, b]) {
      ctx.fillRect(i * t - 4 * s, 0, 8 * s, H);
      ctx.fillRect(0, i * t - 4 * s, W, 8 * s);
    }
  }
  grain(g, W, H, 10, rand);
  return { map: toTex(col.c, o, true, true), bump: toTex(bump.c, o, false, true) };
}

// ------------------------------------------------------------------------------------ doors & metal

/** 1.2m x 2.3m painted steel door with wired glass vision panel and kick plate. */
export function doorTexture(o: TexOpts, tint = '#55635d'): TexSet {
  const W = 256 * o.size, H = 512 * o.size, s = o.size;
  const rand = rng(41);
  const { col, bump } = pair(W, H);
  const g = col.g, b = bump.g;
  g.fillStyle = tint;
  g.fillRect(0, 0, W, H);
  blotches(g, W, H, rand, 20, 10 * s, 60 * s, '#20251f', 0.08, 0.25);
  // Vision panel
  const wx = W * 0.3, wy = H * 0.14, ww = W * 0.4, wh = H * 0.24;
  g.fillStyle = '#0b0d0e';
  g.fillRect(wx, wy, ww, wh);
  g.strokeStyle = 'rgba(120,130,130,0.25)';
  g.lineWidth = 1 * s;
  for (let i = 0; i < ww; i += 10 * s) { g.beginPath(); g.moveTo(wx + i, wy); g.lineTo(wx + i, wy + wh); g.stroke(); }
  for (let i = 0; i < wh; i += 10 * s) { g.beginPath(); g.moveTo(wx, wy + i); g.lineTo(wx + ww, wy + i); g.stroke(); }
  g.strokeStyle = '#2a2d2b';
  g.lineWidth = 6 * s;
  g.strokeRect(wx, wy, ww, wh);
  b.fillStyle = '#5a5a5a';
  b.fillRect(wx, wy, ww, wh);
  // Inset panel lines
  b.strokeStyle = '#6a6a6a';
  b.lineWidth = 4 * s;
  b.strokeRect(W * 0.12, H * 0.48, W * 0.76, H * 0.36);
  g.strokeStyle = 'rgba(15,18,16,0.5)';
  g.lineWidth = 2 * s;
  g.strokeRect(W * 0.12, H * 0.48, W * 0.76, H * 0.36);
  // Kick plate
  g.fillStyle = '#6f6d66';
  g.fillRect(0, H * 0.9, W, H * 0.1);
  for (let i = 0; i < 30; i++) {
    g.strokeStyle = `rgba(30,28,25,${0.2 + rand() * 0.3})`;
    g.lineWidth = 1;
    const x = rand() * W, y = H * 0.9 + rand() * H * 0.1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 40 * s, y + (rand() - 0.5) * 6 * s); g.stroke();
  }
  b.fillStyle = '#a0a0a0';
  b.fillRect(0, H * 0.9, W, H * 0.1);
  // Scratches & grime
  for (let i = 0; i < 50; i++) {
    g.strokeStyle = `rgba(190,190,175,${0.05 + rand() * 0.12})`;
    g.lineWidth = 0.8 * s;
    const x = rand() * W, y = rand() * H;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 50 * s, y + (rand() - 0.5) * 50 * s); g.stroke();
  }
  const grime = g.createLinearGradient(0, H * 0.6, 0, H);
  grime.addColorStop(0, 'rgba(20,16,12,0)');
  grime.addColorStop(1, 'rgba(20,16,12,0.4)');
  g.fillStyle = grime;
  g.fillRect(0, H * 0.6, W, H * 0.4);
  grain(g, W, H, 14, rand);
  return { map: toTex(col.c, o), bump: toTex(bump.c, o, false) };
}

/** Painted sheet metal with vents (lockers, cabinets). */
export function lockerTexture(o: TexOpts): TexSet {
  const W = 256 * o.size, H = 512 * o.size, s = o.size;
  const rand = rng(59);
  const { col, bump } = pair(W, H);
  const g = col.g, b = bump.g;
  g.fillStyle = '#4a565a';
  g.fillRect(0, 0, W, H);
  blotches(g, W, H, rand, 16, 10 * s, 50 * s, '#1b2224', 0.1, 0.3);
  // Vent slats
  for (let i = 0; i < 6; i++) {
    const y = H * 0.06 + i * 14 * s;
    g.fillStyle = '#0d1012';
    g.fillRect(W * 0.25, y, W * 0.5, 6 * s);
    b.fillStyle = '#303030';
    b.fillRect(W * 0.25, y, W * 0.5, 6 * s);
    g.fillStyle = 'rgba(160,170,170,0.25)';
    g.fillRect(W * 0.25, y + 6 * s, W * 0.5, 1.5 * s);
  }
  for (let i = 0; i < 6; i++) {
    const y = H * 0.82 + i * 14 * s;
    g.fillStyle = '#0d1012';
    g.fillRect(W * 0.25, y, W * 0.5, 6 * s);
    b.fillStyle = '#303030';
    b.fillRect(W * 0.25, y, W * 0.5, 6 * s);
  }
  // Rust and dents
  blotches(g, W, H, rand, 10, 3 * s, 16 * s, '#6b3f1e', 0.3, 0.7);
  streaks(g, W, rand, 4, '#5a3216', 0.3, 160 * s, H * 0.2);
  for (let i = 0; i < 6; i++) blotch(b, rand() * W, rand() * H, (10 + rand() * 30) * s, '#404040', 0.6);
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(200,200,190,${0.06 + rand() * 0.12})`;
    g.lineWidth = 0.8 * s;
    const x = rand() * W, y = rand() * H;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 40 * s, y + (rand() - 0.5) * 20 * s); g.stroke();
  }
  grain(g, W, H, 14, rand);
  return { map: toTex(col.c, o), bump: toTex(bump.c, o, false) };
}

/** Corrugated roller-shutter steel. */
export function shutterTexture(o: TexOpts): TexSet {
  const W = 256 * o.size, H = 512 * o.size, s = o.size;
  const rand = rng(61);
  const { col, bump } = pair(W, H);
  const g = col.g, b = bump.g;
  g.fillStyle = '#5f625f';
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 16 * s) {
    const grad = g.createLinearGradient(0, y, 0, y + 16 * s);
    grad.addColorStop(0, 'rgba(255,255,255,0.12)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.05)');
    grad.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = grad;
    g.fillRect(0, y, W, 16 * s);
    const bg = b.createLinearGradient(0, y, 0, y + 16 * s);
    bg.addColorStop(0, '#d0d0d0');
    bg.addColorStop(1, '#303030');
    b.fillStyle = bg;
    b.fillRect(0, y, W, 16 * s);
  }
  blotches(g, W, H, rand, 20, 8 * s, 50 * s, '#6b3f1e', 0.15, 0.45);
  streaks(g, W, rand, 8, '#4a2a12', 0.3, 300 * s);
  // Hazard paint at the bottom bar
  for (let i = -2; i < 12; i++) {
    g.fillStyle = i % 2 ? '#9a7d16' : '#151412';
    g.beginPath();
    const x = i * 24 * s;
    g.moveTo(x, H); g.lineTo(x + 24 * s, H); g.lineTo(x + 44 * s, H - 20 * s); g.lineTo(x + 20 * s, H - 20 * s);
    g.fill();
  }
  grain(g, W, H, 12, rand);
  return { map: toTex(col.c, o), bump: toTex(bump.c, o, false) };
}

// ------------------------------------------------------------------------------------ soft & misc

export function fabricTexture(o: TexOpts, base: string, seed: number, stains = true): THREE.Texture {
  const W = 256 * o.size, H = W, s = o.size;
  const rand = rng(seed);
  const { g, c } = canvas(W, H);
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 30; i++) {
    g.strokeStyle = `rgba(0,0,0,${0.03 + rand() * 0.05})`;
    g.lineWidth = (2 + rand() * 6) * s;
    g.beginPath();
    const x = rand() * W, y = rand() * H;
    g.moveTo(x, y);
    g.bezierCurveTo(x + rand() * 60 * s, y + rand() * 20 * s, x + rand() * 80 * s, y - rand() * 20 * s, x + rand() * 140 * s, y + (rand() - 0.5) * 40 * s);
    g.stroke();
  }
  if (stains) {
    blotches(g, W, H, rand, 6, 10 * s, 50 * s, '#7a6230', 0.12, 0.3);
    blotches(g, W, H, rand, 2, 6 * s, 20 * s, '#4a120c', 0.2, 0.45);
  }
  grain(g, W, H, 10, rand);
  return toTex(c, o, true, true);
}

export function plainTexture(o: TexOpts, base: string, seed: number, grime = 0.15, grainAmt = 14): THREE.Texture {
  const W = 256 * o.size, H = W, s = o.size;
  const rand = rng(seed);
  const { g, c } = canvas(W, H);
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  blotches(g, W, H, rand, 14, 10 * s, 70 * s, '#15120d', grime * 0.3, grime);
  for (let i = 0; i < 25; i++) {
    g.strokeStyle = `rgba(210,205,190,${0.04 + rand() * 0.08})`;
    g.lineWidth = 0.8 * s;
    const x = rand() * W, y = rand() * H;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 30 * s, y + (rand() - 0.5) * 30 * s); g.stroke();
  }
  grain(g, W, H, grainAmt, rand);
  return toTex(c, o, true, true);
}

export function woodTexture(o: TexOpts): THREE.Texture {
  const W = 256 * o.size, H = W;
  const rand = rng(77);
  const { g, c } = canvas(W, H);
  g.fillStyle = '#5c4a39';
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 2) {
    g.fillStyle = `rgba(${30 + rand() * 30},${20 + rand() * 20},10,${0.08 + rand() * 0.1})`;
    g.fillRect(0, y + Math.sin(y * 0.05) * 3, W, 1 + rand() * 2);
  }
  blotches(g, W, H, rand, 10, 10, 60, '#1a120a', 0.08, 0.25);
  grain(g, W, H, 10, rand);
  return toTex(c, o, true, true);
}

export function cardboardTexture(o: TexOpts): THREE.Texture {
  const W = 256 * o.size, H = W;
  const rand = rng(83);
  const { g, c } = canvas(W, H);
  g.fillStyle = '#7a5f40';
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(200,180,140,0.25)';
  g.fillRect(0, H * 0.46, W, H * 0.08); // tape
  blotches(g, W, H, rand, 12, 10, 50, '#2b2014', 0.1, 0.3);
  g.fillStyle = 'rgba(20,15,10,0.6)';
  g.font = `bold ${22 * o.size}px monospace`;
  g.fillText('STERILE', W * 0.12, H * 0.3);
  g.font = `${14 * o.size}px monospace`;
  g.fillText('LOT 7741-B  //  KEEP DRY', W * 0.12, H * 0.78);
  grain(g, W, H, 14, rand);
  return toTex(c, o, true, true);
}

/** Grey, mottled, veined skin for the stalker. */
export function skinTexture(o: TexOpts): TexSet {
  const W = 512 * o.size, H = W, s = o.size;
  const rand = rng(666);
  const { col, bump } = pair(W, H);
  const g = col.g, b = bump.g;
  g.fillStyle = '#5d5853';
  g.fillRect(0, 0, W, H);
  blotches(g, W, H, rand, 70, 10 * s, 80 * s, '#2a2624', 0.12, 0.35);
  blotches(g, W, H, rand, 30, 10 * s, 50 * s, '#7a7468', 0.08, 0.18);
  blotches(g, W, H, rand, 20, 8 * s, 40 * s, '#3a1a1c', 0.15, 0.35);
  blotches(g, W, H, rand, 12, 6 * s, 30 * s, '#2b3326', 0.12, 0.3);
  // Raised veins
  for (let i = 0; i < 70; i++)
    crack([g, b], rand() * W, rand() * H, 8 + Math.floor(rand() * 20), rand, ['rgba(38,30,52,0.45)', '#c0c0c0'], 1.8 * s);
  // Sores
  for (let i = 0; i < 16; i++) {
    const x = rand() * W, y = rand() * H, r = (2 + rand() * 6) * s;
    blotch(g, x, y, r * 2.5, '#4a1612', 0.5);
    blotch(b, x, y, r * 2, '#303030', 0.8);
  }
  grain(g, W, H, 18, rand, false);
  grain(b, W, H, 40, rand);
  return { map: toTex(col.c, o, true, true), bump: toTex(bump.c, o, false, true) };
}

// ------------------------------------------------------------------------------------ decals

export function decalTexture(kind: 'stain' | 'blood' | 'paper' | 'drag' | 'debris', seed: number, o: TexOpts): THREE.Texture {
  const W = 256 * o.size, H = W, s = o.size;
  const rand = rng(seed);
  const { g, c } = canvas(W, H);
  g.clearRect(0, 0, W, H);
  if (kind === 'stain' || kind === 'blood') {
    const color = kind === 'blood' ? '#3a0a07' : '#1a150e';
    for (let i = 0; i < 14; i++) blotch(g, W / 2 + (rand() - 0.5) * W * 0.5, H / 2 + (rand() - 0.5) * H * 0.5, (20 + rand() * 60) * s, color, 0.25 + rand() * 0.3);
    if (kind === 'blood') for (let i = 0; i < 20; i++) blotch(g, rand() * W, rand() * H, (2 + rand() * 6) * s, color, 0.7);
  } else if (kind === 'drag') {
    for (let i = 0; i < 4; i++) {
      const grad = g.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, 'rgba(50,10,8,0.7)');
      grad.addColorStop(1, 'rgba(50,10,8,0)');
      g.fillStyle = grad;
      g.fillRect(0, H * 0.35 + i * 18 * s + rand() * 8 * s, W, (5 + rand() * 8) * s);
    }
  } else if (kind === 'paper') {
    for (let k = 0; k < 3; k++) {
      g.save();
      g.translate(W * (0.3 + rand() * 0.4), H * (0.3 + rand() * 0.4));
      g.rotate(rand() * Math.PI);
      g.fillStyle = `rgb(${190 + rand() * 30},${185 + rand() * 30},${170 + rand() * 20})`;
      g.fillRect(-45 * s, -60 * s, 90 * s, 120 * s);
      g.fillStyle = 'rgba(40,40,45,0.5)';
      for (let l = 0; l < 12; l++) g.fillRect(-36 * s, -50 * s + l * 9 * s, (40 + rand() * 30) * s, 2 * s);
      blotch(g, 0, 0, 40 * s, '#5a4520', 0.2);
      g.restore();
    }
  } else {
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${40 + rand() * 60},${38 + rand() * 50},${30 + rand() * 40},${0.6 + rand() * 0.4})`;
      g.beginPath();
      const x = W / 2 + (rand() - 0.5) * W * 0.8, y = H / 2 + (rand() - 0.5) * H * 0.8, r = (2 + rand() * 9) * s;
      g.moveTo(x, y - r); g.lineTo(x + r, y + r * 0.6); g.lineTo(x - r * 0.8, y + r * 0.4);
      g.fill();
    }
    blotches(g, W, H, rand, 8, 20 * s, 60 * s, '#a49d8a', 0.2, 0.35);
  }
  const t = toTex(c, o);
  return t;
}

export function signTexture(text: string, sub: string, o: TexOpts, style: 'plain' | 'red' | 'exit' = 'plain'): THREE.Texture {
  const W = 512, H = 128;
  const { g, c } = canvas(W, H);
  const rand = rng(text.length * 13);
  g.fillStyle = style === 'exit' ? '#1c0504' : style === 'red' ? '#5e1410' : '#cfcbbd';
  g.fillRect(0, 0, W, H);
  g.fillStyle = style === 'plain' ? '#1f2a2a' : '#e8ddd0';
  if (style === 'exit') g.fillStyle = '#ff5a40';
  g.font = `600 ${sub ? 52 : 64}px "Inter", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, W / 2, sub ? H * 0.4 : H / 2);
  if (sub) {
    g.font = `400 22px "Inter", Arial, sans-serif`;
    g.globalAlpha = 0.8;
    g.fillText(sub, W / 2, H * 0.78);
    g.globalAlpha = 1;
  }
  blotches(g, W, H, rand, 10, 10, 60, '#1a140c', 0.1, 0.3);
  grain(g, W, H, 12, rand);
  return toTex(c, o);
}

/** Tiling film grain for the CSS overlay. */
export function grainDataUrl(size = 160): string {
  const { g, c } = canvas(size, size);
  const img = g.createImageData(size, size);
  const rand = rng(99);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rand() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
