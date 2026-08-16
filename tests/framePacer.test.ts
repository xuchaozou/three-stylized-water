import assert from 'node:assert/strict';
import test from 'node:test';
import { FramePacer } from '../src/rendering/FramePacer.ts';

test('throttles to approximately 30fps while idle', () => {
  const pacer = new FramePacer({ idleFps: 30, activeFps: 60, activeHoldMs: 250 });

  assert.equal(pacer.shouldRender(0), true);
  assert.equal(pacer.shouldRender(16.7), false);
  assert.equal(pacer.shouldRender(33.4), true);
  assert.equal(pacer.shouldRender(50.1), false);
  assert.equal(pacer.shouldRender(66.8), true);
});

test('raises the rate to approximately 60fps after camera input and returns to 30fps after the hold period', () => {
  const pacer = new FramePacer({ idleFps: 30, activeFps: 60, activeHoldMs: 250 });

  assert.equal(pacer.shouldRender(0), true);
  assert.equal(pacer.shouldRender(33.4), true);
  pacer.noteActivity(40);
  assert.equal(pacer.shouldRender(50.1), true);
  assert.equal(pacer.shouldRender(66.8), true);
  assert.equal(pacer.shouldRender(283.9), true);
  assert.equal(pacer.shouldRender(300.6), false);
  assert.equal(pacer.shouldRender(317.3), true);
});

test('fps=0 allows every frame through for performance measurement', () => {
  const pacer = new FramePacer({ idleFps: 0, activeFps: 0, activeHoldMs: 0 });

  assert.equal(pacer.shouldRender(0), true);
  assert.equal(pacer.shouldRender(0.1), true);
  assert.equal(pacer.shouldRender(0.2), true);
});

test('always renders the next frame after explicit invalidation', () => {
  const pacer = new FramePacer({ idleFps: 30, activeFps: 60, activeHoldMs: 250 });

  assert.equal(pacer.shouldRender(0), true);
  assert.equal(pacer.shouldRender(10), false);
  pacer.forceNextFrame();
  assert.equal(pacer.shouldRender(11), true);
});

test('carries deadline error forward to maintain the target fps at high refresh rates', () => {
  for (const targetFps of [30, 60]) {
    for (const displayFps of [75, 90, 120, 144, 165]) {
      const pacer = new FramePacer({
        idleFps: targetFps,
        activeFps: targetFps,
        activeHoldMs: 0,
      });
      let renders = 0;
      const displayInterval = 1000 / displayFps;
      for (let now = 0; now <= 10_000; now += displayInterval) {
        if (pacer.shouldRender(now)) renders++;
      }
      assert.ok(
        Math.abs(renders - (targetFps * 10 + 1)) <= 1,
        `${renders} frames / 10s at ${displayFps}Hz / target ${targetFps}fps`,
      );
    }
  }
});

test('does not produce a catch-up burst after a long frame', () => {
  const pacer = new FramePacer({ idleFps: 30, activeFps: 60, activeHoldMs: 0 });

  assert.equal(pacer.shouldRender(0), true);
  assert.equal(pacer.shouldRender(16.7), false);
  assert.equal(pacer.shouldRender(33.4), true);
  assert.equal(pacer.shouldRender(50.1), false);
  assert.equal(pacer.shouldRender(83.4), true); // One rAF is missed.
  assert.equal(pacer.shouldRender(100.1), false); // Suppress the immediate catch-up.
  assert.equal(pacer.shouldRender(116.8), true);
});

test('relearns when the display refresh rate decreases', () => {
  const pacer = new FramePacer({ idleFps: 60, activeFps: 60, activeHoldMs: 0 });
  let rendersAfterChange = 0;

  for (let now = 0; now < 1_000; now += 1000 / 120) pacer.shouldRender(now);
  for (let now = 1_000; now <= 11_000; now += 1000 / 75) {
    if (pacer.shouldRender(now)) rendersAfterChange++;
  }

  assert.ok(rendersAfterChange >= 595, `${rendersAfterChange} frames / 10s after 120Hz→75Hz`);
});
