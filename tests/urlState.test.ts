import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUrlState } from '../src/ui/urlState.ts';

function withSearch(search: string, run: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { search },
  });
  try {
    run();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'location', previous);
    else delete (globalThis as { location?: unknown }).location;
  }
}

test('shows the lil-gui Inspector by default and hides it only when hud=0', () => {
  withSearch('', () => assert.equal(parseUrlState().hud, true));
  withSearch('?hud=0', () => assert.equal(parseUrlState().hud, false));
  withSearch('?hud=1', () => assert.equal(parseUrlState().hud, true));
  withSearch('?hud=false', () => assert.equal(parseUrlState().hud, true));
});

test('enables the three.js Profiler only when profile=1', () => {
  withSearch('', () => assert.equal(parseUrlState().profile, false));
  withSearch('?profile=0', () => assert.equal(parseUrlState().profile, false));
  withSearch('?profile=1', () => assert.equal(parseUrlState().profile, true));
});

test('parses uniform overrides for performance measurement', () => {
  withSearch('?t=12.5&freeze=1&fps=0&perf=1&on=A,B&off=C&set=X=1.5,Y=-2', () => {
    const state = parseUrlState();
    assert.equal(state.t, 12.5);
    assert.equal(state.freeze, true);
    assert.equal(state.fps, 0);
    assert.equal(state.perf, true);
    assert.deepEqual(state.on, ['A', 'B']);
    assert.deepEqual(state.off, ['C']);
    assert.deepEqual(state.set, [['X', 1.5], ['Y', -2]]);
  });
});

test('falls back to the standard automatic setting for an invalid fps', () => {
  withSearch('?fps=-1', () => assert.equal(parseUrlState().fps, null));
  withSearch('?fps=not-a-number', () => assert.equal(parseUrlState().fps, null));
  withSearch('?fps=', () => assert.equal(parseUrlState().fps, null));
});

test('falls back to the default shader time when invalid', () => {
  withSearch('?t=not-a-number', () => assert.equal(parseUrlState().t, 10));
  withSearch('?t=', () => assert.equal(parseUrlState().t, 10));
});
