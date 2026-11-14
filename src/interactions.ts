import { decodeCard } from "./model";

export interface CardSize { fixedCardSize: boolean; cardWidth: number; cardHeight: number; }
export const DEFAULT_CARD_SIZE: CardSize = { fixedCardSize: true, cardWidth: 360, cardHeight: 210 };
export function cardSize(settings: Partial<CardSize>): CardSize {
  const dimension = (value: unknown, fallback: number, min: number) => typeof value === "number" && Number.isFinite(value)
    ? Math.min(2000, Math.max(min, Math.round(value))) : fallback;
  return { fixedCardSize: settings.fixedCardSize !== false, cardWidth: dimension(settings.cardWidth, 360, 240), cardHeight: dimension(settings.cardHeight, 210, 120) };
}
// Canvas internals are capability checked and patched on instances, never globally.
export interface CanvasNodeHandle {
  text?: string; width: number; height: number; x: number; y: number;
  nodeEl?: HTMLElement; isEditing?: boolean; child?: { editMode?: boolean };
  [key: string]: any;
}
export interface CanvasHandle {
  nodes?: Map<string, CanvasNodeHandle>;
  canvasControlsEl?: HTMLElement;
  requestSave?: () => void;
  [key: string]: any;
}
export function isPaperNode(node: CanvasNodeHandle): boolean { return typeof node.text === "string" && !!decodeCard(node.text); }

function patch(target: Record<string, any>, key: string, intercept: (original: (...args: any[]) => any, args: any[]) => any): () => void {
  const original = target[key];
  if (typeof original !== "function") return () => {};
  const own = Object.getOwnPropertyDescriptor(target, key);
  let active = true;
  const wrapper = function(this: unknown, ...args: any[]) {
    return active ? intercept(original.bind(this), args) : original.apply(this, args);
  };
  target[key] = wrapper;
  return () => {
    active = false;
    // A later plugin may have wrapped ours; leave its method intact, with ours inert.
    if (target[key] !== wrapper) return;
    if (own) Object.defineProperty(target, key, own); else delete target[key];
  };
}

export function protectPaperNode(node: CanvasNodeHandle, getSize: () => CardSize) {
  const cleanup: (() => void)[] = [];
  const managed = () => isPaperNode(node);
  const locked = () => managed() && getSize().fixedCardSize;
  const fixed = (data: Record<string, unknown>) => ({ ...data, width: getSize().cardWidth, height: getSize().cardHeight });
  for (const method of ["startEditing", "isEditable"]) cleanup.push(patch(node, method, (original, args) => managed() ? false : original(...args)));
  for (const method of ["onResizePointerdown", "onResizeDblclick"]) cleanup.push(patch(node, method, (original, args) => {
    if (!locked()) return original(...args);
    args[0]?.preventDefault?.(); args[0]?.stopPropagation?.();
  }));
  cleanup.push(patch(node, "moveAndResize", (original, args) => original(locked() ? fixed(args[0]) : args[0], ...args.slice(1))));
  cleanup.push(patch(node, "setData", (original, args) => {
    const data = args[0];
    // Undo, refresh and third-party auto-height updates use setData as well.
    // Do not constrain a card that has just been replaced with ordinary text.
    const remainsPaper = typeof data?.text === "string" ? !!decodeCard(data.text) : managed();
    return original(remainsPaper && getSize().fixedCardSize ? fixed(data) : data, ...args.slice(1));
  }));
  return {
    update(): boolean {
      const paper = managed();
      node.nodeEl?.classList.toggle("npc-managed-node", paper);
      node.nodeEl?.classList.toggle("npc-fixed-size", locked());
      if (paper && (node.isEditing || node.child?.editMode)) node.blur?.();
      if (!locked() || (node.width === getSize().cardWidth && node.height === getSize().cardHeight) || typeof node.resize !== "function") return false;
      node.resize({ width: getSize().cardWidth, height: getSize().cardHeight });
      node.render?.();
      return true;
    },
    dispose() {
      cleanup.reverse().forEach(fn => fn());
      node.nodeEl?.classList.remove("npc-managed-node", "npc-fixed-size");
    }
  };
}

/** Protect new/duplicated cards as well as existing ones; release every hook on unload. */
export class CanvasInteractions {
  private nodes = new Map<CanvasNodeHandle, ReturnType<typeof protectPaperNode>>();
  private cleanup: (() => void)[] = [];
  private observer?: MutationObserver;
  private stopped = false;
  private queued = false;
  private sizeChanged = false;
  constructor(private canvas: CanvasHandle, container: HTMLElement | undefined, private getSize: () => CardSize) {
    const Observer = container?.ownerDocument.defaultView?.MutationObserver;
    if (container && Observer) {
      this.observer = new Observer(() => this.schedule());
      this.observer.observe(container, { childList: true, subtree: true });
    }
    // Native setData/applyHistory cache the incoming object *after* importData.
    // Normalize a copy at the outer boundary so live nodes, saved data and undo
    // snapshots agree. Never requestSave half way through an import.
    for (const method of ["setData", "applyHistory", "importData"]) this.cleanup.push(patch(canvas, method, (original, args) => {
      const data = args[0], size = this.getSize();
      if (size.fixedCardSize && Array.isArray(data?.nodes)) {
        args[0] = { ...data, nodes: data.nodes.map((node: Record<string, any>) =>
          node.type === "text" && typeof node.text === "string" && decodeCard(node.text)
            ? { ...node, width: size.cardWidth, height: size.cardHeight } : node) };
      }
      const result = original(...args); this.update(false); this.schedule(); return result;
    }));
    this.cleanup.push(patch(canvas, "addNode", (original, args) => {
      const result = original(...args); this.update(false); this.schedule(); return result;
    }));
    this.update();
  }
  private schedule() {
    if (this.queued || this.stopped) return;
    this.queued = true;
    void Promise.resolve().then(() => { this.queued = false; if (!this.stopped) this.update(); });
  }
  update(save = true) {
    if (this.stopped || !this.canvas.nodes?.values) return;
    const live = new Set(this.canvas.nodes.values());
    for (const [node, guard] of this.nodes) if (!live.has(node) || !isPaperNode(node)) { guard.dispose(); this.nodes.delete(node); }
    let changed = false;
    for (const node of live) {
      if (!isPaperNode(node)) continue;
      let guard = this.nodes.get(node);
      if (!guard) { guard = protectPaperNode(node, this.getSize); this.nodes.set(node, guard); }
      changed = guard.update() || changed;
    }
    this.sizeChanged ||= changed;
    if (save && this.sizeChanged) { this.sizeChanged = false; this.canvas.requestSave?.(); }
  }
  dispose() {
    this.stopped = true; this.observer?.disconnect();
    this.cleanup.reverse().forEach(fn => fn());
    for (const guard of this.nodes.values()) guard.dispose();
    this.nodes.clear();
  }
}
