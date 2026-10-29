import { Vector2, Vector3, Vector4 } from 'three';
import type { WaterUniforms } from '../water/uniforms';
import { fromColorControl, hexToRgb, rgbToHex, toColorControl } from './colorControl.ts';

export const INSPECTOR_SECTIONS: Array<[string, Array<keyof WaterUniforms>]> = [
  ['Base', ['Color_Shallow', 'Color_Deep', 'Water_Depth', 'WorldSpaceDepth', 'DistanceMask_Start', 'DistanceMask_Fade', 'ShoreFade', 'ShoreFade_Smoothness']],
  ['Surface Foam', ['Enable_SurfaceFoam', 'SurfFoam_Color', 'SurfFoam_AlphaBlend', 'Invert_SurfFoam', 'SurfFoam_Pan', 'SurfFoam_Scale', 'SurfFoam_Tile', 'SurfFoam_Edge', 'SurfFoam_EdgeSmooth', 'SurfaceDistortion_Scale', 'SurfaceDistortion_Strength', 'SurfaceDistortion_Pan']],
  ['Intersection', ['Enable_Intersection', 'InterSec_Color', 'InterSec_Width', 'InterSec_Dissolve', 'InterSec_Foam_Invert', 'InterSec_Foam_Scale', 'InterSec_Foam_Tile', 'InterSec_Foam_Pan', 'InterSec_Foam_Distortion', 'InterSec_Foam_Smooth', 'InterSec_GradientDissolve', 'InterSec_Edge_Fade', 'InterSec_WallDistance']],
  ['Shoreline', ['ENABLESHORELINE', 'SL_Color', 'SL_WaterDepth', 'SL_Speed', 'SL_Ammount', 'SL_Thickness', 'SL_CenterMask', 'SL_CenterMaskFade', 'SL_Dissolve', 'SL_GradientDissolve', 'SL_MaskPan', 'SL_MaskScale', 'SL_MaskTile', 'SL_EnableTrail', 'SL_Trail_Fade']],
  ['Underwater Layer', ['ENABLE_UNDERWATERLAYER', 'UnderWater_Depth', 'ConformToGeometry', 'Underwater_Color', 'UnderWater_ScaleModifier', 'UnderWater_Start', 'Underwater_Fade']],
  ['Normal', ['ENABLENORMAL', 'Normal_Strength', 'Normal_Pan', 'Normal_Scale', 'Normal_DistanceStrength']],
  ['Lighting', ['ShadowColor', 'Specular_Color', 'Specular_Spread', 'Specular_Hardness', 'Specular_Size']],
  ['Reflection', ['ENABLEPLANERREFLECTION', 'Reflection_Strength', 'Reflection_Fresnel', 'Reflection_Distortion']],
  ['Refraction', ['ENABLEREFRACTION', 'Refraction_Strength', 'Refraction_Distance_Strength', 'Refraction_Distance_Fade', 'Refraction_Physical', 'Refraction_Thickness']],
  ['Flow', ['Flow_Speed', 'Flow_Direction', 'Normal_CrossAngle', 'Flow_Aligned', 'Flow_Stretch', 'Normal_Shading']],
  ['Caustics', ['ENABLECAUSTICS', 'Caustics_Depth', 'Caustics_Pan', 'Caustics_Scale', 'Caustics_Strength', 'Caustics_Distortion_Strength', 'Caustics_Distortion_Scale', 'Caustics_Start', 'Caustics_Fade']],
  ['Waves', ['ENABLEWAVE', 'Wave_Top_Color', 'Wave1_Length', 'Wave1_Height', 'Wave1_Speed', 'Wave1_Direction', 'Wave1_Sharpness', 'Wave2_Length', 'Wave2_Height', 'Wave2_Speed', 'Wave2_Direction', 'Wave2_Sharpness']],
];

type Key = keyof WaterUniforms;

/** A curated, labelled control. `drift` edits a pan vector as one downstream speed (flow-frame -x). */
export type FieldSpec =
  | { kind: 'number'; key: Key; label: string; min: number; max: number; step: number }
  | { kind: 'toggle'; key: Key; label: string }
  | { kind: 'color'; key: Key; label: string }
  | { kind: 'drift'; key: 'SurfFoam_Pan' | 'InterSec_Foam_Pan'; label: string; min: number; max: number; step: number };

const num = (key: Key, label: string, min: number, max: number, step = 0.01): FieldSpec =>
  ({ kind: 'number', key, label, min, max, step });
const toggle = (key: Key, label: string): FieldSpec => ({ kind: 'toggle', key, label });
const color = (key: Key, label: string): FieldSpec => ({ kind: 'color', key, label });

/** Everyday controls, shown first with Chinese labels. Each key appears here or in ADVANCED_SECTIONS, never both. */
export const PRIMARY_SECTIONS: Array<[title: string, fields: FieldSpec[], open: boolean]> = [
  ['基础颜色配置', [
    color('Color_Shallow', '浅水/近壁颜色'),
    color('Color_Deep', '深水颜色'),
    num('Water_Depth', '颜色过渡深度(m)', 0.05, 10),
  ], true],
  ['水流配置', [
    num('Flow_Speed', '流速倍率', 0, 20, 0.05),
    num('Flow_Direction', '水流方向(°)', 0, 360, 1),
    num('Normal_Strength', '波纹强度', 0, 2),
    num('Normal_Scale', '波纹密度', 1, 30, 0.1),
    num('Normal_Pan', '波纹速度', 0, 5),
    num('Normal_CrossAngle', '波纹交错角(°)', 0, 180, 1),
    num('Flow_Stretch', '波纹顺流拉伸', 1, 6, 0.1),
    num('Normal_Shading', '波纹明暗(光照)', 0, 3),
  ], true],
  ['池壁泡沫', [
    toggle('Enable_Intersection', '启用池壁泡沫'),
    color('InterSec_Color', '泡沫颜色'),
    num('InterSec_WallDistance', '贴壁范围(m)', 0, 3),
    num('InterSec_Width', '泡沫带宽度', 0, 1),
    num('InterSec_Dissolve', '泡沫碎裂程度', 0, 4),
    num('InterSec_Foam_Scale', '泡沫颗粒密度', 0.5, 30, 0.1),
    num('InterSec_Foam_Smooth', '泡沫边缘柔和', 0, 1),
    { kind: 'drift', key: 'InterSec_Foam_Pan', label: '泡沫漂移速度', min: 0, max: 2, step: 0.01 },
  ], true],
  ['水面浮渣/泡沫', [
    toggle('Enable_SurfaceFoam', '启用水面浮渣'),
    color('SurfFoam_Color', '浮渣颜色'),
    num('SurfFoam_Edge', '覆盖阈值(越小越多)', 0, 1),
    num('SurfFoam_EdgeSmooth', '边缘柔和', 0, 1),
    num('SurfFoam_Scale', '浮渣尺寸(越大越碎)', 0.1, 20, 0.1),
    num('SurfaceDistortion_Strength', '形状扭曲', 0, 2),
    { kind: 'drift', key: 'SurfFoam_Pan', label: '浮渣漂移速度', min: 0, max: 2, step: 0.01 },
  ], false],
  ['反射与高光', [
    num('Reflection_Strength', '反射强度', 0, 1),
    num('Reflection_Fresnel', '菲涅尔(越大越只在掠射角反射)', 0, 10, 0.1),
    num('Reflection_Distortion', '反射扭曲', 0, 2),
    color('Specular_Color', '高光颜色'),
    num('Specular_Spread', '高光扩散', 0, 1),
  ], false],
  ['折射与焦散', [
    num('Refraction_Strength', '折射强度', 0, 1),
    toggle('ENABLECAUSTICS', '启用池底焦散'),
    num('Caustics_Strength', '焦散强度', 0, 3),
    num('Caustics_Scale', '焦散尺寸', 0.1, 10, 0.1),
  ], false],
  ['波浪', [
    toggle('ENABLEWAVE', '启用几何波浪'),
    num('Wave1_Height', '主波高(m)', 0, 0.2, 0.001),
    num('Wave1_Length', '主波长(m)', 0.2, 10),
    num('Wave2_Height', '次波高(m)', 0, 0.2, 0.001),
    num('Wave2_Length', '次波长(m)', 0.2, 10),
  ], false],
  ['水下悬浮物', [
    toggle('ENABLE_UNDERWATERLAYER', '启用水下悬浮物'),
    color('Underwater_Color', '悬浮物颜色'),
  ], false],
];

const PRIMARY_KEYS = new Set<Key>(PRIMARY_SECTIONS.flatMap(([, fields]) => fields.map((f) => f.key)));

/** The remaining Unity parameters, grouped as in the original shader. */
export const ADVANCED_SECTIONS: Array<[string, Key[]]> = INSPECTOR_SECTIONS
  .map(([section, keys]) => [section, keys.filter((k) => !PRIMARY_KEYS.has(k))] as [string, Key[]])
  .filter(([, keys]) => keys.length > 0);

export const TOGGLE_KEYS = new Set<keyof WaterUniforms>([
  'Flow_Aligned',
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
  'Refraction_Physical',
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
