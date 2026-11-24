import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Package the same React app for a plain file, with no account or API access.
const project = fileURLToPath(new URL("..", import.meta.url));
const bundle = await build({
  absWorkingDir: project,
  stdin: {
    contents: 'import { createRoot } from "react-dom/client"; import TrackerApp from "./src/components/tracker-app"; createRoot(document.getElementById("root")).render(<TrackerApp/>);',
    loader: "tsx", resolveDir: project, sourcefile: "demo-entry.tsx",
  },
  bundle: true, write: false, minify: true, format: "iife", platform: "browser", target: ["es2022"], jsx: "automatic",
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.NEXT_PUBLIC_SUPABASE_URL": '""',
    "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '""',
  },
});
const reset = await readFile(path.join(project, "node_modules/tailwindcss/preflight.css"), "utf8");
const style = (await readFile(path.join(project, "src/app/globals.css"), "utf8"))
  .replace(/^@import .*?;$/gm, "");
const icon = await readFile(path.join(project, "public/icon-192.png"));
const script = bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>减脂日志 · 本机演示</title><link rel="icon" href="data:image/png;base64,${icon.toString("base64")}">
<style>@layer theme,base,components,utilities;@layer base{${reset}}\n${style}</style></head>
<body><div id="root"></div><script>${script}</script></body></html>`;
await writeFile(path.join(project, "demo.html"), html);
console.log("Built demo.html");
