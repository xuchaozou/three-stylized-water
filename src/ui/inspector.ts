import GUI from 'lil-gui';
import { Vector2, Vector3, Vector4 } from 'three/webgpu';
import type { WaterUniforms } from '../water/uniforms';
import {
  applyAlphaControlSnapshot,
  applyColorControlSnapshot,
  INSPECTOR_SECTIONS,
  syncUniformControlSnapshot,
  TOGGLE_KEYS,
  uniformControlSnapshot,
} from './inspectorModel.ts';
import './inspector.css';

type MutableUniform = { value: unknown };
type ControlState = Record<string, any>;

export interface InspectorOptions {
  presetNames: string[];
  currentPreset: string;
  onPreset: (name: string) => void;
  camNames: string[];
  currentCam: string;
  onCam: (name: string) => void;
  onInteraction?: () => void;
  state: { freeze: boolean };
  /** Water bodies that can be edited; switching remounts the inspector for another uniform set. */
  targetNames?: string[];
  currentTarget?: string;
  onTarget?: (name: string) => void;
  /** Named base-color swatches applied directly to the uniforms. */
  paletteNames?: string[];
  onPalette?: (name: string) => void;
  /** One-line description per preset, shown under the preset selector. */
  presetNotes?: Record<string, string>;
}

const FLOW_FIELDS: Array<[key: keyof WaterUniforms, label: string, min: number, max: number, step: number]> = [
  ['Flow_Speed', '流速倍率', 0, 20, 0.05],
  ['Flow_Direction', '水流方向(°)', 0, 360, 1],
  ['Normal_CrossAngle', '波纹交错角(°)', 0, 180, 1],
  ['Normal_Strength', '波纹强度', 0, 2, 0.01],
  ['Normal_Scale', '波纹密度', 1, 30, 0.1],
];

const BASE_COLOR_FIELDS: Array<[key: keyof WaterUniforms, label: string]> = [
  ['Color_Shallow', '浅水/近壁颜色'],
  ['Color_Deep', '深水颜色'],
  ['SurfFoam_Color', '浮渣/泡沫颜色'],
  ['InterSec_Color', '池壁泡沫颜色'],
];

export interface InspectorHandle {
  element: HTMLElement;
  dispose: () => void;
}

export function mountInspector(u: WaterUniforms, opts: InspectorOptions): InspectorHandle {
  const host = document.createElement('aside');
  host.className = 'water-inspector';
  host.dataset.waterInspector = 'light';
  host.setAttribute('aria-label', 'Water parameters');
  document.body.append(host);

  const gui = new GUI({ container: host, title: 'Water Inspector' });
  const controls = uniformControlSnapshot(u) as ControlState;
  const refresh = () => {
    syncUniformControlSnapshot(controls, u);
    gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
  };

  addGeneralControls(gui, opts, refresh);
  addBaseColorControls(gui, u, controls, opts, refresh);
  addFlowControls(gui, u, controls, opts);
  for (const [section, keys] of INSPECTOR_SECTIONS) {
    const folder = gui.addFolder(section).close();
    for (const key of keys) {
      const uniform = u[key] as MutableUniform;
      addUniformControl(folder, String(key), uniform, controls, opts);
    }
  }

  return {
    element: host,
    dispose() {
      gui.destroy();
      host.remove();
    },
  };
}

function addGeneralControls(gui: GUI, opts: InspectorOptions, refresh: () => void) {
  const general = gui.addFolder('General').open();
  const state = {
    target: opts.currentTarget ?? '',
    preset: opts.currentPreset,
    camera: opts.currentCam,
    reset: () => {
      opts.onPreset(state.preset);
      refresh();
    },
  };
  if (opts.targetNames?.length && opts.onTarget) {
    general.add(state, 'target', opts.targetNames).name('编辑水体').onChange(opts.onTarget);
  }
  const info = { note: opts.presetNotes?.[opts.currentPreset] ?? '' };
  general.add(state, 'preset', opts.presetNames).name('Preset').onChange((name: string) => {
    opts.onPreset(name);
    info.note = opts.presetNotes?.[name] ?? '';
    refresh();
  });
  if (opts.presetNotes) general.add(info, 'note').name('工艺说明').disable();
  general.add(state, 'reset').name('重置为预设');
  general.add(state, 'camera', opts.camNames).name('Camera').onChange(opts.onCam);
  general.add(opts.state, 'freeze').name('Freeze Time').onChange(() => opts.onInteraction?.());
}

function addBaseColorControls(
  gui: GUI,
  u: WaterUniforms,
  controls: ControlState,
  opts: InspectorOptions,
  refresh: () => void,
) {
  const folder = gui.addFolder('基础颜色配置').open();
  if (opts.paletteNames?.length && opts.onPalette) {
    const palette = { name: '' };
    folder.add(palette, 'name', opts.paletteNames).name('水色方案').onChange((name: string) => {
      opts.onPalette!(name);
      refresh();
    });
  }
  for (const [key, label] of BASE_COLOR_FIELDS) {
    const color = u[key].value as Vector4;
    folder.addColor(controls, `${key}__color`).name(label).onChange(() => {
      applyColorControlSnapshot(key, color, controls);
      opts.onInteraction?.();
    });
    folder.add(controls, `${key}__alpha`).name(`${label} 不透明度`).min(0).max(1).step(0.01).onChange(() => {
      applyAlphaControlSnapshot(key, color, controls);
      opts.onInteraction?.();
    });
  }
  folder.add(controls, 'Water_Depth').name('颜色过渡深度(m)').min(0.05).max(10).step(0.01).onChange((next: number) => {
    if (!Number.isFinite(next)) return;
    u.Water_Depth.value = next;
    opts.onInteraction?.();
  });
}

function addFlowControls(gui: GUI, u: WaterUniforms, controls: ControlState, opts: InspectorOptions) {
  const folder = gui.addFolder('水流配置').open();
  for (const [key, label, min, max, step] of FLOW_FIELDS) {
    folder.add(controls, key).name(label).min(min).max(max).step(step).onChange((next: number) => {
      if (!Number.isFinite(next)) return;
      (u[key] as MutableUniform).value = next;
      opts.onInteraction?.();
    });
  }
  folder.add(controls, 'Flow_Aligned').name('顺流波纹').onChange((on: boolean) => {
    u.Flow_Aligned.value = on ? 1 : 0;
    opts.onInteraction?.();
  });
}

function addUniformControl(
  folder: GUI,
  key: string,
  uniform: MutableUniform,
  controls: ControlState,
  opts: InspectorOptions,
) {
  const value = uniform.value;
  if (typeof value === 'number') {
    addNumberControl(folder, key, uniform, controls, opts);
  } else if (value instanceof Vector2) {
    addVectorControl(folder, key, value, ['x', 'y'], controls, opts);
  } else if (value instanceof Vector3) {
    addVectorControl(folder, key, value, ['x', 'y', 'z'], controls, opts);
  } else if (value instanceof Vector4) {
    addColorControl(folder, key, value, controls, opts);
  }
}

function addNumberControl(
  folder: GUI,
  key: string,
  uniform: MutableUniform,
  controls: ControlState,
  opts: InspectorOptions,
) {
  if (TOGGLE_KEYS.has(key as keyof WaterUniforms)) {
    folder.add(controls, key).name(key).onChange((enabled: boolean) => {
      uniform.value = enabled ? 1 : 0;
      opts.onInteraction?.();
    });
    return;
  }
  folder.add(controls, key).name(key).step(0.01).onChange((next: number) => {
    if (!Number.isFinite(next)) return;
    uniform.value = next;
    opts.onInteraction?.();
  });
}

function addVectorControl(
  folder: GUI,
  key: string,
  value: Vector2 | Vector3,
  axes: string[],
  controls: ControlState,
  opts: InspectorOptions,
) {
  const vector = controls[key] as Record<string, number>;
  const vectorFolder = folder.addFolder(key).close();
  for (const axis of axes) {
    vectorFolder.add(vector, axis).name(axis).step(0.01).onChange((next: number) => {
      if (!Number.isFinite(next)) return;
      (value as any)[axis] = next;
      opts.onInteraction?.();
    });
  }
}

function addColorControl(
  folder: GUI,
  key: string,
  color: Vector4,
  controls: ControlState,
  opts: InspectorOptions,
) {
  const colorFolder = folder.addFolder(key).close();
  const applyColor = () => {
    applyColorControlSnapshot(key, color, controls);
    opts.onInteraction?.();
  };
  const applyAlpha = () => {
    applyAlphaControlSnapshot(key, color, controls);
    opts.onInteraction?.();
  };
  colorFolder.addColor(controls, `${key}__color`).name('Color').onChange(applyColor);
  if (`${key}__intensity` in controls) {
    colorFolder.add(controls, `${key}__intensity`).name('Intensity').min(1).step(0.01).onChange(applyColor);
  }
  colorFolder.add(controls, `${key}__alpha`).name('Alpha').min(0).max(1).step(0.001).onChange(applyAlpha);
}
