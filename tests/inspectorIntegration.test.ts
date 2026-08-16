import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const inspectorUrl = new URL('../src/ui/inspector.ts', import.meta.url);
const inspectorSource = existsSync(inspectorUrl) ? readFileSync(inspectorUrl, 'utf8') : '';
const legacyInspectorUrl = new URL('../src/ui/inspector.tsx', import.meta.url);
const legacySchemaUrl = new URL('../src/ui/inspectorSchema.ts', import.meta.url);
const profilerUrl = new URL('../src/ui/profiler.ts', import.meta.url);

test('implements the lightweight Inspector with lil-gui', () => {
  assert.equal(existsSync(inspectorUrl), true, 'src/ui/inspector.ts is required');
  assert.equal(existsSync(legacyInspectorUrl), false);
  assert.equal(existsSync(legacySchemaUrl), false);
  assert.equal(packageJson.dependencies?.['lil-gui'], '^0.21.0');
  assert.equal(packageJson.dependencies?.leva, undefined);
  assert.equal(packageJson.dependencies?.react, undefined);
  assert.equal(packageJson.dependencies?.['react-dom'], undefined);
  assert.equal(packageJson.devDependencies?.['@types/react'], undefined);
  assert.equal(packageJson.devDependencies?.['@types/react-dom'], undefined);
  assert.match(inspectorSource, /from ['"]lil-gui['"]/);
  assert.match(inspectorSource, /new GUI\(\{ container: host, title: ['"]Water Inspector['"] \}\)/);
  assert.doesNotMatch(inspectorSource, /three\/addons\/inspector/);
  assert.doesNotMatch(inspectorSource, /renderer\.inspector/);
  assert.doesNotMatch(inspectorSource, /from ['"](?:leva|react|react-dom)/);
  assert.doesNotMatch(inspectorSource, /requestAnimationFrame|createElement\(['"](?:canvas|input|select)/);
  assert.doesNotMatch(inspectorSource, /\.listen\(/);
  assert.match(inspectorSource, /controllersRecursive\(\).*updateDisplay\(\)/s);
  assert.match(inspectorSource, /gui\.destroy\(\)/);
  assert.match(
    mainSource,
    /if \(state\.hud\) \{[\s\S]*?await import\(['"]\.\/ui\/inspector['"]\)/,
  );
  assert.doesNotMatch(mainSource, /from ['"]\.\/ui\/inspector['"]/);
});

test('expands only General in the initial view', () => {
  assert.match(inspectorSource, /addFolder\(['"]General['"]\)\.open\(\)/);
  assert.match(inspectorSource, /addFolder\(section\)\.close\(\)/);
  assert.match(inspectorSource, /addFolder\(key\)\.close\(\)/);
});

test('isolates the three.js Profiler behind a dynamic import for profile=1', () => {
  assert.equal(existsSync(profilerUrl), true, 'src/ui/profiler.ts is required');
  assert.match(
    mainSource,
    /if \(state\.profile\) \{[\s\S]*?await import\(['"]\.\/ui\/profiler['"]\)/,
  );
  assert.doesNotMatch(mainSource, /from ['"]\.\/ui\/profiler['"]/);
});
