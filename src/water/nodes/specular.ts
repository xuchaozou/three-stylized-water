import { cameraPosition, exp2, float, mix, positionWorld, pow, reflect, saturate, vec3 } from 'three/tsl';
import type { WaterCtx } from './types';

export interface LightingData {
  specular: any;
  /**
   * Shadow-layer composition factor = (1 - shadowAtten) x _ShadowColor.a.
   * The canonical application is `mix(rgb, _ShadowColor.rgb, shadowFactor)`.
   */
  shadowFactor: any;
}

export function buildSpecular(ctx: WaterCtx, waterNormal: any): LightingData {
  const { u } = ctx;

  // This Phong scalar intentionally excludes light color, shadow, and intensity.
  const L = ctx.sunDirection.normalize();
  const V = cameraPosition.sub(positionWorld).normalize();
  const exponent = exp2(u.Specular_Spread.oneMinus().mul(10.0).add(1.0)); // 2^(10(1-spread)+1)
  const mainSpec = pow(saturate(reflect(L.negate(), waterNormal).dot(V)), exponent);

  const specSum = vec3(mainSpec);
  const lo = u.Specular_Size.oneMinus();
  const hard = specSum.smoothstep(lo, lo.add(0.15)); // 0.15 is a hard-coded constant, applied per component.
  const specular = mix(specSum, hard, u.Specular_Hardness).mul(u.Specular_Color.rgb); // HDR: do not clamp.

  // MeshBasicNodeMaterial uses a no-op BasicLightingModel.direct(), so light-driven shadow reception is not generated
  // and material.receivedShadowNode (a hook inside ShadowNode.setup) is never reached.
  // Instead, sample PCF attenuation directly with three's official standalone shadow() node.
  let shadowFactor: any = float(0);
  const sun = findShadowSun(ctx);
  if (sun !== null && ctx.renderer.shadowMap.enabled) {
    // Reuse demoScene's ShadowNode; NodeFrame deduplicates it, and its shadowPositionWorld includes waves.
    const atten = (sun.shadow as any).shadowNode;
    shadowFactor = atten.oneMinus().mul(u.ShadowColor.a); // PCF already yields [0,1], so saturate is unnecessary.
  }

  return { specular, shadowFactor };
}

function findShadowSun(ctx: WaterCtx) {
  let sun: any = null;
  ctx.scene.traverse((o: any) => {
    if (sun === null && o.isDirectionalLight === true && o.castShadow === true) sun = o;
  });
  return sun;
}
