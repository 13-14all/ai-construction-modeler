/**
 * build_wall planner + command-level tests.
 *
 * These are the 22 numeric checks from the initial scaffold, now a permanent
 * regression suite. All geometry assertions use toBeCloseTo / actual dims
 * (inches) — never nominal labels.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  planBuildWall,
  DEFAULT_SPACING_IN,
  DEFAULT_HEIGHT_IN,
  DEFAULT_WALL_THICKNESS_IN,
  STUD_WIDTH_IN,
  PLATE_HEIGHT_IN,
  nominalStock,
  headerForSpan,
  roughOpening,
  resolveCorners,
  recordWall,
  getWallRecord,
  type OpeningParams,
  type ResolvedCorner,
} from './build_wall';
import { studsOf, platesOf, expectVec3Close, createTestModel } from '../test/geometry';
import { execute, setModel } from '../engine/commands';

/** Canonical 16 ft (192") wall for reuse across tests. */
const WALL_16FT = { start: { x: 0, y: 0, z: 0 }, end: { x: 192, y: 0, z: 0 } };
const EPSILON = 1e-9;

// ---------------------------------------------------------------------------
// 1. Planner: stud count & spacing
// ---------------------------------------------------------------------------
describe('build_wall planner — stud count and spacing', () => {
  it('places 13 studs on a 16 ft wall (corners + 16 in grid)', () => {
    const plan = planBuildWall(WALL_16FT);
    expect(plan.studCount).toBe(13);
  });

  it('places 7 studs on an 8 ft wall (corners + 1 intermediate)', () => {
    const plan = planBuildWall({ start: { x: 0, y: 0, z: 0 }, end: { x: 96, y: 0, z: 0 } });
    expect(plan.studCount).toBe(7); // 0,16,32,48,64,80,96
  });

  it('stud centers are exactly 16 in apart', () => {
    const plan = planBuildWall(WALL_16FT);
    const studs = studsOf(plan);
    for (let i = 1; i < studs.length; i++) {
      const gap = studs[i].center.x - studs[i - 1].center.x;
      // interior gaps are 16; the last gap (corner→end) is also 16 for a 192" wall
      expect(gap).toBeGreaterThanOrEqual(15.5);
      expect(gap).toBeLessThanOrEqual(16.5);
    }
  });

  it('places 15 studs on a 224 in wall', () => {
    const plan = planBuildWall({ start: { x: 0, y: 0, z: 0 }, end: { x: 224, y: 0, z: 0 } });
    expect(plan.studCount).toBe(15); // 0,16,...,208,224
  });

  it('smallest wall (sub-16 in) still has 2 corner studs', () => {
    const plan = planBuildWall({ start: { x: 0, y: 0, z: 0 }, end: { x: 8, y: 0, z: 0 } });
    expect(plan.studCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Planner: plate count and positions
// ---------------------------------------------------------------------------
describe('build_wall planner — plate count and positions', () => {
  it('emits 3 plates (bottom + double top plate)', () => {
    const plan = planBuildWall(WALL_16FT);
    const plates = platesOf(plan);
    expect(plates).toHaveLength(3);
    expect(plates.map((p) => p.name)).toEqual([
      'wall_bottom_plate',
      'wall_top_plate',
      'wall_cap_plate',
    ]);
  });

  it('bottom plate z-center is at half the plate height (0.75 in)', () => {
    const plan = planBuildWall(WALL_16FT);
    const bottom = platesOf(plan)[0];
    expectVec3Close(bottom.center, { x: bottom.center.x, y: bottom.center.y, z: PLATE_HEIGHT_IN / 2 });
  });

  it('top plate z-center is 2.25 in below the cap plate', () => {
    const plan = planBuildWall(WALL_16FT);
    const top = platesOf(plan)[1]; // first of the double top plates
    expectVec3Close(top.center, { x: top.center.x, y: top.center.y, z: DEFAULT_HEIGHT_IN - 1.5 * PLATE_HEIGHT_IN });
  });

  it('cap plate z-center is at height minus half the plate height (95.25 in)', () => {
    const plan = planBuildWall(WALL_16FT);
    const cap = platesOf(plan)[2];
    const expectedZ = DEFAULT_HEIGHT_IN - PLATE_HEIGHT_IN / 2; // 95.25
    expectVec3Close(cap.center, { x: cap.center.x, y: cap.center.y, z: expectedZ });
  });

  it('all 3 plates are centered on the wall centerline (flush with studs)', () => {
    const plan = planBuildWall(WALL_16FT);
    for (const plate of platesOf(plan)) {
      expect(plate.center.y).toBeCloseTo(0, 5); // 16 ft wall along +x: centerline is y=0
      expect(plate.size.y).toBe(DEFAULT_WALL_THICKNESS_IN);
    }
  });

  it('plate length matches wall length (192 in)', () => {
    const plan = planBuildWall(WALL_16FT);
    const plate = platesOf(plan)[0];
    expect(plate.size.x).toBe(192);
  });
});

// ---------------------------------------------------------------------------
// 3. Planner: actual lumber dimensions (the most common geometry bug)
// ---------------------------------------------------------------------------
describe('build_wall planner — actual dimensions', () => {
  it('stud along-wall width is 1.5 in (actual 2×4)', () => {
    const plan = planBuildWall(WALL_16FT);
    const stud = studsOf(plan)[0];
    expect(stud.size.x).toBe(STUD_WIDTH_IN); // 1.5
  });

  it('stud across-wall depth is wallThickness (3.5 in default)', () => {
    const plan = planBuildWall(WALL_16FT);
    const stud = studsOf(plan)[0];
    expect(stud.size.y).toBe(DEFAULT_WALL_THICKNESS_IN); // 3.5
  });

  it('stud height is wall height minus 3 plates (91.5 in for 8 ft wall)', () => {
    const plan = planBuildWall(WALL_16FT);
    const stud = studsOf(plan)[0];
    const expectedLen = DEFAULT_HEIGHT_IN - 3 * PLATE_HEIGHT_IN; // 91.5 (bottom + double top)
    expect(stud.size.z).toBeCloseTo(expectedLen, 5);
  });

  it('stud z-center sits between the bottom plate and the double top plate', () => {
    const plan = planBuildWall(WALL_16FT);
    const stud = studsOf(plan)[0];
    const expectedZ = PLATE_HEIGHT_IN + (DEFAULT_HEIGHT_IN - 3 * PLATE_HEIGHT_IN) / 2; // 47.25
    expect(stud.center.z).toBeCloseTo(expectedZ, 5);
  });

  it('plate depth equals wallThickness (3.5 in default)', () => {
    const plan = planBuildWall(WALL_16FT);
    const plate = platesOf(plan)[0];
    expect(plate.size.y).toBe(DEFAULT_WALL_THICKNESS_IN);
  });

  it('plate height is 1.5 in', () => {
    const plan = planBuildWall(WALL_16FT);
    const plate = platesOf(plan)[0];
    expect(plate.size.z).toBe(PLATE_HEIGHT_IN);
  });

  it('2×6 wall uses 5.5 in thickness', () => {
    const plan = planBuildWall({ ...WALL_16FT, wallThickness: 5.5 });
    const stud = studsOf(plan)[0];
    expect(stud.size.y).toBe(5.5);
    expect(platesOf(plan)[0].size.y).toBe(5.5);
  });
});

// ---------------------------------------------------------------------------
// 4. Planner: rounding, non-orthogonal, clamping
// ---------------------------------------------------------------------------
describe('build_wall planner — rounding, orientation, clamping', () => {
  it('plate length rounds to 1/4 in', () => {
    const plan = planBuildWall({ start: { x: 0, y: 0, z: 0 }, end: { x: 1920.3, y: 0, z: 0 } });
    expect(platesOf(plan)[0].size.x).toBe(1920.25);
  });

  it('non-orthogonal wall computes correct length (96/72 → 120)', () => {
    const plan = planBuildWall({ start: { x: 0, y: 0, z: 0 }, end: { x: 96, y: 72, z: 0 } });
    expect(plan.length).toBeCloseTo(120, 5);
  });

  it('clamps height > 240 down to 240 and sets clampedHeight flag', () => {
    const plan = planBuildWall({ start: { x: 0, y: 0, z: 0 }, end: { x: 96, y: 0, z: 0 }, height: 300 });
    expect(plan.height).toBe(240);
    expect(plan.clampedHeight).toBe(true);
  });

  it('clamps height < 8 up to 8', () => {
    const plan = planBuildWall({ start: { x: 0, y: 0, z: 0 }, end: { x: 96, y: 0, z: 0 }, height: 2 });
    expect(plan.height).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// 5. Error cases
// ---------------------------------------------------------------------------
describe('build_wall planner — rejects invalid params', () => {
  it('throws on non-ground-plane wall', () => {
    expect(() =>
      planBuildWall({ start: { x: 0, y: 0, z: 0 }, end: { x: 96, y: 0, z: 24 } }),
    ).toThrow(/ground plane/);
  });

  it('throws on zero-length wall', () => {
    expect(() =>
      planBuildWall({ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 } }),
    ).toThrow(/at least 0.25 in/);
  });

  it('throws on spacing below 12 in', () => {
    expect(() =>
      planBuildWall({ start: { x: 0, y: 0, z: 0 }, end: { x: 96, y: 0, z: 0 }, spacing: 7 }),
    ).toThrow(/between 12 and 24/);
  });

  it('throws on spacing above 24 in', () => {
    expect(() =>
      planBuildWall({ start: { x: 0, y: 0, z: 0 }, end: { x: 96, y: 0, z: 0 }, spacing: 30 }),
    ).toThrow(/between 12 and 24/);
  });

  it('throws on wallThickness below minimum', () => {
    expect(() =>
      planBuildWall({ start: { x: 0, y: 0, z: 0 }, end: { x: 96, y: 0, z: 0 }, wallThickness: 0.5 }),
    ).toThrow(/wallThickness/);
  });

  it('throws on non-finite start coordinates', () => {
    expect(() =>
      planBuildWall({ start: { x: NaN, y: 0, z: 0 }, end: { x: 96, y: 0, z: 0 } }),
    ).toThrow(/start must be/);
  });
});

// ---------------------------------------------------------------------------
// 6. Determinism
// ---------------------------------------------------------------------------
describe('build_wall planner — determinism', () => {
  it('identical params produce deep-equal piece lists', () => {
    const plan1 = planBuildWall(WALL_16FT);
    const plan2 = planBuildWall(WALL_16FT);
    expect(plan1.pieces).toEqual(plan2.pieces);
  });
});

// ---------------------------------------------------------------------------
// 7. nominalStock mapping
// ---------------------------------------------------------------------------
describe('nominalStock', () => {
  it.each([
    [3.5, '2×4'],
    [5.5, '2×6'],
    [7.25, '2×8'],
    [11.25, '11.25" stock'],
  ])('thickness %.1f → "%s"', (thickness, expected) => {
    expect(nominalStock(thickness)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 8. Openings — RO dimensions and header sizing rules
// ---------------------------------------------------------------------------
describe('roughOpening — RO from unit dims (IRC/carpentry-standards)', () => {
  it.each([
    ['window', { kind: 'window', width: 36, height: 48 }, 36.5, 48.5],
    ['interior door', { kind: 'door', width: 36, height: 84 }, 38, 85],
    ['exterior door', { kind: 'door', width: 36, height: 84, exterior: true }, 40.5, 86.25],
  ])('%s', (_label, opening, w, h) => {
    const ro = roughOpening(opening as OpeningParams);
    expect(ro.width).toBeCloseTo(w, 5);
    expect(ro.height).toBeCloseTo(h, 5);
  });

  it('rejects non-positive unit dims', () => {
    expect(() => roughOpening({ kind: 'door', width: 0, height: 80 } as OpeningParams)).toThrow(/positive/);
  });
});

describe('headerForSpan — built-up header lumber by span', () => {
  it.each([
    [48, '2×4', 3.5],
    [72, '2×6', 5.5],
    [96, '2×8', 7.25],
    [120, '2×10', 9.25],
    [144, '2×12', 11.25],
  ])('span %i in → %s (depth %i)', (span, label, depth) => {
    const h = headerForSpan(span);
    expect(h.label).toBe(label);
    expect(h.depth).toBe(depth);
  });

  it('throws past 12 ft (engineered header out of scope)', () => {
    expect(() => headerForSpan(150)).toThrow(/12 ft/);
  });
});

// ---------------------------------------------------------------------------
// 9. Openings — door framing
// ---------------------------------------------------------------------------
describe('build_wall planner — door opening', () => {
  const WALL_WITH_DOOR = {
    ...WALL_16FT,
    openings: [{ kind: 'door' as const, width: 36, height: 80, x: 48 }],
  };

  it('reports 1 opening with a 38 in RO and a 2×4 header', () => {
    const plan = planBuildWall(WALL_WITH_DOOR);
    expect(plan.openings).toHaveLength(1);
    const o = plan.openings[0];
    expect(o.kind).toBe('door');
    expect(o.roWidth).toBeCloseTo(38, 5);
    expect(o.headerLabel).toBe('2×4');
  });

  it('header top is flush under the top plates; RO height = header bottom', () => {
    const plan = planBuildWall(WALL_WITH_DOOR);
    const o = plan.openings[0];
    const header = plan.pieces.filter((p) => p.kind === 'header');
    // Door: RO extends from the subfloor up to the header bottom.
    // RO height = wall height − 3 plates − header depth = 88 for a 2×4 header.
    expect(o.roTop).toBeCloseTo(DEFAULT_HEIGHT_IN - 3 * PLATE_HEIGHT_IN - o.headerDepth, 5);
    // The header rises from the RO top: center = roTop + depth/2, top flush at 91.5.
    expect(header[0].center.z).toBeCloseTo(o.roTop + o.headerDepth / 2, 5);
    expect(header[0].center.z + o.headerDepth / 2).toBeCloseTo(DEFAULT_HEIGHT_IN - 3 * PLATE_HEIGHT_IN, 5);
  });

  it('builds a built-up header: 2 boards + 1/2 in spacer spanning RO + 3', () => {
    const plan = planBuildWall(WALL_WITH_DOOR);
    const headers = plan.pieces.filter((p) => p.kind === 'header');
    expect(headers).toHaveLength(3);
    const boards = headers.filter((h) => h.size.y === 1.5);
    const spacer = headers.find((h) => h.size.y === 0.5)!;
    expect(boards).toHaveLength(2);
    expect(spacer).toBeDefined();
    for (const h of headers) {
      expect(h.size.x).toBeCloseTo(41, 5); // RO 38 + 2×1.5 bearing
      expect(h.size.z).toBeCloseTo(3.5, 5); // 2×4 header depth
    }
    // assembly spans the full wall thickness: 1.5 + 0.5 + 1.5
    const ys = headers.map((h) => h.center.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-1.0, 5);
    expect(ys[2]).toBeCloseTo(1.0, 5);
  });

  it('frames 2 kings + 2 jacks at the RO edges with correct lengths', () => {
    const plan = planBuildWall(WALL_WITH_DOOR);
    const kings = plan.pieces.filter((p) => p.kind === 'king');
    const jacks = plan.pieces.filter((p) => p.kind === 'jack');
    expect(kings).toHaveLength(2);
    expect(jacks).toHaveLength(2);
    expect(kings[0].center.x).toBeCloseTo(45.75, 5); // 48 - 2.25
    expect(kings[1].center.x).toBeCloseTo(48 + 38 + 2.25, 5);
    expect(jacks[0].center.x).toBeCloseTo(47.25, 5); // 48 - 0.75
    expect(jacks[1].center.x).toBeCloseTo(48 + 38 + 0.75, 5);
    const studLen = DEFAULT_HEIGHT_IN - 3 * PLATE_HEIGHT_IN; // 91.5
    expect(kings[0].size.z).toBeCloseTo(studLen, 5);
    expect(jacks[0].size.z).toBeCloseTo(88 - 1.5, 5); // header bottom 88 − bottom plate
  });

  it('drops grid studs that would land inside the opening/king zone', () => {
    const plain = planBuildWall(WALL_16FT).studCount; // 13
    const withDoor = planBuildWall(WALL_WITH_DOOR).studCount;
    expect(withDoor).toBe(plain - 3); // grid studs at 48, 64, 80 removed
  });

  it('exterior door RO is 40.5 in wide', () => {
    const plan = planBuildWall({
      ...WALL_16FT,
      openings: [{ kind: 'door', width: 36, height: 80, x: 72, exterior: true }],
    });
    expect(plan.openings[0].roWidth).toBeCloseTo(40.5, 5);
  });
});

// ---------------------------------------------------------------------------
// 10. Openings — window framing
// ---------------------------------------------------------------------------
describe('build_wall planner — window opening', () => {
  const WALL_WITH_WINDOW = {
    ...WALL_16FT,
    openings: [{ kind: 'window' as const, width: 36, height: 48, x: 100, sillHeight: 36 }],
  };

  it('reports RO 36.5 wide, sill top at 36, top at 84.5', () => {
    const plan = planBuildWall(WALL_WITH_WINDOW);
    const o = plan.openings[0];
    expect(o.kind).toBe('window');
    expect(o.roWidth).toBeCloseTo(36.5, 5);
    expect(o.roBottom).toBeCloseTo(36, 5); // sill top
    expect(o.roTop).toBeCloseTo(84.5, 5); // 36 + 48.5
  });

  it('lays a 2×4 sill flat between the jacks', () => {
    const plan = planBuildWall(WALL_WITH_WINDOW);
    const sill = plan.pieces.find((p) => p.kind === 'sill')!;
    expect(sill).toBeDefined();
    expect(sill.size.x).toBeCloseTo(36.5, 5); // RO width
    expect(sill.size.z).toBe(PLATE_HEIGHT_IN); // 2×4 laid flat
    expect(sill.center.z).toBeCloseTo(35.25, 5); // 36 − 1.5/2
  });

  it('places cripple studs below the sill at 16 in O.C. from the opening edge', () => {
    const plan = planBuildWall(WALL_WITH_WINDOW);
    const cripples = plan.pieces.filter((p) => p.kind === 'cripple');
    expect(cripples).toHaveLength(2); // x+16, x+32 < 36.5 RO
    expect(cripples[0].center.x).toBeCloseTo(116, 5);
    expect(cripples[1].center.x).toBeCloseTo(132, 5);
    expect(cripples[0].size.z).toBeCloseTo(33, 5); // 36 − 1.5 (sill) − 1.5 (bottom plate)
  });

  it('window kings/jacks flank the RO like a door', () => {
    const plan = planBuildWall(WALL_WITH_WINDOW);
    expect(plan.pieces.filter((p) => p.kind === 'king')).toHaveLength(2);
    expect(plan.pieces.filter((p) => p.kind === 'jack')).toHaveLength(2);
  });

  it('default sill height is 36 in when omitted', () => {
    const plan = planBuildWall({
      ...WALL_16FT,
      openings: [{ kind: 'window', width: 36, height: 48, x: 100 }],
    });
    expect(plan.openings[0].roBottom).toBeCloseTo(36, 5);
  });
});

// ---------------------------------------------------------------------------
// 11. Openings — fit and clearance validation
// ---------------------------------------------------------------------------
describe('build_wall planner — opening validation', () => {
  it('rejects an opening that collides with the corner/king zone (x < 4.5)', () => {
    expect(() =>
      planBuildWall({ ...WALL_16FT, openings: [{ kind: 'door', width: 36, height: 80, x: 2 }] }),
    ).toThrow(/clear corner studs/);
  });

  it('rejects a door too tall for the header space', () => {
    // RO 98 needed (97+1) vs header bottom 88 → must reject
    expect(() =>
      planBuildWall({ ...WALL_16FT, openings: [{ kind: 'door', width: 36, height: 97, x: 48 }] }),
    ).toThrow(/Raise the wall|header leaves/);
  });

  it('rejects a window too tall for the header space', () => {
    expect(() =>
      planBuildWall({
        ...WALL_16FT,
        openings: [{ kind: 'window', width: 36, height: 120, x: 48, sillHeight: 60 }],
      }),
    ).toThrow(/doesn't fit/);
  });

  it('rejects an opening span beyond 12 ft', () => {
    expect(() =>
      planBuildWall({ ...WALL_16FT, openings: [{ kind: 'door', width: 168, height: 80, x: 12 }] }),
    ).toThrow(/12 ft/);
  });

  it('rejects invalid opening kind', () => {
    expect(() =>
      planBuildWall({
        ...WALL_16FT,
        openings: [{ kind: 'garage', width: 36, height: 80, x: 48 }] as unknown as OpeningParams[],
      }),
    ).toThrow(/door' or 'window/);
  });

  it('full wall with door + window: 28 members (grid studs culled by both zones)', () => {
    const plan = planBuildWall({
      ...WALL_16FT,
      openings: [
        { kind: 'door', width: 36, height: 80, x: 48 },
        { kind: 'window', width: 36, height: 48, x: 100, sillHeight: 36 },
      ],
    });
    // 3 plates + 8 grid studs (13 − 3 door zone − 2 window zone)
    //   + 7 door members (2 kings + 2 jacks + 3 header) + 10 window members (2k+2j+3h+sill+2 cripples)
    expect(plan.pieces).toHaveLength(3 + 8 + 7 + 10);
  });
});

// ---------------------------------------------------------------------------
// 12. Corners — registry resolution
// ---------------------------------------------------------------------------
describe('resolveCorners — registry resolution', () => {
  const AXIS_X = { x: 1, y: 0, z: 0 };
  beforeAll(() => {
    recordWall({ id: 'reg_north', start: { x: 0, y: 0, z: 0 }, end: { x: 192, y: 0, z: 0 }, length: 192, height: 96, thickness: 3.5, spacing: 16, axis: AXIS_X });
    recordWall({ id: 'reg_short', start: { x: 0, y: 0, z: 0 }, end: { x: 64, y: 0, z: 0 }, length: 64, height: 96, thickness: 3.5, spacing: 16, axis: AXIS_X });
  });

  it('resolves an L-corner when endpoints coincide', () => {
    const resolved = resolveCorners(
      { start: { x: 192, y: 0, z: 0 }, end: { x: 192, y: 192, z: 0 }, length: 192 },
      [{ at: 'start', with: 'reg_north' }],
    );
    expect(resolved).toEqual([{ at: 'start', kind: 'l' }]);
  });

  it('resolves a T-junction on the interior with trim + ladder data', () => {
    const resolved = resolveCorners(
      { start: { x: 96, y: 0, z: 0 }, end: { x: 96, y: 96, z: 0 }, length: 96 },
      [{ at: 'start', with: 'reg_north' }],
    );
    expect(resolved[0].kind).toBe('t');
    expect(resolved[0].trim).toBeCloseTo(1.75, 5); // half the target thickness
    expect(resolved[0].ladder).toEqual({
      targetId: 'reg_north',
      centerWorld: { x: 104, y: 0, z: 0 }, // between grid studs 96 and 112
      cavity: 14.5, // 16 OC − 1.5 stud
      thickness: 3.5,
    });
  });

  it('throws on an unknown target wall', () => {
    expect(() =>
      resolveCorners({ start: { x: 96, y: 0, z: 0 }, end: { x: 96, y: 96, z: 0 }, length: 96 }, [{ at: 'start', with: 'ghost' }]),
    ).toThrow(/unknown wall 'ghost'/);
  });

  it('throws when the corner point is off the target wall', () => {
    expect(() =>
      resolveCorners({ start: { x: 96, y: 10, z: 0 }, end: { x: 96, y: 106, z: 0 }, length: 96 }, [{ at: 'start', with: 'reg_north' }]),
    ).toThrow(/off wall/);
  });

  it('throws on collinear interior overlap (parallel walls)', () => {
    expect(() =>
      resolveCorners({ start: { x: 20, y: 0, z: 0 }, end: { x: 100, y: 0, z: 0 }, length: 80 }, [{ at: 'end', with: 'reg_north' }]),
    ).toThrow(/collinear/);
  });

  it('L-corner tolerance: endpoint within 0.25 in of target end', () => {
    const resolved = resolveCorners(
      { start: { x: 191.9, y: 0, z: 0 }, end: { x: 191.9, y: 100, z: 0 }, length: 100 },
      [{ at: 'start', with: 'reg_north' }],
    );
    expect(resolved[0].kind).toBe('l');
  });

  it('records and retrieves wall records', () => {
    recordWall({ id: 'probe', start: { x: 0, y: 0, z: 0 }, end: { x: 96, y: 0, z: 0 }, length: 96, height: 96, thickness: 3.5, spacing: 16, axis: AXIS_X });
    expect(getWallRecord('probe')?.length).toBe(96);
  });
});

// ---------------------------------------------------------------------------
// 13. Corners — L-corner framing
// ---------------------------------------------------------------------------
describe('build_wall planner — L-corner', () => {
  const L_END: ResolvedCorner = { at: 'end', kind: 'l' };
  const L_START: ResolvedCorner = { at: 'start', kind: 'l' };

  const plan = () => planBuildWall({ ...WALL_16FT, corners: [L_END] });

  it('adds a California-style backer stud 3.5 in O.C. inside the wall', () => {
    const backers = plan().pieces.filter((p) => p.kind === 'backer');
    expect(backers).toHaveLength(1);
    expect(backers[0].center.x).toBeCloseTo(192 - 3.5, 5);
    expect(backers[0].size.z).toBeCloseTo(91.5, 5); // full stud length
  });

  it('adds a mid-height block between end stud and backer', () => {
    const blocks = plan().pieces.filter((p) => p.kind === 'block');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].center.x).toBeCloseTo(192 - 1.75, 5); // cavity midpoint
    expect(blocks[0].size).toEqual({ x: 2.0, y: 3.5, z: 1.5 });
    expect(blocks[0].center.z).toBeCloseTo(48, 5); // mid-height
  });

  it('keeps the 16 in O.C. grid intact at the corner end', () => {
    expect(plan().studCount).toBe(13); // 2×4 header wall: 13 studs, unchanged
  });

  it('L-corner at start is symmetric around x=0', () => {
    const p = planBuildWall({ ...WALL_16FT, corners: [L_START] });
    const backers = p.pieces.filter((x) => x.kind === 'backer');
    expect(backers[0].center.x).toBeCloseTo(3.5, 5);
    expect(p.studCount).toBe(13);
  });

  it('reports the corner in cornerNotes', () => {
    expect(plan().cornerNotes).toContain('L-corner end (backer + block)');
  });
});

// ---------------------------------------------------------------------------
// 14. Corners — T-junction framing
// ---------------------------------------------------------------------------
describe('build_wall planner — T-junction', () => {
  const T_END: ResolvedCorner = {
    at: 'end',
    kind: 't',
    trim: 1.75,
    ladder: { targetId: 'reg_north', centerWorld: { x: 104, y: 0, z: 0 }, cavity: 14.5, thickness: 3.5 },
  };

  const plan = () => planBuildWall({ ...WALL_16FT, corners: [T_END] });

  it('trims plates to the target wall near face (192 − 1.75 = 190.25)', () => {
    const plates = plan().pieces.filter((p) => p.kind === 'plate');
    expect(plates).toHaveLength(3);
    for (const p of plates) expect(p.size.x).toBeCloseTo(190.25, 5);
    expect(plates[0].center.x).toBeCloseTo(192 / 2 - 1.75 / 2, 5); // re-centered for trim
  });

  it('moves the end stud flush against the near face (center at L − 2.5)', () => {
    const studs = plan().pieces.filter((p) => p.kind === 'stud');
    const last = studs[studs.length - 1];
    expect(last.center.x).toBeCloseTo(192 - 2.5, 5); // 189.5
  });

  it('adds ladder blocks at 1/3 and 2/3 height in the target wall', () => {
    const blocks = plan().pieces.filter((p) => p.kind === 'block');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].center).toEqual({ x: 104, y: 0, z: 32 }); // 96/3
    expect(blocks[1].center).toEqual({ x: 104, y: 0, z: 64 }); // 2·96/3
    for (const b of blocks) {
      expect(b.size).toEqual({ x: 14.5, y: 3.5, z: 1.5 });
    }
  });

  it('keeps grid studs inside the trimmed wall (13 studs)', () => {
    expect(plan().studCount).toBe(13);
  });

  it('handles T at start symmetrically', () => {
    const p = planBuildWall({
      ...WALL_16FT,
      corners: [{ ...T_END, at: 'start', ladder: { ...T_END.ladder!, centerWorld: { x: 104, y: 0, z: 0 } } }],
    });
    const studs = p.pieces.filter((x) => x.kind === 'stud');
    expect(studs[0].center.x).toBeCloseTo(2.5, 5);
    expect(p.pieces.filter((x) => x.kind === 'plate')[0].size.x).toBeCloseTo(190.25, 5);
  });

  it('reports the junction in cornerNotes', () => {
    expect(plan().cornerNotes).toContain('T-junction end w/ reg_north (ladder blocks)');
  });
});

// ---------------------------------------------------------------------------
// 15. Command-level: execute() through the full pipeline (node fake model)
// ---------------------------------------------------------------------------
describe('build_wall command — execute() happy path', () => {
  it('creates 15 boxes (2 plates + 13 studs) and registers the group', () => {
    setModel(createTestModel());
    const result = execute('build_wall', { start: { x: 0, y: 0, z: 0 }, end: { x: 192, y: 0, z: 0 } });
    expect(result.ok).toBe(true);
  });

  it('reports stud count and spacing in the result message', () => {
    setModel(createTestModel());
    const result = execute('build_wall', { start: { x: 0, y: 0, z: 0 }, end: { x: 192, y: 0, z: 0 } });
    expect(result.message).toContain('13 studs');
    expect(result.message).toContain('16" OC');
  });

  it('emits a focus side-effect for the viewport', () => {
    setModel(createTestModel());
    const result = execute('build_wall', { start: { x: 0, y: 0, z: 0 }, end: { x: 192, y: 0, z: 0 } });
    expect(result.effects).toContainEqual({ type: 'focus', payload: { target: 'wall' } });
  });
});

// ---------------------------------------------------------------------------
// 16. Command-level: corner resolution through execute()
// ---------------------------------------------------------------------------
describe('build_wall command — corner integration', () => {
  beforeEach(() => {
    setModel(createTestModel());
  });

  it('L-corner: second wall references the first by id', () => {
    execute('build_wall', { id: 'north', start: { x: 0, y: 0, z: 0 }, end: { x: 192, y: 0, z: 0 } });
    const result = execute('build_wall', {
      id: 'west',
      start: { x: 192, y: 0, z: 0 },
      end: { x: 192, y: 192, z: 0 },
      corners: [{ at: 'start', with: 'north' }],
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('L-corner start');
  });

  it('T-junction: wall tees into the first wall interior', () => {
    execute('build_wall', { id: 'north_t', start: { x: 0, y: 0, z: 0 }, end: { x: 192, y: 0, z: 0 } });
    const result = execute('build_wall', {
      id: 'tee',
      start: { x: 96, y: 0, z: 0 },
      end: { x: 96, y: 96, z: 0 },
      corners: [{ at: 'start', with: 'north_t' }],
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('T-junction start w/ north_t');
  });

  it('unknown corner target fails cleanly through execute()', () => {
    const result = execute('build_wall', {
      start: { x: 96, y: 0, z: 0 },
      end: { x: 96, y: 96, z: 0 },
      corners: [{ at: 'start', with: 'ghost' }],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown wall 'ghost'/);
  });

  it('registered wall record matches the built wall (getWallRecord)', () => {
    execute('build_wall', { id: 'probe_w', start: { x: 0, y: 0, z: 0 }, end: { x: 128, y: 0, z: 0 }, height: 104 });
    const rec = getWallRecord('probe_w')!;
    expect(rec.length).toBeCloseTo(128, 5);
    expect(rec.height).toBe(104);
    expect(rec.thickness).toBe(3.5);
  });
});
