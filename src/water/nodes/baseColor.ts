import { mix } from 'three/tsl';
import type { WaterCtx, DepthData } from './types';

/** Deep-to-shallow color; depthColorMask is 1 at the shoreline. */
export function buildBaseColor(ctx: WaterCtx, d: DepthData) {
  const { u } = ctx;
  return mix(u.Color_Deep, u.Color_Shallow, d.depthColorMask);
}
