import { canonicalPageUrl, DEFAULT_FIELDS, Fields, notionId, object, Paper, Tag, UserError } from "./model";
export const NOTION_VERSION = "2025-09-03";
export interface Response { status: number; headers: Record<string, string>; body: unknown; }
export type Transport = (request: { url: string; method: "GET" | "POST"; headers: Record<string,string>; body?: string }) => Promise<Response>;
const rich = (v: unknown): string => Array.isArray(v) ? v.map(t => typeof t?.plain_text === "string" ? t.plain_text : typeof t?.text?.content === "string" ? t.text.content : "").join("") : "";
function tag(v: unknown): Tag | null { const t = object(v); return typeof t.name === "string" ? { name: t.name, color: typeof t.color === "string" ? t.color : "default" } : null; }
function textProperty(v: unknown): string {
  const p = object(v);
  if (p.type === "rich_text") return rich(p.rich_text);
  if (p.type === "title") return rich(p.title);
  if (p.type === "select") return tag(p.select)?.name ?? "";
  if (p.type === "status") return tag(p.status)?.name ?? "";
  if (p.type === "multi_select") return Array.isArray(p.multi_select) ? p.multi_select.map(tag).filter(Boolean).map(t => t!.name).join(", ") : "";
  if (p.type === "formula") { const f = object(p.formula); return f.type === "string" ? String(f.string ?? "") : ""; }
  return "";
}
export function mapPage(value: unknown, fields: Fields): Paper {
  const page = object(value), props = object(page.properties);
  if (page.object !== "page" || typeof page.id !== "string") throw new UserError("Notion returned an incomplete page. No Canvas changes were made.");
  for (const name of Object.values(fields).filter(Boolean)) if (!props[name]) throw new UserError("A Notion page is missing a mapped property. Check the field names in settings.");
  const tags = object(props[fields.tags]), status = object(props[fields.status]);
  const url = canonicalPageUrl(page.id, page.url);
  return {
    id: notionId(page.id), ...(url ? { url } : {}), title: textProperty(props[fields.title]) || "Untitled paper", about: textProperty(props[fields.about]),
    tags: tags.type === "multi_select" && Array.isArray(tags.multi_select) ? tags.multi_select.map(tag).filter((t): t is Tag => !!t) : [],
    venue: textProperty(props[fields.venue]), status: tag(status[status.type]),
    availability: page.archived === true || page.is_archived === true || page.in_trash === true ? "archived" : "active"
  };
}
export class NotionClient {
  constructor(private transport: Transport, private token: string, private signal: AbortSignal, private pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {}
  private check() { if (this.signal.aborted) throw new UserError("Sync cancelled. Canvas was not changed."); }
  private async call(path: string, body?: object): Promise<Record<string, any>> {
    for (let attempt = 0; attempt < 3; attempt++) {
      this.check();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let res: Response;
      try {
        res = await Promise.race([
          this.transport({ url: `https://api.notion.com/v1/${path}`, method: body ? "POST" : "GET",
            headers: { Authorization: `Bearer ${this.token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
            ...(body ? { body: JSON.stringify(body) } : {}) }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new UserError("Notion did not respond within 30 seconds. Try again.")), 30000); })
        ]);
      } catch { throw new UserError("Could not read Notion. Check your connection and retry. Canvas was not changed."); }
      finally { if (timer) clearTimeout(timer); }
      this.check();
      if (res.status === 429 && attempt < 2) {
        const entry = Object.entries(res.headers).find(([key]) => key.toLowerCase() === "retry-after")?.[1];
        const seconds = Number(entry ?? "1");
        if (!Number.isFinite(seconds) || seconds > 30) throw new UserError("Notion is rate limiting requests. Wait and try again.");
        await this.pause(Math.max(1, seconds) * 1000); continue;
      }
      if (res.status === 401) throw new UserError("Notion rejected the token. Select a valid secret in settings.");
      if (res.status === 403 || res.status === 404) throw new UserError("Cannot access Papers. Check the ID and share the database with your Notion connection.");
      if (res.status < 200 || res.status >= 300) throw new UserError(`Notion request failed (HTTP ${res.status}). Canvas was not changed.`);
      return object(res.body);
    }
    throw new UserError("Notion is rate limiting requests. Try again later.");
  }
  async readAll(input: string, kind: "database" | "data-source", mapping: Fields = DEFAULT_FIELDS): Promise<{ sourceId: string; papers: Paper[] }> {
    let sourceId = notionId(input);
    if (kind === "database") {
      const database = await this.call(`databases/${sourceId}`);
      const sources = database.data_sources;
      if (!Array.isArray(sources) || sources.length !== 1 || typeof sources[0]?.id !== "string")
        throw new UserError("Choose a specific data source ID in settings when the database has zero or multiple data sources.");
      sourceId = notionId(sources[0].id);
    }
    const schema = await this.call(`data_sources/${sourceId}`);
    const props = object(schema.properties), fields = { ...mapping };
    if (!fields.title) fields.title = Object.keys(props).find(key => props[key]?.type === "title") ?? "";
    const accepted: Record<keyof Fields, string[]> = { title: ["title"], about: ["rich_text", "formula"], tags: ["multi_select"], venue: ["rich_text", "select", "multi_select", "formula"], status: ["status", "select"] };
    for (const key of Object.keys(fields) as (keyof Fields)[]) {
      if (!fields[key] && key !== "title") continue;
      if (!accepted[key].includes(props[fields[key]]?.type)) throw new UserError(`Check the ${key} property mapping in settings. Its name or type does not match Notion.`);
    }
    const papers = new Map<string, Paper>(), cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 10000; page++) {
      const result = await this.call(`data_sources/${sourceId}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      if (!Array.isArray(result.results) || typeof result.has_more !== "boolean" || result.request_status?.type === "incomplete")
        throw new UserError("Notion returned an incomplete result. Canvas was not changed.");
      for (const row of result.results) { const paper = mapPage(row, fields); papers.set(paper.id, paper); }
      if (!result.has_more) return { sourceId, papers: [...papers.values()] };
      if (typeof result.next_cursor !== "string" || !result.next_cursor || cursors.has(result.next_cursor))
        throw new UserError("Notion pagination did not finish correctly. Retry the sync.");
      cursor = result.next_cursor; cursors.add(cursor);
      await this.pause(350);
    }
    throw new UserError("Notion returned too many pages. Canvas was not changed.");
  }
}
