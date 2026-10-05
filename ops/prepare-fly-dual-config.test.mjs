import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dualMachineConfig } from "./prepare-fly-dual-config.mjs";
const source = readFileSync(new URL("../fly.toml", import.meta.url), "utf8");
test("worker stage preserves app performance and both 8GB allocations; shared is a separate explicit proposal", () => {
  const first = dualMachineConfig(source, "worker", "7812595b294778");
  const target = dualMachineConfig(source, "shared", "7812595b294778");
  assert.equal(first.match(/cpu_kind = 'performance'/g).length, 2);
  assert.equal(target.match(/cpu_kind = 'shared'/g).length, 1);
  assert.equal(target.match(/memory_mb = 8192/g).length, 2);
  assert.equal(first.match(/MANHUA_HEAVY_WORKER_SPLIT=1/g).length, 2);
  assert.ok(target.includes("processes = ['app']\n  # Fly 平台"));
  assert.ok(target.includes("destination = '/data'\n  processes = ['app']"));
  assert.equal(
    readFileSync(new URL("../fly.toml", import.meta.url), "utf8"),
    source
  );
});
test("unknown machines, Tokyo machine, stage and changed topology are rejected", () => {
  assert.throws(() => dualMachineConfig(source, "worker", "891e455b424608"));
  assert.throws(() => dualMachineConfig(source, "deploy", "7812595b294778"));
  assert.throws(() =>
    dualMachineConfig(
      source.replace("memory = '8gb'", "memory = '4gb'"),
      "shared",
      "7812595b294778"
    )
  );
});
