// Block orientation, using the same direction names as Space Engineers.
//
// A block's orientation is two directions: where its FRONT points ("forward")
// and where its TOP points ("up"). Together they allow all 24 ways a block can
// face. The game stores exactly these two names in `<BlockOrientation Forward=".." Up=".." />`.
//
// Axis convention (matches the game):
//   Forward = -z, Backward = +z, Left = -x, Right = +x, Up = +y, Down = -y

/** Three numbers: [x, y, z]. x, y and z are the game's own axis names. */
export type Vector = [number, number, number];

export type DirectionName = "Forward" | "Backward" | "Left" | "Right" | "Up" | "Down";

export interface Orientation {
  forward: DirectionName;
  up: DirectionName;
}

export const DEFAULT_ORIENTATION: Orientation = { forward: "Forward", up: "Up" };

const DIRECTION_VECTORS: Record<DirectionName, Vector> = {
  Forward: [0, 0, -1],
  Backward: [0, 0, 1],
  Left: [-1, 0, 0],
  Right: [1, 0, 0],
  Up: [0, 1, 0],
  Down: [0, -1, 0],
};

function vectorOf(direction: DirectionName): Vector {
  return DIRECTION_VECTORS[direction];
}

/** Cross product: a vector at right angles to both inputs. Used to rotate by 90 degrees. */
function crossProduct(first: Vector, second: Vector): Vector {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function negate(vector: Vector): Vector {
  return [-vector[0], -vector[1], -vector[2]];
}

/** Finds the direction name for an axis-aligned unit vector. */
function directionOf(vector: Vector): DirectionName {
  for (const [name, candidate] of Object.entries(DIRECTION_VECTORS)) {
    if (candidate[0] === vector[0] && candidate[1] === vector[1] && candidate[2] === vector[2]) {
      return name as DirectionName;
    }
  }
  throw new Error(`not an axis direction: ${vector.join(",")}`);
}

/** Turn the block left or right: spin the front around the top (key Q). */
export function rotateYaw(orientation: Orientation): Orientation {
  const forward = vectorOf(orientation.forward);
  const up = vectorOf(orientation.up);
  return { forward: directionOf(crossProduct(up, forward)), up: orientation.up };
}

/** Tip the block forward: spin both front and top around the right side (key W). */
export function rotatePitch(orientation: Orientation): Orientation {
  const forward = vectorOf(orientation.forward);
  const up = vectorOf(orientation.up);
  const right = crossProduct(forward, up);
  return {
    forward: directionOf(crossProduct(right, forward)),
    up: directionOf(crossProduct(right, up)),
  };
}

/** Roll the block sideways: spin the top around the front (key E). */
export function rotateRoll(orientation: Orientation): Orientation {
  const forward = vectorOf(orientation.forward);
  const up = vectorOf(orientation.up);
  return { forward: orientation.forward, up: directionOf(crossProduct(forward, up)) };
}

/**
 * How many grid cells the block covers along each world axis once rotated.
 * The block's own size is [x, y, z] along its local right, up and backward.
 */
export function footprint(size: Vector, orientation: Orientation): Vector {
  const forward = vectorOf(orientation.forward);
  const up = vectorOf(orientation.up);
  const right = crossProduct(forward, up);
  const backward = negate(forward);

  const result: Vector = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    result[axis] = Math.abs(size[0] * right[axis] + size[1] * up[axis] + size[2] * backward[axis]);
  }
  return result;
}

/**
 * The three directions a block's own axes point in the world, for a given
 * orientation: its right side (local x), its top (local y) and its back
 * (local z). A 3D model drawn in block coordinates is turned into the world by
 * these three axes.
 */
export function orientationAxes(orientation: Orientation): { right: Vector; up: Vector; backward: Vector } {
  const forward = vectorOf(orientation.forward);
  const up = vectorOf(orientation.up);
  return { right: crossProduct(forward, up), up, backward: negate(forward) };
}
