import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
const sha = b => createHash("sha256").update(b).digest("hex");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),"growth-owned-cleanup-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,"source.json"),target=path.join(root,"backups/current-batches/123-1"),neighbor=path.join(root,"backups/current-batches/124-1");
  fs.writeFileSync(source,'{"items":[{"id":"must-remain"}]}');
  fs.mkdirSync(target,{recursive:true});fs.mkdirSync(neighbor);
  fs.linkSync(source,path.join(target,"linked.json"));fs.linkSync(source,path.join(neighbor,"neighbor.json"));
  const deadPid=Number(execFileSync(process.execPath,["-e","process.stdout.write(String(process.pid))"],{encoding:"utf8"}));
  fs.writeFileSync(path.join(target,".snapshot-owner.json"),JSON.stringify({schemaVersion:1,batchId:"123-1",pid:deadPid}));
  return {root,source,target,neighbor,hash:sha(fs.readFileSync(source))};
}
function run(f,id="123-1") {
  return spawnSync(process.execPath,["--import","tsx","scripts/cleanup-growth-current-snapshot.mts",`--batch-id=${id}`],{env:{...process.env,GROWTH_STORE_DIR:f.root},encoding:"utf8",timeout:10_000});
}
test("owned failed or complete batch cleanup only unlinks that batch; source and neighboring batch remain byte-identical",t=>{
  const f=fixture(t),result=run(f);assert.equal(result.status,0,result.stderr);assert(!fs.existsSync(f.target));
  assert.equal(sha(fs.readFileSync(f.source)),f.hash);assert.equal(sha(fs.readFileSync(path.join(f.neighbor,"neighbor.json"))),f.hash);
  assert.equal(JSON.parse(result.stdout).sourceDeletionAuthorized,false);
  const again=run(f);assert.equal(again.status,0,again.stderr);assert.equal(JSON.parse(again.stdout).removed,false);
});
for(const kind of ["wrong-batch","wrong-owner","live-owner","symlink-root","symlink-marker"])test(`cleanup retains all data for ${kind}`,t=>{
  const f=fixture(t),marker=path.join(f.target,".snapshot-owner.json");
  if(kind==="wrong-owner")fs.writeFileSync(marker,JSON.stringify({schemaVersion:1,batchId:"other",pid:99999999}));
  if(kind==="live-owner")fs.writeFileSync(marker,JSON.stringify({schemaVersion:1,batchId:"123-1",pid:process.pid}));
  if(kind==="symlink-root"){fs.renameSync(f.target,f.target+"-saved");fs.symlinkSync(f.target+"-saved",f.target);}
  if(kind==="symlink-marker"){fs.renameSync(marker,marker+"-saved");fs.symlinkSync(marker+"-saved",marker);}
  const result=run(f,kind==="wrong-batch"?"123-1/../../source.json":"123-1");
  assert.notEqual(result.status,0);assert.doesNotMatch(result.stderr,/EPERM: operation not permitted.*tsx|ERR_MODULE_NOT_FOUND/);
  assert(fs.existsSync(f.target));assert.equal(sha(fs.readFileSync(f.source)),f.hash);assert.equal(sha(fs.readFileSync(path.join(f.neighbor,"neighbor.json"))),f.hash);
});
