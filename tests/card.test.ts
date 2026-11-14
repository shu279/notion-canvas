import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderCard } from "../src/card.ts";
import { decodeCard, encodeCard } from "../src/model.ts";
import { SOURCE, sample } from "./fixtures.ts";
test("card matches screenshot fields, colors and order; status is optional",()=>{
 const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main')!;
 const payload={version:1 as const,sourceId:SOURCE,paper:sample};
 renderCard(root,payload,{showStatus:false,open:()=>{}});
 assert.equal(root.querySelector('.npc-title')!.textContent,sample.title);
 assert.deepEqual([...root.querySelectorAll('.npc-tag')].map(e=>e.textContent),['Diffusion','Generative Model']);
 assert.equal(root.querySelector('.npc-venue')!.textContent,'NeurIPS 2021');
 assert.equal(root.querySelector('.npc-about')!.textContent,sample.about);
 assert.equal(root.querySelector('.npc-status'),null);
 renderCard(root,payload,{showStatus:true,open:()=>{}}); assert.equal(root.querySelector('.npc-status')!.textContent,'Included');
 dom.window.close();
});
test("only the title opens Notion; card background gestures still propagate",()=>{
 const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main')!; let opened=0,down=0;
 renderCard(root,{version:1,sourceId:SOURCE,paper:sample},{showStatus:false,open:id=>{assert.equal(id,sample.id);opened++;}});
 root.addEventListener('pointerdown',()=>down++);
 root.querySelector('a')!.dispatchEvent(new dom.window.Event('pointerdown',{bubbles:true})); assert.equal(down,0);
 root.querySelector('a')!.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,cancelable:true})); assert.equal(opened,1);
 root.querySelector('.npc-about')!.dispatchEvent(new dom.window.Event('pointerdown',{bubbles:true})); assert.equal(down,1);
 root.querySelector('.npc-about')!.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})); assert.equal(opened,1);
 dom.window.close();
});
test("Notion property text cannot inject HTML, script, or a new fenced block",()=>{
 const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main')!;
 const payload={version:1 as const,sourceId:SOURCE,paper:{...sample,title:'<img src=x onerror=alert(1)>',about:'```\n<script>alert(1)</script>\n```'}};
 assert.deepEqual(decodeCard(encodeCard(payload)),payload);
 renderCard(root,payload,{showStatus:false,open:()=>{}});
 assert.equal(root.querySelector('img,script'),null); assert.equal(root.querySelector('a')!.textContent,payload.paper.title);
 dom.window.close();
});
