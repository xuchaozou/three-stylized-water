import * as THREE from 'three/webgpu';
import { Fn, pass, uniform, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FramePacer } from './rendering/FramePacer';
import { selectPixelRatio } from './rendering/renderResolution';
import { buildDemoScene } from './scene/demoScene';
import { CAMS, DEFAULT_CAM } from './scene/cams';
import { createWaterUniforms } from './water/uniforms';
import { buildWaterMaterial, createTextureRegistry } from './water/WaterMaterial';
import { applyPreset, PRESET_NAMES, DEFAULT_PRESET } from './water/presets';
import { parseUrlState } from './ui/urlState';
import type { WaterCtx } from './water/nodes/types';

const state = parseUrlState();
const idleFps = state.fps ?? 30;
const activeFps = state.fps ?? 60;
const framePacer = new FramePacer({ idleFps, activeFps, activeHoldMs: 250 });

async function init() {
  const container = document.getElementById('app')!;
  const width = window.innerWidth;
  const height = window.innerHeight;

  // Keep MSAA on the scene pass only; the full-screen blit does not need it.
  const renderer = new THREE.WebGPURenderer({ antialias: false });
  // Unity uses Tonemapping=None, leaving only the linear-to-sRGB conversion.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const setRendererSize = (nextWidth: number, nextHeight: number) => {
    const pixelRatio = selectPixelRatio(nextWidth, nextHeight, window.devicePixelRatio);
    renderer.domElement.style.width = `${nextWidth}px`;
    renderer.domElement.style.height = `${nextHeight}px`;
    renderer.setDrawingBufferSize(nextWidth, nextHeight, pixelRatio);
  };
  setRendererSize(width, height);
  container.appendChild(renderer.domElement);
  await renderer.init();
  (window as any).__BACKEND = (renderer.backend as any).isWebGPUBackend ? 'webgpu' : 'webgl';

  // Start rendering only after all assets finish loading (avoids PMREM/texture races).
  const assetsLoaded = new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 20000);
    THREE.DefaultLoadingManager.onLoad = () => {
      clearTimeout(timer);
      resolve();
    };
    THREE.DefaultLoadingManager.onError = (url) => console.warn('[load error]', url);
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, width / height, 0.3, 1000);

  let camId = state.cam && CAMS[state.cam] ? state.cam : DEFAULT_CAM;
  const controls = new OrbitControls(camera, renderer.domElement);
  const applyCam = (id: string) => {
    camId = id;
    const c = CAMS[id] ?? CAMS[DEFAULT_CAM];
    camera.position.set(...c.pos);
    camera.up.set(...c.up);
    camera.fov = c.fov;
    camera.near = c.near;
    camera.far = c.far;
    camera.updateProjectionMatrix();
    controls.target.set(...c.target);
    controls.update();
    framePacer.noteActivity(performance.now());
    framePacer.forceNextFrame();
  };
  controls.addEventListener('change', () => framePacer.noteActivity(performance.now()));
  applyCam(camId);

  const handles = await buildDemoScene(scene);

  const u = createWaterUniforms();
  const texReg = createTextureRegistry();
  const uTime = uniform(state.t);
  const sunDirection = uniform(new THREE.Vector3(0, 1, 0));
  const sunColor = uniform(new THREE.Color(1, 1, 1));
  const sunIntensity = uniform(1);

  // Unity's 20 m plane scaled by 3.5 gives 70 m; Gerstner displacement needs dense subdivision.
  const waterGeo = new THREE.PlaneGeometry(70, 70, 256, 256);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMesh = new THREE.Mesh(waterGeo);
  waterMesh.name = 'Water';
  waterMesh.frustumCulled = false;
  waterMesh.castShadow = false;
  waterMesh.receiveShadow = false;
  handles.waterAnchor.add(waterMesh);

  const ctx: WaterCtx = {
    u,
    time: uTime,
    tex: texReg.get,
    mesh: waterMesh,
    scene,
    renderer,
    camera,
    sunDirection,
    sunColor,
    sunIntensity,
  };
  waterMesh.material = buildWaterMaterial(ctx);

  let presetName = state.preset && PRESET_NAMES.includes(state.preset) ? state.preset : DEFAULT_PRESET;
  if (presetName) applyPreset(u, texReg.set, presetName);

  for (const key of state.on) {
    const un = (u as any)[key];
    if (un) un.value = 1;
  }
  for (const key of state.off) {
    const un = (u as any)[key];
    if (un) un.value = 0;
  }
  for (const [key, value] of state.set) {
    const un = (u as any)[key];
    if (un && Number.isFinite(value)) un.value = value;
  }

  const guiState = { freeze: state.freeze };
  if (state.hud) {
    const { mountInspector } = await import('./ui/inspector');
    mountInspector(u, {
      presetNames: PRESET_NAMES.length ? PRESET_NAMES : ['(waiting for presets)'],
      currentPreset: presetName || '(waiting for presets)',
      onPreset: (name) => {
        presetName = name;
        applyPreset(u, texReg.set, name);
        framePacer.forceNextFrame();
      },
      camNames: Object.keys(CAMS),
      currentCam: camId,
      onCam: applyCam,
      onInteraction: () => framePacer.noteActivity(performance.now()),
      state: guiState,
    });
  }
  if (state.profile) {
    const { mountProfiler } = await import('./ui/profiler');
    mountProfiler(renderer);
  }

  // three's default bloom high-pass gates pixels at their original brightness, while URP subtracts
  // the threshold with a soft knee. Keep the URP formula here rather than using luminosityHighPass:
  //     b = max3(rgb); knee = T*0.5
  //     s = clamp(b - T + knee, 0, 2*knee); s = s*s / (4*knee + 1e-4)
  //     rgb *= max(b - T, s) / max(b, 1e-4)
  const urpPrefilter = Fn(({ input, threshold }: any) => {
    const c = input.rgb;
    const b = c.r.max(c.g).max(c.b);
    const knee = threshold.mul(0.5);
    const soft = b.sub(threshold).add(knee).clamp(0, knee.mul(2));
    const softened = soft.mul(soft).div(knee.mul(4).add(1e-4));
    const multiplier = softened.max(b.sub(threshold)).div(b.max(1e-4)).max(0);
    return vec4(c.mul(multiplier), input.a);
  });

  // Calibrated against Unity renders; the raw URP intensity is not portable to three's additive mip cascade.
  const BLOOM_INTENSITY = 0.012;
  const pipeline = new THREE.RenderPipeline(renderer);
  // PassNode prioritizes options.samples over renderer.samples, preserving the original 4x MSAA.
  const scenePass = pass(scene, camera, { samples: 4 });
  const scenePassColor = scenePass.getTextureNode('output');
  const bloomNode = bloom(scenePassColor, BLOOM_INTENSITY, 0.7, 1.0);
  bloomNode.highPassFn = urpPrefilter;
  pipeline.outputNode = scenePassColor.add(bloomNode);

  await assetsLoaded;
  const clock = new THREE.Clock();
  const syncSun = () => {
    const dir = handles.sun.position.clone().sub(handles.sun.target.position).normalize();
    (sunDirection.value as THREE.Vector3).copy(dir);
    (sunColor.value as THREE.Color).copy(handles.sun.color);
    // Unity convention (_MainLightColor = color * intensity). Do not pass three's pi multiplier.
    sunIntensity.value = handles.sunUnityIntensity;
  };
  // The sun is static after scene setup, so synchronize its uniforms once.
  syncSun();

  // Reflector targets and similar objects are added during TSL setup in the first pipeline.render(), so after the first render,
  // finalize and freeze the matrices of the completed scene graph. The camera is outside the scene and continues updating independently.
  let firstFrameDone = false;
  const perf = state.perf
    ? { count: 0, timestamps: [] as number[], idleFps, activeFps, cam: camId, preset: presetName }
    : null;
  if (perf) (window as any).__PERF = perf;

  renderer.setAnimationLoop((now) => {
    if (!framePacer.shouldRender(now)) return;

    const dt = Math.min(clock.getDelta(), 0.1);
    if (!guiState.freeze) uTime.value += dt;
    controls?.update();
    pipeline.render();
    if (perf) {
      perf.count++;
      perf.timestamps.push(now);
      if (perf.timestamps.length > 4096) perf.timestamps.shift();
    }
    if (!firstFrameDone) {
      firstFrameDone = true;
      scene.updateMatrixWorld(true);
      scene.matrixWorldAutoUpdate = false;
      (window as any).__READY = true;
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    setRendererSize(window.innerWidth, window.innerHeight);
    framePacer.forceNextFrame();
  });
}

init().catch((e) => {
  (window as any).__INIT_ERROR = String(e?.stack ?? e);
  console.error('[init failed]', e);
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#ff8888;padding:20px;font-size:12px;white-space:pre-wrap';
  pre.textContent = 'INIT FAILED\n' + (e?.stack ?? String(e));
  document.body.appendChild(pre);
});
