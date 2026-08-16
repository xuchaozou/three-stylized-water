import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector4 } from 'three/webgpu';
import { createWaterUniforms } from '../src/water/uniforms.ts';
import {
  applyAlphaControlSnapshot,
  applyColorControlSnapshot,
  INSPECTOR_SECTIONS,
  syncUniformControlSnapshot,
  uniformControlSnapshot,
} from '../src/ui/inspectorModel.ts';

test('Inspector sections cover every water uniform without duplicates', () => {
  const uniforms = createWaterUniforms();
  const keys = INSPECTOR_SECTIONS.flatMap(([, sectionKeys]) => sectionKeys);

  assert.deepEqual([...keys].sort(), Object.keys(uniforms).sort());
  assert.equal(new Set(keys).size, keys.length);
});

test('the lil-gui sync snapshot preserves numbers, toggles, vectors, and colors', () => {
  const uniforms = createWaterUniforms();
  const snapshot = uniformControlSnapshot(uniforms);

  assert.equal(snapshot.Water_Depth, 0.3);
  assert.equal(snapshot.Enable_SurfaceFoam, true);
  assert.deepEqual(snapshot.SurfFoam_Pan, { x: 0.1, y: 0.1 });
  assert.deepEqual(snapshot.Wave1_Direction, { x: 1, y: 0, z: 0 });
  assert.equal(snapshot.Color_Shallow__intensity, 1);
  assert.equal(snapshot.Color_Shallow__alpha, 0);
  assert.equal(typeof snapshot.Color_Shallow__color, 'string');
});

test('syncs the entire snapshot after applying a preset while preserving vector references', () => {
  const uniforms = createWaterUniforms();
  const snapshot = uniformControlSnapshot(uniforms);
  const pan = snapshot.SurfFoam_Pan;

  uniforms.Water_Depth.value = 7;
  uniforms.Enable_SurfaceFoam.value = 0;
  uniforms.SurfFoam_Pan.value.set(2, 3);
  (uniforms.Color_Shallow.value as Vector4).set(4, 0, 0, 0.5);
  syncUniformControlSnapshot(snapshot, uniforms);

  assert.equal(snapshot.Water_Depth, 7);
  assert.equal(snapshot.Enable_SurfaceFoam, false);
  assert.strictEqual(snapshot.SurfFoam_Pan, pan);
  assert.deepEqual(snapshot.SurfFoam_Pan, { x: 2, y: 3 });
  assert.equal(snapshot.Color_Shallow__intensity, 4);
  assert.equal(snapshot.Color_Shallow__alpha, 0.5);
});

test('syncs internal HDR intensity to new uniform values after applying a preset', () => {
  const uniforms = createWaterUniforms();
  const controls = uniformControlSnapshot(uniforms);
  const color = uniforms.Color_Shallow.value as Vector4;

  color.set(4, 0, 0, 1);
  syncUniformControlSnapshot(controls, uniforms);
  controls.Color_Shallow__color = '#00ff00';
  applyColorControlSnapshot('Color_Shallow', color, controls);

  assert.deepEqual([color.x, color.y, color.z], [0, 4, 0]);
});

test('lil-gui color controls preserve the non-HDR color space and HDR intensity', () => {
  const uniforms = createWaterUniforms();
  const controls = uniformControlSnapshot(uniforms);
  controls.SurfFoam_Color__color = '#808080';
  applyColorControlSnapshot('SurfFoam_Color', uniforms.SurfFoam_Color.value as Vector4, controls);
  const foamValue = uniforms.SurfFoam_Color.value as Vector4;
  assert.ok(Math.abs(foamValue.x - 0.21586) < 1e-4);

  const shallowValue = uniforms.Color_Shallow.value as Vector4;
  controls.Color_Shallow__intensity = 2;
  applyColorControlSnapshot('Color_Shallow', shallowValue, controls);
  assert.ok(Math.max(shallowValue.x, shallowValue.y, shallowValue.z) > 1.64);
  assert.ok(Math.max(shallowValue.x, shallowValue.y, shallowValue.z) < 1.65);
  controls.Color_Shallow__intensity = 3;
  applyColorControlSnapshot('Color_Shallow', shallowValue, controls);
  assert.ok(Math.max(shallowValue.x, shallowValue.y, shallowValue.z) > 2.46);
  assert.ok(Math.max(shallowValue.x, shallowValue.y, shallowValue.z) < 2.47);
  controls.Color_Shallow__color = '#ff0000';
  applyColorControlSnapshot('Color_Shallow', shallowValue, controls);
  assert.equal(shallowValue.x, 3);
  assert.equal(shallowValue.y, 0);
  assert.equal(shallowValue.z, 0);
});

test('alpha controls update only alpha without quantizing RGB', () => {
  const uniforms = createWaterUniforms();
  const controls = uniformControlSnapshot(uniforms);
  const color = uniforms.Color_Shallow.value as Vector4;
  const rgb = [color.x, color.y, color.z];

  controls.Color_Shallow__alpha = 0.75;
  applyAlphaControlSnapshot('Color_Shallow', color, controls);

  assert.deepEqual([color.x, color.y, color.z], rgb);
  assert.equal(color.w, 0.75);
});
