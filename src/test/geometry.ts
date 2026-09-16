/**
 * Shared test helpers: a fake Model for exercising execute() in node (no
 * WebGL), and piece selectors for wall plans.
 */

import { expect } from 'vitest';
import type { Model, UnknownObject } from '../engine/commands';
import type { Vec3 } from '../types';
import type { WallPiece, WallPlan } from '../skills/build_wall';

export interface BoxRecord {
  name: string;
  center: Vec3;
  size: Vec3;
  color?: string;
}

export interface TestModel extends Model {
  /** Boxes created via createBox, in order. */
  boxes: BoxRecord[];
  /** Group names added via add. */
  groups: string[];
}

/** In-memory Model — the command system's contract, without Three.js. */
export function createTestModel(): TestModel {
  let rev = 0;
  const boxes: BoxRecord[] = [];
  const groups: string[] = [];
  const meta = new Map<string, UnknownObject>();
  const membership = new Map<string, string[]>();

  const model: TestModel = {
    boxes,
    groups,
    get revision() {
      return rev;
    },
    createBox(name, center, size, color) {
      boxes.push({ name, center: { ...center }, size: { ...size }, color });
      meta.set(name, { name, kind: 'box', center: { ...center }, size: { ...size }, color: color ?? '' });
      rev += 1;
      return name;
    },
    add(name, members) {
      groups.push(name);
      if (Array.isArray(members)) membership.set(name, members);
      meta.set(name, {
        name,
        kind: 'group',
        center: { x: 0, y: 0, z: 0 },
        size: { x: 1, y: 1, z: 1 },
        color: '',
        members: members ?? [],
      });
      rev += 1;
    },
    get(name) {
      return meta.get(name);
    },
    translate(name, delta) {
      const record = meta.get(name);
      if (!record) throw new Error(`translate: no object named '${name}'`);
      const members = record.members && record.members.length > 0 ? record.members : [name];
      let moved = 0;
      for (const m of members) {
        const r = meta.get(m);
        if (!r) continue;
        meta.set(m, {
          ...r,
          center: { x: r.center.x + delta.x, y: r.center.y + delta.y, z: r.center.z + delta.z },
        });
        // keep box records in sync (asserts inspect these)
        const box = boxes.find((b) => b.name === m);
        if (box) {
          box.center.x += delta.x;
          box.center.y += delta.y;
          box.center.z += delta.z;
        }
        moved += 1;
      }
      rev += 1;
      return moved;
    },
    listNames() {
      return [...meta.keys()];
    },
  };
  return model;
}

export const studsOf = (plan: WallPlan): WallPiece[] => plan.pieces.filter((p) => p.kind === 'stud');
export const platesOf = (plan: WallPlan): WallPiece[] => plan.pieces.filter((p) => p.kind === 'plate');

/** Assert two Vec3s match to `precision` decimals (geometry tolerance). */
export function expectVec3Close(actual: Vec3, expected: Vec3, precision = 5): void {
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
  expect(actual.z).toBeCloseTo(expected.z, precision);
}