// Water-treatment-plant surfaces: a small set of visually distinct tank types from a drinking-water
// plant (给水厂) and a wastewater plant (污水厂). Each type is a compact physical description expanded
// into a full preset.
// Color units follow presets.json: HDR keys (Color_Shallow / Color_Deep / Specular_Color) are linear,
// every other color is sRGB; alpha is always linear.
import * as THREE from 'three/webgpu';
import { srgbToLinear } from './uniforms.ts';
import type { WaterUniforms } from './uniforms';

type PresetEntry = {
  floats?: Record<string, number>;
  vectors?: Record<string, number[]>;
  colors?: Record<string, number[]>;
  textures?: Record<string, string | null>;
};

type Rgba = [number, number, number, number];

export type PlantProcess = '给水厂' | '污水厂';

export interface WaterTypeSpec {
  process: PlantProcess;
  /** Short description shown in the inspector. */
  note: string;
  /** Linear HDR colors; alpha is opacity (turbidity). */
  shallow: Rgba;
  deep: Rgba;
  /** Water_Depth [m]: how quickly the color saturates with depth. Larger = clearer water. */
  depth: number;
  refraction: number;
  /** Caustics strength; omitted = off (turbid water never shows bottom caustics). */
  caustics?: number;
  ripple: { strength: number; scale: number; speed: number; map?: string };
  waves: { height: number; length: number; speed: number; sharp: number };
  reflection: number;
  specular: number;
  spread: number;
  /**
   * Floating scum, flocs or bubbles. Color is sRGB. `drift` is the downstream speed; `stretch` > 1
   * elongates the pattern along the current into streaks.
   */
  scum?: { map: string; color: Rgba; scale: number; edge: number; smooth: number; drift: number; stretch?: number; distort?: number };
  /** Scum line / foam collar along walls. Color is sRGB. */
  edge?: { color: Rgba; width: number };
  /** Suspended solids seen below the surface. Color is sRGB. */
  underwater?: Rgba;
  /** Channel flow: ripples and waves all travel downstream so the current direction reads clearly. */
  stream?: boolean;
  /**
   * Ripple-only flow cue for foam-free water: a narrow cross angle makes both ripple layers travel
   * downstream together and `stretch` elongates them along the current. Overrides the stream defaults.
   */
  rippleFlow?: { cross: number; stretch: number };
  /** Normal_Shading: sun-lit light/dark on the ripples so they show away from the highlight. Default 0.6. */
  shading?: number;
  /** Flow_Speed multiplier typical for the process. */
  flow: number;
}

const FLOC_DOTS = 'Foam2.psd';
const CLOUDY = 'Noise 7.png';

export const PLANT_WATER_TYPES: Record<string, WaterTypeSpec> = {
  // ---------------- 给水厂 (drinking-water treatment) ----------------
  '给水·原水池': {
    process: '给水厂',
    note: '原水/进水渠：河湖原水，黄绿色微浑，顺流方向的波纹与漂浮物条带',
    shallow: [0.32, 0.34, 0.18, 0.8], deep: [0.12, 0.15, 0.07, 0.95], depth: 0.8, refraction: 0.12,
    ripple: { strength: 1.1, scale: 5, speed: 3 }, waves: { height: 0.015, length: 1.4, speed: 1.6, sharp: 0.4 },
    reflection: 0.9, specular: 8, spread: 0.08,
    scum: { map: CLOUDY, color: [0.78, 0.76, 0.62, 0.8], scale: 1.6, edge: 0.5, smooth: 0.25, drift: 0.4, stretch: 3, distort: 0.25 },
    edge: { color: [0.72, 0.7, 0.58, 0.55], width: 0.4 },
    stream: true,
    flow: 1.5,
  },
  '给水·絮凝沉淀池': {
    process: '给水厂',
    note: '絮凝/沉淀：投加混凝剂后的灰褐色浑水，水面缓慢，可见矾花絮体',
    shallow: [0.36, 0.33, 0.24, 0.85], deep: [0.17, 0.16, 0.11, 0.96], depth: 0.7, refraction: 0.1,
    ripple: { strength: 0.5, scale: 7, speed: 0.8 }, waves: { height: 0.006, length: 2, speed: 0.7, sharp: 0.25 },
    reflection: 0.85, specular: 8, spread: 0.08,
    scum: { map: FLOC_DOTS, color: [0.78, 0.74, 0.62, 0.8], scale: 4, edge: 0.25, smooth: 0.25, drift: 0.05, distort: 0.3 },
    flow: 1,
  },
  '给水·清水池': {
    process: '给水厂',
    note: '清水池：成品水，低浊度，蓝绿色透亮，沿廊道缓慢推流，波纹整体向前推进，可见池底焦散',
    shallow: [0.18, 0.55, 0.5, 0.15], deep: [0.01, 0.1, 0.12, 0.72], depth: 2.5, refraction: 0.3, caustics: 0.8,
    ripple: { strength: 0.6, scale: 7, speed: 1.2, map: 'Normal 1.png' }, waves: { height: 0.006, length: 2.2, speed: 0.6, sharp: 0.2 },
    reflection: 1, specular: 12, spread: 0.02,
    rippleFlow: { cross: 20, stretch: 1.2 },
    shading: 1.2,
    edge: { color: [0.95, 0.97, 1, 0.6], width: 0.5 },
    flow: 1,
  },

  // ---------------- 污水厂 (wastewater treatment) ----------------
  '污水·进水渠': {
    process: '污水厂',
    note: '进水渠/格栅渠：原污水，深灰褐色，水流湍急，浮渣顺流成条',
    shallow: [0.26, 0.22, 0.15, 0.95], deep: [0.1, 0.085, 0.06, 1], depth: 0.4, refraction: 0.08,
    ripple: { strength: 1, scale: 6, speed: 3.5 }, waves: { height: 0.018, length: 1.2, speed: 1.8, sharp: 0.45 },
    reflection: 0.6, specular: 4, spread: 0.2,
    scum: { map: CLOUDY, color: [0.52, 0.47, 0.36, 0.85], scale: 1.4, edge: 0.5, smooth: 0.3, drift: 0.6, stretch: 4, distort: 0.3 },
    edge: { color: [0.6, 0.55, 0.45, 0.85], width: 0.7 },
    stream: true,
    flow: 1.5,
  },
  '污水·好氧池(曝气)': {
    process: '污水厂',
    note: '好氧/曝气池：微孔曝气翻腾，活性污泥呈巧克力色，水面密布细碎气泡',
    shallow: [0.36, 0.27, 0.15, 0.95], deep: [0.16, 0.12, 0.07, 1], depth: 0.5, refraction: 0.1,
    ripple: { strength: 1.2, scale: 10, speed: 2.5 }, waves: { height: 0.025, length: 0.8, speed: 2.2, sharp: 0.55 },
    reflection: 0.55, specular: 5, spread: 0.2,
    scum: { map: FLOC_DOTS, color: [0.92, 0.88, 0.8, 0.7], scale: 4, edge: 0.1, smooth: 0.35, drift: 0.1, distort: 1 },
    edge: { color: [0.9, 0.87, 0.8, 0.85], width: 0.8 },
    flow: 1,
  },
  '污水·二沉池': {
    process: '污水厂',
    note: '二沉池：泥水分离后的上清液，灰绿色半透明，水面平静如镜',
    shallow: [0.22, 0.3, 0.22, 0.55], deep: [0.07, 0.1, 0.07, 0.9], depth: 1, refraction: 0.15,
    ripple: { strength: 0.35, scale: 7, speed: 0.4 }, waves: { height: 0.003, length: 2.5, speed: 0.5, sharp: 0.2 },
    reflection: 1, specular: 10, spread: 0.04,
    edge: { color: [0.6, 0.58, 0.48, 0.6], width: 0.4 },
    flow: 1,
  },
  '污水·污泥池': {
    process: '污水厂',
    note: '污泥浓缩/储泥池：高含固率污泥，深褐近黑，粘稠不透明，表面结皮',
    shallow: [0.16, 0.12, 0.07, 1], deep: [0.07, 0.05, 0.03, 1], depth: 0.3, refraction: 0.03,
    ripple: { strength: 0.25, scale: 4, speed: 0.2 }, waves: { height: 0.002, length: 3, speed: 0.3, sharp: 0.1 },
    reflection: 0.5, specular: 3, spread: 0.3,
    scum: { map: CLOUDY, color: [0.32, 0.26, 0.17, 0.9], scale: 0.8, edge: 0.35, smooth: 0.4, drift: 0.01 },
    edge: { color: [0.35, 0.3, 0.2, 0.9], width: 0.8 },
    flow: 1,
  },
};

/** Expand a physical description into Unity-named preset properties. */
function specToPreset(s: WaterTypeSpec): PresetEntry {
  const r = s.ripple;
  const w = s.waves;
  const stretch = s.scum?.stretch ?? 1;
  const floats: Record<string, number> = {
    _WorldSpaceDepth: 1,
    _ShoreFade: 1,
    _ShoreFade_Smoothness: 0.2,
    _Water_Depth: s.depth,
    _DistanceMask_Start: 10,
    _DistanceMask_Fade: 30,

    _ENABLEREFRACTION: 1,
    _Refraction_Physical: 1,
    _Refraction_Thickness: 1.5,
    _Refraction_Strength: s.refraction,
    _Refraction_Distance_Strength: s.refraction * 0.4,
    _Refraction_Distance_Fade: 3,

    _ENABLECAUSTICS: s.caustics === undefined ? 0 : 1,
    _Caustics_Strength: s.caustics ?? 0,
    _Caustics_Scale: 2,
    _Caustics_Pan: 0.6,
    _Caustics_Depth: -6,
    _Caustics_Start: 8,
    _Caustics_Fade: 25,
    _Caustics_Distortion_Scale: 2,
    _Caustics_Distortion_Strength: 3,

    _ENABLENORMAL: 1,
    _Normal_Strength: r.strength,
    _Normal_Scale: r.scale,
    _Normal_Pan: r.speed,
    _Normal_DistanceStrength: r.strength * 0.35,
    _Flow_Aligned: 1,
    // A narrow angle keeps a stream's ripples coherent; still tanks need a wide one to shimmer in place.
    _Normal_CrossAngle: s.rippleFlow?.cross ?? (s.stream ? 12 : 70),
    _Flow_Stretch: s.rippleFlow?.stretch ?? (s.stream ? 1.5 : 1),
    _Normal_Shading: s.shading ?? 0.6,

    _ENABLEPLANERREFLECTION: 1,
    _Reflection_Strength: s.reflection,
    _Reflection_Fresnel: 5,
    _Reflection_Distortion: Math.min(1.5, 0.15 + r.strength * 0.5),

    _Specular_Hardness: 0,
    _Specular_Size: 0,
    _Specular_Spread: s.spread,

    _ENABLEWAVE: 1,
    _1st_Wave_Length: w.length,
    _1st_Wave_Height: w.height,
    _1st_Wave_Speed: w.speed,
    _1st_Wave_Sharpness: w.sharp,
    _2nd_Wave_Length: w.length * 1.65,
    _2nd_Wave_Height: w.height * 1.3,
    _2nd_Wave_Speed: w.speed * 0.85,
    _2nd_Wave_Sharpness: w.sharp,

    _Enable_SurfaceFoam: s.scum ? 1 : 0,
    _Invert_SurfFoam: 0,
    _SurfFoam_AlphaBlend: 0,
    _SurfFoam_Scale: s.scum?.scale ?? 3,
    _SurfFoam_Edge: s.scum?.edge ?? 0.5,
    _SurfFoam_EdgeSmooth: s.scum?.smooth ?? 0.3,
    _SurfaceDistortion_Scale: 3,
    _SurfaceDistortion_Strength: s.scum?.distort ?? 0.15,

    _Enable_Intersection: s.edge ? 1 : 0,
    _InterSec_Width: s.edge?.width ?? 0.5,
    _InterSec_Dissolve: 2.2,
    _InterSec_Foam_Scale: 8,
    _InterSec_Foam_Smooth: 0.2,
    // Noise 2 is mostly dark; inverted, it leaves foam with a broken outer edge instead of none.
    _InterSec_Foam_Invert: 1,
    _InterSec_GradientDissolve: 0,
    // Edge fade caps the collar at ~50% opacity; the wall-distance band already fades out softly.
    _InterSec_Edge_Fade: 0,
    _InterSec_WallDistance: 0.6,

    _ENABLE_UNDERWATERLAYER: s.underwater ? 1 : 0,
    _UnderWater_Depth: -3,
    _ConformToGeometry: 0,

    _ENABLESHORELINE: 0,
    _Flow_Speed: s.flow,
  };
  // Panners add `pan * t` to the UV, so a negative x pan moves the pattern downstream (+x of the flow frame).
  const drift = s.scum?.drift ?? 0.02;
  return {
    floats,
    vectors: {
      // Stream trains still head downstream but cross at ~55° so their crests never line up into bands.
      _1st_Wave_Direction: s.stream ? [1, 0, 0.3, 0] : [1, 0, 0.25, 0],
      _2nd_Wave_Direction: s.stream ? [0.7, 0, -0.7, 0] : [-0.5, 0, 1, 0],
      _SurfFoam_Pan: [-drift, 0, 0, 0],
      _SurfFoam_Tile: [1 / stretch, 1, 0, 0],
      _SurfaceDistortion_Pan: s.stream ? [-drift * 1.5, 0, 0, 0] : [0.2, 0.1, 0, 0],
      _InterSec_Foam_Pan: [-drift * 0.5, 0, 0, 0],
      _InterSec_Foam_Tile: [1, 1, 0, 0],
    },
    colors: {
      _Color_Shallow: s.shallow,
      _Color_Deep: s.deep,
      _Specular_Color: [s.specular, s.specular, s.specular, 1],
      _ShadowColor: [0, 0, 0, 0.4],
      _Wave_Top_Color: [1, 1, 1, 0],
      _SurfFoam_Color: s.scum?.color ?? [1, 1, 1, 1],
      _InterSec_Color: s.edge?.color ?? [1, 1, 1, 1],
      _Underwater_Color: s.underwater ?? [0, 0, 0, 0.5],
    },
    textures: {
      _Normal_Map: r.map ?? 'Normal 2.png',
      _SurfFoam_Map: s.scum?.map ?? null,
      _SurfaceDistortion_Map: 'Noise 6.png',
      _InterSec_Foam_Mask: 'Noise 2.png',
      _Caustics_Map: 'Caustic 1.png',
      _Caustics_Distortion_Map: 'Noise 2.png',
    },
  };
}

function mergeEntry(...entries: PresetEntry[]): PresetEntry {
  const out: Required<PresetEntry> = { floats: {}, vectors: {}, colors: {}, textures: {} };
  for (const e of entries) {
    Object.assign(out.floats, e.floats);
    Object.assign(out.vectors, e.vectors);
    Object.assign(out.colors, e.colors);
    Object.assign(out.textures, e.textures);
  }
  return out;
}

/** Resolve plant presets on top of Unity's "clear" so properties the spec does not cover are still set. */
export function buildPlantPresets(unity: Record<string, PresetEntry>): Record<string, PresetEntry> {
  const out: Record<string, PresetEntry> = {};
  for (const [name, spec] of Object.entries(PLANT_WATER_TYPES)) {
    out[name] = mergeEntry(unity.clear ?? {}, specToPreset(spec));
  }
  return out;
}

export const PLANT_PRESET_NAMES = Object.keys(PLANT_WATER_TYPES);

/** Base-color palettes in sRGB hex as shown by the picker; alpha is linear opacity. */
export interface ColorPalette {
  shallow: string;
  shallowAlpha: number;
  deep: string;
  deepAlpha: number;
  foam?: string;
  edge?: string;
}

export const COLOR_PALETTES: Record<string, ColorPalette> = {
  '清水-蓝绿': { shallow: '#7cc4bd', shallowAlpha: 0.15, deep: '#1b5a66', deepAlpha: 0.72 },
  '清水-湛蓝': { shallow: '#7ab8e0', shallowAlpha: 0.12, deep: '#164a78', deepAlpha: 0.7 },
  '清水-浅绿(微藻)': { shallow: '#9cc785', shallowAlpha: 0.3, deep: '#33694a', deepAlpha: 0.82 },
  '污水-褐黄(进水)': { shallow: '#9a8457', shallowAlpha: 0.92, deep: '#5c5132', deepAlpha: 0.98, foam: '#cbb98f', edge: '#d8c9a3' },
  '污水-棕褐(活性污泥)': { shallow: '#a3825a', shallowAlpha: 0.95, deep: '#6e583b', deepAlpha: 1, foam: '#f5f0e2', edge: '#f7f1e4' },
  '污水-灰绿(二沉)': { shallow: '#7f8f70', shallowAlpha: 0.85, deep: '#435040', deepAlpha: 0.96, foam: '#c5c8ae', edge: '#d0d3bb' },
  '污水-深黑(厌氧)': { shallow: '#575046', shallowAlpha: 0.95, deep: '#25221c', deepAlpha: 1, foam: '#8c846e', edge: '#9a927b' },
};

export const COLOR_PALETTE_NAMES = Object.keys(COLOR_PALETTES);

function setFromHex(target: THREE.Vector4, hex: string, alpha: number) {
  const v = Number.parseInt(hex.slice(1), 16);
  const ch = (shift: number) => srgbToLinear(((v >> shift) & 0xff) / 255);
  target.set(ch(16), ch(8), ch(0), alpha);
}

/** Uniforms are always linear, so convert both HDR and plain colors from the sRGB swatch. */
const r3 = (x: number) => Math.round(x * 1e3) / 1e3;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const linearToSrgb = (c: number) => {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, s));
};

function hdrRgba(v: THREE.Vector4): Rgba {
  return [r4(v.x), r4(v.y), r4(v.z), r4(v.w)];
}

function srgbRgba(v: THREE.Vector4): Rgba {
  return [r3(linearToSrgb(v.x)), r3(linearToSrgb(v.y)), r3(linearToSrgb(v.z)), r4(v.w)];
}

function n(u: WaterUniforms, key: keyof WaterUniforms): number {
  return (u[key] as { value: number }).value;
}

function v2(u: WaterUniforms, key: keyof WaterUniforms): THREE.Vector2 {
  return u[key].value as THREE.Vector2;
}

function v4(u: WaterUniforms, key: keyof WaterUniforms): THREE.Vector4 {
  return u[key].value as THREE.Vector4;
}

/**
 * Snapshot the live uniforms as a `WaterTypeSpec` that can replace the matching entry in
 * `PLANT_WATER_TYPES`. Process/note/texture names are taken from the original spec when present.
 */
export function exportWaterTypeSpec(u: WaterUniforms, name: string): WaterTypeSpec {
  const base = PLANT_WATER_TYPES[name];
  const on = (key: keyof WaterUniforms) => n(u, key) >= 0.5;
  const spec: WaterTypeSpec = {
    process: base?.process ?? (name.startsWith('污水') ? '污水厂' : '给水厂'),
    note: base?.note ?? '',
    shallow: hdrRgba(v4(u, 'Color_Shallow')),
    deep: hdrRgba(v4(u, 'Color_Deep')),
    depth: r3(n(u, 'Water_Depth')),
    refraction: r3(n(u, 'Refraction_Strength')),
    ripple: {
      strength: r3(n(u, 'Normal_Strength')),
      scale: r3(n(u, 'Normal_Scale')),
      speed: r3(n(u, 'Normal_Pan')),
    },
    waves: {
      height: r4(n(u, 'Wave1_Height')),
      length: r3(n(u, 'Wave1_Length')),
      speed: r3(n(u, 'Wave1_Speed')),
      sharp: r3(n(u, 'Wave1_Sharpness')),
    },
    reflection: r3(n(u, 'Reflection_Strength')),
    specular: r3(v4(u, 'Specular_Color').x),
    spread: r3(n(u, 'Specular_Spread')),
    flow: r3(n(u, 'Flow_Speed')),
  };
  if (base?.ripple.map) spec.ripple.map = base.ripple.map;
  if (on('ENABLECAUSTICS')) spec.caustics = r3(n(u, 'Caustics_Strength'));

  if (on('Enable_SurfaceFoam')) {
    const tileX = v2(u, 'SurfFoam_Tile').x;
    const stretch = tileX > 1e-4 ? r3(1 / tileX) : 1;
    const distort = r3(n(u, 'SurfaceDistortion_Strength'));
    spec.scum = {
      map: base?.scum?.map ?? CLOUDY,
      color: srgbRgba(v4(u, 'SurfFoam_Color')),
      scale: r3(n(u, 'SurfFoam_Scale')),
      edge: r3(n(u, 'SurfFoam_Edge')),
      smooth: r3(n(u, 'SurfFoam_EdgeSmooth')),
      drift: r3(-v2(u, 'SurfFoam_Pan').x),
    };
    if (stretch !== 1) spec.scum.stretch = stretch;
    if (distort !== 0) spec.scum.distort = distort;
  }

  if (on('Enable_Intersection')) {
    spec.edge = {
      color: srgbRgba(v4(u, 'InterSec_Color')),
      width: r3(n(u, 'InterSec_Width')),
    };
  }

  if (on('ENABLE_UNDERWATERLAYER')) spec.underwater = srgbRgba(v4(u, 'Underwater_Color'));

  const cross = r3(n(u, 'Normal_CrossAngle'));
  const stretch = r3(n(u, 'Flow_Stretch'));
  const aligned = on('Flow_Aligned');
  const stream = base?.stream ?? (aligned && cross < 40);
  if (stream) spec.stream = true;
  const defaultCross = stream ? 12 : 70;
  const defaultStretch = stream ? 1.5 : 1;
  if (cross !== defaultCross || stretch !== defaultStretch) spec.rippleFlow = { cross, stretch };

  const shading = r3(n(u, 'Normal_Shading'));
  if (shading !== 0.6) spec.shading = shading;
  return spec;
}

export function applyColorPalette(u: WaterUniforms, name: string): boolean {
  const p = COLOR_PALETTES[name];
  if (!p) return false;
  setFromHex(u.Color_Shallow.value as THREE.Vector4, p.shallow, p.shallowAlpha);
  setFromHex(u.Color_Deep.value as THREE.Vector4, p.deep, p.deepAlpha);
  if (p.foam) setFromHex(u.SurfFoam_Color.value as THREE.Vector4, p.foam, (u.SurfFoam_Color.value as THREE.Vector4).w);
  if (p.edge) setFromHex(u.InterSec_Color.value as THREE.Vector4, p.edge, (u.InterSec_Color.value as THREE.Vector4).w);
  return true;
}
