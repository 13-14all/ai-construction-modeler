/**
 * The command system — the ONLY way to mutate the model.
 *
 * This is the AI control surface (hard architectural rule: AI never touches
 * meshes directly). Every operation — from a `build_wall` skill down to
 * `create_box` — executes as a command: `execute({ type, params })`.
 *
 * Commands are deterministic functions of their params: same input, same
 * geometry. The executor validates params, applies the command, and returns
 * a result object plus optional side-effect records (viewport focus etc.).
 */

import type { Vec3 } from '../types';

/** The scene mutation surface a command is allowed to touch. */
export interface Model {
  /** Add a previously-created named object to the scene. */
  add(name: string, members?: string[]): void;
  /** Create a new named box mesh (dimensions in inches) and add it. */
  createBox(name: string, center: Vec3, size: Vec3, color?: string): string;
  /** Look up an object by name (a command may depend on prior objects). */
  get(name: string): UnknownObject | undefined;
  /** Monotonic mutation counter — bumped on every applied change. */
  readonly revision: number;
  /** Names of all objects currently in the scene, in creation order. */
  listNames(): string[];
  /**
   * Move a box or a group (resolved to its member boxes) by `delta` inches.
   * Returns the number of boxes actually moved. Never touches meshes
   * directly — this is the Model-side primitive commands compile down to.
   */
  translate(name: string, delta: Vec3): number;
}

/** Minimal handle to a scene object (NOT the mesh itself — see hard rule). */
export interface UnknownObject {
  readonly name: string;
  readonly kind: string;
  readonly center: Readonly<Vec3>;
  readonly size: Readonly<Vec3>;
  readonly color: string;
  /** Group members (kind === 'group'). */
  readonly members?: string[];
}

/** What every command returns. */
export interface CommandResult {
  ok: boolean;
  /** Human-readable summary, e.g. "Stud wall: 9 studs @ 16 in OC". */
  message: string;
  error?: string;
  /** Non-geometry side effects (viewport focus, selection…). */
  effects?: Array<{ type: string; payload?: unknown }>;
}

/** Registry signature: validate params, mutate the model, return a result. */
export type CommandHandler = (
  params: Record<string, unknown>,
  model: Model,
) => CommandResult;

const registry = new Map<string, CommandHandler>();

/** Register a command implementation (called once at module load). */
export function register(type: string, handler: CommandHandler): void {
  if (registry.has(type)) {
    throw new Error(`[commands] duplicate registration: ${type}`);
  }
  registry.set(type, handler);
}

/** Execute a command through the validated pipeline. */
export function execute(type: string, params: Record<string, unknown>): CommandResult {
  const handler = registry.get(type);
  if (!handler) {
    return {
      ok: false,
      message: `Unknown command: ${type}`,
      error: `No handler registered for command '${type}'. Registered: ${[...registry.keys()].join(', ')}`,
    };
  }
  try {
    return handler(params, model);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Command '${type}' failed: ${message}`, error: message };
  }
}

/** List registered command types (used by the AI orchestrator for validation). */
export function listCommands(): string[] {
  return [...registry.keys()];
}

/** Wire the live scene-backed model into the command system (app bootstrap). */
export function setModel(m: Model): void {
  model = m;
}

// The default model fails fast with a clear message until the app bootstrap
// calls setModel() — never silently no-ops.
let model: Model = {
  createBox: () => {
    throw new Error('[commands] model not initialized — call setModel() before execute()');
  },
  add: () => {
    throw new Error('[commands] model not initialized — call setModel() before execute()');
  },
  get: () => undefined,
  listNames: () => [],
  translate: () => {
    throw new Error('[commands] model not initialized — call setModel() before execute()');
  },
  revision: 0,
};