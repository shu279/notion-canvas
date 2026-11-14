import { App, ItemView, Notice, Plugin, PluginSettingTab, SecretComponent, Setting, TFile, normalizePath, requestUrl, setIcon, WorkspaceLeaf } from "obsidian";
import { renderCard } from "./card";
import { DEFAULT_FIELDS, Fields, object, pageUrl, parsePayload, UserError } from "./model";
import { NotionClient } from "./notion";
import { CanvasStore, commitPapers, LiveCanvas } from "./sync";
interface Settings { secretName: string; source: string; sourceKind: "database" | "data-source"; canvasPath: string; fields: Fields; showStatus: boolean; desktop: boolean; }
const DEFAULTS: Settings = { secretName: "", source: "", sourceKind: "database", canvasPath: "Papers.canvas", fields: DEFAULT_FIELDS, showStatus: false, desktop: true };
interface NativeView {
  file?: TFile;
  canvas?: { getData?: () => unknown; requestPushHistory?: { run?: () => void } };
  setViewData?: (data: string, clear: boolean) => void;
  save?: () => Promise<void>;
}
export function canvasPath(value: string): string {
  const path = value.trim().replace(/\\/g, "/");
  if (!path || path.startsWith("/") || path.includes(":") || path.split("/").some(p => !p || p === "." || p === ".." || p.startsWith(".")) || !path.endsWith(".canvas"))
    throw new UserError("Choose a vault-relative .canvas path, such as Papers.canvas or Research/Papers.canvas.");
  return normalizePath(path);
}
export default class NotionPapersCanvas extends Plugin {
  settings: Settings = { ...DEFAULTS, fields: { ...DEFAULT_FIELDS } };
  private operation: AbortController | null = null;
  private actions = new Map<WorkspaceLeaf, HTMLElement>();
  private stopped = false;
  private settingsWrite: Promise<void> = Promise.resolve();
  async onload() {
    const saved = object(await this.loadData());
    this.settings = { ...DEFAULTS, ...saved, fields: { ...DEFAULT_FIELDS, ...object(saved.fields) } };
    // Persist only explicitly supported settings; never store credentials or page bodies.
    this.addSettingTab(new PapersSettings(this.app, this));
    this.addCommand({ id: "refresh-papers", name: "Refresh papers from Notion", callback: () => { void this.refresh(); } });
    this.addCommand({ id: "open-papers-canvas", name: "Open Papers Canvas", callback: () => { void this.openBoard().catch(error => this.report(error)); } });
    this.addCommand({ id: "cancel-papers-refresh", name: "Cancel papers refresh", callback: () => { this.operation?.abort(); } });
    this.addRibbonIcon("library-big", "Refresh Papers from Notion", () => { void this.refresh(); });
    this.registerMarkdownCodeBlockProcessor("notion-paper", (source, el) => {
      const payload = parsePayload(source);
      if (!payload) { el.textContent = "Paper card data is invalid. Undo its text edit, then refresh."; return; }
      renderCard(el, payload, { showStatus: this.settings.showStatus, icon: element => setIcon(element, "file-text"), open: id => { void this.openPaper(id); } });
    });
    this.registerEvent(this.app.workspace.on("layout-change", () => this.updateActions()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateActions()));
    this.app.workspace.onLayoutReady(() => { if (!this.stopped) this.updateActions(); });
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (oldPath === this.settings.canvasPath && file instanceof TFile && file.extension === "canvas") {
        this.settings.canvasPath = file.path; void this.saveSettings();
      }
    }));
  }
  onunload() { this.stopped = true; this.operation?.abort(); for (const el of this.actions.values()) el.remove(); this.actions.clear(); }
  saveSettings(): Promise<void> {
    const s = this.settings;
    const data = { secretName: s.secretName, source: s.source, sourceKind: s.sourceKind, canvasPath: s.canvasPath, fields: { ...s.fields }, showStatus: s.showStatus, desktop: s.desktop };
    this.settingsWrite = this.settingsWrite.catch(() => {}).then(() => this.saveData(data));
    this.updateActions(); return this.settingsWrite;
  }
  private report(error: unknown) {
    if (!this.stopped) new Notice(error instanceof UserError ? error.message : "Could not update Papers Canvas. Your layout remains in the Canvas; check settings and try again.", 8000);
  }
  private updateActions() {
    const leaves = this.app.workspace.getLeavesOfType("canvas");
    for (const [leaf, el] of this.actions) {
      if (!leaves.includes(leaf) || (leaf.view as unknown as NativeView).file?.path !== this.settings.canvasPath) { el.remove(); this.actions.delete(leaf); }
    }
    for (const leaf of leaves) {
      if ((leaf.view as unknown as NativeView).file?.path !== this.settings.canvasPath || this.actions.has(leaf)) continue;
      const el = (leaf.view as ItemView).addAction("refresh-cw", "Refresh papers from Notion", () => { void this.refresh(); });
      this.actions.set(leaf, el);
    }
    for (const el of this.actions.values()) { el.classList.toggle("npc-refreshing", !!this.operation); el.setAttribute("aria-busy", String(!!this.operation)); }
  }
  async openBoard(path = canvasPath(this.settings.canvasPath)) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new UserError("Refresh papers once to create your Canvas.");
    const existing = this.app.workspace.getLeavesOfType("canvas").find(l => (l.view as unknown as NativeView).file?.path === path);
    if (existing) { await this.app.workspace.revealLeaf(existing); return; }
    await this.app.workspace.getLeaf("tab").openFile(file);
  }
  private async openPaper(id: string) {
    try {
      const { shell } = require("electron") as { shell: { openExternal: (url: string) => Promise<void> } };
      await shell.openExternal(pageUrl(id, this.settings.desktop));
    } catch { new Notice("Could not open Notion. Install the desktop app, or turn off 'Open in desktop app' in settings.", 7000); }
  }
  private store(path: string): CanvasStore {
    const matchingLeaves = () => this.app.workspace.getLeavesOfType("canvas").filter(l => (l.view as unknown as NativeView).file?.path === path);
    return {
      liveViews: () => matchingLeaves().map(leaf => {
        const view = leaf.view as unknown as NativeView;
        if (!view.canvas?.getData || !view.setViewData || !view.save)
          throw new UserError("This Canvas version does not expose safe live updates. Close its tab, then refresh.");
        return {
          getSnapshot: () => JSON.stringify(view.canvas!.getData!()),
          apply: data => { view.canvas!.requestPushHistory?.run?.(); view.setViewData!(data, false); },
          save: () => view.save!()
        } satisfies LiveCanvas;
      }),
      exists: () => !!this.app.vault.getAbstractFileByPath(path),
      create: async content => {
        const parts = path.split("/"); parts.pop(); let folder = "";
        for (const part of parts) { folder = folder ? `${folder}/${part}` : part; if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder); }
        if (this.stopped || this.operation?.signal.aborted) throw new UserError("Sync cancelled.");
        await this.app.vault.create(path, content);
      },
      process: async update => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new UserError("The Canvas file moved or disappeared. Refresh again.");
        await this.app.vault.process(file, update);
      }
    };
  }
  async refresh() {
    if (this.operation) { new Notice("A Papers refresh is already running."); return; }
    const controller = this.operation = new AbortController(); this.updateActions();
    const progress = new Notice("Reading papers from Notion…", 0);
    try {
      const settings = { ...this.settings, fields: { ...this.settings.fields } };
      const path = canvasPath(settings.canvasPath);
      const token = this.app.secretStorage.getSecret(settings.secretName);
      if (!token) throw new UserError("Choose a Notion token in Settings → Notion Papers Canvas first.");
      if (!settings.source.trim()) throw new UserError("Add the Papers database link in settings first.");
      const client = new NotionClient(async request => {
        const response = await requestUrl({ ...request, throw: false });
        let body: unknown; try { body = JSON.parse(response.text); } catch { body = null; }
        return { status: response.status, headers: response.headers, body };
      }, token, controller.signal);
      const { sourceId, papers } = await client.readAll(settings.source, settings.sourceKind, settings.fields);
      if (settings.canvasPath !== this.settings.canvasPath || settings.source !== this.settings.source || settings.sourceKind !== this.settings.sourceKind)
        throw new UserError("The source or Canvas path changed during refresh. Click Refresh again.");
      const result = await commitPapers(this.store(path), sourceId, papers, controller.signal);
      if (this.stopped) return;
      new Notice(`Papers refreshed: ${result.added} added, ${result.updated} updated, ${result.retained} unavailable cards kept.`, 6000);
      await this.openBoard(path);
    } catch (error) { this.report(error); }
    finally { progress.hide(); this.operation = null; if (!this.stopped) this.updateActions(); }
  }
}
class PapersSettings extends PluginSettingTab {
  constructor(app: App, private plugin: NotionPapersCanvas) { super(app, plugin); }
  display() {
    const { containerEl: el } = this; el.empty(); const p = this.plugin;
    new Setting(el).setName("Notion connection").setHeading();
    new Setting(el).setName("Notion token").setDesc("Create a read-content connection in Notion and share Papers with it. The token stays in Obsidian SecretStorage.")
      .addComponent(target => new SecretComponent(this.app, target).setValue(p.settings.secretName).onChange(async v => { p.settings.secretName = v ?? ""; await p.saveSettings(); }));
    new Setting(el).setName("Source type").setDesc("Use a data source ID if your database contains multiple sources.")
      .addDropdown(d => d.addOption("database", "Database link / ID").addOption("data-source", "Data source ID").setValue(p.settings.sourceKind).onChange(async v => { p.settings.sourceKind = v as Settings["sourceKind"]; await p.saveSettings(); }));
    new Setting(el).setName("Papers database").setDesc("Paste your database URL or the ID selected above.")
      .addText(t => t.setPlaceholder("https://www.notion.so/…").setValue(p.settings.source).onChange(async v => { p.settings.source = v.trim(); await p.saveSettings(); }));
    new Setting(el).setName("Canvas file").setDesc("A path inside your vault. Choose a new file when switching databases.")
      .addText(t => t.setValue(p.settings.canvasPath).onChange(async v => { p.settings.canvasPath = v.trim(); await p.saveSettings(); }));
    new Setting(el).setName("Refresh papers").setDesc("Read all papers and update cards while keeping their positions, sizes, groups, and connections.")
      .addButton(b => b.setButtonText("Refresh papers").setCta().onClick(() => { void p.refresh(); }));
    new Setting(el).setName("Card display").setHeading();
    new Setting(el).setName("Show status").setDesc("Off matches the compact title, tags, venue, and summary layout. Reopen the Canvas after changing this.")
      .addToggle(t => t.setValue(p.settings.showStatus).onChange(async v => { p.settings.showStatus = v; await p.saveSettings(); }));
    new Setting(el).setName("Open in desktop app").setDesc("Titles open the Notion desktop app. Turn off to use your browser.")
      .addToggle(t => t.setValue(p.settings.desktop).onChange(async v => { p.settings.desktop = v; await p.saveSettings(); }));
    new Setting(el).setName("Notion property names").setHeading();
    for (const key of Object.keys(DEFAULT_FIELDS) as (keyof Fields)[]) {
      new Setting(el).setName(key === "title" ? "Title" : key[0].toUpperCase() + key.slice(1))
        .setDesc(key === "title" ? "Leave blank to detect the title property." : "Leave blank to omit this property.")
        .addText(t => t.setValue(p.settings.fields[key]).onChange(async v => { p.settings.fields[key] = v.trim(); await p.saveSettings(); }));
    }
  }
}
