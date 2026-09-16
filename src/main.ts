/**
 * App bootstrap: renderer + command system + skills.
 *
 * The AI-facing surface is `window.app.commands.exec({ type, params })`
 * (also used by the console demo below). Everything mutating the model goes
 * through execute() — nothing else touches the scene (hard rule).
 */

import './skills/build_wall'; // registers the build_wall command (side effect)
import './engine/primitives'; // registers create_box / create_group / translate
import { execute, listCommands, type CommandResult } from './engine/commands';
import { createRenderer } from './scene/scene';
import { wireInteraction } from './interaction/interact';
import type { BBox } from './types';

const statusEl = document.getElementById('status') as HTMLElement;
let commandCount = 0;

// Camera framing happens ONLY via focus side-effects (report below), never
// on arbitrary model changes — otherwise dragging a wall would chase the
// camera every increment.
const { model, render, frame, domElement, pick, groundPoint, controls } = createRenderer();

function report(result: CommandResult): void {
  commandCount += 1;
  const mark = result.ok ? '✓' : '✗';
  const status = `${commandCount} cmd · ${mark} ${result.message}`;
  statusEl.textContent = status;
  console.info(`[command ${commandCount}] ${result.message}`);
  if (!result.ok) console.warn(result.error);

  // Apply non-geometry side effects (focus requests re-frame the wall).
  for (const effect of result.effects ?? []) {
    if (effect.type === 'focus') frame(model.bounds());
  }
}

/** The one public entry point used by the AI orchestrator and tests. */
function exec(type: string, params: Record<string, unknown>): CommandResult {
  const result = execute(type, params);
  report(result);
  return result;
}

// --- Direct manipulation (click to select, drag to move) -------------------
declare global {
  interface Window {
    app: {
      commands: {
        exec(type: string, params: Record<string, unknown>): CommandResult;
        list(): string[];
      };
      model: {
        names(): string[];
      };
    };
  }
}

window.app = {
  commands: {
    exec,
    list: listCommands,
  },
  model: {
    names: () => model.listNames(),
  },
};

wireInteraction({
  domElement,
  model,
  pick,
  groundPoint,
  controls,
  exec,
});

// --- Keyboard shortcuts (SketchUp-like quick keys) -------------------------
window.addEventListener('keydown', (evt) => {
  if (evt.key === '1') {
    // Demo: 16 ft wall along +x from origin, 2×4 @ 16 in OC.
    exec('build_wall', { id: 'north', start: { x: 0, y: 0, z: 0 }, end: { x: 192, y: 0, z: 0 } });
  }
  if (evt.key === '2') {
    // Demo: parallel 12 ft wall with a 36×80 door + a 36×48 window.
    exec('build_wall', {
      id: 'south',
      start: { x: 0, y: 192, z: 0 },
      end: { x: 144, y: 192, z: 0 },
      openings: [
        { kind: 'door', width: 36, height: 80, x: 24 },
        { kind: 'window', width: 36, height: 48, x: 88, sillHeight: 36 },
      ],
    });
  }
  if (evt.key === '3') {
    // Demo: L-corner — west wall lands on the end of 'north'.
    exec('build_wall', {
      id: 'west',
      start: { x: 192, y: 0, z: 0 },
      end: { x: 192, y: 192, z: 0 },
      corners: [{ at: 'start', with: 'north' }],
    });
  }
  if (evt.key === '4') {
    // Demo: T-junction — wall tees into the interior of 'north' at x=96.
    exec('build_wall', {
      id: 'tee',
      start: { x: 96, y: 0, z: 0 },
      end: { x: 96, y: 96, z: 0 },
      corners: [{ at: 'start', with: 'north' }],
    });
  }
});

// --- Boot demo: one 16 ft wall so the scene isn't empty --------------------
console.info('[app] command registry:', listCommands().join(', '));
exec('build_wall', { id: 'north', start: { x: 0, y: 0, z: 0 }, end: { x: 192, y: 0, z: 0 } });

// --- Render loop -----------------------------------------------------------
function tick(): void {
  render();
  requestAnimationFrame(tick);
}
tick();