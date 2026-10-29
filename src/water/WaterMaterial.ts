import * as THREE from 'three/webgpu';
import { dot, Fn, mix, positionLocal, screenUV, texture, vec3, vec4 } from 'three/tsl';
import type { WaterCtx } from './nodes/types';
import type { TextureSlot } from './uniforms';
import { DEFAULT_TEXTURES } from './uniforms';
import { colorLayerAlpha, layerAlpha } from './nodes/utils';
import { buildWaves } from './nodes/waves';
import { buildDepth } from './nodes/depth';
import { buildBaseColor } from './nodes/baseColor';
import { buildRefraction } from './nodes/refraction';
import { buildSurfaceFoam, buildUnderwaterLayer } from './nodes/surfaceFoam';
import { buildIntersection } from './nodes/intersection';
import { buildShoreline } from './nodes/shoreline';
import { buildCaustics } from './nodes/caustics';
import { buildNormalTS, buildWaterNormal } from './nodes/normals';
import { buildSpecular } from './nodes/specular';
import { buildReflection } from './nodes/reflection';
const loader = new THREE.TextureLoader();

export function createTextureRegistry() {
  const nodes = new Map<TextureSlot, any>();
  const load = (url: string) => {
    const t = loader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace; // Treat masks, noise, and normals as linear data.
    // Unity forces anisotropy for all textures; three silently discards it unless min/mag/mipmap
    // sampling are all linear (WebGPUTextureUtils L185-191, WebGLTextureUtils L369-380).
    // LinearMipmapNearestFilter selects overly coarse normal mips at grazing angles and removes distant ripple detail.
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 16;
    return t;
  };
  const get = (slot: TextureSlot) => {
    if (!nodes.has(slot)) nodes.set(slot, texture(load(DEFAULT_TEXTURES[slot])));
    return nodes.get(slot);
  };
  const set = (slot: TextureSlot, url: string) => {
    get(slot).value = load(url);
  };
  return { get, set };
}

export function buildWaterMaterial(ctx: WaterCtx) {
  const u = ctx.u;
  const mat = new THREE.MeshBasicNodeMaterial();
  // Render state: Blend SrcAlpha OneMinusSrcAlpha / ZWrite Off / Cull Back
  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = THREE.FrontSide;

  const waves = buildWaves(ctx);
  mat.positionNode = positionLocal.add(waves.offset);

  mat.colorNode = Fn(() => {
    const N = buildWaterNormal(ctx, waves);
    const depthS = buildDepth(ctx, screenUV);
    const refr = buildRefraction(ctx, depthS);
    const depthR = buildDepth(ctx, refr.uv);

    const base: any = buildBaseColor(ctx, depthR);
    const caustics = buildCaustics(ctx, depthS);
    const under = buildUnderwaterLayer(ctx, depthR, depthS);
    const inter = buildIntersection(ctx, depthS);
    const shore = buildShoreline(ctx, depthS);
    const foam = buildSurfaceFoam(ctx);

    let c: any = base;
    c = colorLayerAlpha(c, vec4(4.0, 4.0, 4.0, 1.0), caustics.mask);
    c = colorLayerAlpha(c, u.Underwater_Color, under.mask);
    c = colorLayerAlpha(c, u.InterSec_Color, inter.mask);
    c = colorLayerAlpha(c, u.SL_Color, shore.mask);
    c = colorLayerAlpha(c, u.Wave_Top_Color, waves.height01);
    c = colorLayerAlpha(c, u.SurfFoam_Color, foam.mask);

    let a: any = base.a;
    a = layerAlpha(u.InterSec_Color, a, inter.mask, 0.0 as any);
    a = layerAlpha(u.SL_Color, a, shore.mask, 0.0 as any);
    a = layerAlpha(u.SurfFoam_Color, a, foam.mask, u.SurfFoam_AlphaBlend);
    const layeredAlpha = a;

    let rgb: any = mix(
      c.rgb,
      mix(refr.sceneColor, c.rgb, layeredAlpha),
      u.ENABLEREFRACTION,
    );

    const refl = buildReflection(ctx, N);
    rgb = mix(rgb, refl.color, refl.factor);
    // Ripple diffuse shading (as in three.js Water): faces tilted toward the sun brighten, away darken.
    // Only the normal-map ripples are shaded; the two near-parallel Gerstner trains would otherwise
    // print regular crest bands across the tank. Flat-surface basis: T=-X, B=cross(Y,T)=+Z.
    const nTS = buildNormalTS(ctx);
    const rippleN = vec3(nTS.x.negate(), nTS.z, nTS.y).normalize();
    const tilt = dot(rippleN, ctx.sunDirection).sub(ctx.sunDirection.y);
    rgb = rgb.mul(tilt.mul(u.Normal_Shading).add(1).max(0));

    const lit = buildSpecular(ctx, N);
    rgb = rgb.add(lit.specular);
    // Shadows use the same layer composition as the Unity HLSL:
    //   mix(rgb, _ShadowColor.rgb, (1 - shadowAtten) * _ShadowColor.a)
    // Do not use the multiplicative form (shadowTint), which is equivalent only when _ShadowColor.rgb=(0,0,0).
    rgb = mix(rgb, u.ShadowColor.rgb, lit.shadowFactor);

    const outAlpha = mix(
      depthS.shoreFadeMask.mul(layeredAlpha),
      depthS.shoreFadeMask,
      u.ENABLEREFRACTION,
    );

    return vec4(rgb, outAlpha);
  })();

  return mat;
}
