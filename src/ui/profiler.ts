// three's Inspector attaches to WebGPURenderer only. The classic WebGLRenderer has no inspector slot.
import type * as THREE from 'three';

export function mountProfiler(_renderer: THREE.WebGLRenderer): null {
  console.warn('[profiler] WebGLRenderer 没有 three Inspector，profile=1 已跳过');
  return null;
}
