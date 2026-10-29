import * as THREE from 'three';
import type { ReflectionSetup, WaterCtx } from './nodes/types';
import type { TextureSlot } from './uniforms';
import { DEFAULT_TEXTURES, TEXTURE_SLOTS } from './uniforms';
import { waterFragmentShader, waterVertexShader } from './waterShader';

const loader = new THREE.TextureLoader();

const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
placeholder.needsUpdate = true;

const sceneColor = { value: placeholder as THREE.Texture };
const sceneDepth = { value: placeholder as THREE.Texture };
const shared = {
  near: { value: 0.3 },
  far: { value: 1000 },
  resolution: { value: new THREE.Vector2(1, 1) },
};

let grab: THREE.WebGLRenderTarget | null = null;
const _size = new THREE.Vector2();

/** Hide the water, draw the opaque scene into a linear color+depth target, then restore visibility. */
export function renderOpaqueGrab(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  hidden: THREE.Object3D[],
) {
  renderer.getDrawingBufferSize(_size);
  const w = Math.max(1, _size.x);
  const h = Math.max(1, _size.y);
  shared.resolution.value.set(w, h);
  if ('near' in camera && 'far' in camera) {
    shared.near.value = (camera as THREE.PerspectiveCamera).near;
    shared.far.value = (camera as THREE.PerspectiveCamera).far;
  }
  if (!grab || grab.width !== w || grab.height !== h) {
    grab?.dispose();
    const depth = new THREE.DepthTexture(w, h);
    grab = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: depth });
    grab.texture.colorSpace = THREE.LinearSRGBColorSpace;
    grab.texture.generateMipmaps = false;
    grab.texture.minFilter = THREE.LinearFilter;
    grab.texture.magFilter = THREE.LinearFilter;
    grab.texture.wrapS = grab.texture.wrapT = THREE.ClampToEdgeWrapping;
    sceneColor.value = grab.texture;
    sceneDepth.value = grab.depthTexture as THREE.Texture;
  }

  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  const vis = hidden.map((o) => o.visible);
  for (const o of hidden) o.visible = false;
  renderer.autoClear = true;
  renderer.setRenderTarget(grab);
  renderer.clear();
  renderer.render(scene, camera);
  for (let i = 0; i < hidden.length; i++) hidden[i].visible = vis[i];
  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;
}

export function createTextureRegistry() {
  const slots = new Map<TextureSlot, { value: THREE.Texture }>();
  const load = (url: string) => {
    const t = loader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 16;
    return t;
  };
  const get = (slot: TextureSlot) => {
    let entry = slots.get(slot);
    if (!entry) {
      entry = { value: load(DEFAULT_TEXTURES[slot]) };
      slots.set(slot, entry);
    }
    return entry;
  };
  const set = (slot: TextureSlot, url: string) => {
    get(slot).value = load(url);
  };
  return { get, set };
}

/** Demo scene volume, used when a body does not pass its own reflection setup. */
const DEMO_REFLECTION: ReflectionSetup = {
  volumeCenter: [56.6, 20.4, -50.1],
  volumeHalf: [41.4, 14.05, 30.7],
  probePosition: [39.678116, 20.23, -49.844906],
  boxMin: [-4.8711, 15.6098, -105.1152],
  boxMax: [106.3541, 52.2922, -1.364],
  resolutionScale: 0.3,
};
const BLEND_DISTANCE = 1.48;

function volumeBlend(camera: THREE.Camera, setup: ReflectionSetup) {
  const p = camera.position;
  const c = setup.volumeCenter;
  const h = setup.volumeHalf;
  const outside = Math.max(
    Math.abs(p.x - c[0]) - h[0],
    Math.abs(p.y - c[1]) - h[1],
    Math.abs(p.z - c[2]) - h[2],
    0,
  );
  return Math.min(1, outside / BLEND_DISTANCE);
}

const _mirrorWorld = new THREE.Vector3();
const _cameraWorld = new THREE.Vector3();
const _rotation = new THREE.Matrix4();
const _normal = new THREE.Vector3();
const _view = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _target = new THREE.Vector3();
const _mirrorPlane = new THREE.Plane();
const _clipPlane = new THREE.Vector4();
const _q = new THREE.Vector4();
let renderingMirror = false;

function ensureWallDist(mesh: THREE.Mesh) {
  const geo = mesh.geometry;
  if (geo.getAttribute('wallDist')) return;
  const pos = geo.getAttribute('position');
  geo.setAttribute('wallDist', new THREE.BufferAttribute(new Float32Array(pos.count).fill(1e3), 1));
}

function attachPlanarReflection(
  mesh: THREE.Mesh,
  material: THREE.ShaderMaterial,
  setup: ReflectionSetup,
) {
  const mirrorCamera = new THREE.PerspectiveCamera();
  mirrorCamera.layers.set(0);
  const textureMatrix = material.uniforms.textureMatrix.value as THREE.Matrix4;
  const planarWeight = material.uniforms.planarWeight;
  let rt: THREE.WebGLRenderTarget | null = null;

  const ensureTarget = (renderer: THREE.WebGLRenderer) => {
    renderer.getDrawingBufferSize(_size);
    const scale = setup.resolutionScale ?? 0.3;
    const w = Math.max(1, Math.floor(_size.x * scale));
    const h = Math.max(1, Math.floor(_size.y * scale));
    if (rt && rt.width === w && rt.height === h) return rt;
    rt?.dispose();
    rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    rt.texture.generateMipmaps = false;
    rt.texture.minFilter = THREE.LinearFilter;
    rt.texture.magFilter = THREE.LinearFilter;
    rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    material.uniforms.tReflect.value = rt.texture;
    return rt;
  };

  mesh.onBeforeRender = (renderer, scene, camera) => {
    const webgl = renderer as THREE.WebGLRenderer;
    planarWeight.value = (1 - volumeBlend(camera, setup)) * (material.uniforms.ENABLEPLANERREFLECTION.value as number);
    if (renderingMirror || planarWeight.value <= 0) return;

    const target = ensureTarget(webgl);
    _mirrorWorld.setFromMatrixPosition(mesh.matrixWorld);
    _cameraWorld.setFromMatrixPosition(camera.matrixWorld);
    _rotation.extractRotation(mesh.matrixWorld);
    _normal.set(0, 1, 0).applyMatrix4(_rotation);
    _view.subVectors(_mirrorWorld, _cameraWorld);
    if (_view.dot(_normal) > 0) return;

    _view.reflect(_normal).negate().add(_mirrorWorld);
    _rotation.extractRotation(camera.matrixWorld);
    _lookAt.set(0, 0, -1).applyMatrix4(_rotation).add(_cameraWorld);
    _target.subVectors(_mirrorWorld, _lookAt).reflect(_normal).negate().add(_mirrorWorld);

    mirrorCamera.position.copy(_view);
    mirrorCamera.up.set(0, 1, 0).applyMatrix4(_rotation).reflect(_normal);
    mirrorCamera.lookAt(_target);
    mirrorCamera.far = (camera as THREE.PerspectiveCamera).far;
    mirrorCamera.updateMatrixWorld();
    mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);

    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(mirrorCamera.projectionMatrix);
    textureMatrix.multiply(mirrorCamera.matrixWorldInverse);

    _mirrorPlane.setFromNormalAndCoplanarPoint(_normal, _mirrorWorld);
    _mirrorPlane.applyMatrix4(mirrorCamera.matrixWorldInverse);
    _clipPlane.set(_mirrorPlane.normal.x, _mirrorPlane.normal.y, _mirrorPlane.normal.z, _mirrorPlane.constant);
    const proj = mirrorCamera.projectionMatrix;
    const e = proj.elements;
    _q.set((Math.sign(_clipPlane.x) + e[8]) / e[0], (Math.sign(_clipPlane.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    _clipPlane.multiplyScalar(2 / _clipPlane.dot(_q));
    e[2] = _clipPlane.x;
    e[6] = _clipPlane.y;
    e[10] = _clipPlane.z + 1;
    e[14] = _clipPlane.w;

    const prevTarget = webgl.getRenderTarget();
    const prevXr = webgl.xr.enabled;
    const prevShadow = webgl.shadowMap.autoUpdate;
    const visible = mesh.visible;
    renderingMirror = true;
    mesh.visible = false;
    webgl.xr.enabled = false;
    webgl.shadowMap.autoUpdate = false;
    webgl.setRenderTarget(target);
    webgl.state.buffers.depth.setMask(true);
    if (webgl.autoClear === false) webgl.clear();
    webgl.render(scene, mirrorCamera);
    mesh.visible = visible;
    renderingMirror = false;
    webgl.xr.enabled = prevXr;
    webgl.shadowMap.autoUpdate = prevShadow;
    webgl.setRenderTarget(prevTarget);
  };
}

export function buildWaterMaterial(ctx: WaterCtx) {
  ensureWallDist(ctx.mesh);
  const uniforms: Record<string, THREE.IUniform> = {
    ...(ctx.u as unknown as Record<string, THREE.IUniform>),
    uTime: ctx.time,
    sunDirection: ctx.sunDirection,
    tScene: sceneColor,
    tDepth: sceneDepth,
    tReflect: { value: placeholder },
    textureMatrix: { value: new THREE.Matrix4() },
    uCameraNear: shared.near,
    uCameraFar: shared.far,
    uResolution: shared.resolution,
    planarWeight: { value: 1 },
    // ShaderMaterial does not receive UniformsLib.fog; the renderer writes these when material.fog is set.
    fogColor: { value: new THREE.Color() },
    fogDensity: { value: 0 },
    fogNear: { value: 1 },
    fogFar: { value: 2000 },
  };
  for (const slot of TEXTURE_SLOTS) uniforms[slot] = ctx.tex(slot);

  const mat = new THREE.ShaderMaterial({
    name: 'StylizedWater',
    uniforms,
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    fog: true,
  });
  attachPlanarReflection(ctx.mesh, mat, ctx.reflection ?? DEMO_REFLECTION);
  return mat;
}
