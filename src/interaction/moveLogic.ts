/**
 * Pure move-tool logic: grid snapping + dominant-axis lock (plan x/y in
 * inches). Kept free of DOM/Three so the interaction rules are unit-testable.
 */

export interface PlanPoint {
  x: number;
  y: number;
}

/** Round to the nearest `grid` inches (default 1 in — framing grid). */
export function snapCoord(v: number, grid = 1): number {
  return Math.round(v / grid) * grid;
}

export function snapPoint(p: PlanPoint, grid = 1): PlanPoint {
  return { x: snapCoord(p.x, grid), y: snapCoord(p.y, grid) };
}

/**
 * SketchUp-style axis lock: if one axis clearly dominates the drag (≥ 1.2×),
 * zero out the other; near-diagonal drags stay diagonal. `deadzone` (inches)
 * suppresses micro-drags.
 */
export function lockAxis(delta: PlanPoint, deadzone = 4): PlanPoint {
  const ax = Math.abs(delta.x);
  const ay = Math.abs(delta.y);
  if (ax < deadzone && ay < deadzone) return { x: 0, y: 0 };
  if (ax / Math.max(ay, 1e-9) >= 1.2) return { x: delta.x, y: 0 };
  if (ay / Math.max(ax, 1e-9) >= 1.2) return { x: 0, y: delta.y };
  return { x: delta.x, y: delta.y }; // diagonal
}

export interface MoveOptions {
  /** Snap grid in inches (default 1). */
  snap?: number;
  /** Lock to the dominant axis (default true). */
  axisLock?: boolean;
  /** Ignore drags shorter than this (inches). */
  deadzone?: number;
}

/**
 * Where the object should sit given the raw pointer point, relative to the
 * snapped drag start. Returns the snapped (and possibly axis-locked) target
 * position.
 */
export function applyMove(start: PlanPoint, raw: PlanPoint, opts: MoveOptions = {}): PlanPoint {
  const snap = opts.snap ?? 1;
  const startSnapped = snapPoint(start, snap);
  let target = snapPoint(raw, snap);
  if (opts.axisLock !== false) {
    const locked = lockAxis(
      { x: target.x - startSnapped.x, y: target.y - startSnapped.y },
      opts.deadzone ?? 4,
    );
    target = { x: startSnapped.x + locked.x, y: startSnapped.y + locked.y };
  }
  return target;
}