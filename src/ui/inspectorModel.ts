import { Vector2, Vector3, Vector4 } from 'three/webgpu';
import type { WaterUniforms } from '../water/uniforms';
import { fromColorControl, hexToRgb, rgbToHex, toColorControl } from './colorControl.ts';

export const INSPECTOR_SECTIONS: Array<[string, Array<keyof WaterUniforms>]> = [
  ['Base', ['Color_Shallow', 'Color_Deep', 'Water_Depth', 'WorldSpaceDepth', 'DistanceMask_Start', 'DistanceMask_Fade', 'ShoreFade', 'ShoreFade_Smoothness']],
  ['Surface Foam', ['Enable_SurfaceFoam', 'SurfFoam_Color', 'SurfFoam_AlphaBlend', 'Invert_SurfFoam', 'SurfFoam_Pan', 'SurfFoam_Scale', 'SurfFoam_Tile', 'SurfFoam_Edge', 'SurfFoam_EdgeSmooth', 'SurfaceDistortion_Scale', 'SurfaceDistortion_Strength', 'SurfaceDistortion_Pan']],
  ['Intersection', ['Enable_Intersection', 'InterSec_Color', 'InterSec_Width', 'InterSec_Dissolve', 'InterSec_Foam_Invert', 'InterSec_Foam_Scale', 'InterSec_Foam_Tile', 'InterSec_Foam_Pan', 'InterSec_Foam_Distortion', 'InterSec_Foam_Smooth', 'InterSec_GradientDissolve', 'InterSec_Edge_Fade']],
  ['Shoreline', ['ENABLESHORELINE', 'SL_Color', 'SL_WaterDepth', 'SL_Speed', 'SL_Ammount', 'SL_Thickness', 'SL_CenterMask', 'SL_CenterMaskFade', 'SL_Dissolve', 'SL_GradientDissolve', 'SL_MaskPan', 'SL_MaskScale', 'SL_MaskTile', 'SL_EnableTrail', 'SL_Trail_Fade']],
  ['Underwater Layer', ['ENABLE_UNDERWATERLAYER', 'UnderWater_Depth', 'ConformToGeometry', 'Underwater_Color', 'UnderWater_ScaleModifier', 'UnderWater_Start', 'Underwater_Fade']],
  ['Normal', ['ENABLENORMAL', 'Normal_Strength', 'Normal_Pan', 'Normal_Scale', 'Normal_DistanceStrength']],
  ['Lighting', ['ShadowColor', 'Specular_Color', 'Specular_Spread', 'Specular_Hardness', 'Specular_Size']],
  ['Reflection', ['ENABLEPLANERREFLECTION', 'Reflection_Strength', 'Reflection_Fresnel', 'Reflection_Distortion']],
  ['Refraction', ['ENABLEREFRACTION', 'Refraction_Strength', 'Refraction_Distance_Strength', 'Refraction_Distance_Fade']],
  ['Caustics', ['ENABLECAUSTICS', 'Caustics_Depth', 'Caustics_Pan', 'Caustics_Scale', 'Caustics_Strength', 'Caustics_Distortion_Strength', 'Caustics_Distortion_Scale', 'Caustics_Start', 'Caustics_Fade']],
  ['Waves', ['ENABLEWAVE', 'Wave_Top_Color', 'Wave1_Length', 'Wave1_Height', 'Wave1_Speed', 'Wave1_Direction', 'Wave1_Sharpness', 'Wave2_Length', 'Wave2_Height', 'Wave2_Speed', 'Wave2_Direction', 'Wave2_Sharpness']],
];

export const TOGGLE_KEYS = new Set<keyof WaterUniforms>([
  'WorldSpaceDepth',
  'ShoreFade',
  'Enable_SurfaceFoam',
  'Invert_SurfFoam',
  'Enable_Intersection',
  'InterSec_Foam_Invert',
  'InterSec_GradientDissolve',
  'ENABLESHORELINE',
  'SL_EnableTrail',
  'ENABLE_UNDERWATERLAYER',
  'ConformToGeometry',
  'ENABLENORMAL',
  'ENABLEPLANERREFLECTION',
  'ENABLEREFRACTION',
  'ENABLECAUSTICS',
  'ENABLEWAVE',
]);

export function uniformControlSnapshot(u: WaterUniforms): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const [, keys] of INSPECTOR_SECTIONS) {
    for (const key of keys) addUniformSnapshot(snapshot, String(key), (u[key] as { value: unknown }).value);
  }
  return snapshot;
}

export function syncUniformControlSnapshot(
  target: Record<string, unknown>,
  u: WaterUniforms,
): void {
  const source = uniformControlSnapshot(u);
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (isVectorSnapshot(current) && isVectorSnapshot(value)) Object.assign(current, value);
    else target[key] = value;
  }
}

export function applyColorControlSnapshot(
  key: string,
  color: Vector4,
  controls: Record<string, unknown>,
): void {
  const hex = controls[`${key}__color`];
  const intensity = controls[`${key}__intensity`] ?? 1;
  if (typeof hex === 'string' && typeof intensity === 'number' && Number.isFinite(intensity)) {
    const linear = fromColorControl(key, hexToRgb(hex), intensity);
    color.setX(linear.r);
    color.setY(linear.g);
    color.setZ(linear.b);
  }
}

export function applyAlphaControlSnapshot(
  key: string,
  color: Vector4,
  controls: Record<string, unknown>,
): void {
  const alpha = controls[`${key}__alpha`];
  if (typeof alpha === 'number' && Number.isFinite(alpha)) color.w = alpha;
}

function addUniformSnapshot(snapshot: Record<string, unknown>, key: string, value: unknown) {
  if (typeof value === 'number') {
    snapshot[key] = TOGGLE_KEYS.has(key as keyof WaterUniforms) ? value >= 0.5 : value;
  } else if (value instanceof Vector2) {
    snapshot[key] = { x: value.x, y: value.y };
  } else if (value instanceof Vector3) {
    snapshot[key] = { x: value.x, y: value.y, z: value.z };
  } else if (value instanceof Vector4) {
    const color = toColorControl(key, { r: value.x, g: value.y, b: value.z });
    snapshot[`${key}__color`] = rgbToHex(color.srgb);
    if (color.hdr) snapshot[`${key}__intensity`] = color.intensity;
    snapshot[`${key}__alpha`] = value.w;
  }
}

function isVectorSnapshot(value: unknown): value is Record<string, number> {
  return typeof value === 'object' && value !== null;
}
