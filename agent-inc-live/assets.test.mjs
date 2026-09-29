import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const extension = new URL("../.github/extensions/agent-inc-live/", import.meta.url);

test("the installable folder has a manifest and all referenced page assets", async () => {
  assert.deepEqual(JSON.parse(await readFile(new URL("copilot-extension.json", extension), "utf8")),
    { name: "agent-inc-live", version: 1 });
  const html = await readFile(new URL("office.html", extension), "utf8");
  const files = [...html.matchAll(/(?:href|src)="\/([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(files, ["styles.css", "live.css", "office.bundle.js"]);
  for (const name of files) assert((await readFile(new URL(name, extension))).length > 0);
});

test("the shipped scene stylesheet exactly matches its source", async () => {
  assert.deepEqual(
    await readFile(new URL("styles.css", extension)),
    await readFile(new URL("../agent-inc/app/styles.css", import.meta.url)),
  );
});
