import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkDeployedGrowthRouting } from "./growth-cold-store-routing-check.mjs";
const repository = "gabrieltan0506-prog/mvstudiopro-growth-data";
const configured = { GROWTH_BACKUP_REPOSITORY: repository, GROWTH_GITHUB_PRIVATE_COLD_STORE_BASE_URL: `https://github.com/${repository}/releases/download/growth-cold-store-latest`, GROWTH_BACKUP_GITHUB_TOKEN: "synthetic-only" };
function step(text, name) {
  const body = text.split(`      - name: ${name}\n`)[1]?.split("\n      - ")[0];
  assert(body, name);
  return body.split("        run: |\n")[1].replace(/^ {10}/gm, "");
}
for (const [key, value, message] of [
  ["GROWTH_BACKUP_GITHUB_TOKEN", "", /token_missing/],
  ["GROWTH_GITHUB_PRIVATE_COLD_STORE_BASE_URL", "", /url_missing/],
  ["GROWTH_GITHUB_PRIVATE_COLD_STORE_BASE_URL", "https://github.com/other/repository/releases/download/growth-cold-store-latest", /url_missing/],
  ["GROWTH_BACKUP_REPOSITORY", "other/repository", /repository_mismatch/],
]) test(`deployed gate rejects ${key} misconfiguration before network`, async () => {
  let calls = 0;
  await assert.rejects(checkDeployedGrowthRouting({ expectedRepository: repository, env: { ...configured, [key]: value }, fetchImpl: async () => { calls++; throw Error("not expected"); } }), message);
  assert.equal(calls, 0);
});
test("deployed gate verifies metadata only; denies 403 and never downloads backup content", async () => {
  const urls = [];
  const result = await checkDeployedGrowthRouting({ expectedRepository: repository, env: configured, fetchImpl: async (url, options) => {
    urls.push(url); assert.equal(options.redirect, "error"); assert.equal(options.headers.Authorization, "Bearer synthetic-only");
    return Response.json(url.endsWith("/releases?per_page=1") ? [] : { full_name: repository, private: true });
  } });
  assert.equal(urls.length, 2); assert(urls.every(u => u.startsWith(`https://api.github.com/repos/${repository}`)));
  assert.equal(result.restoreVerified, false); assert.equal(result.backupContentDownloaded, false);
  await assert.rejects(checkDeployedGrowthRouting({ expectedRepository: repository, env: configured, fetchImpl: async () => new Response(null, { status: 403 }) }), /metadata_unavailable:403/);
});
test("actual cleanup always step calls owned CLI only for matching batch; unrelated target remains untouched", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "growth-wiring-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin"), backup = path.join(root, "backup"), calls = path.join(root, "calls");
  fs.mkdirSync(bin); fs.mkdirSync(backup);
  fs.writeFileSync(path.join(bin,"flyctl"), '#!/usr/bin/env node\nrequire("fs").appendFileSync(process.env.CALLS,JSON.stringify(process.argv.slice(2))+"\\n");\n', {mode:0o755});
  fs.writeFileSync(path.join(bin,"timeout"), '#!/bin/sh\nshift\nshift\nexec "$@"\n', {mode:0o755});
  const source = fs.readFileSync(".github/workflows/growth-backup.yml", "utf8");
  assert.match(source, /name: Always release owned current snapshot\n        timeout-minutes: 2\n        if: always\(\)/);
  const script = step(source,"Always release owned current snapshot").replaceAll("/tmp/growth-backup",backup);
  const env = {...process.env, PATH:`${bin}:${process.env.PATH}`, CALLS:calls, FLY_MACHINE_ID:"synthetic-machine",GITHUB_RUN_ID:"123",GITHUB_RUN_ATTEMPT:"1"};
  const run=()=>spawnSync("bash",["-euo","pipefail","-c",script],{env,encoding:"utf8"});
  assert.equal(run().status,0); assert(!fs.existsSync(calls));
  fs.writeFileSync(path.join(backup,"remote-current-batch-dir.txt"),"/data/growth/backups/current-batches/124-1\n");
  assert.notEqual(run().status,0); assert(!fs.existsSync(calls));
  fs.writeFileSync(path.join(backup,"remote-current-batch-dir.txt"),"/data/growth/backups/current-batches/123-1\n");
  const done=run(); assert.equal(done.status,0,done.stderr);
  const command=JSON.parse(fs.readFileSync(calls,"utf8").trim());
  assert(command.includes("synthetic-machine")); assert.match(command.at(-1),/cleanup-growth-current-snapshot\.mts --batch-id=123-1/);
  assert.doesNotMatch(command.at(-1),/rm -rf|cleanup-current-batch/);
});
for (const file of ["growth-backup.yml","growth-archive-offload.yml"]) test(`${file}: uncovered evidence and shell syntax`, () => {
  const source=fs.readFileSync(`.github/workflows/${file}`,"utf8");
  const snapshot=step(source,"Create leased archive snapshot on Fly");
  assert.match(snapshot,/uncovered\.jsonl/); assert.match(snapshot,/::warning::存在未覆盖文件/);
  assert.match(step(source,"Verify deployed cold-store routing"),/growth-cold-store-routing-check\.mjs/);
  assert(!source.includes("path: /tmp/growth-archive-offload\n"));
  for (const body of source.split("        run: |\n").slice(1)) {
    const script=body.split("\n      - ")[0].replace(/^ {10}/gm,"");
    const result=spawnSync("bash",["-n"],{input:script,encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
  }
});
test("actual deployed gate rejects old deployed checker output and accepts explicit metadata-only readiness",t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"growth-gate-wiring-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,"timeout"),'#!/bin/sh\nshift\nshift\nexec "$@"\n',{mode:0o755});
  fs.writeFileSync(path.join(root,"flyctl"),'#!/usr/bin/env node\nprocess.stdout.write(process.env.GATE_OUTPUT+"\\n");\n',{mode:0o755});
  const script=step(fs.readFileSync('.github/workflows/growth-archive-offload.yml','utf8'),'Verify deployed cold-store routing');
  const env={...process.env,PATH:`${root}:${process.env.PATH}`,FLY_MACHINE_ID:'synthetic',GROWTH_BACKUP_REPOSITORY:repository};
  const run=output=>spawnSync('bash',['-euo','pipefail','-c',script],{env:{...env,GATE_OUTPUT:output},encoding:'utf8'});
  assert.notEqual(run('冷备分仓读取版本已就绪').status,0);
  assert.notEqual(run(JSON.stringify({codeAndConfigurationReady:true,metadataReadable:false,restoreVerified:false})).status,0);
  assert.equal(run(JSON.stringify({codeAndConfigurationReady:true,metadataReadable:true,restoreVerified:false})).status,0);
});
