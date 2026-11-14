import { mergePapers, parseCanvas, SyncResult } from "./canvas";
import { Paper, UserError } from "./model";
export interface LiveCanvas {
  getSnapshot(): string;
  apply(serialized: string): void;
  save(): Promise<void>;
}
export interface CanvasStore {
  liveViews(): LiveCanvas[];
  exists(): boolean;
  create(content: string): Promise<void>;
  process(update: (current: string) => string): Promise<void>;
}
/** Called only after every Notion page has loaded. Read geometry at commit time, not fetch time. */
export async function commitPapers(store: CanvasStore, sourceId: string, papers: Paper[], signal: AbortSignal, newCardSize = { width: 360, height: 210 }): Promise<SyncResult> {
  const check = () => { if (signal.aborted) throw new UserError("Sync cancelled. Canvas was not changed."); };
  check();
  const views = store.liveViews();
  if (views.length > 1) throw new UserError("Close duplicate tabs of this Canvas before refreshing papers.");
  if (views.length === 1) {
    const view = views[0];
    const before = view.getSnapshot();
    const result = mergePapers(parseCanvas(before), sourceId, papers, newCardSize);
    check();
    if (result.added || result.updated) {
      // No await between the live snapshot and apply: dragging/resizing during
      // the network request has already been incorporated into this snapshot.
      try { view.apply(JSON.stringify(result.data, null, 2)); }
      catch {
        try { view.apply(before); }
        catch { throw new UserError("Canvas could not apply or restore its live state. Keep the tab open and recover the layout before retrying."); }
        throw new UserError("Canvas rejected the update. The previous live layout was restored.");
      }
      try { await view.save(); }
      catch { throw new UserError("Papers updated on screen, but saving failed. Keep the Canvas open and save it before closing."); }
    }
    return result;
  }
  if (!store.exists()) {
    const result = mergePapers({ nodes: [], edges: [] }, sourceId, papers, newCardSize);
    check();
    await store.create(JSON.stringify(result.data, null, 2));
    return result;
  }
  let result: SyncResult | undefined;
  await store.process(current => {
    check();
    if (store.liveViews().length) throw new UserError("Canvas was opened during refresh. Click Refresh again.");
    result = mergePapers(parseCanvas(current), sourceId, papers, newCardSize);
    return result.added || result.updated ? JSON.stringify(result.data, null, 2) : current;
  });
  if (!result) throw new UserError("Canvas could not be updated. Try again.");
  return result;
}
