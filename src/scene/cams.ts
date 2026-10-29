// [Coordinate conversion convention] Unity (left-handed, Y-up) -> three.js (right-handed, Y-up) **flips Z**:
//     p_three = (x, y, -z) / dir_three = (dx, dy, -dz)
// Apply the same conversion to the camera's forward and up vectors. This reflection preserves screen coordinates
// (because the right = cross relation also remains consistent), producing exactly the same composition as Unity.
// The position, forward, and up values are copied directly from the Unity capture.
export interface CamPose {
  pos: [number, number, number];
  target: [number, number, number];
  /** Camera up vector (required for poses looking straight down, such as the top view). */
  up: [number, number, number];
  fov: number;
  near: number;
  far: number;
}

function fromUnity(
  pos: [number, number, number],
  fwd: [number, number, number],
  up: [number, number, number],
  fov = 65,
): CamPose {
  const p: [number, number, number] = [pos[0], pos[1], -pos[2]];
  const f: [number, number, number] = [fwd[0], fwd[1], -fwd[2]];
  const d = 20; // Distance to the target (only the direction matters).
  return {
    pos: p,
    target: [p[0] + f[0] * d, p[1] + f[1] * d, p[2] + f[2] * d],
    up: [up[0], up[1], -up[2]],
    fov,
    near: 0.3,
    far: 1000,
  };
}

export const CAMS: Record<string, CamPose> = {
  main: fromUnity(
    [24.67709, 22.115469, 53.211216],
    [0.975685239, -0.2144323, 0.0453560725],
    [0.2143763, 0.9767318, 0.006152652],
  ),
  low: fromUnity(
    [23.1199951, 20.989994, 16.4699936],
    [0.93559, -0.1391731, 0.324502856],
    [0.131488621, 0.990268052, 0.04560591],
  ),
  top: fromUnity(
    [42.78224, 61.5899963, 52.6372452],
    [-5.96046448e-8, -1, -1.1920929e-7],
    [0.998921335, -1.1920929e-7, 0.04643613],
  ),
  shore: fromUnity(
    [28.0726814, 23.5899944, 54.41288],
    [0.861458957, -0.40613848, 0.304860651],
    [0.382870674, 0.913811564, 0.135493636],
  ),
  far: fromUnity(
    [21.8030949, 41.5899963, 54.0219269],
    [0.84452194, -0.479615748, -0.238226578],
    [0.461602032, 0.877478659, -0.130210757],
  ),
};

export const DEFAULT_CAM = 'main';

const plantCam = (
  pos: [number, number, number],
  target: [number, number, number],
  fov = 55,
): CamPose => ({ pos, target, up: [0, 1, 0], fov, near: 0.3, far: 1000 });

/** Water-plant scene: sewage pool at z=-14.5, clear-water pool at z=+14.5, water level at y≈8. */
export const PLANT_CAMS: Record<string, CamPose> = {
  overview: plantCam([-46, 30, 30], [0, 6, 0]),
  sewage: plantCam([-20, 13.5, -21], [-4, 7.8, -13]),
  clear: plantCam([-20, 13.5, 21], [-4, 7.8, 13]),
  grazing: plantCam([-20.5, 10.6, 14.5], [12, 7.6, 14.5], 60),
  clearClose: plantCam([-12, 10, 18], [-2, 7.9, 15.5], 50),
  top: plantCam([0, 75, 0.01], [0, 0, 0]),
};

export const DEFAULT_PLANT_CAM = 'overview';
