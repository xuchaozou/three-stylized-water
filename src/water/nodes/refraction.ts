import {
  cameraPosition,
  float,
  mix,
  positionWorld,
  screenUV,
  step,
  viewportSharedTexture,
} from 'three/tsl';
import type { WaterCtx, DepthData } from './types';
import { sceneEyeDepthAt } from './depth';
import { buildUnscaledNormalMapSample } from './normals';

export interface RefractionData {
  uv: any;
  sceneColor: any;
}

/** Eye distance [m] at which the physical offset equals the Unity one; farther pixels shrink as 1/d. */
const PHYS_REF_DISTANCE = 4;
/** Depth margin [m] over which the physical variant fades its offset near occluders. */
const PHYS_KEEP_FADE = 0.3;

/** ENABLEREFRACTION=0 must return screenUV and the unmodified scene color. */
export function buildRefraction(ctx: WaterCtx, depthS: DepthData): RefractionData {
  const { u } = ctx;

  // Unity refraction uses the unscaled two-sample normal, unaffected by Normal_Strength or DistanceMask.
  const N = buildUnscaledNormalMapSample(ctx);

  // Spread 5 is hard-coded in the compiled HLSL (L1378).
  const far01 = cameraPosition
    .distance(positionWorld)
    .sub(u.Refraction_Distance_Fade)
    .div(5)
    .saturate();
  const strength = mix(
    depthS.shoreFadeMask.mul(u.Refraction_Strength),
    u.Refraction_Distance_Strength,
    far01,
  );

  // Unity's offset is a constant screen fraction, so close up it shears the underwater image by tens of
  // pixels and its hard depth test tears into vertical sheets below walls. The physical variant scales by
  // the water column the ray crosses and by 1/distance, so it vanishes at the waterline.
  const thickness = depthS.sceneEyeDepth.sub(depthS.eyeDepth).max(0);
  const physScale = thickness
    .div(u.Refraction_Thickness.max(1e-3))
    .saturate()
    .mul(float(PHYS_REF_DISTANCE).div(depthS.eyeDepth.max(PHYS_REF_DISTANCE)));
  const scale = mix(float(1), physScale, u.Refraction_Physical);

  // The 0.1 UV-offset scale is hard-coded in the compiled HLSL (L1382).
  const offset = N.xy.mul(strength.mul(0.1)).mul(scale);
  const uvOff = screenUV.add(offset);

  // Cancel the offset when its destination is in front of the water surface.
  // step(eyeDepth - sceneEyeDepth(uvOff), 0) is 1 when eyeDepth <= sceneEyeDepth.
  const behind = sceneEyeDepthAt(uvOff).sub(depthS.eyeDepth);
  const keepHard = step(behind.negate(), float(0));
  const keepSoft = behind.div(PHYS_KEEP_FADE).saturate();
  const keep = mix(keepHard, keepSoft, u.Refraction_Physical);

  const uv = screenUV.add(offset.mul(keep).mul(u.ENABLEREFRACTION));

  return {
    uv,
    sceneColor: viewportSharedTexture(uv).rgb,
  };
}
