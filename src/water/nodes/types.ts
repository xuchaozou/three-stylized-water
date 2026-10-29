import type * as THREE from 'three/webgpu';
import type { WaterUniforms, TextureSlot } from '../uniforms';

export interface WaterCtx {
  u: WaterUniforms;
  /** App-defined, freezable time in seconds. Do not use TSL's built-in time. */
  time: any;
  /** Get a TSL texture node for a slot (presets switch it by replacing .value). */
  tex: (slot: TextureSlot) => any;
  mesh: THREE.Mesh;
  scene: THREE.Scene;
  renderer: THREE.WebGPURenderer;
  camera: THREE.PerspectiveCamera;
  sunDirection: any;
  sunColor: any;
  sunIntensity: any;
  /** Scene-specific probe and planar-reflection volume; defaults to the Unity demo scene. */
  reflection?: ReflectionSetup;
}

/** All coordinates are three.js world space. */
export interface ReflectionSetup {
  volumeCenter: [number, number, number];
  volumeHalf: [number, number, number];
  probePosition: [number, number, number];
  boxMin: [number, number, number];
  boxMax: [number, number, number];
  /** Planar reflection target size relative to the drawing buffer; defaults to the Unity demo's 0.3. */
  resolutionScale?: number;
}

/** Return value of buildDepth(ctx, uv). Two instances are created: screenUV and refracted UV. */
export interface DepthData {
  /** Positive view-space depth of the fragment itself [m]. */
  eyeDepth: any;
  /** Positive view-space scene depth at the sampled UV [m]. */
  sceneEyeDepth: any;
  scenePosWS: any;
  /** World Space shallow mask (exp). 1=shoreline, 0=deep. */
  ws: any;
  /** View Space shallow mask (linear). 1=shoreline. */
  cs: any;
  /** _WorldSpaceDepth ? ws : cs -- for water color and underwater-layer conformance. */
  depthColorMask: any;
  /** Final alpha and near-distance refraction mask (meaningful only for the screenUV variant). */
  shoreFadeMask: any;
  /** saturate((dist-Start)/Fade) for normal distance blending. Near 0 -> far 1. */
  distanceMask: any;
}

export interface WavesData {
  offset: any;
  normal: any;
  /** Wave_Top_Color mask (fragment-recomputed displacement y x 10, unclamped). */
  height01: any;
}
