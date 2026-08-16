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
  const refresh = () => {
    syncUniformControlSnapshot(controls, u);
    gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
  };

  addGeneralControls(gui, opts, refresh);
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
    preset: opts.currentPreset,
    camera: opts.currentCam,
  };
  general.add(state, 'preset', opts.presetNames).name('Preset').onChange((name: string) => {
    opts.onPreset(name);
    refresh();
  });
  general.add(state, 'camera', opts.camNames).name('Camera').onChange(opts.onCam);
  general.add(opts.state, 'freeze').name('Freeze Time').onChange(() => opts.onInteraction?.());
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
