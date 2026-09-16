/**
 * Command system tests: registry behavior, validation, and the invariants of
 * the AI control surface (execute() is the only mutation path; bad params
 * fail with named errors instead of producing garbage geometry).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { execute, listCommands, setModel } from './commands';
import { createTestModel, type TestModel } from '../test/geometry';
import '../skills/build_wall'; // registers build_wall
import './primitives'; // registers create_box / create_group

// Keep the live wired model so tests can assert on its state after execute().
let lastTestModel: TestModel;

beforeEach(() => {
  lastTestModel = createTestModel();
  setModel(lastTestModel);
});

describe('execute() — registry', () => {
  it('rejects unknown command types with a named error', () => {
    const result = execute('build_roof', {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No handler registered for command 'build_roof'/);
    expect(result.error).toContain('create_box'); // lists registered commands
  });

  it('registers the expected scaffold commands', () => {
    const commands = listCommands();
    expect(commands).toContain('build_wall');
    expect(commands).toContain('create_box');
    expect(commands).toContain('create_group');
  });

  it('returns a CommandResult for every call (never throws)', () => {
    // @ts-expect-error — garbage input must not crash the pipeline
    const result = execute(42, null);
    expect(result).toHaveProperty('ok');
    expect(result).toHaveProperty('message');
  });
});

describe('execute() — create_box validation', () => {
  it('rejects missing center and size params', () => {
    const result = execute('create_box', {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/center/);
    expect(result.error).toMatch(/must be \{x,y,z\}/);
  });

  it('rejects NaN coordinates', () => {
    const result = execute('create_box', {
      center: { x: NaN, y: 0, z: 0 },
      size: { x: 10, y: 10, z: 10 },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/NaN|must be \{x,y,z\}/i);
  });

  it('rejects negative size', () => {
    const result = execute('create_box', {
      center: { x: 0, y: 0, z: 0 },
      size: { x: -10, y: 10, z: 10 },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/positive/);
  });

  it('rejects wrong-typed params (strings instead of numbers)', () => {
    const result = execute('create_box', {
      center: { x: '0', y: '0', z: '0' },
      size: { x: 10, y: 10, z: 10 },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/must be \{x,y,z\}/);
  });

  it('accepts a valid box and reports its message', () => {
    const result = execute('create_box', {
      center: { x: 0, y: 0, z: 0 },
      size: { x: 24, y: 24, z: 1 },
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Created box');
    expect(result.message).toContain('24');
  });
});

describe('execute() — create_group validation', () => {
  it('rejects grouping unknown objects', () => {
    const result = execute('create_group', { names: ['nope'], name: 'g' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no object named 'nope'/);
  });

  it('rejects an empty names array', () => {
    const result = execute('create_group', { names: [], name: 'g' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/non-empty/);
  });

  it('groups existing objects', () => {
    execute('create_box', { center: { x: 0, y: 0, z: 0 }, size: { x: 10, y: 10, z: 10 }, name: 'a' });
    execute('create_box', { center: { x: 20, y: 0, z: 0 }, size: { x: 10, y: 10, z: 10 }, name: 'b' });
    const result = execute('create_group', { names: ['a', 'b'], name: 'pair' });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("'pair'");
  });

  it('is deterministic across fresh models with identical params', () => {
    const run = () => {
      setModel(createTestModel());
      return execute('create_box', { center: { x: 0, y: 0, z: 0 }, size: { x: 10, y: 10, z: 10 } });
    };
    expect(run()).toEqual(run());
  });
});

describe('execute() — translate (move tool primitive)', () => {
  it('moves a single box by the delta', () => {
    const result = execute('create_box', { name: 'b1', center: { x: 0, y: 0, z: 0 }, size: { x: 10, y: 10, z: 10 } });
    expect(result.ok).toBe(true);
    const moved = execute('translate', { targets: 'b1', delta: { x: 12, y: 0, z: 0 } });
    expect(moved.ok).toBe(true);
    expect(moved.message).toContain("'b1'");
    // TestModel meta + box record both in sync
    expect(lastTestModel.get('b1')!.center).toEqual({ x: 12, y: 0, z: 0 });
  });

  it('moves every member of a wall group (15 boxes for a 16 ft wall)', () => {
    execute('build_wall', { id: 'nw', start: { x: 0, y: 0, z: 0 }, end: { x: 192, y: 0, z: 0 } });
    const result = execute('translate', { targets: ['nw'], delta: { x: 48, y: 24, z: 0 } });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/16 member\(s\)/);
    const group = lastTestModel.get('nw')!;
    expect(group.kind).toBe('group');
    expect(group.members).toHaveLength(16);
    // members moved: bottom plate center 0.75 → 48, 24, 0.75
    expect(lastTestModel.get('nw_bottom_plate')!.center).toEqual({ x: 144, y: 24, z: 0.75 });
    expect(lastTestModel.get('nw_top_plate')!.center).toEqual({ x: 144, y: 24, z: 93.75 });
  });

  it('rejects an unknown target name', () => {
    const result = execute('translate', { targets: 'ghost', delta: { x: 1, y: 0, z: 0 } });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no object named 'ghost'/);
  });

  it('rejects bad targets or delta shapes', () => {
    const badTargets = execute('translate', { targets: [], delta: { x: 1, y: 0, z: 0 } });
    expect(badTargets.ok).toBe(false);
    expect(badTargets.error).toMatch(/targets/);
    const badDelta = execute('translate', { targets: 'x', delta: { x: NaN, y: 0, z: 0 } });
    expect(badDelta.ok).toBe(false);
  });
});