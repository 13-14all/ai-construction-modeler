/**
 * Move-tool rules: snap + axis lock.
 */

import { describe, it, expect } from 'vitest';
import { snapCoord, snapPoint, lockAxis, applyMove } from './moveLogic';

describe('snapCoord / snapPoint', () => {
  it('rounds to the nearest inch by default', () => {
    expect(snapCoord(12.4)).toBe(12);
    expect(snapCoord(12.6)).toBe(13);
    expect(snapCoord(-3.4)).toBe(-3);
  });

  it('snaps to an arbitrary grid', () => {
    expect(snapCoord(97.3, 16)).toBe(96); // 16 in OC grid
    expect(snapCoord(95.5, 12)).toBe(96);
  });

  it('snaps both axes of a point', () => {
    expect(snapPoint({ x: 40.6, y: -7.4 })).toEqual({ x: 41, y: -7 });
  });
});

describe('lockAxis', () => {
  it('locks to X when strongly horizontal', () => {
    expect(lockAxis({ x: 60, y: 3 })).toEqual({ x: 60, y: 0 });
  });

  it('locks to Y when strongly vertical', () => {
    expect(lockAxis({ x: 2, y: 48 })).toEqual({ x: 0, y: 48 });
  });

  it('suppresses micro-drags under the deadzone', () => {
    expect(lockAxis({ x: 1, y: 2 })).toEqual({ x: 0, y: 0 });
  });

  it('keeps diagonal drags unlocked (equal magnitudes)', () => {
    expect(lockAxis({ x: 40, y: 40 })).toEqual({ x: 40, y: 40 });
  });
});

describe('applyMove (snap + axis lock combined)', () => {
  it('snaps the drag along the dominant axis from the snapped start', () => {
    const start = { x: 0.4, y: 0 }; // snaps to (0, 0)
    const result = applyMove(start, { x: 37.6, y: 2.3 });
    expect(result).toEqual({ x: 38, y: 0 }); // x dominant, snapped
  });

  it('moves diagonally when both axes are significant', () => {
    const result = applyMove({ x: 0, y: 0 }, { x: 47.6, y: 48.3 });
    expect(result).toEqual({ x: 48, y: 48 });
  });

  it('does nothing for a sub-deadzone drag', () => {
    const start = { x: 10, y: 10 };
    expect(applyMove(start, { x: 11.2, y: 10.6 })).toEqual(start);
  });

  it('respects a custom snap grid', () => {
    const result = applyMove({ x: 0, y: 0 }, { x: 33.4, y: 1.1 }, { snap: 16 });
    expect(result).toEqual({ x: 32, y: 0 });
  });

  it('can disable the axis lock', () => {
    const result = applyMove({ x: 0, y: 0 }, { x: 60.4, y: 24.6 }, { axisLock: false });
    expect(result).toEqual({ x: 60, y: 25 });
  });
});