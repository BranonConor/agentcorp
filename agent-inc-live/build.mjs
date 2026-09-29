import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(root, "../.github/extensions/agent-inc-live/office.bundle.js");
await build({
  entryPoints: [resolve(root, "src/office.tsx")],
  outfile,
  nodePaths: [resolve(root, "node_modules")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
});
const bundle = await readFile(outfile, "utf8");
await writeFile(outfile, bundle.replace(/[ \t]+$/gm, ""));
