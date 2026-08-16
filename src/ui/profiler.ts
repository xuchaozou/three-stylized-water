// Profiling itself adds overhead, so dynamically import it only when profile=1.
import type * as THREE from 'three/webgpu';
import { Inspector } from 'three/addons/inspector/Inspector.js';

export function mountProfiler(renderer: THREE.WebGPURenderer): Inspector {
  const profiler = new Inspector();
  renderer.inspector = profiler;
  profiler.init();
  return profiler;
}
