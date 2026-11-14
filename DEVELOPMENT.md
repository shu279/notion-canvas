# Development

Requires Node.js 22 or newer.

```sh
npm ci
npm run check
```

`npm run check` typechecks, runs the regression suite, and builds `main.js`. Tests use synthetic page IDs and mocked transport; they do not contact Notion or require credentials.

## Design

- `src/notion.ts`: read-only Notion API client pinned to `2025-09-03`. Resolve a database's data source, validate property mappings, and finish cursor pagination before returning any papers. Incomplete query results and pagination errors abort the sync. Rate-limit retries respect `Retry-After` up to 30 seconds; a longer delay requires a manual retry.
- `src/canvas.ts`: pure JSON Canvas merge. Generated text cards hold a `notion-paper` code block containing a page ID, source ID, and card metadata. Updating a paper changes only its text. Existing node order, geometry, groups, edge records, and extension fields are retained. A new group is created only for new papers, outside the existing bounds; existing groups are never resized.
- `src/sync.ts`: commit after fetching. Open Canvas tabs are read from live `canvas.getData()` immediately before applying via `setViewData(data, false)` and saving through the view. A pending native history entry is flushed before applying. Closed files use `vault.process()` so the merge sees the latest disk data. Multiple open tabs of the same file are rejected to avoid competing unsaved layouts.
- `src/card.ts`: code block renderer using textContent, fixed CSS color classes, and a validated page-ID-derived link. Only title pointer events stop propagation; the card body remains draggable by Canvas. Card rendering itself makes no network calls.
- `src/interactions.ts`: per-instance Canvas guards for generated cards. Prevent text editing; constrain resize gestures, geometry updates and auto-height changes when fixed sizing is on. Ordinary nodes retain their behavior. Node imports and DOM changes attach guards to new/duplicated cards. Unload disconnects observers and restores methods without removing later third-party wrappers. Scoped CSS bypasses the native unselected-card blocker so the title responds on the first click.
- `src/main.ts`: Obsidian controls, SecretStorage, settings, native Canvas adapter, and desktop link opening. Sync settings are captured at start; a changed source or file path cancels the commit. Plugin unload cancels commit eligibility. Already-sent `requestUrl` calls cannot be physically aborted.

Desktop page URLs include `deepLinkOpenNewTab=true`. Notion 7.43.0's existing-tab matcher compares the complete last path segment, including the title slug, plus peek/chat query context. Raw ID links therefore fail to match title-bearing tabs. Sync preserves Notion API `page.url`; the renderer and desktop opener use that URL after validating its HTTPS Notion host and matching page ID, and discarding query/fragment options. Older cards without a URL remain readable and use ID links until refreshed. Browser URLs omit the desktop flag. Existing tabs with stale title slugs or different peek/chat contexts may still open separately. These are internal Notion behaviors, so future desktop versions may change them.

Each Canvas is for one data source. Managed cards from a different source cause a clear error. Duplicate cards for one page are all updated without changing their independent placements. A source query can omit a page because of permissions, moving, or archiving: omission is marked as unavailable, never treated as proof of deletion.

Status properties such as `Archived` remain normal paper metadata. Notion's page archive/trash flags are handled separately. No filter tied to a particular Notion saved view is applied.

The sample matches the supplied card layout. Status is hidden by default. Cards default to 360 × 210 with configurable fixed dimensions. Turning fixed sizing off permits native resizing. Existing oversized cards are normalized on opening, retaining their coordinates and edges. With the plugin disabled, the generated code block remains in the Canvas and can be inspected as JSON.

## Verification before a release

Use a disposable vault to test actual Obsidian behavior:

1. Enable the plugin, open `examples/Papers.canvas`, drag its card, try resize handles and double-clicks, add a group and an arrow, then reopen it. Check fixed dimensions and no code editor; turn fixed sizing off and verify free resizing. Repeat with Advanced Canvas minimum size 600 and One Click Edit enabled.
2. Connect a test Notion database with Read content access and refresh. Confirm every page is represented, including other Status values.
3. While a refresh is fetching, move an existing card. Confirm the latest position, size, groups, and arrow labels survive.
4. Change a title/tag/About field in Notion and add a paper. Confirm existing geometry is unchanged and only the new paper appears in an Unsorted group.
5. Archive/move a page or remove access to it. Confirm its existing card and connections remain. Retry after an invalid token/network error and verify no partial Canvas update.
6. Click an unselected title and test the desktop/browser setting. Verify background dragging does not open links. Use the visible right-side Refresh papers button with tab headers hidden. Check other installed Canvas plugins separately.

The native adapter was checked against the locally installed Obsidian implementation, but that inspection is not an end-to-end UI test. No claim of verified compatibility with every Obsidian version or third-party Canvas plugin is made.

## Publish

This directory is the root of [shu279/notion-canvas](https://github.com/shu279/notion-canvas). The plugin ID and installation folder remain `notion-papers-canvas` for compatibility with existing settings and installations.

1. Run `npm run check` and update versions together in `manifest.json`, `package.json`, `package-lock.json`, and `versions.json`.
2. Commit the reviewed source and built `main.js`. Keep `data.json`, credentials, personal Canvas files, and `node_modules` out of Git.
3. Create a release tagged exactly as the manifest version.
4. Attach `main.js`, `manifest.json`, and `styles.css` individually. An installation ZIP may additionally contain those files under `notion-papers-canvas/`.

GitHub publication and Obsidian community directory submission are separate steps; see the [official submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin).

## References

- [JSON Canvas specification](https://jsoncanvas.org/spec/1.0/)
- [Notion data source migration and database lookup](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03)
- [Querying a data source](https://developers.notion.com/reference/query-a-data-source)
- [Notion request limits](https://developers.notion.com/reference/request-limits)
- [Obsidian SecretStorage](https://docs.obsidian.md/plugins/guides/secret-storage)
- [Notion desktop link settings](https://www.notion.com/help/notion-for-desktop)
