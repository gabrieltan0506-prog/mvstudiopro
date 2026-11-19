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
  assert.match(source, /name: Always release owned current snapshot\n        timeout-minutes: 12\n        if: always\(\)/);
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
  fs.writeFileSync(path.join(root,"flyctl"),'#!/usr/bin/env node\nif(process.argv.at(-1)==="test -r /app/scripts/growth-backup-io.py")process.exit(process.env.MISSING_READER==="1"?1:0);process.stdout.write(process.env.GATE_OUTPUT+"\\n");\n',{mode:0o755});
  const script=step(fs.readFileSync('.github/workflows/growth-archive-offload.yml','utf8'),'Verify deployed cold-store routing');
  const env={...process.env,PATH:`${root}:${process.env.PATH}`,FLY_MACHINE_ID:'synthetic',GROWTH_BACKUP_REPOSITORY:repository};
  const run=(output,missing=false)=>spawnSync('bash',['-euo','pipefail','-c',script],{env:{...env,GATE_OUTPUT:output,MISSING_READER:missing?'1':'0'},encoding:'utf8'});
  assert.notEqual(run('冷备分仓读取版本已就绪').status,0);
  assert.notEqual(run(JSON.stringify({codeAndConfigurationReady:true,metadataReadable:false,restoreVerified:false})).status,0);
  assert.equal(run(JSON.stringify({codeAndConfigurationReady:true,metadataReadable:true,restoreVerified:false})).status,0);
  assert.notEqual(run(JSON.stringify({codeAndConfigurationReady:true,metadataReadable:true,restoreVerified:false}),true).status,0);
});
function shims(t, flyctlExit = 0) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "growth-wiring-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin"), backup = path.join(root, "backup"), archive = path.join(root, "archive"), calls = path.join(root, "calls");
  fs.mkdirSync(bin); fs.mkdirSync(backup); fs.mkdirSync(archive);
  fs.writeFileSync(path.join(bin,"flyctl"), `#!/usr/bin/env node\nrequire("fs").appendFileSync(process.env.CALLS,JSON.stringify(process.argv.slice(2))+"\\n");process.exit(${flyctlExit});\n`, {mode:0o755});
  fs.writeFileSync(path.join(bin,"timeout"), '#!/bin/sh\nshift\nshift\nexec "$@"\n', {mode:0o755});
  const env = {...process.env, PATH:`${bin}:${process.env.PATH}`, CALLS:calls, FLY_MACHINE_ID:"synthetic-machine", GITHUB_RUN_ID:"123", GITHUB_RUN_ATTEMPT:"1", GITHUB_STEP_SUMMARY:path.join(root,"summary.md")};
  const callCount = () => fs.existsSync(calls) ? fs.readFileSync(calls,"utf8").trim().split("\n").length : 0;
  return { root, bin, backup, archive, calls, env, callCount };
}
const redirect = (script, s) => script.replaceAll("/tmp/growth-backup", s.backup).replaceAll("/tmp/growth-archive-offload", s.archive);
test("current release step: already released in the lane → no flyctl call", t => {
  const s = shims(t), script = redirect(step(fs.readFileSync(".github/workflows/growth-backup.yml","utf8"),"Always release owned current snapshot"), s);
  fs.writeFileSync(path.join(s.backup,"remote-current-batch-dir.txt"),"/data/growth/backups/current-batches/123-1\n");
  fs.writeFileSync(path.join(s.backup,"CURRENT_SNAPSHOT_RELEASED"),"");
  const r = spawnSync("bash",["-euo","pipefail","-c",script],{env:s.env,encoding:"utf8"});
  assert.equal(r.status,0,r.stderr); assert.equal(s.callCount(),0);
  assert(!fs.existsSync(path.join(s.backup,"CURRENT_SNAPSHOT_RETAINED")));
});
test("current release step: flyctl failing 3 times → step exits 0, RETAINED marker, exactly 3 owned-CLI calls", t => {
  const s = shims(t, 1), script = redirect(step(fs.readFileSync(".github/workflows/growth-backup.yml","utf8"),"Always release owned current snapshot"), s);
  fs.writeFileSync(path.join(s.backup,"remote-current-batch-dir.txt"),"/data/growth/backups/current-batches/123-1\n");
  const r = spawnSync("bash",["-euo","pipefail","-c",script],{env:{...s.env,GROWTH_SNAPSHOT_RELEASE_WAIT_SECONDS:"0"},encoding:"utf8",timeout:30_000});
  assert.equal(r.status,0,r.stderr); assert.equal(s.callCount(),3);
  assert(fs.existsSync(path.join(s.backup,"CURRENT_SNAPSHOT_RETAINED"))); assert(!fs.existsSync(path.join(s.backup,"CURRENT_SNAPSHOT_RELEASED")));
  for (const line of fs.readFileSync(s.calls,"utf8").trim().split("\n")) assert.match(JSON.parse(line).at(-1),/cleanup-growth-current-snapshot\.mts --batch-id=123-1'$/);
  assert.match(r.stdout,/::warning::/);
});
test("current release step: success on a later attempt marks RELEASED, not RETAINED", t => {
  const s = shims(t), script = redirect(step(fs.readFileSync(".github/workflows/growth-backup.yml","utf8"),"Always release owned current snapshot"), s);
  fs.writeFileSync(path.join(s.bin,"flyctl"), '#!/usr/bin/env node\nconst fs=require("fs");fs.appendFileSync(process.env.CALLS,"x\\n");process.exit(fs.readFileSync(process.env.CALLS,"utf8").split("\\n").length>2?0:1);\n', {mode:0o755});
  fs.writeFileSync(path.join(s.backup,"remote-current-batch-dir.txt"),"/data/growth/backups/current-batches/123-1\n");
  const r = spawnSync("bash",["-euo","pipefail","-c",script],{env:{...s.env,GROWTH_SNAPSHOT_RELEASE_WAIT_SECONDS:"0"},encoding:"utf8",timeout:30_000});
  assert.equal(r.status,0,r.stderr); assert.equal(s.callCount(),2);
  assert(fs.existsSync(path.join(s.backup,"CURRENT_SNAPSHOT_RELEASED"))); assert(!fs.existsSync(path.join(s.backup,"CURRENT_SNAPSHOT_RETAINED")));
});
for (const file of ["growth-backup.yml","growth-archive-offload.yml"]) test(`${file}: final step fails the run when a temporary snapshot was left on Fly`, t => {
  const source = fs.readFileSync(`.github/workflows/${file}`,"utf8");
  assert.match(source, /- name: Fail run when a temporary snapshot was left on Fly\n        if: always\(\)\n/);
  assert(!source.slice(source.indexOf("- name: Fail run when a temporary snapshot was left on Fly")).slice(1).includes("\n      - name:"), "must be the last step");
  for (const marker of [null, "backup/CURRENT_SNAPSHOT_RETAINED", "archive/SNAPSHOT_RETAINED", "both"]) {
    const s = shims(t), script = redirect(step(source,"Fail run when a temporary snapshot was left on Fly"), s);
    assert(!/\/tmp\/growth-(?:backup|archive-offload)\//.test(script));
    if (marker === "both") { fs.writeFileSync(path.join(s.backup,"CURRENT_SNAPSHOT_RETAINED"),""); fs.writeFileSync(path.join(s.archive,"SNAPSHOT_RETAINED"),""); }
    else if (marker) fs.writeFileSync(path.join(s.root,marker),"");
    const r = spawnSync("bash",["-euo","pipefail","-c",script],{env:s.env,encoding:"utf8"});
    assert.equal(r.status, marker ? 1 : 0, `${marker}: ${r.stdout}${r.stderr}`);
    if (marker) { assert.match(r.stdout,/::error::临时快照残留在 Fly/); assert(fs.readFileSync(s.env.GITHUB_STEP_SUMMARY,"utf8").includes("未能从 Fly 删除")); }
    else assert(!fs.existsSync(s.env.GITHUB_STEP_SUMMARY));
    if (marker === "both") assert.match(r.stdout,/current archive/);
  }
});
test("backup lane script: disk full prints GROWTH_BACKUP_DISK_FULL, exits 44 and creates no lock; free space still takes the lock", t => {
  const fetch = step(fs.readFileSync(".github/workflows/growth-backup.yml","utf8"),"Fetch growth store files from Fly");
  const lane = fetch.split("cat >/tmp/acquire-growth-backup-lane.sh <<'SH'\n")[1]?.split("\nSH\n")[0];
  assert(lane && lane.includes("ROOT=/data/growth\n"), "lane heredoc");
  const s = shims(t), store = path.join(s.root,"store"); fs.mkdirSync(store);
  const script = lane.replace("ROOT=/data/growth\n", `ROOT='${store}'\n`);
  assert(!script.includes("/data/growth"));
  fs.writeFileSync(path.join(s.bin,"df"), '#!/bin/sh\necho "Filesystem 1024-blocks Used Available Capacity Mounted on"\necho "/dev/vdb 1000000 1000000 $DF_AVAILABLE 100% /data"\n', {mode:0o755});
  const lock = path.join(store,".growth-platform-collection.lock");
  const run = available => spawnSync("sh",["-s"],{input:script,env:{...s.env,DF_AVAILABLE:available},encoding:"utf8"});
  for (const available of ["0", "1023", "", "n/a"]) {
    const full = run(available);
    assert.equal(full.status,44,`${available}: ${full.stderr}`); assert.match(full.stderr,/^GROWTH_BACKUP_DISK_FULL$/m);
    assert(!fs.existsSync(lock));
  }
  const ok = run("50000000");
  assert.equal(ok.status,0,ok.stderr); assert.equal(fs.readFileSync(lock,"utf8"),"github-growth-backup");
  const busy = run("50000000");
  assert.equal(busy.status,43); assert.match(busy.stderr,/^GROWTH_BACKUP_LANE_BUSY=collection$/m);
  assert.doesNotMatch(busy.stderr,/DISK_FULL/);
});
