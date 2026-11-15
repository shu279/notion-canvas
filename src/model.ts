export interface Tag { name: string; color: string; }
export interface Paper {
  id: string;
  /** Canonical page URL supplied by Notion, including its title slug. */
  url?: string;
  title: string;
  about: string;
  tags: Tag[];
  venue: string;
  affiliation?: string;
  status: Tag | null;
  availability: "active" | "archived" | "missing";
}
export interface CardPayload { version: 1; sourceId: string; paper: Paper; }
export interface Fields { title: string; about: string; tags: string; venue: string; affiliation: string; status: string; }
export const DEFAULT_FIELDS: Fields = { title: "Paper", about: "About", tags: "Tags", venue: "Venue", affiliation: "", status: "Status" };
export class UserError extends Error {}
export const object = (v: unknown): Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};
export function notionId(input: string): string {
  let value = input.trim();
  if (/^https?:/i.test(value)) {
    let url: URL;
    try { url = new URL(value); } catch { throw new UserError("Enter a valid Notion database URL or ID."); }
    if (url.protocol !== "https:" || url.username || url.password || !["notion.so", "notion.com", "notion.site"].some(h => url.hostname === h || url.hostname.endsWith(`.${h}`)))
      throw new UserError("Use a Notion HTTPS URL or a database/data source ID.");
    value = url.pathname.split("/").filter(Boolean).pop() ?? "";
  }
  const match = value.match(/(?:^|[-/])([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);
  if (!match) throw new UserError("The Notion ID is invalid. Copy the database link or data source ID again.");
  const raw = match[1].replace(/-/g, "").toLowerCase();
  return `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
}
export function canonicalPageUrl(id: string, candidate: unknown): string | undefined {
  if (typeof candidate !== "string") return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["notion.so", "notion.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) ||
        notionId(url.href) !== notionId(id)) return undefined;
    // Stored metadata may be edited by hand. Never forward arbitrary query
    // options (redirects, peeks, etc.) or fragments to the desktop app.
    url.search = ""; url.hash = "";
    return url.href;
  } catch { return undefined; }
}
export function pageUrl(id: string, desktop = false, canonicalUrl?: string): string {
  const webUrl = canonicalPageUrl(id, canonicalUrl) ?? `https://www.notion.so/${notionId(id).replace(/-/g, "")}`;
  // Desktop tab reuse compares the complete final path segment, including the
  // title slug. ID-only links open the page but cannot match a titled tab.
  return desktop ? `${webUrl.replace(/^https:/, "notion:")}?deepLinkOpenNewTab=true` : webUrl;
}
export function encodeCard(payload: CardPayload): string {
  return '```notion-paper\n' + JSON.stringify(payload) + '\n```';
}
export function decodeCard(text: string): CardPayload | null {
  const match = /^```notion-paper\r?\n([\s\S]+)\r?\n```\s*$/.exec(text);
  if (!match) return null;
  return parsePayload(match[1]);
}
export function parsePayload(source: string): CardPayload | null {
  try {
    const data = JSON.parse(source), p = object(data.paper);
    if (data.version !== 1 || typeof data.sourceId !== "string" || typeof p.id !== "string") return null;
    notionId(data.sourceId); notionId(p.id);
    if (p.url !== undefined && !canonicalPageUrl(p.id, p.url)) return null;
    if (p.affiliation !== undefined && typeof p.affiliation !== "string") return null;
    if (![p.title, p.about, p.venue].every(v => typeof v === "string") || !Array.isArray(p.tags) ||
      !p.tags.every(t => typeof t?.name === "string" && typeof t?.color === "string") ||
      (p.status !== null && (typeof p.status?.name !== "string" || typeof p.status?.color !== "string")) ||
      !["active", "archived", "missing"].includes(p.availability)) return null;
    return data as CardPayload;
  } catch { return null; }
}
