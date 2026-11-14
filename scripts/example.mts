import { writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { mergePapers } from "../src/canvas.ts";
import { sample, SOURCE } from "../tests/fixtures.ts";
const board = mergePapers({ nodes: [], edges: [] }, SOURCE, [sample]).data;
await writeFile("examples/Papers.canvas", JSON.stringify(board, null, 2) + "\n");
const js = await build({ stdin: { contents: `import {renderCard} from './src/card'; renderCard(document.querySelector('#card'), ${JSON.stringify({version:1,sourceId:SOURCE,paper:sample})}, {showStatus:false,open:()=>{}});`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, minify: true });
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Notion Papers Canvas preview</title><link rel="stylesheet" href="../styles.css"><style>
:root{--text-normal:#303030;--text-muted:#92918b;--font-interface:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--background-primary:#fff;--background-modifier-hover:#eee;--interactive-accent:#6b5acb}body{margin:0;background:#fff;font-family:var(--font-interface)}#card{box-sizing:border-box;width:328px;min-height:182px;margin:10px 14px;padding:10px 12px;border:1px solid #e9e9e7;border-radius:13px;box-shadow:0 2px 5px #00000004}.npc-icon{font-size:20px;line-height:1}.npc-icon:empty{display:none}
</style></head><body><main id="card"></main><script>${js.outputFiles[0].text}</script></body></html>`;
await writeFile("examples/card-preview.html", html);
