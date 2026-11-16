import * as THREE from 'three';

/**
 * Airborne dust that is only visible inside the flashlight cone. Particles live in a
 * box that wraps around the camera, so the count stays small.
 */
export class Dust {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly size = 7;

  constructor(count: number) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * this.size;
      pos[i * 3 + 1] = Math.random() * 3;
      pos[i * 3 + 2] = (Math.random() - 0.5) * this.size;
      seed[i] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uLightPos: { value: new THREE.Vector3() },
        uLightDir: { value: new THREE.Vector3(0, 0, -1) },
        uLight: { value: 1 },
        uBox: { value: this.size },
        uPixel: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform float uTime; uniform vec3 uCenter; uniform float uBox; uniform float uPixel;
        uniform vec3 uLightPos; uniform vec3 uLightDir; uniform float uLight;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.13 + seed * 40.0) * 0.4;
          p.z += cos(uTime * 0.11 + seed * 31.0) * 0.4;
          p.y = mod(p.y - uTime * (0.02 + seed * 0.03), 3.0);
          // Wrap the box around the camera.
          vec3 rel = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
          vec3 world = uCenter + rel;
          world.y = p.y;
          vec3 toP = world - uLightPos;
          float d = length(toP);
          float cone = smoothstep(0.86, 0.97, dot(toP / max(d, 0.001), uLightDir));
          float fall = smoothstep(7.0, 0.6, d);
          vAlpha = cone * fall * uLight * (0.35 + seed * 0.65);
          vec4 mv = viewMatrix * vec4(world, 1.0);
          gl_PointSize = uPixel * (0.45 + seed * 0.9) * (5.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(c));
          gl_FragColor = vec4(vec3(1.0, 0.95, 0.85), a * vAlpha * 0.55);
        }`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.userData.dynamic = true;
  }

  update(dt: number, camera: THREE.Camera, lightPos: THREE.Vector3, lightDir: THREE.Vector3, lightLevel: number, pixelRatio: number) {
    const u = this.material.uniforms;
    u.uTime.value += dt;
    u.uCenter.value.copy(camera.position);
    u.uLightPos.value.copy(lightPos);
    u.uLightDir.value.copy(lightDir);
    u.uLight.value = lightLevel;
    u.uPixel.value = pixelRatio;
  }
}
