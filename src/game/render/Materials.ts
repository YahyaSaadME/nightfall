import * as THREE from 'three';
import {
  cardboardTexture, ceilingTexture, decalTexture, doorTexture, fabricTexture, floorTexture, lockerTexture,
  plainTexture, shutterTexture, skinTexture, wallTexture, woodTexture, type TexOpts,
} from './Textures';

/** Shared, reusable materials for the whole level (created once). */
export interface MaterialLibrary {
  walls: THREE.MeshStandardMaterial[];
  floor: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  door: THREE.MeshStandardMaterial;
  doorRestricted: THREE.MeshStandardMaterial;
  frame: THREE.MeshStandardMaterial;
  locker: THREE.MeshStandardMaterial;
  shutter: THREE.MeshStandardMaterial;
  paintedMetal: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  plastic: THREE.MeshStandardMaterial;
  seatPlastic: THREE.MeshStandardMaterial;
  mattress: THREE.MeshStandardMaterial;
  sheet: THREE.MeshStandardMaterial;
  curtain: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  laminate: THREE.MeshStandardMaterial;
  cardboard: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  ivBag: THREE.MeshStandardMaterial;
  screen: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  gown: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  claw: THREE.MeshStandardMaterial;
  mouth: THREE.MeshStandardMaterial;
  eye: THREE.MeshStandardMaterial;
  item: THREE.MeshStandardMaterial;
  battery: THREE.MeshStandardMaterial;
  batteryCap: THREE.MeshStandardMaterial;
  keycard: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  ceramic: THREE.MeshStandardMaterial;
  hazard: THREE.MeshStandardMaterial;
  decals: Record<'stain' | 'blood' | 'paper' | 'drag' | 'debris', THREE.MeshStandardMaterial[]>;
  exterior: THREE.MeshStandardMaterial;
}

export function createMaterials(opts: TexOpts): MaterialLibrary {
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  const walls = [0, 1, 2].map((v) => {
    const t = wallTexture(v, opts);
    return std({ map: t.map, bumpMap: t.bump, bumpScale: 1.6, roughness: 0.92, metalness: 0 });
  });
  const fl = floorTexture(opts);
  fl.map.repeat.set(1, 1);
  const ce = ceilingTexture(opts);
  const dr = doorTexture(opts);
  const drR = doorTexture(opts, '#5a3b34');
  const lk = lockerTexture(opts);
  const sh = shutterTexture(opts);
  const sk = skinTexture(opts);

  const decal = (kind: 'stain' | 'blood' | 'paper' | 'drag' | 'debris', seed: number) =>
    std({
      map: decalTexture(kind, seed, opts), transparent: true, depthWrite: false, roughness: kind === 'blood' ? 0.35 : 0.9,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });

  return {
    walls,
    floor: std({ map: fl.map, bumpMap: fl.bump, bumpScale: 1.2, roughness: 0.62, metalness: 0.0 }),
    ceiling: std({ map: ce.map, bumpMap: ce.bump, bumpScale: 1.5, roughness: 0.95 }),
    door: std({ map: dr.map, bumpMap: dr.bump, bumpScale: 1.5, roughness: 0.6, metalness: 0.35 }),
    doorRestricted: std({ map: drR.map, bumpMap: drR.bump, bumpScale: 1.5, roughness: 0.6, metalness: 0.35 }),
    frame: std({ map: plainTexture(opts, '#3c403b', 3, 0.3), roughness: 0.7, metalness: 0.3 }),
    locker: std({ map: lk.map, bumpMap: lk.bump, bumpScale: 1.4, roughness: 0.55, metalness: 0.45 }),
    shutter: std({ map: sh.map, bumpMap: sh.bump, bumpScale: 2, roughness: 0.55, metalness: 0.6 }),
    paintedMetal: std({ map: plainTexture(opts, '#7b7f78', 5, 0.25), roughness: 0.6, metalness: 0.3 }),
    darkMetal: std({ map: plainTexture(opts, '#2c2f2d', 6, 0.3), roughness: 0.5, metalness: 0.6 }),
    chrome: std({ color: 0x8a8d8c, roughness: 0.32, metalness: 0.9 }),
    rubber: std({ color: 0x151515, roughness: 0.9 }),
    plastic: std({ map: plainTexture(opts, '#b9b4a6', 9, 0.2, 8), roughness: 0.5 }),
    seatPlastic: std({ map: plainTexture(opts, '#3f5552', 10, 0.25, 10), roughness: 0.45 }),
    mattress: std({ map: fabricTexture(opts, '#55666c', 12, true), roughness: 0.55 }),
    sheet: std({ map: fabricTexture(opts, '#b7b2a3', 13, true), roughness: 0.95, side: THREE.DoubleSide }),
    curtain: std({ map: fabricTexture(opts, '#61756f', 14, true), roughness: 0.95, side: THREE.DoubleSide }),
    wood: std({ map: woodTexture(opts), roughness: 0.7 }),
    laminate: std({ map: plainTexture(opts, '#8d8676', 15, 0.25), roughness: 0.55 }),
    cardboard: std({ map: cardboardTexture(opts), roughness: 0.95 }),
    glass: std({ color: 0x1b2326, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.55 }),
    ivBag: std({ color: 0xc9d3c8, roughness: 0.2, transparent: true, opacity: 0.6 }),
    screen: std({ color: 0x0a0d0c, roughness: 0.15, metalness: 0.1, emissive: 0x050806 }),
    skin: std({ map: sk.map, bumpMap: sk.bump, bumpScale: 3, roughness: 0.36, metalness: 0.0, color: 0x8e8780 }),
    gown: std({ map: fabricTexture(opts, '#55574e', 21, true), roughness: 0.97, side: THREE.DoubleSide, color: 0xa8a49a }),
    hair: std({ color: 0x050505, roughness: 0.55, side: THREE.DoubleSide }),
    claw: std({ color: 0x1b1612, roughness: 0.3 }),
    mouth: std({ color: 0x050303, roughness: 1 }),
    eye: std({ color: 0x1a1612, emissive: 0x3a2214, emissiveIntensity: 0.6, roughness: 0.05 }),
    item: std({ color: 0xb8b2a2, roughness: 0.4, metalness: 0.2, emissive: 0x1a1712, emissiveIntensity: 0.4 }),
    battery: std({ color: 0x1d4a3a, roughness: 0.35, metalness: 0.4, emissive: 0x06120d, emissiveIntensity: 1 }),
    batteryCap: std({ color: 0xb8b8b0, roughness: 0.25, metalness: 0.9 }),
    keycard: std({ color: 0xd8d4c8, roughness: 0.35, emissive: 0x222018, emissiveIntensity: 0.5 }),
    brass: std({ color: 0xa88a48, roughness: 0.3, metalness: 0.95, emissive: 0x1c140a, emissiveIntensity: 0.6 }),
    ceramic: std({ color: 0xe3dccb, roughness: 0.3, emissive: 0x1c1912, emissiveIntensity: 0.5 }),
    hazard: std({ color: 0x8c7414, roughness: 0.6 }),
    decals: {
      stain: [decal('stain', 1), decal('stain', 2), decal('stain', 3)],
      blood: [decal('blood', 4), decal('blood', 5)],
      paper: [decal('paper', 6), decal('paper', 7)],
      drag: [decal('drag', 8)],
      debris: [decal('debris', 9), decal('debris', 10)],
    },
    exterior: std({ color: 0x0d1418, roughness: 1 }),
  };
}
