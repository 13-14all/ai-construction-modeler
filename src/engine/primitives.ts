/**
 * Core command implementations: the smallest deterministic geometry ops the
 * skills layer is built on. These belong to the command system, not to any
 * skill — skills emit these commands.
 */

import { register, type CommandResult } from './commands';
import type { Vec3 } from '../types';

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isVec3(v: unknown): v is Vec3 {
  return (
    typeof v === 'object' &&
    v !== null &&
    isFiniteNumber((v as Vec3).x) &&
    isFiniteNumber((v as Vec3).y) &&
    isFiniteNumber((v as Vec3).z)
  );
}

/** Read a Vec3 param under `key`, or throw with a helpful message. */
export function expectVec3(params: Record<string, unknown>, key: string): Vec3 {
  const v = params[key];
  if (!isVec3(v)) {
    throw new Error(`create_box: param '${key}' must be {x,y,z} numbers (inches), got ${JSON.stringify(v)}`);
  }
  return v;
}

/** Read a positive finite number param under `key`. */
export function expectPositiveNumber(params: Record<string, unknown>, key: string): number {
  const v = params[key];
  if (!isFiniteNumber(v) || v <= 0) {
    throw new Error(`create_box: param '${key}' must be a positive number (inches), got ${JSON.stringify(v)}`);
  }
  return v;
}

register('create_box', (params, model): CommandResult => {
  const center = expectVec3(params, 'center');
  const size = expectVec3(params, 'size');
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
    throw new Error(`create_box: size must be positive in all axes, got {${size.x}, ${size.y}, ${size.z}}`);
  }
  const color = typeof params.color === 'string' ? params.color : '#8a94a6';
  const baseName = typeof params.name === 'string' && params.name.trim() ? params.name : 'box';
  const name = model.createBox(baseName, center, size, color);
  return {
    ok: true,
    message: `Created box '${name}' (${size.x}" × ${size.y}" × ${size.z}")`,
  };
});

register('translate', (params, model): CommandResult => {
  const raw = params.targets;
  const targets = typeof raw === 'string' ? [raw] : raw;
  if (
    !Array.isArray(targets) ||
    targets.length === 0 ||
    !targets.every((t) => typeof t === 'string')
  ) {
    throw new Error(`translate: param 'targets' must be an object name or a non-empty array of names, got ${JSON.stringify(raw)}`);
  }
  const delta = expectVec3(params, 'delta');
  let moved = 0;
  for (const name of targets) {
    if (!model.get(name)) {
      throw new Error(`translate: no object named '${name}' in the scene`);
    }
    moved += model.translate(name, delta);
  }
  const list = targets.length === 1 ? `'${targets[0]}'` : `[${targets.map((t) => `'${t}'`).join(', ')}]`;
  return {
    ok: true,
    message: `Moved ${list} by (${delta.x}, ${delta.y}, ${delta.z}) in (${moved} member(s))`,
  };
});
  register('create_group', (params, model): CommandResult => {
  const names = params.names;
  if (!Array.isArray(names) || names.length === 0 || !names.every((n) => typeof n === 'string')) {
    throw new Error('create_group: param \'names\' must be a non-empty array of object names');
  }
  for (const name of names) {
    if (!model.get(name)) {
      throw new Error(`create_group: no object named '${name}' in the scene`);
    }
  }
  const groupName = typeof params.name === 'string' && params.name.trim() ? params.name : `group_${model.revision + 1}`;
  model.add(groupName, names);
  return {
    ok: true,
    message: `Grouped ${names.length} object(s) as '${groupName}'`,
  };
});