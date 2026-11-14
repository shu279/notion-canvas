import { DEFAULT_FIELDS, Paper } from "../src/model.ts";
export const SOURCE = "11111111-1111-4111-8111-111111111111";
export const DB = "22222222-2222-4222-8222-222222222222";
export const ID = "33333333-3333-4333-8333-333333333333";
export const ID2 = "44444444-4444-4444-8444-444444444444";
export const sample: Paper = { id: ID, title: "Diffusion Models Beat GANs on Image Synthesis", tags: [{ name: "Diffusion", color: "pink" }, { name: "Generative Model", color: "brown" }], venue: "NeurIPS 2021", about: "U-Net改良とClassifier勾配による高品質Diffusion画像生成", status: { name: "Included", color: "green" }, availability: "active" };
export const rich = (text: string) => [{ plain_text: text }];
export function page(id = ID) { return { object: "page", id, properties: {
  Paper: { type: "title", title: rich(sample.title) }, About: { type: "rich_text", rich_text: rich(sample.about) },
  Tags: { type: "multi_select", multi_select: sample.tags }, Venue: { type: "rich_text", rich_text: rich(sample.venue) }, Status: { type: "select", select: sample.status }
} }; }
export const schema = { properties: Object.fromEntries(Object.entries(DEFAULT_FIELDS).map(([key,name]) => [name, { type: { title: "title", about: "rich_text", tags: "multi_select", venue: "rich_text", status: "select" }[key] }])) };
