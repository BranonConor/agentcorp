import { build } from "esbuild";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const extension = resolve(root, "../.github/extensions/agent-inc-live");
const outfile = resolve(extension, "office.bundle.js");
const result = await build({
  entryPoints: [resolve(root, "src/office.tsx")],
  outfile,
  nodePaths: [resolve(root, "node_modules")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  metafile: true,
});
const bundle = await readFile(outfile, "utf8");
await writeFile(outfile, bundle.replace(/[ \t]+$/gm, ""));
await copyFile(resolve(root, "../agent-inc/app/styles.css"), resolve(extension, "styles.css"));

const packageRoots = [...new Set(Object.keys(result.metafile.inputs).flatMap((input) => {
  const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input.replaceAll("\\", "/"));
  return match ? [resolve(root, match[1])] : [];
}))].sort();
const notices = await Promise.all(packageRoots.map(async (directory) => {
  const pkg = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  if (pkg.license !== "MIT") throw new Error(`Review the license for bundled dependency ${pkg.name}`);
  const license = (await readFile(resolve(directory, "LICENSE"), "utf8")).trimEnd();
  return `${pkg.name} v${pkg.version} (MIT)\n\n${license}`;
}));
await writeFile(resolve(extension, "THIRD_PARTY_NOTICES.txt"),
  "Third-party notices for office.bundle.js\n" +
  "These licenses apply only to the dependencies below, not to agentcorp's own code.\n\n" +
  `${notices.sort().join("\n\n---\n\n")}\n`);
