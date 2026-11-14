import { CardPayload, pageUrl } from "./model";
const COLORS = new Set(["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]);
export interface CardOptions { showStatus: boolean; open: (pageId: string) => void; icon?: (el: HTMLElement) => void; }
/** Build DOM with textContent only; Notion property values never become HTML. */
export function renderCard(container: HTMLElement, payload: CardPayload, options: CardOptions): void {
  const doc = container.ownerDocument, paper = payload.paper;
  const card = doc.createElement("article"); card.className = "npc-card";
  const header = doc.createElement("header"); header.className = "npc-heading";
  const icon = doc.createElement("span"); icon.className = "npc-icon"; icon.setAttribute("aria-hidden", "true");
  if (options.icon) options.icon(icon); else icon.textContent = "▤";
  const title = doc.createElement("a"); title.className = "npc-title"; title.textContent = paper.title;
  title.href = pageUrl(paper.id); title.title = "Open in Notion"; title.draggable = false;
  title.addEventListener("pointerdown", event => event.stopPropagation());
  title.addEventListener("mousedown", event => event.stopPropagation());
  title.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); options.open(paper.id); });
  title.addEventListener("keydown", event => { if (event.key === "Enter") event.stopPropagation(); });
  header.append(icon, title); card.append(header);
  const meta = doc.createElement("div"); meta.className = "npc-meta";
  for (const tag of paper.tags) {
    const badge = doc.createElement("span"); badge.className = `npc-tag npc-color-${COLORS.has(tag.color) ? tag.color : "default"}`;
    badge.textContent = tag.name; meta.append(badge);
  }
  if (paper.venue) { const venue = doc.createElement("span"); venue.className = "npc-venue"; venue.textContent = paper.venue; meta.append(venue); }
  if (meta.childNodes.length) card.append(meta);
  if (paper.about) { const about = doc.createElement("p"); about.className = "npc-about"; about.textContent = paper.about; card.append(about); }
  if (options.showStatus && paper.status) {
    const status = doc.createElement("span"); status.className = `npc-status npc-tag npc-color-${COLORS.has(paper.status.color) ? paper.status.color : "default"}`;
    status.textContent = paper.status.name; card.append(status);
  }
  if (paper.availability !== "active") {
    const note = doc.createElement("p"); note.className = "npc-availability";
    note.textContent = paper.availability === "archived" ? "Archived in Notion · card kept" : "Not returned by Notion · card kept";
    card.append(note);
  }
  container.replaceChildren(card);
}
