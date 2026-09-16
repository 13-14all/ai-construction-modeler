/**
 * Three.js scene module.
 *
 * Implements the command system's `Model` interface: the scene is the only
 * place meshes are created, transformed and tracked. Renderers/commands talk
 * to it purely through names + boxes — the AI orchestrator never reaches
 * Three.js objects directly (hard rule).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BBox, Vec3 } from '../types';
import type { Model, UnknownObject } from '../engine/commands';
import { setModel } from '../engine/commands';

/** Bluish-grey default material — an unambiguous "unassigned" look. */
const DEFAULT_COLOR = '#8a94a6';

export interface SceneHooks {
  /** Called whenever the model mutates (broadcast to HUD/status). */
  onChange?(evt: { kind: 'add' | 'update' | 'remove'; name: string }): void;
}

export class ModelScene implements Model {
  private readonly objects = new Map<string, THREE.Object3D>();
  private readonly meta = new Map<string, UnknownObject>();
  /** Group name → member box names (membership edges). */
  private readonly membership = new Map<string, string[]>();
  private readonly hooks: SceneHooks;

  /** Accumulated AABB of every object — used for autofit framing. */
  private bbox = new THREE.Box3();

  constructor(
    private readonly scene: THREE.Scene,
    hooks: SceneHooks = {},
  ) {
    this.hooks = hooks;
    this.setupLights();
    this.setupGrid();
    // Central wiring: the command system mutates THIS scene from now on.
    setModel(this);
  }

  // --- Model implementation ------------------------------------------------

  private rev = 0;

  get revision(): number {
    return this.rev;
  }

  createBox(name: string, center: Vec3, size: Vec3, color: string = DEFAULT_COLOR): string {
    const geometry = new THREE.BoxGeometry(size.x, size.z, size.y);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(center.x, center.z, center.y);
    const uniqueName = this.uniqueName(name);
    mesh.name = uniqueName;
    mesh.userData = { name: uniqueName, kind: 'box', size: { ...size }, color };
    this.objects.set(uniqueName, mesh);
    // px min corner, y up: world bbox from center/size
    const min = new THREE.Vector3(
      center.x - size.x / 2,
      center.z - size.z / 2,
      center.y - size.y / 2,
    );
    const max = new THREE.Vector3(
      center.x + size.x / 2,
      center.z + size.z / 2,
      center.y + size.y / 2,
    );
    this.bbox.expandByPoint(min);
    this.bbox.expandByPoint(max);
    this.meta.set(uniqueName, {
      name: uniqueName,
      kind: 'box',
      center: { ...center },
      size: { ...size },
      color,
    });
    this.scene.add(mesh);
    this.tick();
    this.hooks.onChange?.({ kind: 'add', name: uniqueName });
    return uniqueName;
  }

  add(name: string, members?: string[]): void {
    if (Array.isArray(members)) {
      this.membership.set(name, members);
      for (const m of members) {
        const meta = this.meta.get(m);
        if (meta) {
          this.meta.set(m, { ...meta });
        }
      }
    }
    if (this.meta.has(name)) return;
    // Group record: bbox over members, kept in sync by translate().
    const memberMeta = (members ?? []).map((m) => this.meta.get(m)).filter((x): x is UnknownObject => !!x);
    let center: Vec3 = { x: 0, y: 0, z: 0 };
    let size: Vec3 = { x: 0, y: 0, z: 0 };
    if (memberMeta.length > 0) {
      const minX = Math.min(...memberMeta.map((m) => m.center.x - m.size.x / 2));
      const maxX = Math.max(...memberMeta.map((m) => m.center.x + m.size.x / 2));
      const minY = Math.min(...memberMeta.map((m) => m.center.y - m.size.y / 2));
      const maxY = Math.max(...memberMeta.map((m) => m.center.y + m.size.y / 2));
      const minZ = Math.min(...memberMeta.map((m) => m.center.z - m.size.z / 2));
      const maxZ = Math.max(...memberMeta.map((m) => m.center.z + m.size.z / 2));
      center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
      size = { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
    }
    this.meta.set(name, { name, kind: 'group', center, size, color: '', members: members ?? [] });
    this.tick();
    this.hooks.onChange?.({ kind: 'add', name });
  }

  get(name: string): UnknownObject | undefined {
    return this.meta.get(name);
  }

  listNames(): string[] {
    return [...this.objects.keys()];
  }

  /**
   * Move a box or group by `delta` (plan inches: x/y/z; ground drags pass
   * z = 0 and keep objects at their base height).
   */
  translate(name: string, delta: Vec3): number {
    const record = this.meta.get(name);
    if (!record) {
      throw new Error(`translate: no object named '${name}'`);
    }
    const members = record.members && record.members.length > 0 ? record.members : [name];
    let moved = 0;
    for (const m of members) {
      const mesh = this.objects.get(m);
      const meta = this.meta.get(m);
      if (!mesh || !meta) continue;
      mesh.position.x += delta.x;
      mesh.position.z += delta.y; // plan y → three z
      mesh.position.y += delta.z; // plan z → three y
      const center = { x: meta.center.x + delta.x, y: meta.center.y + delta.y, z: meta.center.z + delta.z };
      const next = { ...meta, center };
      this.meta.set(m, next);
      // Keep the world bbox generous (grows on move; reframe on demand).
      this.bbox.expandByPoint(new THREE.Vector3(center.x - meta.size.x / 2, center.z - meta.size.z / 2, center.y - meta.size.y / 2));
      this.bbox.expandByPoint(new THREE.Vector3(center.x + meta.size.x / 2, center.z + meta.size.z / 2, center.y + meta.size.y / 2));
      moved += 1;
    }
    if (record.members) this.refreshGroupMeta(name);
    this.tick();
    this.hooks.onChange?.({ kind: 'update', name });
    return moved;
  }

  /** If `name` is a member box, its parent group; else undefined. */
  groupOf(name: string): string | undefined {
    for (const [g, members] of this.membership) {
      if (members.includes(name)) return g;
    }
    return undefined;
  }

  /** Highlight meshes (or group members) with a selection tint. */
  setHighlight(names: string[]): void {
    const clear = (mesh: THREE.Object3D) => {
      const mat = (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (mat) mat.emissive.setHex(0x000000);
    };
    for (const obj of this.objects.values()) clear(obj);
    const targets = names.flatMap((n) => this.meta.get(n)?.members ?? [n]);
    for (const t of targets) {
      const mesh = this.objects.get(t);
      const mat = mesh && (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (mat) mat.emissive.setHex(0x1e4f8f);
    }
  }

  private refreshGroupMeta(name: string): void {
    const record = this.meta.get(name);
    if (!record?.members) return;
    const metas = record.members.map((m) => this.meta.get(m)).filter((x): x is UnknownObject => !!x);
    if (metas.length === 0) return;
    const minX = Math.min(...metas.map((m) => m.center.x - m.size.x / 2));
    const maxX = Math.max(...metas.map((m) => m.center.x + m.size.x / 2));
    const minY = Math.min(...metas.map((m) => m.center.y - m.size.y / 2));
    const maxY = Math.max(...metas.map((m) => m.center.y + m.size.y / 2));
    const minZ = Math.min(...metas.map((m) => m.center.z - m.size.z / 2));
    const maxZ = Math.max(...metas.map((m) => m.center.z + m.size.z / 2));
    this.meta.set(name, {
      ...record,
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
      size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    });
  }

  // --- Scene helpers --------------------------------------------------------

  /** Total bounds of everything modeled so far (for camera autofit). */
  bounds(): BBox | null {
    if (this.bbox.isEmpty()) return null;
    return {
      min: { x: this.bbox.min.x, y: this.bbox.min.z, z: this.bbox.min.y },
      max: { x: this.bbox.max.x, y: this.bbox.max.z, z: this.bbox.max.y },
    };
  }

  /** The root Three.js scene (renderer-only access — never mutate via AI). */
  get root(): THREE.Scene {
    return this.scene;
  }

  // --- Internals ------------------------------------------------------------

  private uniqueName(base: string): string {
    if (!this.objects.has(base) && !this.meta.has(base)) return base;
    let i = 2;
    while (this.objects.has(`${base}_${i}`) || this.meta.has(`${base}_${i}`)) i++;
    return `${base}_${i}`;
  }

  private tick(): void {
    this.rev += 1;
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1.0);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(400, 800, 300);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.4);
    fill.position.set(-300, 200, -400);
    this.scene.add(fill);
  }

  private setupGrid(): void {
    // 12 in grid with a 5-ft heavy line every 5 cells — framing-friendly.
    const grid = new THREE.GridHelper(2400, 200, 0x2c3a4d, 0x1c2735);
    this.scene.add(grid);
    const originAxes = new THREE.AxesHelper(24);
    originAxes.position.z = 0.02; // sit just above the grid
    this.scene.add(originAxes);
  }
}

/**
 * Bootstrap the renderer + controls. Returns an object exposing the scene
 * model and a per-frame render loop; keeps Three.js internals encapsulated.
 */
export function createRenderer(hooks: SceneHooks = {}): {
  model: ModelScene;
  render(): void;
  resize(): void;
  frame(bounds: BBox | null): void;
  domElement: HTMLCanvasElement;
  /** OrbitControls handle — interaction layer toggles .enabled. */
  controls: { enabled: boolean };
  /** Raycast pick: nearest object name under the pointer, or null. */
  pick(clientX: number, clientY: number): string | null;
  /** Ground-plane (plan z=0) point under the pointer, plan inches. */
  groundPoint(clientX: number, clientY: number): { x: number; y: number } | null;
} {
  const container = document.getElementById('app') as HTMLElement;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1420);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 20000);
  camera.position.set(220, 180, 260);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;

  const model = new ModelScene(scene, hooks);

  function resize(): void {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  resize();
  window.addEventListener('resize', resize);

  function render(): void {
    controls.update();
    renderer.render(scene, camera);
  }

  function frame(bounds: BBox | null): void {
    if (!bounds) return;
    const box = new THREE.Box3(
      new THREE.Vector3(bounds.min.x, bounds.min.z, bounds.min.y),
      new THREE.Vector3(bounds.max.x, bounds.max.z, bounds.max.y),
    );
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) / 2 + 24;
    camera.position.set(center.x + radius * 1.6, center.y + radius * 1.1, center.z + radius * 1.6);
    camera.near = Math.max(0.5, radius / 1000);
    controls.target.set(center.x, center.y, center.z);
    controls.update();
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function pick(clientX: number, clientY: number): string | null {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster
      .intersectObjects(scene.children, true)
      .filter((h) => (h.object as THREE.Mesh).isMesh && h.object.userData?.name);
    if (hits.length === 0) return null;
    const boxName = hits[0].object.userData.name as string;
    return model.groupOf(boxName) ?? boxName;
  }

  function groundPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(GROUND, hit)) return null;
    // three (x, y, z) → plan (x, y): three.z IS plan y; ground plane is three y = 0.
    return { x: hit.x, y: hit.z };
  }

  return { model, render, resize, frame, domElement: renderer.domElement, controls, pick, groundPoint };
}