import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function absolutePath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\0\r\n]/.test(value) ||
      value.split(/[\\/]/).includes("..")) throw new Error("Expected an absolute path without traversal");
  return path.resolve(value);
}

export function runtimeRoot(env = process.env) {
  const root = env.SITES_RUNTIME_ROOT
    ? absolutePath(env.SITES_RUNTIME_ROOT)
    : path.join(projectRoot, ".sites-runtime");
  if (root === path.parse(root).root) throw new Error("The filesystem root is not a runtime directory");
  return root;
}

export function runtimePath(value, fallback, root = runtimeRoot()) {
  const candidate = value ? absolutePath(value) : path.join(root, fallback);
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error("Runtime output must stay inside SITES_RUNTIME_ROOT");
  return candidate;
}

// Reject existing redirected ancestors before creating output. These helpers run
// as the developer, not as a sandbox for another process with the same account.
export function assertNoSymlinkAncestors(filename) {
  let current = absolutePath(filename);
  for (;;) {
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error("Symlinked runtime paths are unsupported");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function packageManagerEntry(filename, name, version) {
  const entry = realpathSync(absolutePath(filename));
  const packageRoot = path.dirname(path.dirname(entry));
  const metadata = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const expectedBin = name === "npm" ? "bin/npm-cli.js" : "bin/pnpm.cjs";
  const declared = metadata.bin?.[name];
  if (metadata.name !== name || (version && metadata.version !== version) ||
      declared !== expectedBin || realpathSync(path.join(packageRoot, expectedBin)) !== entry)
    throw new Error("Expected the declared package-manager entry point");
  return entry;
}

export function npmInvocation(command, env = process.env) {
  if (!Array.isArray(command) || command.some((value) => typeof value !== "string"))
    throw new Error("Invalid npm command");
  let args;
  let executable;
  let prefix;
  if (command[0] === "npm") {
    executable = "npm";
    prefix = [];
    args = command.slice(1);
  } else if (command[0] === process.execPath && command.length >= 3) {
    executable = process.execPath;
    prefix = [packageManagerEntry(command[1], "npm")];
    args = command.slice(2);
  } else {
    throw new Error("Only npm or Node's npm entry point may be installed");
  }
  if (args[0] !== "ci") throw new Error("Only npm ci is supported");
  const allowed = new Set([
    "--workspaces=false", "--include=dev", "--include=optional",
    "--prefer-offline", "--no-audit", "--no-fund",
  ]);
  for (let index = 1; index < args.length; index++) {
    const flag = args[index];
    if (allowed.has(flag)) continue;
    if (flag === "--prefix" && absolutePath(args[++index]) === path.resolve(projectRoot)) continue;
    if (flag === "--cache" && absolutePath(args[++index]) === path.join(runtimeRoot(env), "npm-cache")) {
      assertNoSymlinkAncestors(path.join(runtimeRoot(env), "npm-cache"));
      continue;
    }
    throw new Error("Unsupported npm installation argument");
  }
  return { executable, args: [...prefix, ...args], registryArgs: [...prefix, "config", "get", "registry"] };
}

export function pnpmInvocation(executable, prefix, env = process.env) {
  if (executable === "pnpm" && prefix.length === 0) return { executable: "pnpm", prefix: [] };
  if (executable === "corepack" && prefix.length === 1 && prefix[0] === "pnpm")
    return { executable: "corepack", prefix: ["pnpm"] };
  if ((executable === "node" || executable === process.execPath) && prefix.length === 1 &&
      env.SITES_PNPM_BIN && absolutePath(prefix[0]) === absolutePath(env.SITES_PNPM_BIN))
    return { executable: process.execPath, prefix: [packageManagerEntry(prefix[0], "pnpm", "11.25.0")] };
  throw new Error("Only the configured pnpm package manager may be installed");
}

export function installStore(store, scope, env = process.env) {
  const expected = scope === "project" ? path.join(runtimeRoot(env), "pnpm-store")
    : scope === "workspace" && process.platform === "linux" ? "/workspace/.sites-runtime/pnpm-store" : undefined;
  if (!expected || absolutePath(store) !== expected) throw new Error("Unexpected pnpm store");
  assertNoSymlinkAncestors(expected);
  return expected;
}

export function installLockPaths(project, shared, waitSeconds, env = process.env) {
  const expectedProject = path.join(runtimeRoot(env), "install.lock");
  const expectedShared = "/workspace/.sites-runtime/pnpm-store.seed.lock";
  if (absolutePath(project) !== expectedProject || typeof waitSeconds !== "string" ||
      !/^\d+(?:\.\d+)?$/.test(waitSeconds) || Number(waitSeconds) > 300)
    throw new Error("Invalid installation lock arguments");
  assertNoSymlinkAncestors(path.dirname(expectedProject));
  // An absent/shared-store fallback must never create a caller-selected file.
  const sharedLock = process.platform === "linux" && shared === expectedShared ? expectedShared : undefined;
  if (sharedLock) assertNoSymlinkAncestors(path.dirname(sharedLock));
  return { project: expectedProject, shared: sharedLock, waitSeconds };
}

export function openInstallReport(filename = process.env.SITES_INSTALL_REPORT_PATH) {
  let descriptor;
  try {
    if (!filename || !constants.O_NOFOLLOW || !constants.O_NONBLOCK) return undefined;
    const candidate = absolutePath(filename);
    const parent = path.dirname(candidate);
    if (path.basename(candidate) !== "report.json" || !/^sites-install-[A-Za-z0-9]{6,}$/.test(path.basename(parent)))
      return undefined;
    assertNoSymlinkAncestors(parent);
    const directory = lstatSync(parent);
    const file = lstatSync(candidate);
    const uid = process.getuid?.();
    // The Sites caller creates a private temporary directory and a pre-existing
    // report (wx+, 0600). Preserve that capability without opening arbitrary
    // regular files or following hard links; unsupported telemetry stays optional.
    if (!directory.isDirectory() || !file.isFile() || file.nlink !== 1 || file.size > 4096 ||
        (uid !== undefined && (directory.uid !== uid || file.uid !== uid ||
          (directory.mode & 0o077) !== 0 || (file.mode & 0o077) !== 0))) return undefined;
    descriptor = openSync(path.join(parent, "report.json"),
      constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(descriptor);
    const after = lstatSync(parent);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== file.dev || opened.ino !== file.ino ||
        after.dev !== directory.dev || after.ino !== directory.ino) throw new Error("Report identity changed");
    return descriptor;
  } catch {
    // Telemetry must not change installation behavior or disclose local paths.
  }
  if (descriptor !== undefined) closeSync(descriptor);
  return undefined;
}
