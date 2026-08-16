import assert from 'node:assert/strict';
import test from 'node:test';
import { fromColorControl, hexToRgb, rgbToHex, toColorControl } from '../src/ui/colorControl.ts';
import { srgbToLinear } from '../src/water/uniforms.ts';

const closeTo = (actual: number, expected: number, epsilon = 1e-12) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≉ ${expected}`);
};

test('non-HDR colors round-trip between the sRGB picker and linear uniforms', () => {
  const picked = hexToRgb('#808080');
  const linear = fromColorControl('SurfFoam_Color', picked, 8);
  closeTo(linear.r, srgbToLinear(128 / 255));
  closeTo(linear.g, srgbToLinear(128 / 255));
  closeTo(linear.b, srgbToLinear(128 / 255));

  const control = toColorControl('SurfFoam_Color', linear);
  assert.equal(control.hdr, false);
  assert.equal(control.intensity, 1);
  assert.equal(rgbToHex(control.srgb), '#808080');
});

test('HDR colors round-trip with separate linear hue and intensity', () => {
  const source = { r: 64, g: 16, b: 0 };
  const control = toColorControl('Specular_Color', source);
  assert.equal(control.hdr, true);
  assert.equal(control.intensity, 64);

  const restored = fromColorControl('Specular_Color', control.srgb, control.intensity);
  closeTo(restored.r, source.r);
  closeTo(restored.g, source.g);
  closeTo(restored.b, source.b);
});
