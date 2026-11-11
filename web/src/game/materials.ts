import { MeshLambertMaterial } from "three";
import type { Mat } from "./city";

function styledMaterial(opts: {
  color: number;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  grid?: number;
  polygonOffset?: boolean;
}) {
  const mat = new MeshLambertMaterial({
    color: opts.color,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    polygonOffset: opts.polygonOffset ?? false,
    polygonOffsetFactor: opts.polygonOffset ? -2 : 0,
    polygonOffsetUnits: opts.polygonOffset ? -4 : 0,
  });
  const grid = opts.grid ?? 0;
  if (grid > 0) {
    const g = grid.toFixed(3);
    mat.customProgramCacheKey = () => `voxel-${g}`;
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader =
        "varying vec3 vBlockWorld;\nvarying vec3 vBlockNormal;\n" +
        shader.vertexShader.replace(
          "#include <project_vertex>",
          `#include <project_vertex>
          vec3 blockN = objectNormal;
          vec4 blockW = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            mat3 bMat = mat3(instanceMatrix);
            blockN /= vec3(dot(bMat[0], bMat[0]), dot(bMat[1], bMat[1]), dot(bMat[2], bMat[2]));
            blockN = bMat * blockN;
            blockW = instanceMatrix * blockW;
          #endif
          blockW = modelMatrix * blockW;
          blockN = mat3(modelMatrix) * blockN;
          vBlockWorld = blockW.xyz;
          vBlockNormal = normalize(blockN);
          `,
        );
      shader.fragmentShader =
        "varying vec3 vBlockWorld;\nvarying vec3 vBlockNormal;\n" +
        shader.fragmentShader.replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          vec3 bDist = min(fract(vBlockWorld), 1.0 - fract(vBlockWorld));
          vec3 aN = abs(normalize(vBlockNormal));
          float edgeDist = aN.x > aN.y && aN.x > aN.z ? min(bDist.y, bDist.z) : (aN.y > aN.z ? min(bDist.x, bDist.z) : min(bDist.x, bDist.y));
          float crack = 1.0 - smoothstep(0.012, 0.085, edgeDist);
          float n = fract(sin(dot(floor(vBlockWorld + aN * 0.5), vec3(127.1, 311.7, 74.7))) * 43758.5453);
          diffuseColor.rgb *= mix(1.0, 0.55, crack * ${g});
          diffuseColor.rgb *= 0.9 + 0.1 * n;
          `,
        );
    };
  }
  return mat;
}

export const MATERIALS: Record<Mat, MeshLambertMaterial> = {
  asphalt: styledMaterial({ color: 0x171a22 }),
  sidewalk: styledMaterial({ color: 0xc5c9d1, grid: 0.35 }),
  plaza: styledMaterial({ color: 0xe4e7ee, grid: 0.45 }),
  grass: styledMaterial({ color: 0x3c9a3a, grid: 0.4 }),
  hedge: styledMaterial({ color: 0x1d6e32, grid: 0.7 }),
  leaves: styledMaterial({ color: 0x37b24a, grid: 0.55 }),
  leavesDark: styledMaterial({ color: 0x1f8a34, grid: 0.55 }),
  trunk: styledMaterial({ color: 0x6b4a2e, grid: 0.4 }),
  black: styledMaterial({ color: 0x12151c, grid: 0.85 }),
  white: styledMaterial({ color: 0xf4f6fa, grid: 0.75 }),
  gray: styledMaterial({ color: 0x3a404c, grid: 0.7 }),
  cyan: styledMaterial({
    color: 0x7eefff,
    emissive: 0x19d8ff,
    emissiveIntensity: 0.95,
    grid: 0.25,
  }),
  cyanhot: styledMaterial({
    color: 0xe9fbff,
    emissive: 0x5ef3ff,
    emissiveIntensity: 1.15,
  }),
  water: styledMaterial({
    color: 0x1a74ff,
    emissive: 0x0a3ec8,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.82,
  }),
  stone: styledMaterial({ color: 0xd5dae2, grid: 0.65 }),
  lane: styledMaterial({ color: 0xf7f7f2, polygonOffset: true }),
  hill: styledMaterial({ color: 0x6a3b2c, grid: 0.25 }),
  track: styledMaterial({ color: 0x1c212b, grid: 0.2 }),
};
MATERIALS.water.depthWrite = false;

export const GOLD = styledMaterial({
  color: 0xe0b33a,
  emissive: 0x8a5a10,
  emissiveIntensity: 0.35,
});
