import { build } from "esbuild";
await build({ entryPoints: ["src/main.ts"], bundle: true, platform: "browser", target: "es2022", format: "cjs", outfile: "main.js", external: ["obsidian", "electron"], minify: true, logLevel: "info" });
