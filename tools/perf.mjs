#!/usr/bin/env node
// Normal load (default):
//   node tools/perf.mjs --cams main --presets tropical
//   node tools/perf.mjs --dpr 2 --target-fps 30 --max-gpu-p50 40
// Maximum throughput (disables VSync and the frame-rate limit):
//   node tools/perf.mjs --mode throughput --cams main --presets tropical
//
// runtime measures the real application's render intervals and buffer dimensions, plus system-wide GPU utilization on macOS.
// throughput is a stress test of frame submission rate, not a measure of power efficiency.
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';

const execFileAsync = promisify(execFile);
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')
    ? argv[index + 1]
    : fallback;
};
const numberOpt = (name, fallback) => Number(opt(name, String(fallback)));
const boolOpt = (name, fallback) => opt(name, fallback ? '1' : '0') === '1';

const mode = opt('mode', 'runtime');
if (!['runtime', 'throughput'].includes(mode)) {
  throw new Error(`--mode must be runtime or throughput: ${mode}`);
}

const cams = opt('cams', 'main,low,top,shore,far').split(',').filter(Boolean);
const presets = opt('presets', 'tropical,wavy2,clear').split(',').filter(Boolean);
const base = opt('url', 'http://localhost:5180');
const channel = opt('channel', 'chrome');
const width = numberOpt('width', 1920);
const height = numberOpt('height', 1080);
const dpr = numberOpt('dpr', mode === 'runtime' ? 2 : 1);
const targetFps = numberOpt('target-fps', mode === 'runtime' ? 30 : 0);
const settleSeconds = numberOpt('settle-seconds', mode === 'runtime' ? 25 : 0);
const samples = numberOpt('samples', mode === 'runtime' ? 120 : 400);
const warmup = numberOpt('warmup', mode === 'runtime' ? 30 : 120);
const timeout = numberOpt('timeout', 120000);
const jsonOut = opt('json', '');
const label = opt('label', '');
const extra = opt('extra', '');
const overrides = Object.fromEntries(
  ['on', 'off', 'set'].map((key) => [key, opt(key, '')]),
);
const headless = boolOpt('headless', mode === 'throughput');
const sampleSystemGpu = boolOpt('system-gpu', mode === 'runtime' && process.platform === 'darwin');
const minFps = numberOpt('min-fps', targetFps > 0 ? targetFps * 0.8 : 0);
const maxFps = numberOpt('max-fps', targetFps > 0 ? targetFps * 1.1 : 0);
const maxMeanMs = numberOpt('max-mean-ms', 0);
const maxP95Ms = numberOpt('max-p95-ms', 0);
const maxGpuP50 = numberOpt('max-gpu-p50', 0);
const maxGpuP95 = numberOpt('max-gpu-p95', 0);

for (const [name, value] of Object.entries({ width, height, dpr, samples, warmup, timeout })) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
}
for (const [name, value] of Object.entries({ width, height, samples, warmup, timeout })) {
  if (!Number.isInteger(value)) throw new Error(`--${name} must be an integer`);
}
for (const [name, value] of [
  ['target-fps', targetFps],
  ['settle-seconds', settleSeconds],
  ['min-fps', minFps],
  ['max-fps', maxFps],
  ['max-mean-ms', maxMeanMs],
  ['max-p95-ms', maxP95Ms],
  ['max-gpu-p50', maxGpuP50],
  ['max-gpu-p95', maxGpuP95],
]) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be a non-negative number`);
}
if (samples >= 4096) throw new Error('--samples must be 4095 or less');
if (cams.length === 0 || presets.length === 0) throw new Error('--cams and --presets each require at least one entry');
if (minFps > 0 && maxFps > 0 && minFps > maxFps) {
  throw new Error('--min-fps must be less than or equal to --max-fps');
}

const stats = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: quantile(0.5),
    p95: quantile(0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
};

async function readMacGpuUtilization() {
  try {
    const { stdout } = await execFileAsync(
      'ioreg',
      ['-r', '-c', 'IOAccelerator', '-l', '-d', '1'],
      { maxBuffer: 2 * 1024 * 1024 },
    );
    const match = stdout.match(/"Device Utilization %"=(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function startSystemGpuSampler() {
  const values = [];
  let running = true;
  const done = (async () => {
    while (running) {
      const value = await readMacGpuUtilization();
      if (value !== null) values.push(value);
      if (running) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();
  return {
    values,
    async stop() {
      running = false;
      await done;
    },
  };
}

const browserArgs = [
  '--enable-unsafe-webgpu',
  '--enable-features=WebGPU',
  '--use-angle=metal',
  '--hide-scrollbars',
];
if (mode === 'throughput') {
  browserArgs.push(
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  );
}

const browser = await chromium.launch({
  channel,
  headless,
  args: browserArgs,
});
const browserVersion = browser.version();

const rows = [];
const failures = [];
try {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  for (const preset of presets) {
    for (const cam of cams) {
      pageErrors.length = 0;
      const params = new URLSearchParams({
        cam,
        preset,
        freeze: '0',
        hud: '0',
        t: '10',
        fps: String(targetFps),
        perf: '1',
      });
      for (const key of ['on', 'off', 'set']) {
        const value = overrides[key];
        if (value) params.set(key, value);
      }
      for (const [key, value] of new URLSearchParams(extra)) params.set(key, value);
      params.set('fps', String(targetFps));
      params.set('perf', '1');

      await page.goto(`${base}/?${params}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction('window.__READY === true || window.__INIT_ERROR', null, { timeout });
      const initError = await page.evaluate('window.__INIT_ERROR ?? null');
      if (initError) throw new Error(`INIT_ERROR ${preset}/${cam}: ${initError}`);

      const backend = await page.evaluate('window.__BACKEND');
      if (backend !== 'webgpu') throw new Error(`backend is ${backend}, not webgpu`);
      if (settleSeconds > 0) await page.waitForTimeout(settleSeconds * 1000);

      const warmupStartedAt = await page.evaluate('window.__PERF.count');
      await page.waitForFunction(
        ({ startedAt, count }) => window.__PERF?.count >= startedAt + count,
        { startedAt: warmupStartedAt, count: warmup },
        { timeout },
      );
      const startedAt = await page.evaluate('window.__PERF.count');
      const gpuSampler = sampleSystemGpu ? startSystemGpuSampler() : null;
      try {
        await page.waitForFunction(
          ({ startedAt, count }) => window.__PERF?.count >= startedAt + count,
          { startedAt, count: samples },
          { timeout },
        );
      } finally {
        if (gpuSampler) await gpuSampler.stop();
      }

      const measured = await page.evaluate(
        (count) => {
          const timestamps = window.__PERF.timestamps.slice(-(count + 1));
          const intervals = timestamps.slice(1).map((value, i) => value - timestamps[i]);
          const canvas = document.querySelector('#app > canvas');
          return {
            intervals,
            actualCam: window.__PERF.cam,
            actualPreset: window.__PERF.preset,
            cssWidth: innerWidth,
            cssHeight: innerHeight,
            deviceDpr: devicePixelRatio,
            bufferWidth: canvas?.width ?? null,
            bufferHeight: canvas?.height ?? null,
            bufferPixels: canvas ? canvas.width * canvas.height : null,
            renderPixelRatio: canvas
              ? Math.sqrt((canvas.width * canvas.height) / (innerWidth * innerHeight))
              : null,
          };
        },
        samples,
      );

      const frame = stats(measured.intervals);
      const systemGpu = stats(gpuSampler?.values ?? []);
      const renderFps = 1000 / frame.mean;
      const { intervals, ...dimensions } = measured;
      const prefix = `${preset}/${cam}`;
      if (sampleSystemGpu && !systemGpu) {
        failures.push(`${prefix}: unable to obtain system GPU utilization`);
      }
      const row = {
        preset,
        cam,
        backend,
        renderFps,
        frame,
        systemGpu,
        ...dimensions,
        frameSamples: intervals,
        systemGpuSamples: [...(gpuSampler?.values ?? [])],
        pageErrors: [...pageErrors],
      };
      rows.push(row);

      const gpuText = !sampleSystemGpu
        ? ''
        : systemGpu
          ? `  system GPU p50 ${systemGpu.p50.toFixed(0)}% p95 ${systemGpu.p95.toFixed(0)}%`
          : '  system GPU N/A';
      console.log(
        `${mode.padEnd(10)} ${preset.padEnd(9)} ${cam.padEnd(6)} ` +
        `${renderFps.toFixed(1)}fps  mean ${frame.mean.toFixed(2)}ms  p95 ${frame.p95.toFixed(2)}ms  ` +
        `${measured.bufferWidth}x${measured.bufferHeight} ` +
        `device DPR ${measured.deviceDpr} render DPR ${measured.renderPixelRatio?.toFixed(2)}${gpuText}`,
      );

      if (measured.actualCam !== cam || measured.actualPreset !== preset) {
        failures.push(
          `${prefix}: actual value is ${measured.actualPreset}/${measured.actualCam} (invalid selection)`,
        );
      }
      if (pageErrors.length) failures.push(`${prefix}: pageerror ${pageErrors.join(' | ')}`);
      if (minFps > 0 && renderFps < minFps) failures.push(`${prefix}: ${renderFps.toFixed(1)}fps < ${minFps}`);
      if (maxFps > 0 && renderFps > maxFps) failures.push(`${prefix}: ${renderFps.toFixed(1)}fps > ${maxFps}`);
      if (maxMeanMs > 0 && frame.mean > maxMeanMs) failures.push(`${prefix}: mean ${frame.mean.toFixed(2)}ms > ${maxMeanMs}ms`);
      if (maxP95Ms > 0 && frame.p95 > maxP95Ms) failures.push(`${prefix}: p95 ${frame.p95.toFixed(2)}ms > ${maxP95Ms}ms`);
      if (maxGpuP50 > 0 && (!systemGpu || systemGpu.p50 > maxGpuP50)) {
        failures.push(`${prefix}: system GPU p50 ${systemGpu?.p50 ?? 'N/A'}% > ${maxGpuP50}%`);
      }
      if (maxGpuP95 > 0 && (!systemGpu || systemGpu.p95 > maxGpuP95)) {
        failures.push(`${prefix}: system GPU p95 ${systemGpu?.p95 ?? 'N/A'}% > ${maxGpuP95}%`);
      }
    }
  }
} finally {
  await browser.close();
}

const result = {
  label,
  mode,
  generatedAt: new Date().toISOString(),
  platform: `${process.platform}/${process.arch}`,
  node: process.version,
  browser: browserVersion,
  channel,
  base,
  extra,
  overrides,
  width,
  height,
  dpr,
  targetFps,
  settleSeconds,
  samples,
  warmup,
  headless,
  sampleSystemGpu,
  thresholds: { minFps, maxFps, maxMeanMs, maxP95Ms, maxGpuP50, maxGpuP95 },
  rows,
  failures,
};
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(result, null, 2));
  console.log(`saved ${jsonOut}`);
}

if (failures.length) {
  console.error('\nPERF FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`\nPERF PASS (${rows.length} configurations)`);
}
