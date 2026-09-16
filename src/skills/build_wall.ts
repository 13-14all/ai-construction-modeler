/**
 * build_wall skill — platform-framed stud wall with rough openings and
 * corner intersections.
 *
 * Deterministic: `planBuildWall()` is a pure function of its JSON input (the
 * AI-surface contract); the registered command validates + executes the plan
 * through primitives. No direct mesh access anywhere (hard rule).
 *
 * Framing conventions (IRC-based, per carpentry_standards.md / the
 * carpentry-standards skill):
 *   - Bottom plate + DOUBLE top plate (3 × 1.5 in plates; joints offset
 *     ≥24 in in real work — plates here are continuous single pieces, so
 *     the offset rule is trivially satisfied).
 *   - Studs: 1.5 in wide along the wall, 16 in O.C. default. Corner stud at
 *     each end; grid studs 16 in O.C. between. Stud length = wall height
 *     minus 3 plates (wall height is measured to the TOP of the double top
 *     plate). Precut-stud allowances for floor assemblies are out of scope.
 *   - Openings: king studs + jack studs + built-up header (two boards with
 *     a 1/2 in ply spacer, making the assembly equal to wall thickness).
 *     Header sized by span (conservative single-story rule, labeled in the
 *     plan so the user can override): <4 ft→2×4, <6 ft→2×6, <8 ft→2×8,
 *     <10 ft→2×10, <12 ft→2×12; beyond that, throw (engineered header).
 *     Headers sit flush under the top plates; the space above a door/window
 *     unit inside the opening is blocking (real framing practice).
 *   - Windows: 2×4 sill laid flat + cripple studs below it at 16 in O.C.
 *     from the opening edge.
 *   - Rough opening: window = unit +1/2 in each way; interior door = +2 in
 *     wide, +1 in tall; exterior door = +4.5 in wide, +2.25 in tall.
 *   - Corners: `corner: [{ at: 'start'|'end', with: <wallId> }]` — resolved
 *     against previously-built walls (see WallRecord/resolveCorners).
 *     L-corner (endpoints coincide): the two end studs overlap at the point
 *     and fill the 3.5×3.5 corner; we add a California-style backer stud at
 *     3.5 in O.C. inside the joining wall + a mid-height block.
 *     T-junction (end lands on a wall's interior): the joining wall is
 *     framed flush to the target's near face (plates trimmed by half the
 *     target's thickness, end stud moved inward) and ladder blocking (2
 *     blocks at 1/3 and 2/3 height) is added between the target wall's
 *     flanking studs to give nailing support. Simplified CAD-style corner
 *     framing — documented simplification, not a construction detail.
 */

import { register, type CommandResult } from '../engine/commands';
import type { Vec3 } from '../types';

/** Imperially-sane defaults (inches). */
export const DEFAULT_HEIGHT_IN = 96; // 8 ft wall, measured to top of double top plate
export const DEFAULT_SPACING_IN = 16; // on center
export const DEFAULT_WALL_THICKNESS_IN = 3.5; // 2×4 actual depth
export const STUD_WIDTH_IN = 1.5; // 2×4 and 2×6 studs are 1.5 in wide along the wall
export const PLATE_HEIGHT_IN = 1.5;
export const PLATE_COUNT = 3; // bottom + double top plate
const MIN_HEIGHT_IN = 8;
const MAX_HEIGHT_IN = 240;
const MIN_THICKNESS_IN = 1.25;
const MAX_THICKNESS_IN = 12;
const MAX_STUDS = 500; // AI budget guards
const MAX_OPENINGS = 20;
const MAX_CORNERS = 4;

/** One rough opening request (unit dimensions — RO computed from these). */
export interface OpeningParams {
  kind: 'door' | 'window';
  /** Unit width (inches), e.g. 36 for a 36 in door. */
  width: number;
  /** Unit height (inches), e.g. 80 for an 80 in door. */
  height: number;
  /** Offset of the rough opening LEFT edge from the wall start, inches. */
  x: number;
  /** Door only: exterior door RO rule (+4.5/+2.25). Default interior. */
  exterior?: boolean;
  /** Window only: sill top above the subfloor (inches). Default 36. */
  sillHeight?: number;
}

/** Framed opening geometry after layout. */
export interface FrameOpening {
  kind: 'door' | 'window';
  x: number; // RO left edge
  roWidth: number;
  /** Door: header bottom (RO is open to the subfloor). Window: sill top. */
  roBottom: number;
  roTop: number;
  headerDepth: number;
  headerLabel: string;
}

export interface WallParams {
  /** Start point of the wall centerline, inches (ground plane). */
  start: Vec3;
  /** End point of the wall centerline, inches (ground plane). */
  end: Vec3;
  /** Wall height, to top of double top plate (inches). Default 96. */
  height?: number;
  /** Stud spacing, on center (inches). Default 16. */
  spacing?: number;
  /** Wall depth, across the wall plane (inches). Default 3.5 (2×4). */
  wallThickness?: number;
  /** Optional label; scene-derived if omitted. */
  id?: string;
  /** Rough openings (doors/windows). Default none. */
  openings?: OpeningParams[];
  /** Corner references resolved by the command handler. Default none. */
  corners?: ResolvedCorner[];
}

/** User-facing corner request: this wall's end touches another wall. */
export interface CornerRequest {
  at: 'start' | 'end';
  /** Id of an already-built wall to intersect. */
  with: string;
}

export type WallPieceKind =
  | 'plate'
  | 'stud'
  | 'king'
  | 'jack'
  | 'cripple'
  | 'header'
  | 'sill'
  | 'backer'
  | 'block';

export interface WallPiece {
  name: string;
  kind: WallPieceKind;
  center: Vec3;
  size: Vec3;
  color: string;
}

export interface WallPlan {
  id: string;
  /** Wall centerline length, inches. */
  length: number;
  height: number;
  spacing: number;
  wallThickness: number;
  studCount: number;
  clampedHeight?: boolean;
  openings: FrameOpening[];
  headerLabels: string[];
  /** Human-readable corner summaries (message + tests). */
  cornerNotes: string[];
  pieces: WallPiece[];
}

const roundQuarter = (v: number): number => Math.round(v * 4) / 4;

// ---------------------------------------------------------------------------
// Corner resolution (command-side state)
// ---------------------------------------------------------------------------

/** Authoritative geometry of a built wall, kept by the build_wall command. */
export interface WallRecord {
  id: string;
  start: Vec3;
  end: Vec3;
  length: number;
  height: number;
  thickness: number;
  spacing: number;
  /** Unit vector along the wall (start → end), ground plane. */
  axis: Vec3;
}

/** Corner layout resolved against the wall registry (pure planner input). */
export interface ResolvedCorner {
  at: 'start' | 'end';
  kind: 'l' | 't';
  /** T only: this wall's framing is trimmed by half the target's thickness. */
  trim?: number;
  /** T only: ladder blocks to add in the target wall. */
  ladder?: {
    targetId: string;
    /** World position of the block pair (midpoint between flanking studs). */
    centerWorld: Vec3;
    /** Block length = flanking stud OC − 1.5. */
    cavity: number;
    /** Target wall thickness (block depth). */
    thickness: number;
  };
}

const wallRecords = new Map<string, WallRecord>();

/** Register (or overwrite) a wall for corner resolution. */
export function recordWall(record: WallRecord): void {
  wallRecords.set(record.id, record);
}

/** Look up a built wall's record. */
export function getWallRecord(id: string): WallRecord | undefined {
  return wallRecords.get(id);
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Resolve `{at, with}` corner requests against the registry. Throws on:
 * unknown target, corner point off the target wall, collinear overlap.
 */
export function resolveCorners(
  mine: { start: Vec3; end: Vec3; length: number },
  requests: CornerRequest[],
): ResolvedCorner[] {
  const resolved: ResolvedCorner[] = [];
  for (const req of requests) {
    if (req.at !== 'start' && req.at !== 'end') {
      throw new Error(`build_wall: corner.at must be 'start' or 'end', got '${req.at}'`);
    }
    const target = wallRecords.get(req.with);
    if (!target) {
      throw new Error(`build_wall: corner references unknown wall '${req.with}' (build it first with that id)`);
    }
    const P = req.at === 'start' ? mine.start : mine.end;

    // Project P onto the target's axis.
    const rel = { x: P.x - target.start.x, y: P.y - target.start.y, z: P.z - target.start.z };
    const along = rel.x * target.axis.x + rel.y * target.axis.y + rel.z * target.axis.z;
    const perpX = rel.x - target.axis.x * along;
    const perpY = rel.y - target.axis.y * along;
    const perpZ = rel.z - target.axis.z * along;
    const perpDist = Math.hypot(perpX, perpY, perpZ);

    if (perpDist > 0.25) {
      throw new Error(
        `build_wall: corner point (${P.x}, ${P.y}) is ${perpDist.toFixed(1)} in off wall '${req.with}' — ` +
          `corners must touch the target wall (tolerance 0.25 in)`,
      );
    }
    // Collinearity check: parallel unit axes (cross product → 0) with the
    // point on the interior means the walls overlap — not a corner.
    const mAxis = normalizeAxis(mine);
    const cross = Math.hypot(
      mAxis.y * target.axis.z - mAxis.z * target.axis.y,
      mAxis.z * target.axis.x - mAxis.x * target.axis.z,
      mAxis.x * target.axis.y - mAxis.y * target.axis.x,
    );
    if (cross < 0.05 && along > 0.25 && along < target.length - 0.25) {
      throw new Error(`build_wall: wall '${req.with}' and this wall are collinear — overlapping walls are not supported`);
    }

    const atTargetEnd = along <= 0.25 || along >= target.length - 0.25;
    if (atTargetEnd) {
      resolved.push({ at: req.at, kind: 'l' });
    } else {
      // T-junction: trim this wall to the target's near face, ladder-block the target.
      const trim = target.thickness / 2;
      // Target grid: 0, spacing, 2·spacing, …, length (plain grid; openings ignored for blocks).
      const leftGrid = Math.floor(along / target.spacing) * target.spacing;
      const rightGrid = Math.min(leftGrid + target.spacing, target.length);
      const centerAlong = (leftGrid + rightGrid) / 2;
      resolved.push({
        at: req.at,
        kind: 't',
        trim,
        ladder: {
          targetId: target.id,
          centerWorld: {
            x: target.start.x + target.axis.x * centerAlong,
            y: target.start.y + target.axis.y * centerAlong,
            z: 0,
          },
          cavity: rightGrid - leftGrid - 1.5,
          thickness: target.thickness,
        },
      });
    }
  }
  return resolved;
}

function normalizeAxis(w: { start: Vec3; end: Vec3 }): Vec3 {
  const dx = w.end.x - w.start.x;
  const dy = w.end.y - w.start.y;
  const dz = w.end.z - w.start.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

/** Built-up header lumber by span (conservative single-story rule of thumb). */
export function headerForSpan(span: number): { label: string; depth: number } {
  const rule: Array<[number, string, number]> = [
    [48, '2×4', 3.5],
    [72, '2×6', 5.5],
    [96, '2×8', 7.25],
    [120, '2×10', 9.25],
    [144, '2×12', 11.25],
  ];
  const match = rule.find(([max]) => span <= max);
  if (!match) {
    throw new Error(
      `build_wall: opening span ${span}" exceeds 12 ft — engineered header required (out of scope)`,
    );
  }
  const [, label, depth] = match;
  return { label, depth };
}

/** Rough opening dimensions from unit dims (carpentry-standards rules). */
export function roughOpening(opening: OpeningParams): { width: number; height: number } {
  if (!Number.isFinite(opening.width) || opening.width <= 0 || !Number.isFinite(opening.height) || opening.height <= 0) {
    throw new Error(`build_wall: opening width/height must be positive numbers (inches), got ${JSON.stringify(opening)}`);
  }
  if (opening.kind === 'window') {
    return { width: opening.width + 0.5, height: opening.height + 0.5 };
  }
  if (opening.exterior) {
    return { width: opening.width + 4.5, height: opening.height + 2.25 };
  }
  return { width: opening.width + 2, height: opening.height + 1 };
}

/**
 * Pure planner: inputs (inches) → piece geometry. Same input, same output —
 * this is the contract the AI orchestrator validates against.
 */
export function planBuildWall(input: WallParams): WallPlan {
  const { start, end } = input;
  if (!Number.isFinite(start.x) || !Number.isFinite(start.y) || !Number.isFinite(start.z)) {
    throw new Error('build_wall: start must be {x,y,z} numbers (inches)');
  }
  if (!Number.isFinite(end.x) || !Number.isFinite(end.y) || !Number.isFinite(end.z)) {
    throw new Error('build_wall: end must be {x,y,z} numbers (inches)');
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  if (dz !== 0) {
    throw new Error('build_wall: wall must lie in the ground plane (start.z must equal end.z)');
  }
  const length = Math.hypot(dx, dy);
  if (length < 0.25) {
    throw new Error('build_wall: wall length must be at least 0.25 in');
  }

  let height = input.height ?? DEFAULT_HEIGHT_IN;
  const clampedHeight = height < MIN_HEIGHT_IN || height > MAX_HEIGHT_IN;
  height = Math.min(MAX_HEIGHT_IN, Math.max(MIN_HEIGHT_IN, height));

  const thickness = input.wallThickness ?? DEFAULT_WALL_THICKNESS_IN;
  if (!Number.isFinite(thickness) || thickness < MIN_THICKNESS_IN || thickness > MAX_THICKNESS_IN) {
    throw new Error(`build_wall: wallThickness must be between ${MIN_THICKNESS_IN}" and ${MAX_THICKNESS_IN}"`);
  }

  const spacing = input.spacing ?? DEFAULT_SPACING_IN;
  if (!Number.isFinite(spacing) || spacing < 12 || spacing > 24) {
    throw new Error('build_wall: spacing must be between 12 and 24 inches on center');
  }

  const id = input.id?.trim() || 'wall';
  const uAxis = { x: dx / length, y: dy / length }; // wall axis unit vector
  const uPerp = { x: -uAxis.y, y: uAxis.x }; // wall thickness direction
  const along = (offset: number, z: number): Vec3 => ({
    x: start.x + uAxis.x * offset,
    y: start.y + uAxis.y * offset,
    z,
  });

  // ---- layout openings -----------------------------------------------------
  const openings = input.openings ?? [];
  if (openings.length > MAX_OPENINGS) {
    throw new Error(`build_wall: more than ${MAX_OPENINGS} openings in one wall`);
  }
  const plateBand = 3 * PLATE_HEIGHT_IN; // bottom + 2 top plates
  const frameOpenings: FrameOpening[] = [];
  const headerLabels = new Set<string>();

  for (const opening of openings) {
    if (opening.kind !== 'door' && opening.kind !== 'window') {
      throw new Error(`build_wall: opening kind must be 'door' or 'window', got '${opening.kind}'`);
    }
    const ro = roughOpening(opening);
    if (!Number.isFinite(opening.x) || opening.x < 4.5 || opening.x + ro.width > length - 4.5) {
      throw new Error(
        `build_wall: opening must clear corner studs + king studs (x ≥ 4.5 and x + RO width ≤ length - 4.5); ` +
          `got x=${opening.x}, length=${length}, RO width=${ro.width}`,
      );
    }
    const { label, depth } = headerForSpan(ro.width);
    headerLabels.add(label);
    const headerBottom = height - plateBand - depth; // header flush under top plates

    if (opening.kind === 'door') {
      const required = ro.height; // door RO height needed to fit the unit
      if (required > headerBottom) {
        throw new Error(
          `build_wall: door ${opening.width}x${opening.height} needs RO height ${required}" but the ${label} ` +
            `header leaves only ${headerBottom.toFixed(1)}" (wall ${height}" minus 4.5" plates minus header). ` +
            `Raise the wall or use a shorter door/smaller header.`,
        );
      }
      frameOpenings.push({
        kind: 'door',
        x: opening.x,
        roWidth: ro.width,
        roBottom: 0,
        roTop: headerBottom,
        headerDepth: depth,
        headerLabel: label,
      });
    } else {
      const sillTop = opening.sillHeight ?? 36;
      if (!Number.isFinite(sillTop) || sillTop < 3.0 || sillTop + ro.height > headerBottom) {
        throw new Error(
          `build_wall: window ${opening.width}x${opening.height} at sill ${sillTop}" doesn't fit under the ` +
            `${label} header (needs top ≤ ${headerBottom.toFixed(1)}"). Raise the wall or lower the sill.`,
        );
      }
      frameOpenings.push({
        kind: 'window',
        x: opening.x,
        roWidth: ro.width,
        roBottom: sillTop,
        roTop: sillTop + ro.height,
        headerDepth: depth,
        headerLabel: label,
      });
    }
  }

  // ---- resolve corner trims (T-junctions shorten the framing) --------------
  const corners = input.corners ?? [];
  if (corners.length > MAX_CORNERS) {
    throw new Error(`build_wall: more than ${MAX_CORNERS} corners on one wall`);
  }
  const trimStart = corners.find((c) => c.at === 'start' && c.kind === 't')?.trim ?? 0;
  const trimEnd = corners.find((c) => c.at === 'end' && c.kind === 't')?.trim ?? 0;
  // Framed stud-center offsets of the two end studs (default: wall endpoints).
  // A T-junction end stud butts the target's near face: center sits one
  // stud-width/2 + trim inside the nominal endpoint.
  const startStudOffset = trimStart > 0 ? trimStart + STUD_WIDTH_IN / 2 : 0;
  const endStudOffset = trimEnd > 0 ? length - (trimEnd + STUD_WIDTH_IN / 2) : length;
  const framedPlateLen = roundQuarter(length - trimStart - trimEnd);
  if (framedPlateLen < Math.max(trimStart + trimEnd + 0.5, startStudOffset + STUD_WIDTH_IN)) {
    throw new Error('build_wall: wall too short for its corner trims');
  }

  // ---- plates (bottom + double top) ----------------------------------------
  // Plates are the same depth as the wall — centered on the centerline, the
  // same as studs, so outer faces are flush all the way down. A T-junction
  // trims the plate end flush with the target wall's near face.
  const plateMid = (start.x + end.x) / 2 - uAxis.x * ((trimEnd - trimStart) / 2);
  const plateMidY = (start.y + end.y) / 2 - uAxis.y * ((trimEnd - trimStart) / 2);
  const plateCenter = (z: number): Vec3 => ({ x: plateMid, y: plateMidY, z });
  const plateSize: Vec3 = { x: framedPlateLen, y: thickness, z: PLATE_HEIGHT_IN };
  const plateColor = '#b8a279';

  const pieces: WallPiece[] = [
    { name: `${id}_bottom_plate`, kind: 'plate', center: plateCenter(PLATE_HEIGHT_IN / 2), size: plateSize, color: plateColor },
    { name: `${id}_top_plate`, kind: 'plate', center: plateCenter(height - 1.5 * PLATE_HEIGHT_IN), size: plateSize, color: plateColor },
    { name: `${id}_cap_plate`, kind: 'plate', center: plateCenter(height - 0.5 * PLATE_HEIGHT_IN), size: plateSize, color: plateColor },
  ];

  // ---- grid studs (skip any that would land inside an opening/king zone) ----
  const studLen = height - plateBand; // wall height minus 3 plates
  const studZ = PLATE_HEIGHT_IN + studLen / 2;
  const studColor = '#d9c9a3';

  const inOpeningZone = (s: number): boolean =>
    frameOpenings.some((o) => s + STUD_WIDTH_IN / 2 > o.x - 3.0 && s - STUD_WIDTH_IN / 2 < o.x + o.roWidth + 3.0);

  const offsets = new Set<number>([startStudOffset, endStudOffset]);
  for (let s = spacing; s < endStudOffset; s += spacing) {
    offsets.add(roundQuarter(s));
  }
  const studOffsets = [...offsets]
    .sort((a, b) => a - b)
    .filter((s) => {
      if (inOpeningZone(s)) return false;
      if (s === startStudOffset || s === endStudOffset) return true;
      // grid stud within 0.75 of an end stud would overlap it
      return s > startStudOffset + STUD_WIDTH_IN / 2 && s < endStudOffset - STUD_WIDTH_IN / 2;
    });
  if (studOffsets.length > MAX_STUDS) {
    throw new Error(`build_wall: ${studOffsets.length} studs exceeds the ${MAX_STUDS} budget guard`);
  }

  studOffsets.forEach((s, i) => {
    pieces.push({
      name: `${id}_stud_${i}`,
      kind: 'stud',
      center: along(s, studZ),
      size: { x: STUD_WIDTH_IN, y: thickness, z: studLen },
      color: studColor,
    });
  });

  // ---- corner members -------------------------------------------------------
  const cornerNotes: string[] = [];
  corners.forEach((c, i) => {
    if (c.kind === 'l') {
      // California-style: backer stud + mid-height block inside this wall.
      const backerOff = c.at === 'start' ? 3.5 : length - 3.5;
      pieces.push({
        name: `${id}_corner_${i}_backer`,
        kind: 'backer',
        center: along(backerOff, studZ),
        size: { x: STUD_WIDTH_IN, y: thickness, z: studLen },
        color: studColor,
      });
      // 2×4 block in the 2.0 in cavity between end stud and backer (3.5 OC − 1.5 stud).
      const blockOff = c.at === 'start' ? 1.75 : length - 1.75;
      pieces.push({
        name: `${id}_corner_${i}_block`,
        kind: 'block',
        center: along(blockOff, height / 2),
        size: { x: 2.0, y: thickness, z: PLATE_HEIGHT_IN },
        color: '#c9b896',
      });
      cornerNotes.push(`L-corner ${c.at} (backer + block)`);
    } else if (c.ladder) {
      // Ladder blocking in the target wall at 1/3 and 2/3 height.
      for (const [i2, frac] of [1 / 3, 2 / 3].entries()) {
        pieces.push({
          name: `${id}_corner_${i}_ladder_${i2}`,
          kind: 'block',
          center: { x: c.ladder.centerWorld.x, y: c.ladder.centerWorld.y, z: height * frac },
          size: { x: c.ladder.cavity, y: c.ladder.thickness, z: PLATE_HEIGHT_IN },
          color: '#c9b896',
        });
      }
      cornerNotes.push(`T-junction ${c.at} w/ ${c.ladder.targetId} (ladder blocks)`);
    }
  });

  // ---- opening members ------------------------------------------------------
  const headerBoardColor = '#7f9f7f';
  const spacerColor = '#bfa98f';
  const sillColor = '#c9b896';

  frameOpenings.forEach((o, idx) => {
    const prefix = `${id}_open_${idx}`;
    const { x, roWidth } = o;

    // king studs: full height, flanking the jacks
    for (const side of [-1, 1] as const) {
      pieces.push({
        name: `${prefix}_king_${side === -1 ? 'l' : 'r'}`,
        kind: 'king',
        center: along(x + (side === -1 ? -2.25 : roWidth + 2.25), studZ),
        size: { x: STUD_WIDTH_IN, y: thickness, z: studLen },
        color: studColor,
      });
    }

    // header: two boards + 1/2 in ply spacer, laid flush under the top plates
    const span = roWidth + 3.0; // bears 1.5 in on each jack
    const headerBottom = height - plateBand - o.headerDepth;
    const headerCX = x + roWidth / 2; // along-wall offset of the header center
    const headerBase = along(headerCX, headerBottom + o.headerDepth / 2);
    // Perpendicular offsets so the assembly spans the full wall thickness:
    // 1.5 (board) + 0.5 (ply spacer) + 1.5 (board) = 3.5 = wallThickness.
    const boards: Array<[number, string, string]> = [
      [-(thickness / 2 - 0.75), 'b1', headerBoardColor],
      [0, 'spacer', spacerColor],
      [thickness / 2 - 0.75, 'b2', headerBoardColor],
    ];
    for (const [perpOffset, tag, color] of boards) {
      pieces.push({
        name: `${prefix}_header_${tag}`,
        kind: 'header',
        center: {
          x: headerBase.x + uPerp.x * perpOffset,
          y: headerBase.y + uPerp.y * perpOffset,
          z: headerBase.z,
        },
        size: { x: span, y: tag === 'spacer' ? 0.5 : 1.5, z: o.headerDepth },
        color,
      });
    }

    // jack studs: from top of bottom plate up to the header
    const jackLen = headerBottom - PLATE_HEIGHT_IN;
    for (const side of [-1, 1] as const) {
      pieces.push({
        name: `${prefix}_jack_${side === -1 ? 'l' : 'r'}`,
        kind: 'jack',
        center: along(x + (side === -1 ? -0.75 : roWidth + 0.75), PLATE_HEIGHT_IN + jackLen / 2),
        size: { x: STUD_WIDTH_IN, y: thickness, z: jackLen },
        color: studColor,
      });
    }

    if (o.kind === 'window') {
      // sill: 2×4 laid flat between the jacks
      const sillBottom = o.roBottom - PLATE_HEIGHT_IN;
      pieces.push({
        name: `${prefix}_sill`,
        kind: 'sill',
        center: along(x + roWidth / 2, sillBottom + PLATE_HEIGHT_IN / 2),
        size: { x: roWidth, y: thickness, z: PLATE_HEIGHT_IN },
        color: sillColor,
      });

      // cripples below the sill, 16 in O.C. from the opening edge
      const crippleLen = sillBottom - PLATE_HEIGHT_IN;
      let n = 0;
      for (let s = spacing; s < roWidth; s += spacing) {
        pieces.push({
          name: `${prefix}_cripple_${n++}`,
          kind: 'cripple',
          center: along(x + s, PLATE_HEIGHT_IN + crippleLen / 2),
          size: { x: STUD_WIDTH_IN, y: thickness, z: crippleLen },
          color: studColor,
        });
      }
    }
  });

  return {
    id,
    length,
    height,
    spacing,
    wallThickness: thickness,
    studCount: studOffsets.length,
    clampedHeight,
    openings: frameOpenings,
    headerLabels: [...headerLabels],
    cornerNotes,
    pieces,
  };
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

register('build_wall', (params, model): CommandResult => {
  const raw = params as unknown as WallParams;
  const id = raw.id?.trim() || 'wall';

  // Guard before corner resolution (planner validates in full detail below).
  if (
    !raw.start ||
    !raw.end ||
    !Number.isFinite(raw.start.x) ||
    !Number.isFinite(raw.start.y) ||
    !Number.isFinite(raw.end.x) ||
    !Number.isFinite(raw.end.y)
  ) {
    throw new Error('build_wall: start and end must be {x,y,z} numbers (inches)');
  }

  // Resolve corner references against the wall registry, then plan purely.
  const requests = (Array.isArray(raw.corners) ? raw.corners : []) as unknown as CornerRequest[];
  const corners = resolveCorners(
    { start: raw.start, end: raw.end, length: Math.hypot(raw.end.x - raw.start.x, raw.end.y - raw.start.y) },
    requests,
  );
  const plan = planBuildWall({ ...raw, corners });

  const createdNames: string[] = [];
  for (const piece of plan.pieces) {
    createdNames.push(model.createBox(piece.name, piece.center, piece.size, piece.color));
  }
  model.add(plan.id, createdNames); // group handle: select/move the whole wall

  // Record this wall for future corner resolution.
  recordWall({
    id,
    start: raw.start,
    end: raw.end,
    length: plan.length,
    height: plan.height,
    thickness: plan.wallThickness,
    spacing: plan.spacing,
    axis: normalizeAxis(raw),
  });

  const openingNotes = plan.openings
    .map((o) => `${o.kind} ${o.roWidth.toFixed(1)}x${(o.roTop - o.roBottom).toFixed(1)} RO (${o.headerLabel} header)`)
    .join(', ');
  const cornerSummary = plan.cornerNotes.join(', ');
  const message =
    `Stud wall '${plan.id}': ${(plan.length / 12).toFixed(1)} ft long, ${plan.studCount} studs @ ${plan.spacing}" OC, ` +
    `double top plate, ${nominalStock(plan.wallThickness)}` +
    (openingNotes ? `, ${openingNotes}` : '') +
    (cornerSummary ? `, ${cornerSummary}` : '') +
    (plan.clampedHeight ? ` (height clamped to ${plan.height}")` : '');

  return {
    ok: true,
    message,
    effects: [{ type: 'focus', payload: { target: plan.id } }],
  };
});

/** Map wall depth to a nominal label: 3.5 → "2×4", 5.5 → "2×6", 7.25 → "2×8". */
export function nominalStock(wallThickness: number): string {
  const nominal: Record<number, string> = { 3.5: '2×4', 5.5: '2×6', 7.25: '2×8' };
  return nominal[wallThickness] ?? `${wallThickness}" stock`;
}