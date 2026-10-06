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

test("正式配置绑定同一工作机并保留网站与工作机的职责和内存", () => {
  const app = source.match(/^  app = "(.*)"$/m)[1];
  const rig = source.match(/^  rig = "(.*)"$/m)[1];
  for (const command of [app, rig]) {
    assert.equal((command.match(/MANHUA_HEAVY_WORKER_SPLIT=1/g) || []).length, 1);
    assert.equal((command.match(/MANHUA_HEAVY_MACHINE_ID=7812595b294778/g) || []).length, 1);
  }
  assert.ok(rig.includes("JOB_WORKER_ROLE=rig"));
  assert.ok(rig.includes("DISABLE_GROWTH_TREND_SCHEDULER=1"));
  const vms = [...source.matchAll(/\[\[vm\]\]([\s\S]*?)(?=\n\[|$)/g)].map(x => x[1]);
  assert.equal(vms.length, 2);
  assert.match(vms.find(x => x.includes("['app']")), /cpu_kind = 'shared'\n  cpus = 4/);
  assert.match(vms.find(x => x.includes("['rig']")), /cpu_kind = 'performance'\n  cpus = 2/);
  for (const vm of vms) assert.match(vm, /memory_mb = 8192/);
  assert.match(source, /\[http_service\][\s\S]*?processes = \['app'\]/);
  assert.match(source, /\[\[mounts\]\]\n  source = 'growth_data'\n  destination = '\/data'\n  processes = \['app'\]/);
});

test("生成器支持未配置或已配置输入，重复生成不重复插入分流参数", () => {
  const legacy = source.replace(/MANHUA_HEAVY_WORKER_SPLIT=1 /g, "").replace(/MANHUA_HEAVY_MACHINE_ID=7812595b294778 /g, "");
  const first = dualMachineConfig(legacy, "shared", "7812595b294778");
  const second = dualMachineConfig(first, "shared", "7812595b294778");
  for (const output of [first, second]) {
    assert.equal((output.match(/MANHUA_HEAVY_WORKER_SPLIT=1/g) || []).length, 2);
    assert.equal((output.match(/MANHUA_HEAVY_MACHINE_ID=7812595b294778/g) || []).length, 2);
  }
  assert.throws(() => dualMachineConfig(source.replace(/7812595b294778/g, "891e455b424608"), "shared", "7812595b294778"), /different heavy machine/);
  assert.throws(() => dualMachineConfig(source.replace(/^  rig = .*\n/m, ""), "shared", "7812595b294778"), /topology changed/);
});
