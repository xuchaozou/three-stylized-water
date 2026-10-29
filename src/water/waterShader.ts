// GLSL1 port of the TSL water graph (WaterMaterial colorNode order and nodes/* formulas).
// three's WebGLRenderer compiles this as GLSL 300 and aliases texture2D / texture2DGradEXT.

const WAVE_GLSL = /* glsl */ `
float safeDenom(float x) {
  float sgn = x < 0.0 ? -1.0 : 1.0;
  return sgn * max(abs(x), 1e-6);
}

vec3 flowDirection(vec3 dir, float flowDeg) {
  float a = radians(flowDeg);
  float c = cos(a);
  float s = sin(a);
  return vec3(dir.x * c - dir.z * s, dir.y, dir.x * s + dir.z * c);
}

void gerstner(float len, float height, float speed, vec3 dir, float sharp, vec3 P, float t, out vec3 disp, out vec3 nrm) {
  vec3 D = vec3(dir.x, dir.y, -dir.z);
  vec3 Dn = D / max(length(D), 1e-6);
  float k = 6.283185 / safeDenom(len);
  float w = sqrt(k * 9.8);
  float phase = dot(P, Dn * k) - w * t * speed;
  float cph = cos(phase);
  float sph = sin(phase);
  float kA = k * height;
  float Q = sharp / safeDenom(kA);
  disp = vec3(0.0, cph * height, 0.0) - Dn * (sph * Q * height);
  vec3 nxz = Dn * (sph * kA);
  nrm = vec3(nxz.x, 1.0 - Q * cph * kA, nxz.z);
}
`;

export const waterVertexShader = /* glsl */ `
attribute float wallDist;

uniform float uTime;
uniform float ENABLEWAVE;
uniform float Flow_Direction;
uniform float Wave1_Length;
uniform float Wave1_Height;
uniform float Wave1_Speed;
uniform vec3 Wave1_Direction;
uniform float Wave1_Sharpness;
uniform float Wave2_Length;
uniform float Wave2_Height;
uniform float Wave2_Speed;
uniform vec3 Wave2_Direction;
uniform float Wave2_Sharpness;
uniform mat4 textureMatrix;

varying vec3 vWorld;
varying vec3 vWaveN;
varying float vWallDist;
varying float vEyeDepth;
varying vec4 vMirrorCoord;

#include <fog_pars_vertex>

${WAVE_GLSL}

void main() {
  vec4 world0 = modelMatrix * vec4(position, 1.0);
  vec3 disp = vec3(0.0);
  vec3 nSum = vec3(0.0, 1.0, 0.0);
  if (ENABLEWAVE > 0.5) {
    vec3 d1, n1, d2, n2;
    vec3 dir1 = flowDirection(Wave1_Direction, Flow_Direction);
    vec3 dir2 = flowDirection(Wave2_Direction, Flow_Direction);
    gerstner(Wave1_Length, Wave1_Height, Wave1_Speed, dir1, Wave1_Sharpness, world0.xyz, uTime, d1, n1);
    gerstner(Wave2_Length, Wave2_Height, Wave2_Speed, dir2, Wave2_Sharpness, world0.xyz, uTime, d2, n2);
    disp = d1 + d2;
    nSum = normalize(n1 + n2);
  } else {
    nSum = normalize(mat3(modelMatrix) * normal);
  }
  vec3 world = world0.xyz + disp;
  vWorld = world;
  vWaveN = nSum;
  vWallDist = wallDist;
  vMirrorCoord = textureMatrix * vec4(world, 1.0);
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  vEyeDepth = -mvPosition.z;
  #include <fog_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const waterFragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 sunDirection;
uniform vec2 uResolution;
uniform float uCameraNear;
uniform float uCameraFar;
uniform float planarWeight;

uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tReflect;
uniform sampler2D SurfFoam_Map;
uniform sampler2D SurfaceDistortion_Map;
uniform sampler2D InterSec_Foam_Mask;
uniform sampler2D SL_Dissolve_Mask;
uniform sampler2D Normal_Map;
uniform sampler2D Caustics_Map;
uniform sampler2D Caustics_Distortion_Map;

uniform vec4 Color_Shallow;
uniform vec4 Color_Deep;
uniform float Water_Depth;
uniform float WorldSpaceDepth;
uniform float DistanceMask_Start;
uniform float DistanceMask_Fade;
uniform float ShoreFade;
uniform float ShoreFade_Smoothness;

uniform float Enable_SurfaceFoam;
uniform vec4 SurfFoam_Color;
uniform float SurfFoam_AlphaBlend;
uniform float Invert_SurfFoam;
uniform vec2 SurfFoam_Pan;
uniform float SurfFoam_Scale;
uniform vec2 SurfFoam_Tile;
uniform float SurfFoam_Edge;
uniform float SurfFoam_EdgeSmooth;
uniform float SurfaceDistortion_Scale;
uniform float SurfaceDistortion_Strength;
uniform vec2 SurfaceDistortion_Pan;

uniform float Enable_Intersection;
uniform vec4 InterSec_Color;
uniform float InterSec_Width;
uniform float InterSec_Dissolve;
uniform float InterSec_Foam_Invert;
uniform float InterSec_Foam_Scale;
uniform vec2 InterSec_Foam_Tile;
uniform vec2 InterSec_Foam_Pan;
uniform float InterSec_Foam_Distortion;
uniform float InterSec_Foam_Smooth;
uniform float InterSec_GradientDissolve;
uniform float InterSec_Edge_Fade;
uniform float InterSec_WallDistance;

uniform float ENABLESHORELINE;
uniform vec4 SL_Color;
uniform float SL_WaterDepth;
uniform float SL_Speed;
uniform float SL_Ammount;
uniform float SL_Thickness;
uniform float SL_CenterMask;
uniform float SL_CenterMaskFade;
uniform float SL_Dissolve;
uniform float SL_GradientDissolve;
uniform vec2 SL_MaskPan;
uniform float SL_MaskScale;
uniform vec2 SL_MaskTile;
uniform float SL_EnableTrail;
uniform float SL_Trail_Fade;

uniform float ENABLE_UNDERWATERLAYER;
uniform float UnderWater_Depth;
uniform float ConformToGeometry;
uniform vec4 Underwater_Color;
uniform float UnderWater_ScaleModifier;
uniform float UnderWater_Start;
uniform float Underwater_Fade;

uniform float ENABLENORMAL;
uniform float Normal_Strength;
uniform float Normal_Pan;
uniform float Normal_Scale;
uniform float Normal_DistanceStrength;

uniform vec4 ShadowColor;
uniform vec4 Specular_Color;
uniform float Specular_Spread;
uniform float Specular_Hardness;
uniform float Specular_Size;

uniform float ENABLEPLANERREFLECTION;
uniform float Reflection_Strength;
uniform float Reflection_Fresnel;
uniform float Reflection_Distortion;

uniform float ENABLEREFRACTION;
uniform float Refraction_Strength;
uniform float Refraction_Distance_Strength;
uniform float Refraction_Distance_Fade;
uniform float Refraction_Physical;
uniform float Refraction_Thickness;

uniform float Flow_Direction;
uniform float Normal_CrossAngle;
uniform float Flow_Aligned;
uniform float Flow_Stretch;
uniform float Normal_Shading;

uniform float ENABLECAUSTICS;
uniform float Caustics_Depth;
uniform float Caustics_Pan;
uniform float Caustics_Scale;
uniform float Caustics_Strength;
uniform float Caustics_Distortion_Strength;
uniform float Caustics_Distortion_Scale;
uniform float Caustics_Start;
uniform float Caustics_Fade;

uniform float ENABLEWAVE;
uniform vec4 Wave_Top_Color;
uniform float Wave1_Length;
uniform float Wave1_Height;
uniform float Wave1_Speed;
uniform vec3 Wave1_Direction;
uniform float Wave1_Sharpness;
uniform float Wave2_Length;
uniform float Wave2_Height;
uniform float Wave2_Speed;
uniform vec3 Wave2_Direction;
uniform float Wave2_Sharpness;

varying vec3 vWorld;
varying vec3 vWaveN;
varying float vWallDist;
varying float vEyeDepth;
varying vec4 vMirrorCoord;

#include <packing>
#include <fog_pars_fragment>

${WAVE_GLSL}

float satf(float x) { return clamp(x, 0.0, 1.0); }

float smoothMask(float edge, float smoothness, float x) {
  return smoothstep(edge, edge + max(smoothness, 1e-5), x);
}

vec2 worldUV(vec3 pos) {
  return vec2(pos.x, -pos.z) * 0.1;
}

vec2 flowRotate(vec2 uv) {
  float a = radians(Flow_Direction);
  float c = cos(a);
  float s = sin(a);
  return vec2(uv.x * c + uv.y * s, uv.y * c - uv.x * s);
}

vec2 flowUnrotate(vec2 v) {
  float a = radians(Flow_Direction);
  float c = cos(a);
  float s = sin(a);
  return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

vec2 uvPanner2(vec2 uv, vec2 speed, vec2 tile, float scale, float t) {
  return uv * (tile * scale) + speed * 0.1 * t;
}

vec2 uvPannerDistorted(vec2 baseUV, vec2 tile, float scale, vec2 pan, float distStrength, vec3 distValue, float t) {
  vec2 uv = uvPanner2(baseUV, pan, tile, scale, t);
  return uv + distValue.xy * (distStrength * 0.1);
}

vec3 viewDirTS() {
  vec3 V = normalize(cameraPosition - vWorld);
  return vec3(-V.x, V.z, V.y);
}

vec2 paralaxUV(vec2 baseUV, float paralaxDepth) {
  float amplitude = paralaxDepth * 0.1;
  vec3 v = normalize(viewDirTS());
  float offsetScale = amplitude * -0.5;
  vec2 offset = (v.xy / (v.z + 0.42)) * offsetScale;
  return baseUV + offset;
}

vec3 sampleNormal(sampler2D tex, vec2 uv) {
  vec2 gx = dFdx(uv);
  vec2 gy = dFdy(uv);
  float lx = length(gx);
  float ly = length(gy);
  float ratio = max(lx, ly) / max(min(lx, ly), 1e-8);
  float k = 1.0 / clamp(ratio / 4.0, 1.0, 16.0);
  return texture2DGradEXT(tex, uv, gx * k, gy * k).rgb * 2.0 - 1.0;
}

vec3 unscaledNormal() {
  vec2 uvBase = flowRotate(worldUV(vWorld));
  uvBase.x /= Flow_Stretch;
  float crossA = radians(Normal_CrossAngle);
  float c = cos(crossA);
  float s = sin(crossA);
  float pan = Normal_Pan * uTime;
  vec2 panA = mix(vec2(pan * -0.05), vec2(pan * -0.05, 0.0), Flow_Aligned);
  vec2 panB = mix(vec2(c - s, s + c) * (pan * 0.1), vec2(c, s) * (pan * -0.13), Flow_Aligned);
  vec2 uvA = uvBase * (Normal_Scale * 0.5) + panA;
  vec2 uvB = uvBase * Normal_Scale + panB;
  vec3 nA = sampleNormal(Normal_Map, uvA);
  vec3 nB = sampleNormal(Normal_Map, uvB);
  vec3 nUnity = mix(nA, nB, 0.5);
  float halfCross = crossA * 0.5;
  vec2 uvC = uvBase * (Normal_Scale * 0.17) + vec2(cos(halfCross), -sin(halfCross)) * (pan * -0.0136);
  vec2 uvD = uvBase * (Normal_Scale * 2.1) + vec2(0.37, 0.61) + vec2(cos(halfCross), sin(halfCross)) * (pan * -0.336);
  vec3 nC = sampleNormal(Normal_Map, uvC);
  vec3 nD = sampleNormal(Normal_Map, uvD);
  vec3 nFlow = nA * 0.3 + nB * 0.25 + nC * 0.3 + nD * 0.15;
  vec3 n = mix(nUnity, nFlow, Flow_Aligned);
  return vec3(flowUnrotate(vec2(n.x / Flow_Stretch, n.y)), n.z);
}

vec3 normalTS() {
  vec3 nBlend = unscaledNormal();
  float distMask = satf((distance(cameraPosition, vWorld) - DistanceMask_Start) / DistanceMask_Fade);
  float strength = mix(Normal_Strength, Normal_DistanceStrength, distMask);
  vec3 nScaled = vec3(nBlend.xy * strength, mix(1.0, nBlend.z, satf(strength)));
  return mix(vec3(0.0, 0.0, 1.0), nScaled, ENABLENORMAL);
}

float sceneEyeAt(vec2 uv) {
  return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uCameraNear, uCameraFar);
}

vec3 scenePosAt(float sceneEye) {
  vec3 rayDir = (vWorld - cameraPosition) / vEyeDepth;
  return cameraPosition + rayDir * sceneEye;
}

float worldShallow(vec3 scenePos) {
  float vertical = vWorld.y - scenePos.y;
  return satf(exp(-vertical / Water_Depth));
}

float viewShallow(float sceneEye) {
  return 1.0 - satf((sceneEye - vEyeDepth) / (Water_Depth * 10.0));
}

float shoreFadeOf(float ws) {
  float depth01 = satf(1.0 - ws);
  float edge = ShoreFade - 1.0;
  return smoothMask(edge, ShoreFade_Smoothness, depth01);
}

vec3 surfDistort() {
  vec2 uv = uvPanner2(flowRotate(worldUV(vWorld)), SurfaceDistortion_Pan, vec2(SurfaceDistortion_Scale), 1.0, uTime);
  float d = texture2D(SurfaceDistortion_Map, uv).r;
  return vec3(d * 2.0 - 1.0);
}

float surfFoamAt(vec2 baseUV, float scale, vec3 distValue) {
  vec2 uv = uvPannerDistorted(flowRotate(baseUV), SurfFoam_Tile, scale, SurfFoam_Pan, SurfaceDistortion_Strength, distValue, uTime);
  float r = texture2D(SurfFoam_Map, uv).r;
  float m = smoothMask(SurfFoam_Edge, SurfFoam_EdgeSmooth, r);
  return mix(m, 1.0 - m, Invert_SurfFoam);
}

float intersectionFoam(float waterDepth, vec2 baseUV, vec3 distValue) {
  float g = mix(0.1, 1.0, InterSec_GradientDissolve);
  float w = InterSec_Width * mix(0.7, 1.0, g);
  float edge = 1.0 - w;
  float band = smoothMask(edge, g, waterDepth);
  vec2 foamUV = uvPannerDistorted(flowRotate(baseUV), InterSec_Foam_Tile, InterSec_Foam_Scale, InterSec_Foam_Pan, InterSec_Foam_Distortion, distValue, uTime);
  float r = texture2D(InterSec_Foam_Mask, foamUV).r;
  float m = mix(1.0 - r, r, InterSec_Foam_Invert);
  float d = InterSec_Dissolve * mix(2.5, 1.0, g);
  float dm = 1.0 - m * d;
  float x = band * (band + dm);
  float foam = smoothMask(0.1, max(InterSec_Foam_Smooth, 1e-6), x);
  float wideBand = smoothMask(edge, 1.0, waterDepth);
  float result = mix(foam, wideBand * foam, InterSec_Edge_Fade);
  return satf(result);
}

float shorelineMask(vec3 scenePos) {
  float vertical = vWorld.y - scenePos.y;
  float depth = satf(exp(-vertical / max(SL_WaterDepth, 1e-6)));
  float centerMask = smoothMask(SL_CenterMask, SL_CenterMaskFade, depth);
  float thickEdge = SL_Thickness * -0.5;
  float x = (depth - SL_Speed * 0.1 * uTime) * SL_Ammount;
  float fracNeg = fract(-x);
  float fracPos = fract(x);
  float smA = smoothMask(thickEdge, 1.0, fracNeg);
  float smB = smoothMask(thickEdge, 1.0, fracPos);
  float speedPos = SL_Speed > 0.0 ? 1.0 : 0.0;
  float dirBand = mix(smB, smA, speedPos);
  float lines = mix(min(smA, smB), dirBand, SL_EnableTrail);
  vec2 dUV = uvPanner2(flowRotate(worldUV(vWorld)), SL_MaskPan, SL_MaskTile, SL_MaskScale, uTime);
  float dTex = texture2D(SL_Dissolve_Mask, dUV).r;
  float dissolved = lines * (1.0 - dTex * SL_Dissolve);
  float expanded = mix(dissolved, lines, depth * SL_GradientDissolve);
  float stepped = step(0.5, expanded);
  float fracSel = mix(fracNeg, fracPos, speedPos);
  float trailed = mix(stepped, fracSel * stepped, SL_Trail_Fade);
  return satf(centerMask - (1.0 - trailed));
}

float causticsMask(float ws) {
  float paralaxDepth = (1.0 - ws) * Caustics_Depth;
  vec2 pUV = flowRotate(paralaxUV(worldUV(vWorld), paralaxDepth));
  vec2 dUV = uvPanner2(pUV, vec2(-Caustics_Pan, 0.0), vec2(Caustics_Distortion_Scale), 1.0, uTime);
  float dR = texture2D(Caustics_Distortion_Map, dUV).r;
  vec2 distortion = (vec3(dR * 2.0 - 1.0) * vec3(0.01, 2.0, 2.0) * (Caustics_Distortion_Strength * 0.01)).xy;
  vec2 uvA = uvPanner2(pUV, vec2(Caustics_Pan), vec2(Caustics_Scale), 1.0, uTime) + distortion;
  vec2 uvB = uvPanner2(pUV, vec2(-Caustics_Pan), vec2(Caustics_Scale), 1.3, uTime) + distortion;
  vec3 dual = min(texture2D(Caustics_Map, uvA).rgb, texture2D(Caustics_Map, uvB).rgb) * Caustics_Strength;
  float distFade = 1.0 - satf((distance(cameraPosition, vWorld) - Caustics_Start) / Caustics_Fade);
  return dual.r * ws * distFade;
}

float waveHeight01() {
  if (ENABLEWAVE < 0.5) return 0.0;
  vec3 d1, n1, d2, n2;
  gerstner(Wave1_Length, Wave1_Height, Wave1_Speed, flowDirection(Wave1_Direction, Flow_Direction), Wave1_Sharpness, vWorld, uTime, d1, n1);
  gerstner(Wave2_Length, Wave2_Height, Wave2_Speed, flowDirection(Wave2_Direction, Flow_Direction), Wave2_Sharpness, vWorld, uTime, d2, n2);
  return (d1.y + d2.y) * 10.0;
}

vec4 colorLayer(vec4 base, vec4 layer, float mask) {
  return mix(base, layer, mask * layer.a);
}

float blendScreen(float base, float blend, float opacity) {
  float o = 1.0 - (1.0 - blend) * (1.0 - base);
  return mix(base, o, opacity);
}

float layerAlpha(vec4 layer, float baseAlpha, float mask, float blend) {
  return mix(blendScreen(baseAlpha, layer.a, mask), baseAlpha, blend);
}

void main() {
  vec2 screenUV = gl_FragCoord.xy / uResolution;
  vec3 nUnscaled = unscaledNormal();
  vec3 nTS = normalTS();
  vec3 Ngeo = normalize(vWaveN);
  vec3 T = vec3(-1.0, 0.0, 0.0);
  vec3 B = cross(Ngeo, T);
  vec3 waterN = normalize(T * nTS.x + B * nTS.y + Ngeo * nTS.z);

  float sceneEyeS = sceneEyeAt(screenUV);
  vec3 scenePosS = scenePosAt(sceneEyeS);
  float ws = worldShallow(scenePosS);
  float cs = viewShallow(sceneEyeS);
  float shoreFade = shoreFadeOf(ws);

  float far01 = satf((distance(cameraPosition, vWorld) - Refraction_Distance_Fade) / 5.0);
  float strength = mix(shoreFade * Refraction_Strength, Refraction_Distance_Strength, far01);
  float thickness = max(sceneEyeS - vEyeDepth, 0.0);
  float physScale = satf(thickness / max(Refraction_Thickness, 1e-3)) * (4.0 / max(vEyeDepth, 4.0));
  float scale = mix(1.0, physScale, Refraction_Physical);
  vec2 offset = nUnscaled.xy * (strength * 0.1) * scale;
  vec2 uvOff = screenUV + offset;
  float behind = sceneEyeAt(uvOff) - vEyeDepth;
  float keepHard = step(-behind, 0.0);
  float keepSoft = satf(behind / 0.3);
  float keep = mix(keepHard, keepSoft, Refraction_Physical);
  vec2 refrUV = screenUV + offset * keep * ENABLEREFRACTION;

  float sceneEyeR = sceneEyeAt(refrUV);
  vec3 scenePosR = scenePosAt(sceneEyeR);
  float wsR = worldShallow(scenePosR);
  float csR = viewShallow(sceneEyeR);
  float depthColorR = mix(csR, wsR, WorldSpaceDepth);
  vec3 sceneColor = texture2D(tScene, refrUV).rgb;

  vec4 base = mix(Color_Deep, Color_Shallow, depthColorR);
  vec3 distValue = surfDistort();
  vec2 wuv = worldUV(vWorld);
  float wall = exp(-vWallDist / max(InterSec_WallDistance, 1e-3)) * step(1e-3, InterSec_WallDistance);
  float interDepth = max(ws, wall);
  float caustics = causticsMask(ws) * ENABLECAUSTICS;
  float underDepth = mix(UnderWater_Depth, UnderWater_Depth * (1.0 - depthColorR), ConformToGeometry);
  vec2 uwUV = paralaxUV(wuv, underDepth);
  float uwDistFade = 1.0 - satf((distance(cameraPosition, vWorld) - UnderWater_Start) / Underwater_Fade);
  float under = satf(
    intersectionFoam(ws, uwUV, distValue) * Enable_Intersection
    + surfFoamAt(uwUV, SurfFoam_Scale + UnderWater_ScaleModifier, distValue) * Enable_SurfaceFoam
  ) * uwDistFade * ENABLE_UNDERWATERLAYER;
  float inter = intersectionFoam(interDepth, wuv, distValue) * Enable_Intersection;
  float shore = shorelineMask(scenePosS) * ENABLESHORELINE;
  float height01 = waveHeight01();
  float foam = surfFoamAt(wuv, SurfFoam_Scale, distValue) * Enable_SurfaceFoam;

  vec4 c = base;
  c = colorLayer(c, vec4(4.0, 4.0, 4.0, 1.0), caustics);
  c = colorLayer(c, Underwater_Color, under);
  c = colorLayer(c, InterSec_Color, inter);
  c = colorLayer(c, SL_Color, shore);
  c = colorLayer(c, Wave_Top_Color, height01);
  c = colorLayer(c, SurfFoam_Color, foam);

  float a = base.a;
  a = layerAlpha(InterSec_Color, a, inter, 0.0);
  a = layerAlpha(SL_Color, a, shore, 0.0);
  a = layerAlpha(SurfFoam_Color, a, foam, SurfFoam_AlphaBlend);

  vec3 rgb = mix(c.rgb, mix(sceneColor, c.rgb, a), ENABLEREFRACTION);

  vec2 reflUV = vMirrorCoord.xy / vMirrorCoord.w;
  reflUV += vec2(-nTS.x, nTS.y) * Reflection_Distortion * 0.1;
  vec3 planar = texture2D(tReflect, reflUV).rgb;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 R = reflect(-V, Ngeo);
  vec3 fallback = mix(vec3(0.25, 0.32, 0.38), vec3(0.55, 0.68, 0.82), satf(R.y * 0.5 + 0.5));
  vec3 refl = mix(fallback, planar, planarWeight);
  float fresnel = pow(max(1.0 - satf(dot(Ngeo, V)), 1e-5), Reflection_Fresnel);
  rgb = mix(rgb, refl, fresnel * Reflection_Strength);

  vec3 sunDir = normalize(sunDirection);
  vec3 rippleN = normalize(vec3(-nTS.x, nTS.z, nTS.y));
  float tilt = dot(rippleN, sunDir) - sunDir.y;
  rgb *= max(tilt * Normal_Shading + 1.0, 0.0);

  float exponent = exp2((1.0 - Specular_Spread) * 10.0 + 1.0);
  float mainSpec = pow(satf(dot(reflect(-sunDir, waterN), V)), exponent);
  float lo = 1.0 - Specular_Size;
  float hard = smoothstep(lo, lo + 0.15, mainSpec);
  rgb += mix(vec3(mainSpec), vec3(hard), Specular_Hardness) * Specular_Color.rgb;

  float outAlpha = mix(shoreFade * a, shoreFade, ENABLEREFRACTION);
  gl_FragColor = vec4(rgb, outAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
