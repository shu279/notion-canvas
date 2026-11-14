# Notion Papers Canvas

Arrange your Notion papers in **Obsidian's native Canvas**. Refresh their details without losing your layout, groups, or connections.

Cards show a clickable title, colored tags, venue, and summary. Status is optional. Drag cards to organize them; click a title to open its page in the Notion desktop app.

## Install

1. Download the ZIP and extract it.
2. Rename the folder to `notion-papers-canvas` and move it into your vault's `.obsidian/plugins/` folder.
3. Restart Obsidian and enable **Notion Papers Canvas** in Community plugins.

Desktop Obsidian **1.11.4+** is required. The built plugin is included; no build step is needed.

## Connect Papers

1. Create a [Notion internal connection](https://www.notion.so/profile/integrations) with **Read content** access and share your Papers database with it.
2. In the plugin settings, create or select a **Notion token** using Obsidian SecretStorage.
3. Paste your **database link**, choose a Canvas path, and click **Refresh papers**.

The default property names are `Paper`, `About`, `Tags`, `Venue`, and `Status`. Change them in settings to match your database. For a database with multiple data sources, select **Data source ID** and paste the ID from Notion's **Manage data sources** menu.

Refresh again using the Canvas toolbar button, ribbon icon, or **Refresh papers from Notion** command. Turn off **Open in desktop app** to use your browser instead.

## Sync behavior

- Existing cards keep their IDs, positions, sizes, colors, and connections. Groups and your own notes stay intact.
- New papers appear in a new **Unsorted · Notion** area beside the existing layout.
- All statuses are included. Missing or archived papers keep their cards; missing results are marked without assuming they were deleted.
- A failed or incomplete Notion query makes no Canvas changes. Close duplicate tabs of the same Canvas before syncing.
- Edit paper details in Notion. Generated card text is replaced on refresh. A manually deleted paper card returns on the next refresh.

Only database properties are stored in the `.canvas` file; page bodies, PDFs, and attachments are not copied. The plugin never writes to Notion. Tokens stay in SecretStorage; settings store only their secret name. Your Canvas contains paper metadata and follows your vault's backup/sync settings.

## Try the layout

Open [examples/Papers.canvas](examples/Papers.canvas) in your vault with the plugin enabled. It uses an illustrative paper and a fictional Notion ID. This checks the layout without a token; configure your own database for real links and synchronization.

Experimental initial release. Automated tests cover synchronization and rendering with simulated Obsidian/Notion behavior. Live API, desktop link handling, and full Obsidian UI behavior still need end-to-end verification. Live Canvas refresh uses capability-checked internal Canvas methods; if unavailable, close the Canvas tab before refreshing.

[Development and release instructions](DEVELOPMENT.md) · [MIT License](LICENSE) · Shu
