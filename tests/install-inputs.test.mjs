import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync, closeSync, constants, existsSync, linkSync, mkdirSync,
  mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertNoSymlinkAncestors, installLockPaths, installStore, npmInvocation,
  openInstallReport, pnpmInvocation, projectRoot, runtimePath, runtimeRoot,
} from "../scripts/install-inputs.mjs";
import { NpmCacheProgress } from "../scripts/npm-install.mjs";
import { InstallProgress } from "../scripts/pnpm-install.mjs";

function scratch(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "date-install-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function manager(directory, name, version, body = "") {
  const packageRoot = path.join(directory, name);
  const filename = name === "npm" ? "npm-cli.js" : "pnpm.cjs";
  const entry = path.join(packageRoot, "bin", filename);
  mkdirSync(path.dirname(entry), { recursive: true });
  writeFileSync(entry, body);
  writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
    name, version, bin: { [name]: `bin/${filename}` },
  }));
  return entry;
}

test("npm retains the portable and managed ci argument contracts", (t) => {
  const directory = scratch(t);
  const entry = manager(directory, "npm", "11.17.0");
  const portable = npmInvocation([process.execPath, entry, "ci", "--prefix", projectRoot,
    "--workspaces=false", "--include=dev", "--include=optional", "--prefer-offline", "--no-audit", "--no-fund"]);
  assert.equal(portable.executable, process.execPath);
  assert.deepEqual(portable.registryArgs, [entry, "config", "get", "registry"]);
  const root = path.join(directory, "runtime");
  const managed = npmInvocation(["npm", "ci", "--prefix", projectRoot, "--workspaces=false",
    "--include=dev", "--include=optional", "--cache", path.join(root, "npm-cache")], { SITES_RUNTIME_ROOT: root });
  assert.equal(managed.executable, "npm");
  assert.deepEqual(managed.registryArgs, ["config", "get", "registry"]);
});

test("npm rejects arbitrary programs, subcommands, Node evaluation, and unapproved options", () => {
  for (const command of [
    ["sh", "-c", "ignored"], ["npm;ignored", "ci"], ["npm", "exec", "ignored"],
    [process.execPath, "-e", "ignored"], ["npm", "ci", "--script-shell", "ignored"],
    ["npm", "ci", "--prefix", path.parse(projectRoot).root],
    ["npm", "ci", "--cache", path.parse(projectRoot).root],
    ["npm", "ci", "--prefix"],
  ]) assert.throws(() => npmInvocation(command));
});

test("manager entry points must match declared package identity and bin", (t) => {
  const directory = scratch(t);
  const entry = manager(directory, "npm", "11.17.0");
  const undeclared = path.join(path.dirname(entry), "other.cjs");
  writeFileSync(undeclared, "");
  assert.throws(() => npmInvocation([process.execPath, undeclared, "ci"]));
  writeFileSync(path.join(directory, "npm", "package.json"), JSON.stringify({ name: "other", bin: { npm: "bin/npm-cli.js" } }));
  assert.throws(() => npmInvocation([process.execPath, entry, "ci"]));
});

test("a supported npm invocation preserves its argv, strips the report capability, and returns the child status", (t) => {
  const directory = scratch(t);
  const observed = path.join(directory, "observed.json");
  const entry = manager(directory, "npm", "11.17.0", `
    require('node:fs').writeFileSync(${JSON.stringify(observed)}, JSON.stringify({
      args: process.argv.slice(2), report: process.env.SITES_INSTALL_REPORT_PATH
    }));
    process.exitCode = 23;
  `);
  const helper = fileURLToPath(new URL("../scripts/npm-install.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [helper, "not_applicable", process.execPath, entry,
    "ci", "--prefix", projectRoot, "--workspaces=false"],
  { env: { ...process.env, SITES_INSTALL_REPORT_PATH: path.join(directory, "missing.json") }, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 23, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(observed, "utf8")), {
    args: ["ci", "--prefix", projectRoot, "--workspaces=false", "--loglevel=http"],
  });
});

test("pnpm retains literal pnpm, Corepack, and the configured pinned Node entry", (t) => {
  const entry = manager(scratch(t), "pnpm", "11.25.0");
  assert.deepEqual(pnpmInvocation("pnpm", []), { executable: "pnpm", prefix: [] });
  assert.deepEqual(pnpmInvocation("corepack", ["pnpm"]), { executable: "corepack", prefix: ["pnpm"] });
  assert.deepEqual(pnpmInvocation("node", [entry], { SITES_PNPM_BIN: entry }),
    { executable: process.execPath, prefix: [entry] });
  assert.throws(() => pnpmInvocation("node", [entry], {}));
  assert.throws(() => pnpmInvocation("corepack", ["--eval", "ignored"]));
  assert.throws(() => pnpmInvocation("pnpm", ["--dir", "ignored"]));
  assert.throws(() => pnpmInvocation(process.execPath, ["-e", "ignored"]));
  const wrong = manager(path.join(path.dirname(path.dirname(entry)), "wrong"), "pnpm", "11.24.0");
  assert.throws(() => pnpmInvocation("node", [wrong], { SITES_PNPM_BIN: wrong }));
});

test("runtime overrides stay absolute and outputs remain within their selected root", (t) => {
  const root = path.join(scratch(t), "external-runtime");
  assert.equal(runtimeRoot({}), path.join(projectRoot, ".sites-runtime"));
  assert.equal(runtimeRoot({ SITES_RUNTIME_ROOT: root }), root);
  assert.equal(runtimePath(undefined, "wrangler/logs", root), path.join(root, "wrangler/logs"));
  assert.equal(runtimePath(path.join(root, "custom", "logs"), "unused", root), path.join(root, "custom", "logs"));
  for (const candidate of ["relative", path.join(root, "..", "outside"), `${root}-sibling`, `${root}\0`])
    assert.throws(() => runtimePath(candidate, "unused", root));
  assert.throws(() => runtimeRoot({ SITES_RUNTIME_ROOT: path.parse(root).root }));
});

test("runtime and store checks reject symlink or junction redirection", (t) => {
  const directory = scratch(t);
  const target = path.join(directory, "outside");
  const redirect = path.join(directory, "redirect");
  mkdirSync(target);
  try { symlinkSync(target, redirect, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (["EPERM", "ENOSYS"].includes(error.code)) { t.skip("Symlink creation is unavailable"); return; } throw error; }
  assert.throws(() => assertNoSymlinkAncestors(path.join(redirect, "child")));
  assert.throws(() => installStore(path.join(redirect, "pnpm-store"), "project", { SITES_RUNTIME_ROOT: redirect }));
  const cache = path.join(directory, "npm-cache");
  symlinkSync(target, cache, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => npmInvocation(["npm", "ci", "--cache", cache], { SITES_RUNTIME_ROOT: directory }));
});

test("lock and store paths cannot create files outside the selected runtime", (t) => {
  const root = path.join(scratch(t), "runtime");
  const env = { SITES_RUNTIME_ROOT: root };
  const project = path.join(root, "install.lock");
  assert.equal(installLockPaths(project, ".seed.lock", "30", env).project, project);
  assert.equal(installLockPaths(project, ".seed.lock", "30", env).shared, undefined);
  assert.throws(() => installLockPaths(path.join(root, "other.lock"), "", "30", env));
  for (const wait of ["-1", "301", "NaN", "30;ignored", undefined])
    assert.throws(() => installLockPaths(project, "", wait, env));
  assert.equal(installStore(path.join(root, "pnpm-store"), "project", env), path.join(root, "pnpm-store"));
  assert.throws(() => installStore(path.join(root, "other"), "project", env));
  assert.throws(() => installStore(path.join(root, "pnpm-store"), "workspace", env));
});

test("optional reports accept only the private pre-existing Sites capability", (t) => {
  if (!constants.O_NOFOLLOW || !constants.O_NONBLOCK) { t.skip("This platform lacks no-follow report opens"); return; }
  const directory = scratch(t);
  const parent = mkdtempSync(path.join(directory, "sites-install-"));
  chmodSync(parent, 0o700);
  const report = path.join(parent, "report.json");
  writeFileSync(report, "", { mode: 0o600 });
  const fd = openInstallReport(report);
  assert.equal(typeof fd, "number");
  closeSync(fd);
  assert.equal(openInstallReport(path.join(parent, "missing.json")), undefined);
  assert.equal(existsSync(path.join(parent, "missing.json")), false);
  assert.equal(openInstallReport(directory), undefined);
  chmodSync(report, 0o644);
  assert.equal(openInstallReport(report), undefined);
  chmodSync(report, 0o600);
  linkSync(report, path.join(parent, "alias"));
  assert.equal(openInstallReport(report), undefined);
});

test("invalid npm CLI input never executes the selected program or changes an arbitrary report", (t) => {
  const directory = scratch(t);
  const marker = path.join(directory, "executed");
  const report = path.join(directory, "victim.json");
  writeFileSync(report, "preserve");
  const helper = fileURLToPath(new URL("../scripts/npm-install.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [helper, "not_applicable", process.execPath, "-e",
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`],
  { env: { ...process.env, SITES_INSTALL_REPORT_PATH: report }, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 64, result.stderr);
  assert.equal(existsSync(marker), false);
  assert.equal(readFileSync(report, "utf8"), "preserve");
});

test("invalid pnpm CLI input rejects Node evaluation and arbitrary lock creation", (t) => {
  const directory = scratch(t);
  const marker = path.join(directory, "executed");
  const helper = fileURLToPath(new URL("../scripts/pnpm-install.mjs", import.meta.url));
  const env = { ...process.env, SITES_RUNTIME_ROOT: path.join(directory, "runtime") };
  const result = spawnSync(process.execPath, [helper, "not_applicable", "project", "created",
    path.join(env.SITES_RUNTIME_ROOT, "pnpm-store"), process.execPath, "-e",
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`], { env, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 64, result.stderr);
  assert.equal(existsSync(marker), false);
  const locked = spawnSync(process.execPath, [helper, "--hold-install-locks", marker, "", "30"],
    { env, input: "", encoding: "utf8", timeout: 5000 });
  assert.equal(locked.status, 64, locked.stderr);
  assert.equal(existsSync(marker), false);
});

test("a supported pnpm entry preserves fixed install options and operational failure status", (t) => {
  const directory = scratch(t);
  const observed = path.join(directory, "observed.json");
  const entry = manager(directory, "pnpm", "11.25.0", `
    require('node:fs').writeFileSync(${JSON.stringify(observed)}, JSON.stringify({
      args: process.argv.slice(2), report: process.env.SITES_INSTALL_REPORT_PATH
    }));
    console.log(JSON.stringify({ name: 'pnpm', level: 'error', err: { code: 'ERR_PNPM_FETCH_429' } }));
    process.exitCode = 1;
  `);
  const helper = fileURLToPath(new URL("../scripts/pnpm-install.mjs", import.meta.url));
  const root = path.join(directory, "runtime");
  const store = path.join(root, "pnpm-store");
  const result = spawnSync(process.execPath, [helper, "not_applicable", "project", "created", store, "node", entry],
    { cwd: directory, env: { ...process.env, SITES_RUNTIME_ROOT: root, SITES_PNPM_BIN: entry,
      SITES_INSTALL_REPORT_PATH: path.join(directory, "missing.json") }, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 70, result.stderr);
  const captured = JSON.parse(readFileSync(observed, "utf8"));
  assert.equal(captured.report, undefined);
  assert.deepEqual(captured.args, ["install", "--prod=false", "--ignore-scripts=false", "--frozen-lockfile",
    "--prefer-offline", "--store-dir", store, "--cache-dir", path.join(store, "policy-cache"),
    "--fetch-retries=0", "--fetch-timeout=30000", "--network-concurrency=1", "--reporter=ndjson", "--package-import-method=auto"]);
});

test("runtime setup creates valid external directories and rejects escaping output before creation", (t) => {
  const directory = scratch(t);
  const root = path.join(directory, "runtime");
  const helper = fileURLToPath(new URL("../scripts/sites-env.mjs", import.meta.url));
  const env = { ...process.env, SITES_RUNTIME_ROOT: root };
  for (const variable of ["WRANGLER_LOG_PATH", "WRANGLER_REGISTRY_PATH", "MINIFLARE_REGISTRY_PATH"]) delete env[variable];
  const valid = spawnSync(process.execPath, [helper], { env, encoding: "utf8", timeout: 5000 });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(existsSync(path.join(root, "wrangler", "dev-registry")), true);
  const outside = path.join(directory, "outside-registry");
  const invalid = spawnSync(process.execPath, [helper],
    { env: { ...env, MINIFLARE_REGISTRY_PATH: outside }, encoding: "utf8", timeout: 5000 });
  assert.notEqual(invalid.status, 0);
  assert.equal(existsSync(outside), false);
});

test("installation telemetry still requires complete npm coverage and successful pnpm import", () => {
  const progress = new NpmCacheProgress("https://registry.npmjs.org/");
  const lock = { lockfileVersion: 3, packages: {
    "node_modules/a": { resolved: "https://registry.npmjs.org/a/-/a-1.tgz" },
    "node_modules/b": { resolved: "https://registry.npmjs.org/b/-/b-1.tgz" },
  } };
  progress.accept("npm http cache https://registry.npmjs.org/a/-/a-1.tgz 0ms (cache hit)");
  assert.deepEqual(progress.counts(lock), {});
  progress.accept("npm http fetch GET 200 https://registry.npmjs.org/b/-/b-1.tgz 1ms (cache miss)");
  assert.deepEqual(progress.counts(lock), { packages_reused: 1, packages_downloaded: 1 });
  const pnpm = new InstallProgress(projectRoot);
  pnpm.accept({ name: "pnpm:progress", requester: path.resolve(projectRoot), packageId: "a@1", status: "found_in_store" });
  assert.deepEqual(pnpm.counts(true), {});
  pnpm.accept({ name: "pnpm:stats", prefix: path.resolve(projectRoot), added: 1 });
  pnpm.accept({ name: "pnpm:stage", prefix: path.resolve(projectRoot), stage: "importing_done" });
  assert.deepEqual(pnpm.counts(true), { packages_reused: 1, packages_downloaded: 0 });
  assert.deepEqual(pnpm.counts(false), {});
});
