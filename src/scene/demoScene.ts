// [Coordinate conversion convention] Unity (left-handed, Y-up) -> three.js (right-handed, Y-up) **flips Z**:
//     position p_three = ( x,  y, -z)
//     direction d_three = (dx, dy, -dz)
//     rotation  q_three = (-qx, -qy, qz, qw)   (reflection conjugation M*R*M, where M=diag(1,1,-1))
//     scale     unchanged (diagonal, so reflection conjugation leaves it unchanged)
//   This reflection preserves screen coordinates (and maintains the right x up = -forward relation),
//   producing the same composition as Unity without a horizontal flip. Unity's built-in Cube/Capsule and the terrain
//   are symmetric under Z reflection, so their meshes do not need to be rebuilt.
//   Unity applies Euler angles in Z -> X -> Y order, so three.js uses Euler order 'YXZ' (verified).
import * as THREE from 'three/webgpu';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import {
  cameraPosition,
  cameraViewMatrix,
  mix,
  normalWorldGeometry,
  positionWorld,
  reflect,
  shadow,
  texture,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { publicAsset } from '../assets.ts';

export interface DemoSceneHandles {
  sun: THREE.DirectionalLight;
  /**
   * Sun intensity under Unity's convention (= scale for URP's _MainLightColor, always 1).
   * three's DirectionalLight.intensity is multiplied by pi to cancel the BRDF's 1/pi factor,
   * so pass this value to water shaders and other code that uses Unity's lightColor directly.
   */
  sunUnityIntensity: number;
  waterAnchor: THREE.Object3D;
  terrain: THREE.Mesh;
}

const DEG = Math.PI / 180;
const texLoader = new THREE.TextureLoader();

/** Calibrated Unity sky yaw 220 degrees maps to 140 degrees after the Z reflection. */
const SKY_YAW = 140;

const uPos = (x: number, y: number, z: number) => new THREE.Vector3(x, y, -z);

/** Unity Euler angles (degrees, Z -> X -> Y order) -> three quaternion, including Z reflection. */
function uRot(x: number, y: number, z: number): THREE.Quaternion {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, 'YXZ'));
  return new THREE.Quaternion(-q.x, -q.y, q.z, q.w);
}

/** Unity baseColorSRGB inputs require sRGB-to-linear conversion. */
const lin = (r: number, g: number, b: number) =>
  new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

function loadTex(url: string, srgb: boolean) {
  const t = texLoader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

const TERRAIN_N = 513;
const TERRAIN_SIZE = 100;
const TERRAIN_HEIGHT = 600;
const TERRAIN_Y0 = -20;

async function buildTerrain(): Promise<THREE.Mesh> {
  const buf = await fetch(publicAsset('terrain/heightmap-f32.bin')).then((r) => r.arrayBuffer());
  const h = new Float32Array(buf); // row-major [z][x], 0..1
  const n = TERRAIN_N;
  const step = TERRAIN_SIZE / (n - 1);

  const count = n * n;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const at = (x: number, z: number) =>
    TERRAIN_Y0 + h[Math.min(n - 1, Math.max(0, z)) * n + Math.min(n - 1, Math.max(0, x))] * TERRAIN_HEIGHT;

  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      pos[i * 3] = x * step;
      pos[i * 3 + 1] = at(x, z);
      pos[i * 3 + 2] = -(z * step);
      // Analytic normal from central differences: n_three = normalize(-dY/dx, 1, +dY/dzu).
      const gx = (at(x + 1, z) - at(x - 1, z)) / (2 * step);
      const gz = (at(x, z + 1) - at(x, z - 1)) / (2 * step);
      const l = Math.hypot(-gx, 1, gz);
      nrm[i * 3] = -gx / l;
      nrm[i * 3 + 1] = 1 / l;
      nrm[i * 3 + 2] = gz / l;
      // Splat-map UV (the bottom PNG row is zu 0, so v = zu/100).
      uvs[i * 2] = x / (n - 1);
      uvs[i * 2 + 1] = z / (n - 1);
    }
  }

  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let z = 0; z < n - 1; z++) {
    for (let x = 0; x < n - 1; x++) {
      const a = z * n + x;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // three uses counterclockwise front faces. Since z_three = -zu, (a,b,c)/(b,d,c) produces +Y normals.
      idx[k++] = a; idx[k++] = b; idx[k++] = c;
      idx[k++] = b; idx[k++] = d; idx[k++] = c;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();

  const splat = loadTex(publicAsset('terrain/splatmap.png'), false);
  splat.wrapS = splat.wrapT = THREE.ClampToEdgeWrapping;
  const grassCol = loadTex(publicAsset('textures/scene/grass_color.png'), true);
  const grassNrm = loadTex(publicAsset('textures/scene/grass_normal.png'), false);
  const sandCol = loadTex(publicAsset('textures/scene/sand_color.png'), true);
  const sandNrm = loadTex(publicAsset('textures/scene/sand_normal.png'), false);

  // Tile every 4 m. Base UVs on Unity coordinates (x, zu), where zu = -z_three, to match the pattern orientation.
  const tileUV = vec2(positionWorld.x, positionWorld.z.negate()).mul(1 / 4);

  const w = texture(splat, uv());
  const wGrass = w.r;
  const wSand = w.g;
  const t = wSand.div(wGrass.add(wSand).max(1e-4)).saturate();

  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  mat.colorNode = mix(texture(grassCol, tileUV).rgb, texture(sandCol, tileUV).rgb, t);

  // Normal maps (Sand strength 0.5). TBN aligned to UV axes u=+X and v=+zu (=-z_three).
  const nG = texture(grassNrm, tileUV).rgb.mul(2).sub(1);
  const nSraw = texture(sandNrm, tileUV).rgb.mul(2).sub(1);
  const nS = vec3(nSraw.xy.mul(0.5), nSraw.z);
  const nTS = mix(nG, nS, t);
  const N = normalWorldGeometry;
  const T = vec3(1, 0, 0).sub(N.mul(N.x)).normalize();
  const B = N.cross(T);
  const perturbed = T.mul(nTS.x).add(B.mul(nTS.y)).add(N.mul(nTS.z)).normalize();
  mat.normalNode = perturbed.transformDirection(cameraViewMatrix);

  // three defaults FrontSide materials to a BackSide shadow pass. Force FrontSide because the terrain
  // is an open heightfield whose light-facing triangles would otherwise be culled from the shadow map.
  mat.shadowSide = THREE.FrontSide;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'Terrain';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

type Obj = {
  mesh: 'cube' | 'capsule';
  mat: 'lit' | 'green';
  p: [number, number, number];
  r: [number, number, number];
  s: [number, number, number];
};

const STICK_ROT: [number, number, number] = [0, 277.621979, 0];
const STICK_SCALE: [number, number, number] = [0.03167608, 1.37641728, 0.05471424];
const STICKS: Array<[number, number, number]> = [
  [32.6878777, 18.67, 51.94483],
  [34.66772, 18.460001, 52.9951248],
  [32.5379257, 18.81, 51.60481],
  [34.5177727, 18.6, 52.6551056],
  [32.4178734, 18.81, 51.9747963],
  [34.3977165, 18.6, 53.02509],
  [32.27792, 18.77, 51.67477],
  [34.2577629, 18.56, 52.7250671],
];

const OBJECTS: Obj[] = [
  ...STICKS.map((p): Obj => ({ mesh: 'cube', mat: 'green', p, r: STICK_ROT, s: STICK_SCALE })),
  { mesh: 'cube', mat: 'lit', p: [77.13045, 20.43, 34.58143], r: [9.548727, 148.564835, 339.3728], s: [2.54325724, 17.0685616, 2.215063] },
  { mesh: 'cube', mat: 'lit', p: [45.71944, 19.17, 41.40677], r: [24.8310547, 290.2555, 36.9859238], s: [1.47452271, 9.89596748, 1.28424323] },
  { mesh: 'cube', mat: 'lit', p: [57.41822, 20.72, 49.6485023], r: [9.958808, 285.128021, 331.198669], s: [1.47452331, 9.89596748, 1.2842437] },
  { mesh: 'cube', mat: 'lit', p: [71.08635, 23.89, 62.2305336], r: [2.496965, 298.7411, 16.4190235], s: [2.686581, 18.03045, 2.33989167] },
  { mesh: 'cube', mat: 'lit', p: [45.5455437, 21.42, 67.65674], r: [2.496965, 298.7411, 16.4190235], s: [3.03691077, 5.73753262, 9.051191] },
  { mesh: 'capsule', mat: 'lit', p: [33.60752, 18.37, 54.33497], r: [49.20249, 240.228119, 167.293335], s: [1.2917, 1.29169989, 1.2917] },
  { mesh: 'capsule', mat: 'lit', p: [36.5570679, 19.19, 57.41541], r: [344.296234, 279.737732, 143.035919], s: [1.691352, 1.691352, 1.691352] },
];

const HUMANS: Array<{ p: [number, number, number]; yaw: number }> = [
  { p: [59.75662, 20.065918, 45.70787], yaw: 255.141235 },
  { p: [37.34, 19.8828259, 46.6], yaw: 251.689209 },
];

// three's pi-scaled directional light also scales specular, so roughness 0.8 compensates for the
// difference from Unity Smoothness 0.5.
const PROP_ROUGHNESS = 0.8;

// URP indirect specular "grazingTerm" component (BRDF.hlsl EnvironmentBRDFSpecular).
//   surfaceReduction * lerp(specular, grazingTerm, Pow4(1 - NoV))
//     surfaceReduction = 1/(roughness² + 1)          roughness = (1-Smoothness)² = 0.25 → 0.94118
//     specular         = kDielectricSpec.rgb = 0.04
//     grazingTerm      = saturate(Smoothness + reflectivity) = 0.5 + 0.04 = 0.54
// three already provides F0, so add only (grazingTerm - specular) as emissive.
const GRAZING_GAIN = (1 / (0.25 * 0.25 + 1)) * (0.54 - 0.04); // = 0.47059

// Unity's blurred baked probe reflects terrain below the horizon, not the panorama's ocean. Approximate
// it with measured upper- and lower-hemisphere averages.
const PROBE_SKY: [number, number, number] = [0.4236, 0.3927, 0.4317];
const PROBE_GROUND: [number, number, number] = [0.66, 0.4, 0.15];

function urpGrazingSpecular() {
  const N = normalWorldGeometry;
  const I = positionWorld.sub(cameraPosition).normalize(); // Camera -> surface.
  const noV = N.dot(I.negate()).saturate();
  const R: any = reflect(I, N);
  const probe = mix(vec3(...PROBE_GROUND), vec3(...PROBE_SKY), R.y.smoothstep(-0.2, 0.2));
  return probe.mul(noV.oneMinus().pow(4)).mul(GRAZING_GAIN);
}

function urpLit(color: THREE.Color) {
  const mat = new THREE.MeshStandardNodeMaterial({ color, roughness: PROP_ROUGHNESS, metalness: 0 });
  // Indirect specular is unaffected by shadows, so adding it as emissive matches URP's ordering.
  mat.emissiveNode = urpGrazingSpecular();
  return mat;
}

function buildProps(scene: THREE.Scene) {
  const litMat = urpLit(lin(0.5, 0.5, 0.5));
  const greenMat = urpLit(lin(0.272524148, 0.5943396, 0.06448023));
  const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
  const capsuleGeo = new THREE.CapsuleGeometry(0.5, 1, 8, 24); // Unity Capsule: r=0.5, total height 2.

  for (const o of OBJECTS) {
    const m = new THREE.Mesh(o.mesh === 'cube' ? cubeGeo : capsuleGeo, o.mat === 'lit' ? litMat : greenMat);
    m.position.copy(uPos(o.p[0], o.p[1], o.p[2]));
    m.quaternion.copy(uRot(o.r[0], o.r[1], o.r[2]));
    m.scale.set(o.s[0], o.s[1], o.s[2]);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }
}

async function buildHumans(scene: THREE.Scene) {
  const humanMat = urpLit(lin(0.9433962, 0.387595862, 0.307048738));
  let geo: THREE.BufferGeometry | null = null;
  try {
    const root = await new FBXLoader().loadAsync(publicAsset('models/human.fbx'));
    root.traverse((o) => {
      if (!geo && (o as THREE.Mesh).isMesh) geo = (o as THREE.Mesh).geometry;
    });
  } catch (e) {
    console.warn('[demoScene] Failed to load human.fbx; using a capsule instead', e);
  }
  if (geo) {
    const g = (geo as THREE.BufferGeometry).clone();
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    // Normalize to a height of 1.76 m with a foot-level pivot regardless of FBX units.
    const s = 1.76 / Math.max(1e-6, bb.max.y - bb.min.y);
    g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    g.scale(s, s, s);
    g.computeVertexNormals();
    geo = g;
  } else {
    geo = new THREE.CapsuleGeometry(0.3, 1.16, 6, 12).translate(0, 0.88, 0);
  }
  for (const hm of HUMANS) {
    const m = new THREE.Mesh(geo as THREE.BufferGeometry, humanMat);
    m.position.copy(uPos(hm.p[0], hm.p[1], hm.p[2]));
    m.quaternion.copy(uRot(0, hm.yaw, 0));
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }
}

export async function buildDemoScene(scene: THREE.Scene): Promise<DemoSceneHandles> {
  // Unity render calibration gives 1.21 for both sky and environment intensity.
  const skyTex = texLoader.load(publicAsset('textures/scene/sky_22_2k.png'));
  skyTex.mapping = THREE.EquirectangularReflectionMapping;
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.environment = skyTex;
  scene.backgroundIntensity = 1.21;
  scene.environmentIntensity = 1.21;
  scene.backgroundRotation = new THREE.Euler(0, SKY_YAW * DEG, 0);
  scene.environmentRotation = new THREE.Euler(0, SKY_YAW * DEG, 0);

  // Match Unity's ExpSquared density and linear fog color.
  scene.fog = new THREE.FogExp2(
    new THREE.Color().setRGB(0.132282749, 0.463456184, 0.500747442, THREE.LinearSRGBColorSpace),
    0.01,
  );

  // Unity URP uses diffuse = albedo * NdotL * lightColor, while three.js uses albedo/pi * NdotL * color*intensity,
  // so multiply three's intensity by pi.
  const sun = new THREE.DirectionalLight();
  sun.color.setRGB(1, 0.77996707, 0.619521, THREE.LinearSRGBColorSpace);
  sun.intensity = Math.PI;
  const sunDir = new THREE.Vector3(-0.8471251, -0.442774355, 0.2938195).normalize(); // Travel direction (three).
  sun.target.position.set(50, 20, -45);
  sun.position.copy(sun.target.position).addScaledVector(sunDir, -150);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -85;
  sun.shadow.camera.right = sun.shadow.camera.top = 85;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 320;
  sun.shadow.bias = -0.000001;
  sun.shadow.normalBias = 0.08;
  // Sharing one ShadowNode lets NodeFrame deduplicate redraws by renderId.
  (sun.shadow as any).shadowNode = shadow(sun);
  sun.shadow.autoUpdate = false; // The scene is static; bake only once at startup.
  sun.shadow.needsUpdate = true;
  scene.add(sun);
  scene.add(sun.target);

  const terrain = await buildTerrain();
  scene.add(terrain);
  buildProps(scene);
  await buildHumans(scene);

  const waterAnchor = new THREE.Object3D();
  waterAnchor.position.copy(uPos(52.12, 19.5899944, 45.4699974));
  waterAnchor.name = 'WaterAnchor';
  scene.add(waterAnchor);

  return { sun, sunUnityIntensity: 1, waterAnchor, terrain };
}
