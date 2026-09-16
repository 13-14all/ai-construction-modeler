/**
 * Direct-manipulation wiring (SketchUp feel): click to select, drag to move
 * on the ground plane, grid snap + axis lock, Esc to deselect.
 *
 * Hard rule: the mouse NEVER moves meshes — every drag emits incremental
 * `translate` commands through execute(). Orbit stays on empty-space drags.
 */

import { applyMove, type PlanPoint } from './moveLogic';
import type { ModelScene } from '../scene/scene';
import type { CommandResult } from '../engine/commands';

export interface InteractionEnv {
  domElement: HTMLElement;
  model: ModelScene;
  pick(clientX: number, clientY: number): string | null;
  groundPoint(clientX: number, clientY: number): PlanPoint | null;
  /** OrbitControls handle — disabled while dragging an object. */
  controls: { enabled: boolean };
  /** The single command path (main.ts exec). */
  exec(type: string, params: Record<string, unknown>): CommandResult;
}

interface DragState {
  selected: string | null;
  dragging: boolean;
  start: PlanPoint | null;
  last: PlanPoint | null;
}

const SNAP_IN = 1; // 1 in framing grid

export function wireInteraction(env: InteractionEnv): void {
  const dom = env.domElement;
  const state: DragState = { selected: null, dragging: false, start: null, last: null };

  function select(name: string | null): void {
    state.selected = name;
    env.model.setHighlight(name ? [name] : []);
  }

  dom.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; // left button only; middle stays orbit-pan
    env.model.setHighlight([]);
    const hit = env.pick(e.clientX, e.clientY);
    if (hit) {
      select(hit);
      state.dragging = true;
      state.start = env.groundPoint(e.clientX, e.clientY);
      state.last = state.start ? applyMove(state.start, state.start, { snap: SNAP_IN }) : null;
      env.controls.enabled = false;
      dom.setPointerCapture(e.pointerId);
      e.stopPropagation();
    } else {
      select(null);
    }
  });

  dom.addEventListener('pointermove', (e) => {
    if (!state.dragging || !state.selected || !state.start || !state.last) return;
    const raw = env.groundPoint(e.clientX, e.clientY);
    if (!raw) return;
    const target = applyMove(state.start, raw, { snap: SNAP_IN });
    if (target.x === state.last.x && target.y === state.last.y) return; // stay inside a snap cell
    const delta = { x: target.x - state.last.x, y: target.y - state.last.y, z: 0 };
    env.exec('translate', { targets: [state.selected], delta });
    state.last = target;
  });

  const endDrag = (): void => {
    state.dragging = false;
    state.start = null;
    state.last = null;
    env.controls.enabled = true;
  };
  dom.addEventListener('pointerup', endDrag);
  dom.addEventListener('pointercancel', endDrag);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') select(null);
  });
}