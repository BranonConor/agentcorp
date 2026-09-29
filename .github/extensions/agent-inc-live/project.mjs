import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

function repositoryName(value, host) {
  const parts = typeof value === "string" ? value.split("/") : [];
  if (parts.length !== (host === "github" ? 2 : 3) ||
    parts.some((part) => !part || part !== part.trim() || part === "." || part === "..")) {
    throw new Error("Invalid office repository identity");
  }
  return host === "github" ? value.toLowerCase() : value;
}

function githubOriginName(origin) {
  const ssh = /^git@github\.com:(.+)$/i.exec(origin);
  if (ssh) return repositoryName(ssh[1].replace(/\.git$/i, ""), "github");
  if (!URL.canParse(origin)) return undefined;
  const url = new URL(origin);
  if (url.hostname.toLowerCase() !== "github.com" || url.port ||
    !["https:", "http:", "ssh:", "git:"].includes(url.protocol)) return undefined;
  return repositoryName(url.pathname.slice(1).replace(/\.git$/i, ""), "github");
}

async function localProjectIdentity(folder, gitRoot) {
  if (typeof folder !== "string" || !isAbsolute(folder)) {
    throw new Error("Local office requires an absolute project folder");
  }
  const canonical = await realpath(folder);
  try {
    const { stdout } = await run("git", ["-C", canonical, "rev-parse", "--git-common-dir"],
      { timeout: 5_000, maxBuffer: 4_096 });
    const commonDir = stdout.trim();
    if (!commonDir) throw new Error("Git returned no common directory for office project");
    try {
      const { stdout: origin } = await run("git", ["-C", canonical, "config", "--get", "remote.origin.url"],
        { timeout: 5_000, maxBuffer: 4_096 });
      const name = githubOriginName(origin.trim());
      if (name) return `repo:github:${name}`;
    } catch (error) {
      if (error.code !== 1) throw error;
    }
    return `git:${resolve(canonical, commonDir)}`;
  } catch (error) {
    if (error.code === 128 && /not a git repository/i.test(error.stderr ?? "")) {
      if (gitRoot) throw new Error("Office project lost its Git repository", { cause: error });
      return `folder:${canonical}`;
    }
    if (error.code === "ENOENT" && !gitRoot) return `folder:${canonical}`;
    throw error;
  }
}

export async function projectRoomKey(metadata) {
  const workspace = metadata?.workspace;
  const remote = metadata?.remoteMetadata?.repository;
  if (remote && (typeof remote.owner !== "string" || typeof remote.name !== "string")) {
    throw new Error("Invalid office remote repository identity");
  }
  const remoteName = remote ? repositoryName(`${remote.owner}/${remote.name}`, "github") : undefined;
  let identity;
  if (workspace?.repository !== undefined) {
    const repository = workspace.repository;
    const host = workspace.host_type ??
      (typeof repository === "string" && repository.split("/").length === 3 ? "ado" : "github");
    if (host !== "github" && host !== "ado") throw new Error("Invalid office repository host");
    const name = repositoryName(repository, host);
    if (remoteName && (host !== "github" || name !== remoteName)) {
      throw new Error("Conflicting office repository identities");
    }
    identity = `repo:${host}:${name}`;
  } else if (remoteName) {
    identity = `repo:github:${remoteName}`;
  } else {
    if (metadata?.isRemote) throw new Error("Remote office requires a repository identity");
    const folder = workspace?.git_root ?? metadata?.workingDirectory;
    identity = await localProjectIdentity(folder, workspace?.git_root);
  }
  return createHash("sha256").update(identity).digest("hex");
}
