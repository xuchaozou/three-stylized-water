import { cameraPosition, cross, dFdx, dFdy, float, mix, positionWorld, saturate, vec2, vec3 } from 'three/tsl';
import { flowRotate, flowUnrotate, worldUV } from './utils';
import type { WaterCtx, WavesData } from './types';

// Sampling uses Unity-projected world UVs (three Z is flipped), while the source mesh's Mikktspace
// basis points opposite those UV axes: T=-X_unity and B=-Z_unity. Keep these conventions distinct.

// TSL does not eliminate equivalent node objects, so share the fragment-only normal samples per context.
const unscaledCache = new WeakMap<WaterCtx, any>();
const nTSCache = new WeakMap<WaterCtx, any>();

/**
 * Two-way Normal Blend sample before strength is applied (= Unity Unscaled_Normal, tangent space [-1,1]).
 * Even when _ENABLENORMAL is off, refraction distortion always receives this value; exported for refraction.
 */
export function buildUnscaledNormalMapSample(ctx: WaterCtx) {
  let cached = unscaledCache.get(ctx);
  if (cached === undefined) unscaledCache.set(ctx, (cached = buildUnscaledNormalMapSampleImpl(ctx)));
  return cached;
}

function buildUnscaledNormalMapSampleImpl(ctx: WaterCtx) {
  const { u } = ctx;
  const t = float(ctx.time);
  const uvFlow = flowRotate(ctx, worldUV());
  const uvBase = vec2(uvFlow.x.div(u.Flow_Stretch), uvFlow.y);

  // Unity pans both layers along the same diagonal in opposite directions, which reads as one sliding
  // sheet. Normal_CrossAngle turns layer B so the two ripple trains interfere and shimmer instead.
  const cross = u.Normal_CrossAngle.mul(Math.PI / 180);
  const c = cross.cos();
  const s = cross.sin();
  const pan = u.Normal_Pan.mul(t);
  const panAUnity = vec2(pan.mul(-0.05));
  const panBUnity = vec2(c.sub(s), s.add(c)).mul(pan.mul(0.1));
  // Flow-aligned: both layers move downstream, B slightly faster and turned by the cross angle.
  const panAFlow = vec2(pan.mul(-0.05), 0);
  const panBFlow = vec2(c, s).mul(pan.mul(-0.13));
  const uvA = uvBase.mul(u.Normal_Scale.mul(0.5)).add(mix(panAUnity, panAFlow, u.Flow_Aligned));
  const uvB = uvBase.mul(u.Normal_Scale).add(mix(panBUnity, panBFlow, u.Flow_Aligned));

  const nA = sampleNormalMap(ctx, uvA);
  const nB = sampleNormalMap(ctx, uvB);
  const nUnity: any = mix(nA, nB, 0.5); // The source uses an unnormalized average, not whiteout or UDN blending.

  // Flow-aligned adds a large swell and a fine chop octave (four octaves, as in three.js Water). All of
  // them advance downstream at slightly different world speeds, so the surface travels forward as a
  // whole instead of shimmering in place.
  const halfCross = cross.mul(0.5);
  const uvC = uvBase.mul(u.Normal_Scale.mul(0.17))
    .add(vec2(halfCross.cos(), halfCross.sin().negate()).mul(pan.mul(-0.0136)));
  const uvD = uvBase.mul(u.Normal_Scale.mul(2.1)).add(vec2(0.37, 0.61))
    .add(vec2(halfCross.cos(), halfCross.sin()).mul(pan.mul(-0.336)));
  const nC = sampleNormalMap(ctx, uvC);
  const nD = sampleNormalMap(ctx, uvD);
  // Swell dominates the slope; chop only adds sparkle detail.
  const nFlow: any = nA.mul(0.3).add(nB.mul(0.25)).add(nC.mul(0.3)).add(nD.mul(0.15));
  const n: any = mix(nUnity, nFlow, u.Flow_Aligned);
  // Stretching the UV flattens the slope along the flow by the same factor.
  const nxy = vec2(n.x.div(u.Flow_Stretch), n.y);
  // Tangent xy were sampled in the flow frame; bring them back to the worldUV frame.
  return vec3(flowUnrotate(ctx, nxy), n.z) as any;
}

// These GT-calibrated limits preserve ripple detail after hardware anisotropy reaches its cap.
const ANISO_KNEE = 4;
const ANISO_MAX_BOOST = 16;

function sampleNormalMap(ctx: WaterCtx, uv: any) {
  const gx = dFdx(uv);
  const gy = dFdy(uv);
  const lx = gx.length();
  const ly = gy.length();
  const ratio = lx.max(ly).div(lx.min(ly).max(1e-8));
  const k = float(1).div(ratio.div(ANISO_KNEE).clamp(1, ANISO_MAX_BOOST));
  return ctx.tex('Normal_Map').sample(uv).grad(gx.mul(k), gy.mul(k)).rgb.mul(2).sub(1);
}

/**
 * Tangent-space normal passed to lighting/reflection/distortion, with strength and distance blending applied.
 * When _ENABLENORMAL is off, (0,0,1) means no perturbation.
 *
 * reflection.ts / refraction.ts must import and use this single implementation.
 * Duplicating the formula would diverge when only one copy receives a TBN-sign or UV-convention fix.
 */
export function buildNormalTS(ctx: WaterCtx) {
  let cached = nTSCache.get(ctx);
  if (cached === undefined) nTSCache.set(ctx, (cached = buildNormalTSImpl(ctx)));
  return cached;
}

function buildNormalTSImpl(ctx: WaterCtx) {
  const { u } = ctx;
  const nBlend = buildUnscaledNormalMapSample(ctx);

  const distMask = saturate(
    cameraPosition.distance(positionWorld).sub(u.DistanceMask_Start).div(u.DistanceMask_Fade),
  );
  const strength = mix(u.Normal_Strength, u.Normal_DistanceStrength, distMask);

  // Preserve negative strength as an xy flip; only the z blend saturates in Unity NormalStrength.
  const nScaled = vec3(nBlend.xy.mul(strength), mix(float(1), nBlend.z, saturate(strength)));

  return mix(vec3(0, 0, 1), nScaled, u.ENABLENORMAL) as any;
}

/**
 * Final world normal combining the wave normal and normal map, for specular.
 *
 * Build B from the displaced geometry normal so the perturbation rotates with waves. The Unity-to-three
 * handedness flip makes the required bitangent `cross(N, T)` with T=-X.
 */
export function buildWaterNormal(ctx: WaterCtx, waves: WavesData) {
  const nTS = buildNormalTS(ctx);
  const N = waves.normal.normalize();
  const T = vec3(-1, 0, 0);
  const B = cross(N, T);
  return T.mul(nTS.x).add(B.mul(nTS.y)).add(N.mul(nTS.z)).normalize();
}
