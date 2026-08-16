import { HDR_COLOR_KEYS, srgbToLinear } from '../water/uniforms.ts';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface ColorControlValue {
  hdr: boolean;
  srgb: Rgb;
  intensity: number;
}

export function toColorControl(key: string, linear: Rgb): ColorControlValue {
  const hdr = HDR_COLOR_KEYS.has(key);
  const intensity = hdr ? Math.max(1, linear.r, linear.g, linear.b) : 1;
  return {
    hdr,
    intensity,
    srgb: {
      r: linearToSrgb(linear.r / intensity),
      g: linearToSrgb(linear.g / intensity),
      b: linearToSrgb(linear.b / intensity),
    },
  };
}

export function fromColorControl(key: string, srgb: Rgb, intensity: number): Rgb {
  const multiplier = HDR_COLOR_KEYS.has(key) ? intensity : 1;
  return {
    r: srgbToLinear(srgb.r) * multiplier,
    g: srgbToLinear(srgb.g) * multiplier,
    b: srgbToLinear(srgb.b) * multiplier,
  };
}

export function rgbToHex(rgb: Rgb): string {
  const channel = (value: number) => Math.round(clamp01(value) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  };
}

function linearToSrgb(value: number): number {
  return value <= 0.0031308
    ? value * 12.92
    : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
