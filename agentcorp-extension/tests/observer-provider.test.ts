import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { shouldRegister } from "../../.github/extensions/agentcorp-extension/provider-selection.mjs";

test("both scopes launch, but the canonical user copy alone registers the canvas", async () => {
  const home = await mkdtemp(join(tmpdir(), "observer-provider-"));
  const projectPath = join(home, "project", ".github", "extensions", "agentcorp-extension", "extension.mjs");
  const userPath = join(home, "extensions", "agentcorp-extension", "extension.mjs");
  const project = pathToFileURL(projectPath).href;
  const user = pathToFileURL(userPath).href;
  try {
    await mkdir(dirname(projectPath), { recursive: true });
    await mkdir(dirname(userPath), { recursive: true });
    await writeFile(projectPath, "");
    await writeFile(userPath, "");
    assert.deepEqual(await Promise.all([shouldRegister(project, home), shouldRegister(user, home)]),
      [false, true]);
    await rm(userPath);
    assert.equal(await shouldRegister(project, home), true);
    await writeFile(userPath, "");
    await rm(projectPath);
    assert.equal(await shouldRegister(user, home), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("renamed project, user, and session copies yield to the canonical user provider", async () => {
  const home = await mkdtemp(join(tmpdir(), "observer-provider-"));
  const canonicalPath = join(home, "extensions", "agentcorp-extension", "extension.mjs");
  const aliases = [
    join(home, "project", ".github", "extensions", "renamed-project-observer", "extension.mjs"),
    join(home, "extensions", "renamed-user-observer", "extension.mjs"),
    join(home, "session-state", "session-id", "extensions", "renamed-session-observer", "extension.mjs"),
  ];
  try {
    await mkdir(dirname(canonicalPath), { recursive: true });
    await writeFile(canonicalPath, "");
    for (const alias of aliases) {
      await mkdir(dirname(alias), { recursive: true });
      await writeFile(alias, "");
      assert.equal(await shouldRegister(pathToFileURL(alias).href, home), false, alias);
    }
    assert.equal(await shouldRegister(pathToFileURL(canonicalPath).href, home), true);
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
    assert.equal(await shouldRegister(pathToFileURL(userPath).href, home), false);
    await rm(previousPath);
    assert.equal(await shouldRegister(project, home), false);
    assert.equal(await shouldRegister(pathToFileURL(userPath).href, home), true);
    await rm(userPath);
    assert.equal(await shouldRegister(project, home), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
