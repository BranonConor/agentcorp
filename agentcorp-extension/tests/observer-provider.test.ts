import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { shouldRegister } from "../../.github/extensions/agentcorp-extension/provider-selection.mjs";

test("user installation owns the observer when both scopes are discovered", async () => {
  const home = await mkdtemp(join(tmpdir(), "observer-provider-"));
  const project = pathToFileURL(join(home, "project", ".github", "extensions", "agentcorp-extension", "extension.mjs")).href;
  const userPath = join(home, "extensions", "agentcorp-extension", "extension.mjs");
  const previousPath = join(home, "extensions", "agentcorp-observer-viewer", "extension.mjs");
  try {
    assert.equal(await shouldRegister(project, home), true);
    await mkdir(join(home, "extensions", "agentcorp-extension"), { recursive: true });
    await writeFile(userPath, "");
    assert.equal(await shouldRegister(project, home), false);
    assert.equal(await shouldRegister(pathToFileURL(userPath).href, home), true);
    await mkdir(join(home, "extensions", "agentcorp-observer-viewer"), { recursive: true });
    await writeFile(previousPath, "");
    assert.equal(await shouldRegister(project, home), false);
    assert.equal(await shouldRegister(pathToFileURL(userPath).href, home), false);
    await rm(userPath);
    assert.equal(await shouldRegister(project, home), false);
    await rm(previousPath);
    assert.equal(await shouldRegister(project, home), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
