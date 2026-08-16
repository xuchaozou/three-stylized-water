import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_RENDER_PIXELS, selectPixelRatio } from '../src/rendering/renderResolution.ts';

test('retains DPR 2 on small Retina displays', () => {
  assert.equal(selectPixelRatio(1280, 720, 2), 2);
});

test('keeps the drawing buffer within 4 million pixels on large displays', () => {
  const width = 2560;
  const height = 1323;
  const ratio = selectPixelRatio(width, height, 2);

  assert.ok(ratio > 1 && ratio < 1.1);
  assert.ok(width * height * ratio * ratio <= MAX_RENDER_PIXELS + 1);
});

test('does not raise the device DPR when it is below the limit', () => {
  assert.equal(selectPixelRatio(2560, 1323, 1), 1);
});
