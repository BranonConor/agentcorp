import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { projectRoomKey } from "./project.mjs";

test("worktrees and branches of the same repository share one room", async () => {
  const first = {
    workingDirectory: "/checkout/one",
    workspace: {
      repository: "BranonConor/agentcorp", host_type: "github",
      git_root: "/checkout/one", branch: "main",
    },
  };
  const other = {
    workingDirectory: "/checkout/two",
    workspace: {
      repository: "branonconor/AGENTCORP", host_type: "github",
      git_root: "/checkout/two", branch: "feature",
    },
  };
  const key = await projectRoomKey(first);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key, await projectRoomKey(other));
  assert.equal(key, await projectRoomKey({
    isRemote: true, remoteMetadata: { repository: { owner: "BranonConor", name: "agentcorp", branch: "main" } },
  }));
});

test("different repositories and hosts cannot share a room", async () => {
  const first = { workspace: { repository: "BranonConor/agentcorp", host_type: "github" } };
  const other = { workspace: { repository: "BranonConor/game-labs", host_type: "github" } };
  const sameSlugOtherHost = { workspace: { repository: "BranonConor/agentcorp", host_type: "ado" } };
  assert.notEqual(await projectRoomKey(first), await projectRoomKey(other));
  await assert.rejects(projectRoomKey(sameSlugOtherHost), /Invalid office repository identity/);
  assert.notEqual(await projectRoomKey(first),
    await projectRoomKey({ workspace: { repository: "org/project/agentcorp", host_type: "ado" } }));
});

test("local Git worktrees share a room without a repository slug, but other repos do not", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentcorp-worktrees-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, "checkout");
  execFileSync("git", ["init", "-q", "-b", "main", checkout]);
  await writeFile(join(checkout, "fixture.txt"), "test");
  execFileSync("git", ["-C", checkout, "add", "fixture.txt"]);
  execFileSync("git", ["-C", checkout, "-c", "user.name=Office Test",
    "-c", "user.email=office@example.invalid", "commit", "-q", "-m", "fixture"]);
  const worktree = join(root, "worktree");
  execFileSync("git", ["-C", checkout, "worktree", "add", "-q", "-b", "other", worktree]);
  const first = await projectRoomKey({ workingDirectory: checkout });
  assert.equal(first, await projectRoomKey({ workingDirectory: worktree }));
  const nested = join(checkout, "nested");
  await mkdir(nested);
  assert.equal(first, await projectRoomKey({ workingDirectory: nested }));
  execFileSync("git", ["-C", checkout, "remote", "add", "origin",
    "https://github.com/BranonConor/agentcorp.git"]);
  const sdkKey = await projectRoomKey({
    workspace: { repository: "BranonConor/agentcorp", host_type: "github" },
  });
  assert.equal(sdkKey, await projectRoomKey({ workingDirectory: checkout }));
  assert.equal(sdkKey, await projectRoomKey({ workingDirectory: worktree }));
  execFileSync("git", ["-C", checkout, "remote", "set-url", "origin",
    "git@github.com:BRANONCONOR/AGENTCORP.git"]);
  assert.equal(sdkKey, await projectRoomKey({ workingDirectory: worktree }));
  const different = join(root, "different");
  execFileSync("git", ["init", "-q", different]);
  assert.notEqual(first, await projectRoomKey({ workingDirectory: different }));
  assert.notEqual(sdkKey, await projectRoomKey({ workingDirectory: different }));
});

test("non-Git local folders use their canonical path", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentcorp-folder-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const alias = join(root, "alias");
  const other = join(root, "other");
  await symlink(root, alias, "dir");
  await mkdir(other);
  const folder = { workingDirectory: root };
  const sameFolder = { workingDirectory: alias };
  const differentFolder = { workingDirectory: other };
  assert.equal(await projectRoomKey(folder), await projectRoomKey(sameFolder));
  assert.notEqual(await projectRoomKey(folder), await projectRoomKey(differentFolder));
  await assert.rejects(projectRoomKey({ workingDirectory: "relative/path" }), /absolute project folder/);
  await assert.rejects(projectRoomKey({ isRemote: true, workingDirectory: root }), /requires a repository/);
});

test("malformed or conflicting repository metadata fails closed", async () => {
  await assert.rejects(projectRoomKey({ workspace: { repository: "../other", host_type: "github" } }),
    /Invalid office repository identity/);
  await assert.rejects(projectRoomKey({
    workspace: { repository: "BranonConor/agentcorp", host_type: "github" },
    remoteMetadata: { repository: { owner: "BranonConor", name: "game-labs" } },
  }), /Conflicting office repository identities/);
});
