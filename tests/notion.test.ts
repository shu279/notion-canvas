import test from "node:test";
import assert from "node:assert/strict";
import { NotionClient, mapPage, NOTION_VERSION, Transport } from "../src/notion.ts";
import { DEFAULT_FIELDS, notionId, pageUrl } from "../src/model.ts";
import { DB, SOURCE, ID, ID2, page, schema, sample } from "./fixtures.ts";
const response = (body: unknown, status = 200, headers = {}) => ({ body, status, headers });
const client = (transport: Transport, pause = async (_: number) => {}) => new NotionClient(transport, "test-not-a-real-token", new AbortController().signal, pause);
test("database lookup, schema mapping and cursor pagination read all pages without Notion writes", async () => {
  const calls: Parameters<Transport>[0][] = [];
  const replies = [{ data_sources: [{ id: SOURCE }] }, schema, { results: [page()], has_more: true, next_cursor: "next" }, { results: [page(ID2)], has_more: false, next_cursor: null }];
  const c = client(async req => { calls.push(req); return response(replies.shift()); });
  const result = await c.readAll(`https://www.notion.so/${DB.replace(/-/g, "")}?v=ffffffffffffffffffffffffffffffff`, "database");
  assert.equal(result.sourceId, SOURCE); assert.equal(result.papers.length, 2); assert.deepEqual(result.papers[0], sample);
  assert.deepEqual(calls.map(c => c.method), ["GET","GET","POST","POST"]);
  assert.ok(calls.every(c => c.headers["Notion-Version"] === NOTION_VERSION));
  assert.ok(calls.filter(c => c.method === "POST").every(c => c.url.endsWith("/query")));
  assert.deepEqual(JSON.parse(calls[3].body!), { page_size: 100, start_cursor: "next" });
});
test("all custom Status values are read; no Included-only filter is applied", async () => {
  const p = page(); p.properties.Status.select = { name: "Archived", color: "orange" };
  assert.equal(mapPage(p, DEFAULT_FIELDS).status!.name, "Archived");
  assert.equal(mapPage({ ...p, archived: true }, DEFAULT_FIELDS).availability, "archived");
});
test("partial pagination, repeated cursors, and API caps never return a partial success", async () => {
  for (const last of [response({}, 503), response({ results: [], has_more: true, next_cursor: "again" }), response({ results: [], has_more: false, request_status: { type: "incomplete" } })]) {
    let i = 0;
    const c = client(async () => ++i === 1 ? response(schema) : i === 2 ? response({ results: [page()], has_more: true, next_cursor: "again" }) : last);
    await assert.rejects(c.readAll(SOURCE, "data-source"));
  }
});
test("a failed or malformed query is not interpreted as an empty database", async () => {
  for (const bad of [response({},403), response({},404), response({ has_more: false }), response({ results: [{}], has_more: false })]) {
    let i = 0; const c = client(async () => ++i === 1 ? response(schema) : bad);
    await assert.rejects(c.readAll(SOURCE,"data-source"));
  }
});
test("rate limiting uses Retry-After and redacts transport error details", async () => {
  let i=0; const waits: number[]=[];
  const c=client(async () => ++i===1 ? response({},429,{"Retry-After":"2"}) : i===2 ? response(schema) : response({results:[],has_more:false}), async ms=>{waits.push(ms);});
  await c.readAll(SOURCE,"data-source"); assert.deepEqual(waits,[2000]);
  const failed=client(async()=>{throw new Error("secret-token and private text");});
  await assert.rejects(failed.readAll(SOURCE,"data-source"), e=> !String(e).includes("secret-token") && !String(e).includes("private text"));
});
test("multiple data sources require an explicit choice and wrong property types fail clearly", async () => {
  await assert.rejects(client(async()=>response({data_sources:[{id:SOURCE},{id:ID2}]})).readAll(DB,"database"),/specific data source/);
  await assert.rejects(client(async()=>response({properties:{}})).readAll(SOURCE,"data-source"),/property mapping/);
});
test("optional fields can be omitted and title can be auto-detected", async () => {
  let i=0;
  const c=client(async()=>++i===1 ? response({properties:{Name:{type:"title"}}}) : response({results:[{object:"page",id:ID,properties:{Name:{type:"title",title:[{plain_text:"Example"}]}}}],has_more:false}));
  const result=await c.readAll(SOURCE,"data-source",{title:"",about:"",tags:"",venue:"",status:""});
  assert.equal(result.papers[0].title,"Example"); assert.deepEqual(result.papers[0].tags,[]);
});
test("Notion URLs ignore view IDs and external desktop URLs are constructed from validated IDs",()=>{
  assert.equal(notionId(`https://www.notion.so/Papers-${DB.replace(/-/g,"")}?v=${ID}`),DB);
  assert.equal(pageUrl(ID,true),`notion://www.notion.so/${ID.replace(/-/g,"")}?deepLinkOpenNewTab=true`);
  assert.equal(pageUrl(ID),`https://www.notion.so/${ID.replace(/-/g,"")}`);
  for(const value of ["javascript:alert(1)",`https://notion.so.evil.test/${ID}`,`https://user:pass@notion.so/${ID}`,"../etc/passwd"])
    assert.throws(()=>notionId(value));
});
test("aborting a pending response stops before returning any papers",async()=>{
  const abort=new AbortController(); let done!: (v:any)=>void;
  const c=new NotionClient(()=>new Promise(resolve=>{done=resolve;}),"fake",abort.signal);
  const work=c.readAll(SOURCE,"data-source"); abort.abort(); done(response(schema));
  await assert.rejects(work,/cancelled/);
});
