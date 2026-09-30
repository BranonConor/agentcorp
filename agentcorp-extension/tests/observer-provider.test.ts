import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { shouldRegister } from "../../.github/extensions/agentcorp-extension/provider-selection.mjs";

test("project installation stays active when it shadows a same-name user installation", async () => {
  const home = await mkdtemp(join(tmpdir(), "observer-provider-"));
  const projectPath = join(home, "project", ".github", "extensions", "agentcorp-extension", "extension.mjs");
  const userPath = join(home, "extensions", "agentcorp-extension", "extension.mjs");
  try {
    await mkdir(dirname(projectPath), { recursive: true });
    await mkdir(dirname(userPath), { recursive: true });
    await writeFile(projectPath, "");
    await writeFile(userPath, "");
    // Discovery shadows the user entry before calling into either extension.
    assert.equal(await shouldRegister(pathToFileURL(projectPath).href, home), true);
    await rm(projectPath);
    assert.equal(await shouldRegister(pathToFileURL(userPath).href, home), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("distinct legacy user provider retains ownership until it is removed", async () => {
  const home = await mkdtemp(join(tmpdir(), "observer-provider-"));
  const project = pathToFileURL(join(home, "project", ".github", "extensions", "agentcorp-extension", "extension.mjs")).href;
  const userPath = join(home, "extensions", "agentcorp-extension", "extension.mjs");
  const previousPath = join(home, "extensions", "agentcorp-observer-viewer", "extension.mjs");
  try {
    await mkdir(dirname(userPath), { recursive: true });
    await mkdir(dirname(previousPath), { recursive: true });
    await writeFile(userPath, "");
    await writeFile(previousPath, "");
    assert.equal(await shouldRegister(pathToFileURL(previousPath).href, home), true);
    assert.equal(await shouldRegister(project, home), false);
    await rm(previousPath);
    assert.equal(await shouldRegister(project, home), true);
    await writeFile(previousPath, "");
    assert.equal(await shouldRegister(pathToFileURL(userPath).href, home), false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
