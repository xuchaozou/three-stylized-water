// Unity uses the strength-adjusted tangent-space normal for distortion, but the displaced geometry
// normal (without the normal map) for the probe and Fresnel.
import * as THREE from 'three/webgpu';
import {
  cameraPosition,
  cubeTexture,
  float,
  mix,
  nodeObject,
  positionWorld,
  reflect,
  reflector,
  saturate,
  screenUV,
  vec2,
  vec3,
} from 'three/tsl';
import type { WaterCtx } from './types';
import { buildWaves } from './waves';
import { buildNormalTS } from './normals';

export interface ReflectionData {
  color: any;
  /** Final composition factor 0..1 (Strength x Fresnel). */
  factor: any;
}

/** Demo scene's URP render scale multiplied by PlannerReflectionVolume render scale. */
const RT_RESOLUTION_SCALE = 0.3;

// PlannerReflectionVolume values from the demo scene. Z is flipped into three coordinates.
/** Volume center in three coordinates, with Unity Z flipped. */
const VOLUME_CENTER: [number, number, number] = [56.6, 20.4, -50.1];
/** volumeSize * 0.5 */
const VOLUME_HALF: [number, number, number] = [41.4, 14.05, 30.7];
/** blendDistance from PlannerReflectionVolume.prefab. */
const BLEND_DISTANCE = 1.48;

// The Unity reflection probe contains the baked scene, not only the skybox; reproduce it with a
// scene cubemap capture that excludes the water itself.
/** Probe capture position from the Unity scene, with Z flipped for three. */
const PROBE_POSITION: [number, number, number] = [39.678116, 20.23, -49.844906];
/** Unity ReflectionProbe m_Resolution. */
const PROBE_RESOLUTION = 256;
// Unity probe box projected into three coordinates; flipping Z swaps its min and max.
const BOX_MIN: [number, number, number] = [-4.8711, 15.6098, -105.1152];
const BOX_MAX: [number, number, number] = [106.3541, 52.2922, -1.3640];

/** Bake the cubemap after the first render so asynchronously loaded terrain textures are present. */
function createProbeTarget(ctx: WaterCtx): THREE.CubeRenderTarget {
  const rt = new THREE.CubeRenderTarget(PROBE_RESOLUTION, { type: THREE.HalfFloatType });
  const cam = new THREE.CubeCamera(0.3, 1000, rt);
  cam.position.set(...PROBE_POSITION);

  const capture = () => {
    const visible = ctx.mesh.visible;
    ctx.mesh.visible = false;
    cam.update(ctx.renderer as any, ctx.scene);
    ctx.mesh.visible = visible;
  };
  ctx.mesh.onBeforeRender = () => {
    ctx.mesh.onBeforeRender = () => {};
    requestAnimationFrame(capture);
  };
  return rt;
}

/** Port the probe's scalar-x normal perturbation without normalization; roughness zero selects mip 0. */
function buildProbeColor(ctx: WaterCtx, Ngeo: any, nTS: any, V: any, envCube: THREE.CubeTexture): any {
  const nmx = nTS.x.mul(ctx.u.Reflection_Distortion);
  const perturbedN = Ngeo.add(vec3(nmx));
  const r: any = reflect(V.negate(), perturbedN);

  // Box projection redirects the ray from the probe to its intersection with the probe bounds.
  const positive: any = r.step(vec3(0)); // 1 per component where r>=0
  const bounds: any = mix(vec3(...BOX_MIN), vec3(...BOX_MAX), positive);
  const denom: any = r.abs().max(1e-4).mul(mix(vec3(-1), vec3(1), positive));
  const t: any = bounds.sub(positionWorld).div(denom);
  const fa: any = t.x.min(t.y).min(t.z);
  const boxDir: any = positionWorld.sub(vec3(...PROBE_POSITION)).add(r.mul(fa));

  // CubeTextureNode applies materialEnvRotation; cancel it because this capture is already world-space.
  const yaw = ctx.scene.environment === null ? 0 : ctx.scene.environmentRotation.y;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const dir: any = vec3(
    boxDir.x.mul(c).add(boxDir.z.mul(s)),
    boxDir.y,
    boxDir.x.mul(-s).add(boxDir.z.mul(c)),
  );

  return (cubeTexture(envCube, dir) as any).level(0).rgb;
}

/** ReflectorNode owns scene and render-target state, so construct it only once per water mesh. */
const cache = new WeakMap<THREE.Object3D, ReflectionData>();

export function buildReflection(ctx: WaterCtx, _waterNormal: any): ReflectionData {
  let data = cache.get(ctx.mesh);
  if (data === undefined) {
    data = build(ctx);
    cache.set(ctx.mesh, data);
  }
  return data;
}

function build(ctx: WaterCtx): ReflectionData {
  const { u } = ctx;

  const nTS = buildNormalTS(ctx);

  // Reusing buildWaves preserves TSL's shared vWaveNormal interpolator.
  const Ngeo = buildWaves(ctx).normal.normalize();
  const V = cameraPosition.sub(positionWorld).normalize();

  // Reflector targets +Z by default; rotate it onto the XZ water plane.
  const refl: any = reflector({
    resolutionScale: RT_RESOLUTION_SCALE,
    bounces: false,
    generateMipmaps: false,
  });
  refl.target.rotateX(-Math.PI / 2);
  ctx.mesh.add(refl.target);

  // Reuse the planar RT only when it has valid output and all render-affecting state is unchanged.
  // target.matrixWorld must be keyed because it is still identity during the first render.
  {
    const baseNode: any = refl.reflector;
    const original = baseNode.updateBefore.bind(baseNode);
    const KEY_LEN = 16 + 16 + 16 + 2;
    let lastKey: number[] | null = null;
    const size = new THREE.Vector2();

    const readKey = (): number[] => {
      ctx.renderer.getDrawingBufferSize(size);
      return [
        ...ctx.camera.matrixWorld.elements,
        ...ctx.camera.projectionMatrix.elements,
        ...refl.target.matrixWorld.elements,
        size.x,
        size.y,
      ];
    };
    const sameKey = (a: number[], b: number[]) => {
      for (let i = 0; i < KEY_LEN; i++) if (a[i] !== b[i]) return false;
      return true;
    };

    baseNode.updateBefore = (frame: any) => {
      if (baseNode.forceUpdate) {
        const result = original(frame);
        if (baseNode.hasOutput) lastKey = readKey();
        return result;
      }
      const key = readKey();
      if (baseNode.hasOutput && lastKey !== null && sameKey(key, lastKey)) return undefined;
      const result = original(frame);
      if (baseNode.hasOutput) lastKey = key;
      return result;
    };
  }

  // The mirrored camera keeps a right-handed RT, so both the UV and distortion x offset must flip.
  const off = nTS.xy.mul(u.Reflection_Distortion.mul(0.1));
  refl.uvNode = screenUV.flipX().add(vec2(off.x.negate(), off.y));
  const planar = nodeObject(refl).rgb;

  const probe = buildProbeColor(ctx, Ngeo, nTS, V, createProbeTarget(ctx).texture);
  const outside = cameraPosition.sub(vec3(...VOLUME_CENTER)).abs().sub(vec3(...VOLUME_HALF)).max(0);
  const volumeBlend = saturate(outside.x.max(outside.y).max(outside.z).div(BLEND_DISTANCE));
  const blend = mix(float(1), volumeBlend, u.ENABLEPLANERREFLECTION);
  const color = mix(planar, probe, blend);

  const fresnel = Ngeo.dot(V).saturate().oneMinus().max(1e-5).pow(u.Reflection_Fresnel);

  return { color, factor: fresnel.mul(u.Reflection_Strength) };
}
