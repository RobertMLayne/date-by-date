import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));

test("the legacy loader's actual transformation APIs preserve TypeScript semantics", async () => {
  const core = require("@esbuild-kit/core-utils");
  const fixtures = [
    ["export const answer: number = 42;", 42],
    ["enum E { A = 7 }; const x: { a?: E } = { a: E.A }; export const answer = x?.a ?? 0;", 7],
    ["function id<T>(value: T): T { return value }; export const answer = id<number>(19);", 19],
    ["const x = { a: 5 } as const satisfies { a: number }; export const answer = x.a;", 5],
  ];
  for (const [source, answer] of fixtures) {
    const synchronous = core.transformSync(source, path.join(root, "fixture.ts"), { format: "cjs" });
    const fixtureModule = { exports: {} };
    // Execute only the literal fixture compiled above. No user input, downloaded
    // source or application data is accepted by this compatibility probe.
    new Function("module", "exports", "require", synchronous.code)(fixtureModule, fixtureModule.exports, require);
    assert.equal(fixtureModule.exports.answer, answer);
    const asynchronous = await core.transform(source, path.join(root, "fixture.mts"), { format: "esm" });
    const result = await import(`data:text/javascript;base64,${Buffer.from(asynchronous.code).toString("base64")}`);
    assert.equal(result.answer, answer);
    assert.ok(synchronous.map && asynchronous.map);
  }
  for (const relative of ["db/schema.ts", "drizzle.config.ts"]) {
    const source = readFileSync(path.join(root, relative), "utf8");
    const result = core.transformSync(source, path.join(root, relative), { format: "cjs" });
    assert.ok(result.code.length > 0 && result.map);
  }
});

test("the legacy ESM loader can import the project's actual SQLite schema", () => {
  const child = spawnSync(process.execPath, [
    "--loader", "@esbuild-kit/esm-loader", "--input-type", "module", "-e",
    "const schema=await import('./db/schema.ts'); console.log(JSON.stringify(Object.keys(schema).sort()));",
  ], { cwd: root, encoding: "utf8", timeout: 30_000 });
  assert.equal(child.status, 0, child.stderr || String(child.error));
  const exports = JSON.parse(child.stdout);
  assert.ok(exports.includes("profiles") && exports.includes("messages"));
});

test("the framework's image-size API retains bounded PNG dimension decoding", () => {
  const { imageSize } = require("image-size");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwkAAAAAASUVORK5CYII=", "base64");
  const dimensions = imageSize(png);
  assert.equal(dimensions.type, "png");
  assert.equal(dimensions.width, 1);
  assert.equal(dimensions.height, 1);
});
