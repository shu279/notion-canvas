import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { Script } from "node:vm";
import { JSDOM } from "jsdom";
import { sample, SOURCE, DB, schema, page } from "./fixtures.ts";
import { DEFAULT_FIELDS, decodeCard, encodeCard } from "../src/model.ts";
const bundle = buildSync({ entryPoints: ["src/main.ts"], bundle:true,write:false,minify:true,platform:"browser",target:"es2022",format:"cjs",external:["obsidian","electron"] }).outputFiles[0].text;
function fixture() {
 const dom=new JSDOM('<body></body>');
 const notices:string[]=[],commands=new Map<string,any>(),renderers=new Map<string,any>(),requests:any[]=[],files=new Map<string,{file:any,content:string}>();
 const opened:string[]=[],secrets:string[]=[]; let fail=false,live:any[]=[];
 class TFile { extension="canvas"; constructor(public path:string){} }
 class Notice { constructor(message:string){notices.push(message);} hide(){} }
 const app:any={secretStorage:{getSecret:(name:string)=>{secrets.push(name);return "fixture-secret";}},
  workspace:{on:()=>({}),onLayoutReady:(cb:()=>void)=>cb(),getLeavesOfType:()=>live,revealLeaf:async()=>{},getLeaf:()=>({openFile:async(f:any)=>{opened.push(f.path);}})},
  vault:{on:()=>({}),getAbstractFileByPath:(path:string)=>files.get(path)?.file,
   create:async(path:string,content:string)=>{if(files.has(path))throw Error("Exists");const file=new TFile(path);files.set(path,{file,content});return file;},
   createFolder:async()=>{},process:async(file:any,fn:any)=>{const entry=files.get(file.path)!;entry.content=fn(entry.content);}}
 };
 class Plugin {
  app=app; settingsData:any=null;
  async loadData(){return{secretName:"notion-test",source:DB,sourceKind:"database",canvasPath:"Papers.canvas",fields:DEFAULT_FIELDS};}
  async saveData(d:any){this.settingsData=d;}
  addSettingTab(){} addCommand(c:any){commands.set(c.id,c);} addRibbonIcon(){return dom.window.document.createElement('button');}
  registerMarkdownCodeBlockProcessor(name:string,cb:any){renderers.set(name,cb);} registerEvent(){}
 }
 const obsidian={Plugin,PluginSettingTab:class{},Notice,TFile,normalizePath:(s:string)=>s,setIcon:()=>{},
  requestUrl:async(req:any)=>{requests.push(req);if(fail)return{status:403,headers:{},text:'{"message":"fixture-secret"}'};
   const body=req.url.endsWith('/query')?{results:[page()],has_more:false}:req.url.includes('/databases/')?{data_sources:[{id:SOURCE}]}:schema;
   return{status:200,headers:{},text:JSON.stringify(body)};}};
 const module={exports:{} as any};const external:string[]=[];
 new Script(bundle).runInNewContext({module,exports:module.exports,require:(name:string)=>name==='obsidian'?obsidian:{shell:{openExternal:async(url:string)=>{external.push(url);}}},AbortController,URL,Map,Set,console,setTimeout,clearTimeout});
 const plugin=new module.exports.default();
 return{plugin,files,notices,commands,renderers,requests,external,opened,dom,setFailure:()=>{fail=true;},setLive:(v:any[])=>{live=v;}};
}
test("production plugin creates a native Canvas through its registered refresh command and renders title links",async()=>{
 const f=fixture();try{
 await f.plugin.onload();assert.ok(f.commands.has('refresh-papers'));
 await f.plugin.refresh();
 const entry=f.files.get('Papers.canvas')!;assert.ok(entry);const data=JSON.parse(entry.content);
 assert.equal(data.nodes.length,2);assert.equal(decodeCard(data.nodes[1].text)!.paper.title,sample.title);
 assert.deepEqual(f.opened,['Papers.canvas']);
 const el=f.dom.window.document.createElement('div');
 f.renderers.get('notion-paper')(data.nodes[1].text.split('\n')[1],el);
 el.querySelector('a')!.dispatchEvent(new f.dom.window.MouseEvent('click',{bubbles:true,cancelable:true}));
 assert.equal(f.external.length,1);assert.equal(f.external[0],`notion://www.notion.so/${sample.id.replace(/-/g,'')}?deepLinkOpenNewTab=true`);
 f.plugin.settings.desktop=false;
 el.querySelector('a')!.dispatchEvent(new f.dom.window.MouseEvent('click',{bubbles:true,cancelable:true}));
 assert.equal(f.external[1],`https://www.notion.so/${sample.id.replace(/-/g,'')}`);
 await f.plugin.saveSettings();assert.equal(JSON.stringify(f.plugin.settingsData).includes('fixture-secret'),false);
 assert.ok(f.requests.every(r=>r.method==='GET'||r.url.endsWith('/query')));
 }finally{f.plugin.onunload();f.dom.window.close();}
});
test("production plugin leaves a saved layout byte-for-byte unchanged after an API failure",async()=>{
 const f=fixture();try{
 await f.plugin.onload();await f.plugin.refresh();const entry=f.files.get('Papers.canvas')!;
 const data=JSON.parse(entry.content);data.nodes[1].x=999;entry.content=JSON.stringify(data);const before=entry.content;
 f.setFailure();await f.plugin.refresh();assert.equal(entry.content,before);
 assert.ok(f.notices.some(n=>n.includes('Cannot access Papers')));assert.ok(f.notices.every(n=>!n.includes('fixture-secret')));
 }finally{f.plugin.onunload();f.dom.window.close();}
});
test("Canvas has a visible refresh button even without a visible tab header, and unload removes controls",async()=>{
 const f=fixture();
 try {
  const doc=f.dom.window.document;
  const content=doc.createElement('div'),controls=doc.createElement('div');content.append(controls);doc.body.append(content);
  const node:any={text:encodeCard({version:1,sourceId:SOURCE,paper:sample}),x:11,y:22,width:600,height:600,nodeEl:doc.createElement('div'),
   startEditing(){this.isEditing=true;},isEditable(){return true;},moveAndResize(data:any){Object.assign(this,data);},
   resize(data:any){this.moveAndResize({...this,...data});},setData(data:any){Object.assign(this,data);},render(){}};
  let saves=0;
  const canvas={nodes:new Map([['paper',node]]),canvasControlsEl:controls,requestSave:()=>saves++};
  const leaf={view:{file:{path:'Papers.canvas'},canvas,contentEl:content,addAction:()=>doc.createElement('button')}};
  f.setLive([leaf]);await f.plugin.onload();
  const button=controls.querySelector('button')!;
  assert.equal(button.textContent,'Refresh papers');assert.equal(saves,1);
  assert.deepEqual([node.x,node.y,node.width,node.height],[11,22,360,210]);
  node.startEditing();assert.equal(node.isEditing,undefined);
  let refreshed=0;f.plugin.refresh=async()=>{refreshed++;};button.click();assert.equal(refreshed,1);
  f.plugin.settings.cardWidth=420;await f.plugin.saveSettings();assert.equal(node.width,420);
  f.plugin.onunload();assert.equal(controls.querySelector('button'),null);
  node.startEditing();assert.equal(node.isEditing,true);
 } finally {f.plugin.onunload();f.dom.window.close();}
});
