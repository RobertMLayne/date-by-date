import { mkdirSync } from "node:fs";
import path from "node:path";
import { assertNoSymlinkAncestors, projectRoot, runtimePath, runtimeRoot } from "./install-inputs.mjs";

export { projectRoot };
const root = runtimeRoot();
const outputs = {
  WRANGLER_LOG_PATH: "wrangler/logs",
  WRANGLER_REGISTRY_PATH: "wrangler/dev-registry",
  MINIFLARE_REGISTRY_PATH: "wrangler/registry",
};
for (const [name, fallback] of Object.entries(outputs)) {
  const output = runtimePath(process.env[name], fallback, root);
  assertNoSymlinkAncestors(output);
  process.env[name] = output;
}

process.env.CLOUDFLARE_CF_FETCH_ENABLED ||= "false";
process.env.WRANGLER_SEND_METRICS ||= "false";
process.env.WRANGLER_WRITE_LOGS ||= "false";

process.chdir(projectRoot);
for (const directory of [
  path.dirname(process.env.WRANGLER_LOG_PATH),
  process.env.WRANGLER_REGISTRY_PATH,
  process.env.MINIFLARE_REGISTRY_PATH,
]) {
  mkdirSync(directory, { recursive: true });
}
