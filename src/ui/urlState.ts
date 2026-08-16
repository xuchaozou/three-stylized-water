export interface UrlState {
  preset: string | null;
  cam: string | null;
  t: number;
  freeze: boolean;
  hud: boolean;
  profile: boolean;
  /** null uses the standard 30 fps (idle) / 60 fps (active); 0 means unlimited. */
  fps: number | null;
  perf: boolean;
  on: string[];
  off: string[];
  set: Array<[string, number]>;
}

export function parseUrlState(): UrlState {
  const q = new URLSearchParams(location.search);
  const list = (key: string) => (q.get(key) ?? '').split(',').filter(Boolean);
  const number = (key: string, fallback: number) => {
    const raw = q.get(key);
    if (raw === null || raw.trim() === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  const parsedFps = number('fps', -1);
  return {
    preset: q.get('preset'),
    cam: q.get('cam'),
    t: number('t', 10),
    freeze: q.get('freeze') === '1',
    hud: q.get('hud') !== '0',
    profile: q.get('profile') === '1',
    fps: parsedFps >= 0 ? parsedFps : null,
    perf: q.get('perf') === '1',
    on: list('on'),
    off: list('off'),
    set: list('set').map((pair) => {
      const [key, value] = pair.split('=');
      return [key, parseFloat(value)];
    }),
  };
}
