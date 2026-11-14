import { decodeCard, encodeCard, notionId, Paper, UserError } from "./model";
export interface CanvasNode { id: string; type: string; x: number; y: number; width: number; height: number; text?: string; [key: string]: unknown; }
export interface CanvasData { nodes: CanvasNode[]; edges: Record<string, unknown>[]; [key: string]: unknown; }
export interface SyncResult { data: CanvasData; added: number; updated: number; retained: number; }
export function parseCanvas(text: string): CanvasData {
  let data: CanvasData;
  try { data = JSON.parse(text); } catch { throw new UserError("Canvas is not valid JSON. No changes were made."); }
  if (!data || typeof data !== "object" || Array.isArray(data) || (data.nodes !== undefined && !Array.isArray(data.nodes)) || (data.edges !== undefined && !Array.isArray(data.edges)))
    throw new UserError("Invalid Canvas structure. No changes were made.");
  data = { ...data, nodes: data.nodes ?? [], edges: data.edges ?? [] };
  const ids = new Set<string>();
  for (const node of data.nodes) {
    if (!node || typeof node.id !== "string" || !node.id || ids.has(node.id) || typeof node.type !== "string" ||
        ![node.x, node.y, node.width, node.height].every(Number.isFinite) || node.width <= 0 || node.height <= 0)
      throw new UserError("Canvas has invalid or duplicate nodes. No changes were made.");
    ids.add(node.id);
  }
  const nodeIds = new Set(ids);
  for (const edge of data.edges) {
    if (!edge || typeof edge !== "object" || typeof edge.id !== "string" || ids.has(edge.id) ||
      !nodeIds.has(String(edge.fromNode)) || !nodeIds.has(String(edge.toNode))) throw new UserError("Canvas has invalid connections. No changes were made.");
    ids.add(edge.id);
  }
  return data;
}
/** Pure merge: only managed text changes. Existing geometry, order, edges and unknown fields survive. */
export function mergePapers(input: CanvasData, source: string, papers: Paper[]): SyncResult {
  const sourceId = notionId(source);
  const byId = new Map<string, Paper>();
  for (const paper of papers) {
    const id = notionId(paper.id);
    if (byId.has(id)) throw new UserError("Notion returned duplicate pages. Retry the sync.");
    byId.set(id, { ...paper, id });
  }
  let updated = 0, retained = 0;
  const seen = new Set<string>();
  const nodes = input.nodes.map(node => {
    if (node.type !== "text" || typeof node.text !== "string") return { ...node };
    const old = decodeCard(node.text);
    if (!old) {
      if (node.text.startsWith('```notion-paper')) throw new UserError("A paper card has invalid data. Undo its text edit before syncing.");
      return { ...node };
    }
    if (notionId(old.sourceId) !== sourceId) throw new UserError("This Canvas belongs to another Notion data source. Choose a different Canvas path.");
    const id = notionId(old.paper.id);
    seen.add(id);
    const paper = byId.get(id) ?? { ...old.paper, availability: old.paper.availability === "archived" ? "archived" : "missing" as const };
    if (!byId.has(id)) retained++;
    const text = encodeCard({ version: 1, sourceId, paper });
    if (node.text !== text) updated++;
    return { ...node, text };
  });
  const fresh = [...byId.values()].filter(p => !seen.has(p.id)).sort((a,b) => a.id.localeCompare(b.id));
  if (fresh.length) {
    const ids = new Set([...nodes.map(n => n.id), ...input.edges.map(e => String(e.id))]);
    const unique = (base: string) => { let id = base, suffix = 1; while (ids.has(id)) id = `${base}_${suffix++}`; ids.add(id); return id; };
    const x = nodes.length ? Math.ceil(Math.max(...nodes.map(n => n.x + n.width))) + 160 : 0;
    const y = nodes.length ? Math.floor(Math.min(...nodes.map(n => n.y))) : 0;
    const width = 360, height = 210, gap = 32, padding = 32;
    const columns = Math.min(4, fresh.length), rows = Math.ceil(fresh.length / columns);
    nodes.push({ id: unique("npc_unsorted"), type: "group", label: "Unsorted · Notion", x, y,
      width: columns * (width + gap) - gap + padding * 2, height: rows * (height + gap) - gap + padding * 2 });
    fresh.forEach((paper, index) => nodes.push({
      id: unique(`npc_${paper.id.replace(/-/g, "")}`), type: "text",
      x: x + padding + index % columns * (width + gap), y: y + padding + Math.floor(index / columns) * (height + gap), width, height,
      text: encodeCard({ version: 1, sourceId, paper })
    }));
  }
  return { data: { ...input, nodes, edges: input.edges.map(e => ({ ...e })) }, added: fresh.length, updated, retained };
}
