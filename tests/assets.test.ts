import assert from 'node:assert/strict';
import test from 'node:test';
import { publicAsset } from '../src/assets.ts';

test('resolves public assets from the development root', () => {
  assert.equal(publicAsset('textures/water/foam1.png', '/'), '/textures/water/foam1.png');
});

test('resolves public assets relative to a GitHub Pages project path', () => {
  assert.equal(publicAsset('/terrain/splatmap.png', './'), './terrain/splatmap.png');
});
