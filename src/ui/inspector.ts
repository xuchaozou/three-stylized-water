import GUI from 'lil-gui';
import { Vector2, Vector3, Vector4 } from 'three';
import type { WaterUniforms } from '../water/uniforms';
import {
  ADVANCED_SECTIONS,
  applyAlphaControlSnapshot,
  applyColorControlSnapshot,
  type FieldSpec,
  PRIMARY_SECTIONS,
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
  /** Also list the remaining raw Unity parameters (demo scene); the plant scene keeps only curated ones. */
  advanced?: boolean;
  /** Save the current values as the selected preset's override (and log the JSON). */
  onSave?: (presetName: string) => void;
  /** Drop the saved override so the preset returns to its original definition. */
  onClearSaved?: (presetName: string) => void;
}

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
  const syncHooks: Array<() => void> = [];
  const refresh = () => {
    syncUniformControlSnapshot(controls, u);
    syncHooks.forEach((sync) => sync());
    gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
  };

  addGeneralControls(gui, opts, refresh);
  for (const [title, fields, open] of PRIMARY_SECTIONS) {
    const folder = gui.addFolder(title);
    if (!open) folder.close();
    if (title === '基础颜色配置') addPaletteControl(folder, opts, refresh);
    for (const field of fields) addFieldControl(folder, field, u, controls, opts, syncHooks);
  }
  if (opts.advanced) {
    const advanced = gui.addFolder('高级参数 (Unity)').close();
    for (const [section, keys] of ADVANCED_SECTIONS) {
      const folder = advanced.addFolder(section).close();
      for (const key of keys) {
        const uniform = u[key] as MutableUniform;
        addUniformControl(folder, String(key), uniform, controls, opts);
      }
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
  if (opts.onSave) {
    const actions = {
      save: () => opts.onSave!(state.preset),
      clear: () => opts.onClearSaved?.(state.preset),
    };
    general.add(actions, 'save').name('保存配置');
    if (opts.onClearSaved) general.add(actions, 'clear').name('清除已保存修改');
  }
  general.add(state, 'camera', opts.camNames).name('Camera').onChange(opts.onCam);
  general.add(opts.state, 'freeze').name('Freeze Time').onChange(() => opts.onInteraction?.());
}

function addPaletteControl(folder: GUI, opts: InspectorOptions, refresh: () => void) {
  if (!opts.paletteNames?.length || !opts.onPalette) return;
  const palette = { name: '' };
  folder.add(palette, 'name', opts.paletteNames).name('水色方案').onChange((name: string) => {
    opts.onPalette!(name);
    refresh();
  });
}

function addFieldControl(
  folder: GUI,
  field: FieldSpec,
  u: WaterUniforms,
  controls: ControlState,
  opts: InspectorOptions,
  syncHooks: Array<() => void>,
) {
  const key = field.key;
  const uniform = u[key] as MutableUniform;
  switch (field.kind) {
    case 'number':
      folder.add(controls, key).name(field.label).min(field.min).max(field.max).step(field.step)
        .onChange((next: number) => {
          if (!Number.isFinite(next)) return;
          uniform.value = next;
          opts.onInteraction?.();
        });
      return;
    case 'toggle':
      folder.add(controls, key).name(field.label).onChange((on: boolean) => {
        uniform.value = on ? 1 : 0;
        opts.onInteraction?.();
      });
      return;
    case 'color': {
      const color = uniform.value as Vector4;
      folder.addColor(controls, `${key}__color`).name(field.label).onChange(() => {
        applyColorControlSnapshot(key, color, controls);
        opts.onInteraction?.();
      });
      // Specular is additive HDR: it needs an intensity, and its alpha is unused.
      if (key === 'Specular_Color') {
        folder.add(controls, `${key}__intensity`).name(`${field.label} 强度`).min(1).max(20).step(0.1).onChange(() => {
          applyColorControlSnapshot(key, color, controls);
          opts.onInteraction?.();
        });
        return;
      }
      folder.add(controls, `${key}__alpha`).name(`${field.label} 不透明度`).min(0).max(1).step(0.01).onChange(() => {
        applyAlphaControlSnapshot(key, color, controls);
        opts.onInteraction?.();
      });
      return;
    }
    case 'drift': {
      // Panners add `pan * t` to the flow-frame UV, so a negative x moves the pattern downstream.
      const pan = uniform.value as Vector2;
      const state = { speed: -pan.x };
      syncHooks.push(() => { state.speed = -pan.x; });
      folder.add(state, 'speed').name(field.label).min(field.min).max(field.max).step(field.step)
        .onChange((next: number) => {
          if (!Number.isFinite(next)) return;
          pan.set(-next, 0);
          opts.onInteraction?.();
        });
    }
  }
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
