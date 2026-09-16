/**
 * Shared types for the modeling platform.
 *
 * Convention: all geometric values are in INCHES (real-world imperial
 * dimensions — default stud spacing is 16 in on center). Unit conversion
 * happens at interaction boundaries (input parsing, display), never inside
 * the command system.
 */

/** A point/vector in scene units (inches). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Axis-aligned bounding box, in inches. */
export interface BBox {
  min: Vec3;
  max: Vec3;
}

/** Cardinal axes used for snapping/axis-lock (SketchUp-style). */
export type Axis = 'x' | 'y' | 'z';

/** A direction on the ground plane (x/y) or vertical (z). */
export type Orientation = 'horizontal' | 'vertical';