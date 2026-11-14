import test from "node:test";
import assert from "node:assert/strict";
import { mergePapers, parseCanvas } from "../src/canvas.ts";
import { decodeCard, encodeCard } from "../src/model.ts";
import { commitPapers, CanvasStore, LiveCanvas } from "../src/sync.ts";
import { ID2, SOURCE, sample } from "./fixtures.ts";
const initial = () => mergePapers({ nodes: [], edges: [] }, SOURCE, [sample]).data;
const signal = () => new AbortController().signal;
test("title and metadata changes preserve all geometry, groups, edges, unknown fields, and node IDs", () => {
  const board = initial();
  const card = board.nodes[1]; card.x = -410; card.y = 724; card.width = 582; card.height = 340; card.color = "#c0ffee"; card.custom = { keep: true };
  board.nodes.push({ id: "manual", type: "text", x: 100, y: -900, width: 300, height: 200, text: "My own note" });
  board.edges.push({ id: "line", fromNode: card.id, toNode: "manual", label: "extends", fromSide: "right", toEnd: "arrow", custom: [1,2] });
  board.extension = { arbitrary: "preserve" };
  const before = structuredClone(board);
  const changed = { ...sample, title: "Renamed", tags: [{ name: "New tag", color: "blue" }], about: "New summary", venue: "Updated", status: { name: "Archived", color: "orange" } };
  const result = mergePapers(board, SOURCE, [changed]);
  const afterCard = result.data.nodes[1];
  assert.deepEqual({ ...afterCard, text: card.text }, card);
  assert.equal(decodeCard(afterCard.text!)!.paper.title, "Renamed");
  assert.deepEqual(result.data.edges, before.edges);
  assert.deepEqual(result.data.nodes[0], before.nodes[0]);
  assert.deepEqual(result.data.nodes[2], before.nodes[2]);
  assert.deepEqual(result.data.extension, before.extension);
  assert.deepEqual(board, before, "merge must not mutate its input");
});
test("repeated sync is idempotent, and duplicates of the same paper keep their own IDs and positions", () => {
  const board = initial(); board.nodes.push({ ...board.nodes[1], id: "copy", x: 1500 });
  const result = mergePapers(board, SOURCE, [sample]);
  assert.equal(result.added, 0); assert.equal(result.updated, 0); assert.deepEqual(result.data, board);
  const changed = mergePapers(board, SOURCE, [{ ...sample, title: "New title" }]);
  assert.equal(changed.updated, 2); assert.equal(changed.data.nodes.at(-1)!.x, 1500);
});
test("new papers go into a new unsorted group outside every existing node; existing groups never resize", () => {
  const board = initial(); board.nodes[0].width = 8000;
  const result = mergePapers(board, SOURCE, [sample, { ...sample, id: ID2 }]);
  assert.equal(result.added, 1); assert.deepEqual(result.data.nodes.slice(0,2), board.nodes);
  assert.ok(result.data.nodes[2].x > 8000);
  assert.equal(result.data.nodes[2].type, "group");
});
test("missing or archived papers and their edges are retained and can return", () => {
  const board = initial(); board.edges.push({ id: "e", fromNode: board.nodes[1].id, toNode: board.nodes[0].id });
  const missing = mergePapers(board, SOURCE, []);
  assert.equal(missing.retained, 1); assert.equal(missing.data.nodes.length, 2); assert.deepEqual(missing.data.edges, board.edges);
  assert.equal(decodeCard(missing.data.nodes[1].text!)!.paper.availability, "missing");
  const restored = mergePapers(missing.data, SOURCE, [sample]);
  assert.equal(decodeCard(restored.data.nodes[1].text!)!.paper.availability, "active");
  const archived = mergePapers(board, SOURCE, [{ ...sample, availability: "archived" }]);
  assert.equal(archived.data.nodes[1].id, board.nodes[1].id);
});
test("foreign data source and damaged generated cards abort instead of duplicating or overwriting", () => {
  assert.throws(() => mergePapers(initial(), ID2, [sample]), /another Notion data source/);
  const board = initial(); board.nodes[1].text = '```notion-paper\n{}\n```';
  assert.throws(() => mergePapers(board, SOURCE, [sample]), /invalid data/);
  assert.throws(() => parseCanvas('{"nodes":[{"id":"x"}]}'), /invalid/);
  assert.throws(() => parseCanvas('not json'), /valid JSON/);
});
test("unrelated ID collisions do not replace user notes", () => {
  const board = initial(); const conflictingId = board.nodes[1].id;
  board.nodes[1].text = "My own card";
  const result = mergePapers(board, SOURCE, [sample]);
  assert.equal(result.data.nodes[1].text, "My own card");
  assert.notEqual(result.data.nodes.at(-1)!.id, conflictingId);
});
test("a live sync reads the latest unsaved drag/resize and never writes directly over the open file", async () => {
  const board = initial(); board.nodes[1].x = 876; board.nodes[1].width = 900;
  let saved = 0, applied = "";
  const live: LiveCanvas = { getSnapshot: () => JSON.stringify(board), apply: s => { applied = s; }, save: async () => { saved++; } };
  const store: CanvasStore = { liveViews: () => [live], exists: () => true, create: async () => { assert.fail(); }, process: async () => { assert.fail(); } };
  await commitPapers(store, SOURCE, [{ ...sample, title: "Fresh" }], signal());
  assert.equal(JSON.parse(applied).nodes[1].x, 876); assert.equal(JSON.parse(applied).nodes[1].width, 900); assert.equal(saved, 1);
});
test("closed-file transaction merges a concurrent layout edit at write time", async () => {
  const board = initial(); let disk = JSON.stringify(board);
  const store: CanvasStore = { liveViews: () => [], exists: () => true, create: async () => { assert.fail(); }, process: async fn => { board.nodes[1].y = -1200; disk = fn(JSON.stringify(board)); } };
  await commitPapers(store, SOURCE, [{ ...sample, venue: "New venue" }], signal());
  assert.equal(JSON.parse(disk).nodes[1].y, -1200);
});
test("duplicate tabs, cancellation, and opening during disk commit fail without writing", async () => {
  let touched = false; let views: LiveCanvas[] = [{},{}] as LiveCanvas[];
  const store: CanvasStore = { liveViews: () => views, exists: () => true, create: async () => { touched = true; }, process: async fn => { views = [{}] as LiveCanvas[]; fn(JSON.stringify(initial())); touched = true; } };
  await assert.rejects(commitPapers(store, SOURCE, [sample], signal()), /duplicate tabs/); assert.equal(touched, false);
  views = []; const c = new AbortController(); c.abort();
  await assert.rejects(commitPapers(store, SOURCE, [sample], c.signal), /cancelled/);
  await assert.rejects(commitPapers(store, SOURCE, [sample], signal()), /opened during/); assert.equal(touched, false);
});

test("a failed live apply restores the original snapshot, and a save failure does not revert later user edits", async () => {
  const board = initial(); let current = JSON.stringify(board); const original = current; let failApply = true;
  const live: LiveCanvas = { getSnapshot: () => current, apply: s => { current = s; if (failApply) { failApply = false; throw new Error("Native failure"); } }, save: async () => {} };
  const store: CanvasStore = { liveViews: () => [live], exists: () => true, create: async () => { assert.fail(); }, process: async () => { assert.fail(); } };
  await assert.rejects(commitPapers(store, SOURCE, [{...sample,title:"New"}], signal()), /previous live layout was restored/);
  assert.equal(current, original);
  live.save = async () => { const latest = JSON.parse(current); latest.nodes[1].x = 909; current = JSON.stringify(latest); throw new Error("Disk failure"); };
  await assert.rejects(commitPapers(store, SOURCE, [{...sample,title:"New"}], signal()), /saving failed/);
  assert.equal(JSON.parse(current).nodes[1].x,909);
});
