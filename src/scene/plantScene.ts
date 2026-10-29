import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { publicAsset } from '../assets.ts';
import type { ReflectionSetup } from '../water/nodes/types';

export const PLANT_MODEL_URL = publicAsset('models/清水池_3.glb');
export const WATER_GROUP_NAME = 'water_group';
/** Reflector and probe cameras only see layer 0, so labels on this layer stay out of the water. */
export const LABEL_LAYER = 1;
/** Reflector cameras stay on layer 0, so one pool's water is not drawn into another's reflection. */
export const WATER_LAYER = 2;

export interface PoolDef {
  name: string;
  preset: string;
  /** World offset of the model root. */
  offset: [number, number, number];
  /** Initial Flow_Direction [deg]; 0° runs along world +X, which is the model's channel axis. */
  flowDirection: number;
}

export const PLANT_POOLS: PoolDef[] = [
  { name: '污水池', preset: '污水·进水渠', offset: [0, 0, -14.5], flowDirection: 0 },
  { name: '清水池', preset: '给水·清水池', offset: [0, 0, 14.5], flowDirection: 0 },
];

export interface PoolHandle {
  def: PoolDef;
  root: THREE.Object3D;
  waterMeshes: THREE.Mesh[];
  reflection: ReflectionSetup;
}

export interface PlantSceneHandles {
  sun: THREE.DirectionalLight;
  sunUnityIntensity: number;
  pools: PoolHandle[];
}

/** Target vertex spacing for Gerstner displacement on the GLB water planes [m]. */
const WATER_SEGMENT = 0.25;
const MAX_SEGMENTS = 256;

/** Every mesh below `water_group`, at any depth. */
export function collectWaterMeshes(root: THREE.Object3D, groupName = WATER_GROUP_NAME): THREE.Mesh[] {
  const group = root.getObjectByName(groupName);
  if (!group) return [];
  const meshes: THREE.Mesh[] = [];
  group.traverse((o) => {
    if (o !== group && (o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  return meshes;
}

/** Flat GLB water quads have only four vertices; rebuild them as a dense grid with the same footprint. */
function densifyFlatGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  if (size.y > 1e-3 || size.x <= 0 || size.z <= 0) return geo;
  const center = bb.getCenter(new THREE.Vector3());
  const segX = Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(size.x / WATER_SEGMENT)));
  const segZ = Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(size.z / WATER_SEGMENT)));
  const plane = new THREE.PlaneGeometry(size.x, size.z, segX, segZ);
  plane.rotateX(-Math.PI / 2);
  plane.translate(center.x, center.y, center.z);
  return plane;
}

function prepareWaterMesh(mesh: THREE.Mesh) {
  // The source geometry may be shared with other clones of the model, so it is replaced, not disposed.
  mesh.geometry = densifyFlatGeometry(mesh.geometry);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 1;
  mesh.layers.set(WATER_LAYER);
}

/** Farthest wall distance stored [m]; wall foam never reaches further, so beyond this is "open water". */
const WALL_DISTANCE_MAX = 8;

/**
 * Bake each water vertex's horizontal distance to the nearest wall into a `wallDist` attribute.
 * Walls are the structure triangles cut by the water plane, so partition walls inside one water
 * rectangle count too. The shader uses it for a view-independent foam collar along the walls.
 */
function bakeWallDistance(water: THREE.Mesh, structures: THREE.Mesh[]) {
  water.updateMatrixWorld(true);
  const pos = water.geometry.getAttribute('position');
  const v = new THREE.Vector3();
  const waterY = v.fromBufferAttribute(pos, 0).applyMatrix4(water.matrixWorld).y;

  // Wall outlines at water level as 2D segments (x0, z0, x1, z1).
  const segs: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cut: number[] = [];
  const edge = (p: THREE.Vector3, q: THREE.Vector3) => {
    const dp = p.y - waterY;
    const dq = q.y - waterY;
    if ((dp < 0) === (dq < 0)) return;
    const t = dp / (dp - dq);
    cut.push(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t);
  };
  for (const s of structures) {
    s.updateMatrixWorld(true);
    const sp = s.geometry.getAttribute('position');
    const index = s.geometry.getIndex();
    const triCount = (index ? index.count : sp.count) / 3;
    for (let i = 0; i < triCount; i++) {
      const i0 = index ? index.getX(i * 3) : i * 3;
      const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
      const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;
      a.fromBufferAttribute(sp, i0).applyMatrix4(s.matrixWorld);
      b.fromBufferAttribute(sp, i1).applyMatrix4(s.matrixWorld);
      c.fromBufferAttribute(sp, i2).applyMatrix4(s.matrixWorld);
      cut.length = 0;
      edge(a, b);
      edge(b, c);
      edge(c, a);
      if (cut.length >= 4) segs.push(cut[0], cut[1], cut[2], cut[3]);
    }
  }

  const dist = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(water.matrixWorld);
    let best = WALL_DISTANCE_MAX * WALL_DISTANCE_MAX;
    for (let k = 0; k < segs.length; k += 4) {
      const ex = segs[k + 2] - segs[k];
      const ez = segs[k + 3] - segs[k + 1];
      const len2 = ex * ex + ez * ez;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((v.x - segs[k]) * ex + (v.z - segs[k + 1]) * ez) / len2)) : 0;
      const dx = v.x - (segs[k] + ex * t);
      const dz = v.z - (segs[k + 1] + ez * t);
      best = Math.min(best, dx * dx + dz * dz);
    }
    dist[i] = Math.sqrt(best);
  }
  water.geometry.setAttribute('wallDist', new THREE.BufferAttribute(dist, 1));}

/** Concrete tank walls: the GLB ships metallic 0.3, which reads as painted steel under the sky probe. */
function prepareStructureMesh(mesh: THREE.Mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats as THREE.MeshStandardMaterial[]) {
    if (!m.isMeshStandardMaterial) continue;
    m.metalness = 0;
    m.roughness = 0.9;
    m.color.copy(CONCRETE_TINT);
    m.shadowSide = THREE.FrontSide;
  }
}

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.fillStyle = 'rgba(16, 24, 32, 0.72)';
  g.beginPath();
  g.roundRect(8, 8, 496, 112, 24);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = 'bold 64px "Microsoft YaHei", "PingFang SC", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, fog: false }));
  sprite.scale.set(6, 1.5, 1);
  sprite.layers.set(LABEL_LAYER);
  // Water is transparent with depthWrite off; draw the label after it so it is not overpainted.
  sprite.renderOrder = 10;
  return sprite;
}

function buildGround(scene: THREE.Scene, texLoader: THREE.TextureLoader) {
  const grass = texLoader.load(publicAsset('textures/scene/grass_color.png'));
  grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
  grass.colorSpace = THREE.SRGBColorSpace;
  grass.repeat.set(400, 400);
  grass.anisotropy = 8;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: grass, roughness: 1, metalness: 0 }),
  );
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(56, 70).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.55, 0.55, 0.53, THREE.SRGBColorSpace), roughness: 0.95, metalness: 0 }),
  );
  apron.position.y = -0.01;
  apron.receiveShadow = true;
  scene.add(apron);
}

/** Physical sky output is HDR; the plant scene is tone mapped with ACES at this exposure. */
export const PLANT_TONE_MAPPING_EXPOSURE = 0.55;
/** Preetham radiance at a ~38° sun saturates ACES; scale it to the sun's diffuse range. */
const SKY_GAIN = 0.22;
const SKY_MAX = 2000;
/** GLB wall texture is near-white; real cast concrete albedo is ~0.35-0.5. */
const CONCRETE_TINT = new THREE.Color().setRGB(0.62, 0.62, 0.6, THREE.SRGBColorSpace);

/** Preetham sky as background; its PMREM bake drives the walls' ambient light and the water's probe fallback. */
function buildSky(scene: THREE.Scene, renderer: THREE.WebGLRenderer, sunDir: THREE.Vector3) {
  const sky = new Sky();
  sky.name = 'Sky';
  sky.scale.setScalar(900);
  const skyMat = sky.material as THREE.ShaderMaterial;
  skyMat.uniforms.turbidity.value = 4;
  skyMat.uniforms.rayleigh.value = 1.2;
  skyMat.uniforms.mieCoefficient.value = 0.004;
  skyMat.uniforms.mieDirectionalG.value = 0.85;
  skyMat.uniforms.cloudCoverage.value = 0.35;
  skyMat.uniforms.cloudDensity.value = 0.5;
  skyMat.uniforms.sunPosition.value.copy(sunDir).negate();
  // The sun disc reaches ~1e7, which overflows half-float targets. Clamp before tone mapping.
  skyMat.fragmentShader = skyMat.fragmentShader.replace(
    'gl_FragColor = vec4( texColor, 1.0 );',
    `gl_FragColor = vec4( min( texColor * ${SKY_GAIN}, vec3( ${SKY_MAX}.0 ) ), 1.0 );`,
  );
  skyMat.fog = false;
  sky.frustumCulled = false;
  scene.add(sky);

  // Bake before anything else is added so the environment contains only the sky.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(scene, 0.04, 0.1, 1000).texture;
  scene.environmentIntensity = 1;
  pmrem.dispose();
}

export async function buildPlantScene(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
): Promise<PlantSceneHandles> {
  const texLoader = new THREE.TextureLoader();
  const sunDir = new THREE.Vector3(0.55, -0.62, -0.56).normalize();
  buildSky(scene, renderer, sunDir);
  scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(0.55, 0.64, 0.74, THREE.SRGBColorSpace), 0.0012);

  const sun = new THREE.DirectionalLight();
  sun.color.setRGB(1, 0.95, 0.88, THREE.LinearSRGBColorSpace);
  sun.intensity = Math.PI * 1.6;
  sun.target.position.set(0, 0, 0);
  sun.position.copy(sun.target.position).addScaledVector(sunDir, -120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -55;
  sun.shadow.camera.right = sun.shadow.camera.top = 55;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.05;
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  scene.add(sun);
  scene.add(sun.target);

  buildGround(scene, texLoader);

  const gltf = await new GLTFLoader().loadAsync(PLANT_MODEL_URL);
  const roots = PLANT_POOLS.map((_, i) => (i === 0 ? gltf.scene : gltf.scene.clone(true)));
  const pools: PoolHandle[] = PLANT_POOLS.map((def, i) => {
    const root = roots[i];
    root.position.set(...def.offset);
    root.name = def.name;
    scene.add(root);
    root.updateMatrixWorld(true);

    const waterMeshes = collectWaterMeshes(root);
    if (waterMeshes.length === 0) console.warn(`[plantScene] "${WATER_GROUP_NAME}" has no meshes in ${def.name}`);
    const waterSet = new Set<THREE.Object3D>(waterMeshes);
    const structures: THREE.Mesh[] = [];
    root.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      if (waterSet.has(o)) prepareWaterMesh(o as THREE.Mesh);
      else {
        prepareStructureMesh(o as THREE.Mesh);
        structures.push(o as THREE.Mesh);
      }
    });
    for (const mesh of waterMeshes) bakeWallDistance(mesh, structures);

    const box = new THREE.Box3().setFromObject(root);
    const c = box.getCenter(new THREE.Vector3());
    const label = makeLabel(def.name);
    label.position.set(c.x, box.max.y + 4, c.z);
    scene.add(label);

    // Camera stays inside the huge volume so the planar reflection is always used; the probe is the fallback.
    const reflection: ReflectionSetup = {
      volumeCenter: [c.x, c.y, c.z],
      volumeHalf: [500, 500, 500],
      probePosition: [c.x, box.max.y + 2, c.z],
      boxMin: [c.x - 120, -1, c.z - 120],
      boxMax: [c.x + 120, 80, c.z + 120],
      // Close-up wall reflections stair-step visibly at the demo's 0.3.
      resolutionScale: 0.5,
    };
    return { def, root, waterMeshes, reflection };
  });

  return { sun, sunUnityIntensity: 1.6, pools };
}
