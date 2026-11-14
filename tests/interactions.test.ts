import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { CanvasInteractions, DEFAULT_CARD_SIZE, cardSize, protectPaperNode, type CardSize } from "../src/interactions.ts";
import { encodeCard } from "../src/model.ts";
import { sample, SOURCE } from "./fixtures.ts";

const paperText = (title = sample.title) => encodeCard({ version: 1, sourceId: SOURCE, paper: { ...sample, title } });

/** The native paths used by dragging, Advanced Canvas sizing and source editing. */
class NativeNode {
  [key: string]: any;
  x = 42; y = -24; width = 360; height = 210; isEditing = false;
  child = { editMode: false };
  edits = 0; blurs = 0; renders = 0; resizePresses = 0; resizeDoubleClicks = 0;
  constructor(public nodeEl: HTMLElement, public text = paperText()) {}
  startEditing() { this.edits++; this.isEditing = true; this.child.editMode = true; return "editing"; }
  isEditable() { return true; }
  blur() { this.blurs++; this.isEditing = false; this.child.editMode = false; }
  moveAndResize(data: { x: number; y: number; width: number; height: number }) {
    this.x = data.x; this.y = data.y; this.width = data.width; this.height = data.height;
  }
  resize(size: { width: number; height: number }) { this.moveAndResize({ x: this.x, y: this.y, ...size }); }
  onResizePointerdown(_event: Event) {
    this.resizePresses++;
    // Advanced Canvas's minNodeSize feeds the native resize handler.
    this.resize({ width: Math.max(600, this.width), height: Math.max(600, this.height) });
  }
  onResizeDblclick(_event: Event) { this.resizeDoubleClicks++; this.resize({ width: 800, height: 900 }); }
  setData(data: Record<string, unknown>) { Object.assign(this, data); return "updated"; }
  render() { this.renders++; }
}

function fixture() {
  const dom = new JSDOM("<main></main>");
  const container = dom.window.document.querySelector("main")!;
  const createNode = (text = paperText()) => new NativeNode(dom.window.document.createElement("article"), text);
  return { dom, container, createNode };
}
const dimensions = (node: NativeNode) => [node.width, node.height];
const position = (node: NativeNode) => [node.x, node.y];
const nextTurn = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test("managed cards leave source mode and reject editing without locking ordinary nodes", () => {
  const f = fixture(), paper = f.createNode(), ordinary = f.createNode("A normal Canvas note");
  const originalOrdinaryStart = ordinary.startEditing;
  paper.startEditing();
  const canvas = { nodes: new Map([["paper", paper], ["ordinary", ordinary]]) };
  const controller = new CanvasInteractions(canvas, f.container, () => DEFAULT_CARD_SIZE);
  try {
    assert.equal(paper.blurs, 1); assert.equal(paper.isEditing, false); assert.equal(paper.child.editMode, false);
    assert.equal(paper.startEditing(), false); assert.equal(paper.isEditable(), false); assert.equal(paper.edits, 1);
    assert.equal(paper.nodeEl.classList.contains("npc-managed-node"), true);
    assert.equal(ordinary.startEditing, originalOrdinaryStart);
    assert.equal(ordinary.isEditable(), true); assert.equal(ordinary.startEditing(), "editing");
    assert.equal(ordinary.nodeEl.classList.contains("npc-managed-node"), false);
    ordinary.resize({ width: 720, height: 640 }); assert.deepEqual(dimensions(ordinary), [720, 640]);
  } finally { controller.dispose(); f.dom.window.close(); }
});

test("fixed dimensions resist minimum-size and auto-fit handlers while body dragging still moves the card", () => {
  const f = fixture(), node = f.createNode(); node.width = node.height = 600;
  const guard = protectPaperNode(node, () => DEFAULT_CARD_SIZE);
  try {
    assert.equal(guard.update(), true); assert.deepEqual(dimensions(node), [360, 210]);
    assert.deepEqual(position(node), [42, -24]); assert.equal(guard.update(), false);
    for (const method of ["onResizePointerdown", "onResizeDblclick"] as const) {
      const event = new f.dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
      node[method](event); assert.equal(event.defaultPrevented, true); assert.equal(event.cancelBubble, true);
    }
    assert.equal(node.resizePresses, 0); assert.equal(node.resizeDoubleClicks, 0);
    node.moveAndResize({ x: -120, y: 880, width: 600, height: 600 });
    assert.deepEqual(position(node), [-120, 880]); assert.deepEqual(dimensions(node), [360, 210]);
    node.resize({ width: 1200, height: 1200 });
    assert.deepEqual(position(node), [-120, 880]); assert.deepEqual(dimensions(node), [360, 210]);
  } finally { guard.dispose(); f.dom.window.close(); }
});

test("sync and auto-height setData keep metadata and positions while ordinary replacements regain native behavior", () => {
  const f = fixture(), node = f.createNode(), updated = paperText("Updated title");
  const guard = protectPaperNode(node, () => DEFAULT_CARD_SIZE);
  try {
    const data = { text: updated, x: 91, y: 92, width: 900, height: 700, customExtension: { status: "kept" } };
    assert.equal(node.setData(data), "updated");
    assert.equal(node.text, updated); assert.deepEqual(position(node), [91, 92]);
    assert.deepEqual(dimensions(node), [360, 210]); assert.deepEqual(node.customExtension, { status: "kept" });
    assert.equal(data.width, 900); assert.equal(data.height, 700); // Do not mutate the caller's sync snapshot.
    node.setData({ height: 850, dynamicHeight: true });
    assert.deepEqual(dimensions(node), [360, 210]); assert.equal(node.dynamicHeight, true);
    node.setData({ text: "Replaced with an ordinary note", width: 740, height: 620 });
    guard.update();
    assert.deepEqual(dimensions(node), [740, 620]); assert.equal(node.startEditing(), "editing");
    assert.equal(node.isEditable(), true); assert.equal(node.nodeEl.classList.contains("npc-managed-node"), false);
  } finally { guard.dispose(); f.dom.window.close(); }
});

test("unlocking allows native sizing but keeps paper contents protected, and relocking uses the configured dimensions", () => {
  const f = fixture(), node = f.createNode(); let size: CardSize = { ...DEFAULT_CARD_SIZE };
  const guard = protectPaperNode(node, () => size);
  try {
    guard.update(); size = { ...size, fixedCardSize: false }; assert.equal(guard.update(), false);
    assert.equal(node.nodeEl.classList.contains("npc-fixed-size"), false);
    node.onResizePointerdown(new f.dom.window.Event("pointerdown"));
    assert.deepEqual(dimensions(node), [600, 600]); assert.equal(node.resizePresses, 1);
    node.onResizeDblclick(new f.dom.window.Event("dblclick")); assert.deepEqual(dimensions(node), [800, 900]);
    node.setData({ width: 710, height: 510 }); assert.deepEqual(dimensions(node), [710, 510]);
    assert.equal(node.startEditing(), false);
    size = { fixedCardSize: true, cardWidth: 480, cardHeight: 260 };
    assert.equal(guard.update(), true); assert.deepEqual(dimensions(node), [480, 260]);
    assert.equal(node.nodeEl.classList.contains("npc-fixed-size"), true);
  } finally { guard.dispose(); f.dom.window.close(); }
});

test("teardown restores own method descriptors and removes instance wrappers over inherited methods", () => {
  const f = fixture(), node = f.createNode();
  const ownStart = function(this: NativeNode) { this.edits++; return "own editor"; };
  Object.defineProperty(node, "startEditing", { value: ownStart, configurable: true, writable: true, enumerable: false });
  const descriptor = Object.getOwnPropertyDescriptor(node, "startEditing");
  const inherited = node.moveAndResize, guard = protectPaperNode(node, () => DEFAULT_CARD_SIZE);
  try {
    guard.update(); assert.equal(Object.hasOwn(node, "moveAndResize"), true);
    guard.dispose();
    assert.deepEqual(Object.getOwnPropertyDescriptor(node, "startEditing"), descriptor);
    assert.equal(Object.hasOwn(node, "moveAndResize"), false); assert.equal(node.moveAndResize, inherited);
    assert.equal(node.startEditing(), "own editor"); assert.equal(node.nodeEl.classList.contains("npc-managed-node"), false);
    node.resize({ width: 600, height: 600 }); assert.deepEqual(dimensions(node), [600, 600]);
  } finally { f.dom.window.close(); }
});

test("a later plugin wrapper survives teardown and calls through to an inactive protection layer", () => {
  const f = fixture(), node = f.createNode(), guard = protectPaperNode(node, () => DEFAULT_CARD_SIZE);
  let laterEdits = 0, laterUpdates = 0;
  const protectedStart = node.startEditing, protectedSetData = node.setData;
  const laterStart = function(this: NativeNode) { laterEdits++; return protectedStart.call(this); };
  const laterSetData = function(this: NativeNode, data: Record<string, unknown>) { laterUpdates++; return protectedSetData.call(this, data); };
  node.startEditing = laterStart; node.setData = laterSetData;
  try {
    assert.equal(node.startEditing(), false); assert.equal(laterEdits, 1);
    guard.dispose();
    assert.equal(node.startEditing, laterStart); assert.equal(node.setData, laterSetData);
    assert.equal(node.startEditing(), "editing"); assert.equal(laterEdits, 2);
    node.setData({ width: 630, height: 640 });
    assert.equal(laterUpdates, 1); assert.deepEqual(dimensions(node), [630, 640]);
  } finally { f.dom.window.close(); }
});

test("Canvas imports and duplicates are protected immediately and defer correction saves until import completes", async () => {
  const f = fixture(), first = f.createNode(); let saves = 0;
  const canvas = {
    nodes: new Map([["first", first]]),
    requestSave() { saves++; },
    addNode(id: string, node: NativeNode) { this.nodes.set(id, node); return node; },
    importData(entries: [string, NativeNode][]) { for (const [id, node] of entries) this.nodes.set(id, node); return "imported"; }
  };
  const originalAdd = canvas.addNode, originalImport = canvas.importData;
  const controller = new CanvasInteractions(canvas, f.container, () => DEFAULT_CARD_SIZE);
  try {
    assert.equal(saves, 0); controller.update(); assert.equal(saves, 0);
    const imported = f.createNode(); imported.width = imported.height = 600;
    const ordinary = f.createNode("Keep this ordinary note's dimensions"); ordinary.width = 700;
    assert.equal(canvas.importData([["imported", imported], ["ordinary", ordinary]]), "imported");
    assert.deepEqual(dimensions(imported), [360, 210]); assert.equal(imported.startEditing(), false);
    assert.equal(ordinary.width, 700); assert.equal(saves, 0);
    await nextTurn(); assert.equal(saves, 1);
    const duplicate = f.createNode(first.text); duplicate.x = 1000;
    assert.equal(canvas.addNode("duplicate", duplicate), duplicate);
    assert.equal(duplicate.startEditing(), false); assert.deepEqual(position(duplicate), [1000, -24]); assert.equal(saves, 1);
    controller.update(); assert.equal(saves, 1);
    canvas.nodes.delete("imported"); controller.update();
    assert.equal(imported.startEditing(), "editing"); assert.equal(saves, 1);
    first.setData({ text: "Changed to an ordinary note", width: 800, height: 800 }); controller.update();
    assert.equal(Object.hasOwn(first, "startEditing"), false); assert.equal(first.startEditing(), "editing");
    assert.equal(saves, 1);
    controller.dispose();
    assert.equal(canvas.addNode, originalAdd); assert.equal(canvas.importData, originalImport);
    assert.equal(duplicate.startEditing(), "editing");
  } finally { controller.dispose(); f.dom.window.close(); }
});

for (const entryPoint of ["setData", "applyHistory"] as const) {
  test(`native ${entryPoint} keeps live, cached and saved sizes consistent without changing its incoming snapshot`, async () => {
    const f = fixture();
    type Snapshot = { nodes: Record<string, any>[]; edges: Record<string, any>[]; [key: string]: any };
    const canvas = {
      nodes: new Map<string, NativeNode>(),
      data: { nodes: [], edges: [] } as Snapshot,
      importing: false, saves: 0, saved: "",
      addNode(node: NativeNode) { this.nodes.set(node.id, node); return node; },
      importData(data: Snapshot) {
        this.importing = true;
        try {
          const wanted = new Set(data.nodes.map(node => node.id));
          for (const id of this.nodes.keys()) if (!wanted.has(id)) this.nodes.delete(id);
          for (const entry of data.nodes) {
            const existing = this.nodes.get(entry.id);
            const node = existing ?? f.createNode("");
            node.setData(entry); node.serialized = entry;
            if (!existing) this.addNode(node);
            assert.equal(this.saves, 0, "The outer native operation has not finished caching all nodes and edges");
          }
        } finally { this.importing = false; }
      },
      // These ordering details match native Canvas: the outer cache assignment
      // happens after importData and all of its addNode calls return.
      setData(data: Snapshot) { this.importData(data); this.data = data; return "loaded"; },
      applyHistory(data: Snapshot) { this.importData(data); this.data = data; return "history applied"; },
      getData(): Snapshot {
        return { ...this.data, nodes: [...this.nodes.values()].map(node => ({
          ...node.serialized, x: node.x, y: node.y, width: node.width, height: node.height,
          ...(node.type === "text" ? { text: node.text } : {})
        })) };
      },
      requestSave() {
        assert.equal(this.importing, false, "A correction must never save a partial import");
        this.saves++; this.data = this.getData();
      },
      saveView() { this.saved = JSON.stringify(this.data); }
    };
    const controller = new CanvasInteractions(canvas, f.container, () => DEFAULT_CARD_SIZE);
    try {
      const snapshot: Snapshot = {
        viewport: { x: 100, y: 200, zoom: 0.8 },
        nodes: [
          { id: "paper", type: "text", text: paperText("Imported history title"), x: -420, y: 320, width: 600, height: 600, customMetadata: { retained: true } },
          { id: "note", type: "text", text: "Ordinary editable note", x: 300, y: -200, width: 780, height: 640 },
          { id: "group", type: "group", label: "My research group", x: -700, y: -400, width: 1800, height: 1400 }
        ],
        edges: [{ id: "edge", fromNode: "paper", toNode: "note", label: "supports", fromSide: "right", toSide: "left" }]
      };
      const before = JSON.stringify(snapshot);
      assert.equal(canvas[entryPoint](snapshot), entryPoint === "setData" ? "loaded" : "history applied");
      assert.equal(canvas.saves, 0);
      assert.deepEqual(dimensions(canvas.nodes.get("paper")!), [360, 210]);
      assert.deepEqual(position(canvas.nodes.get("paper")!), [-420, 320]);
      assert.equal(canvas.nodes.get("paper")!.startEditing(), false);
      assert.notEqual(canvas.data, snapshot); assert.notEqual(canvas.data.nodes[0], snapshot.nodes[0]);
      assert.equal(JSON.stringify(snapshot), before);
      assert.deepEqual(canvas.data.nodes[0], { ...snapshot.nodes[0], width: 360, height: 210 });
      assert.deepEqual(canvas.data.nodes.slice(1), snapshot.nodes.slice(1));
      assert.deepEqual(canvas.data.edges, snapshot.edges); assert.deepEqual(canvas.data.viewport, snapshot.viewport);
      assert.deepEqual(canvas.getData(), canvas.data);
      await nextTurn();
      assert.equal(canvas.saves, 0, "Normalized imports need no extra history/save entry");
      canvas.saveView();
      assert.deepEqual(JSON.parse(canvas.saved), canvas.getData());
      assert.equal(JSON.stringify(snapshot), before);
      assert.equal(canvas.nodes.get("note")!.startEditing(), "editing");
      assert.deepEqual(dimensions(canvas.nodes.get("group")!), [1800, 1400]);
    } finally { controller.dispose(); f.dom.window.close(); }
  });
}

test("DOM insertion catches nodes outside import hooks and pending observer work is cancelled on dispose", async () => {
  const f = fixture(); let saves = 0;
  const canvas = { nodes: new Map<string, NativeNode>(), requestSave() { saves++; } };
  const controller = new CanvasInteractions(canvas, f.container, () => DEFAULT_CARD_SIZE);
  try {
    const node = f.createNode(); node.width = node.height = 600;
    canvas.nodes.set("new", node); f.container.append(node.nodeEl);
    await nextTurn();
    assert.deepEqual(dimensions(node), [360, 210]); assert.equal(node.startEditing(), false); assert.equal(saves, 1);
    f.container.append(f.dom.window.document.createElement("span")); await nextTurn(); assert.equal(saves, 1);
    const afterDispose = f.createNode(); afterDispose.width = 800;
    canvas.nodes.set("later", afterDispose); f.container.append(afterDispose.nodeEl);
    controller.dispose(); await nextTurn();
    assert.equal(afterDispose.width, 800); assert.equal(afterDispose.startEditing(), "editing"); assert.equal(saves, 1);
    assert.equal(node.startEditing(), "editing");
  } finally { controller.dispose(); f.dom.window.close(); }
});

test("saved dimensions are bounded and malformed settings fall back to the compact defaults", () => {
  assert.deepEqual(cardSize({ cardWidth: NaN, cardHeight: Infinity }), DEFAULT_CARD_SIZE);
  assert.deepEqual(cardSize({ fixedCardSize: false, cardWidth: -1, cardHeight: 10000 }), { fixedCardSize: false, cardWidth: 240, cardHeight: 2000 });
  assert.deepEqual(cardSize({ cardWidth: 480.6, cardHeight: 240.2 }), { fixedCardSize: true, cardWidth: 481, cardHeight: 240 });
});
