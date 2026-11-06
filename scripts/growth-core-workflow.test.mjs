import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { spawnSync, execFileSync } from "node:child_process";

const repo = process.cwd();
const sha = raw => createHash("sha256").update(raw).digest("hex");
// Execute the actual YAML run block. No copied workflow logic is maintained here.
function fetchStep() {
  const yaml = fs.readFileSync(path.join(repo, ".github/workflows/growth-backup.yml"), "utf8");
  const label = "      - name: Fetch growth store files from Fly\n";
  const start = yaml.indexOf(label);
  assert(start >= 0, "production fetch step must exist");
  const end = yaml.indexOf("\n      - ", start + label.length);
  const block = yaml.slice(start, end < 0 ? undefined : end);
  const marker = "        run: |\n";
  assert(block.includes(marker));
  return block.slice(block.indexOf(marker) + marker.length).split("\n").filter(line => !/^ {0,9}#/.test(line)).map(line => {
    assert(!line || line.startsWith("          "), "unexpected YAML run indentation");
    return line.slice(10);
  }).join("\n");
}
function executable(file, code) { fs.writeFileSync(file, code, { mode: 0o755 }); }

function prepare() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "growth-core-workflow-"));
  const source = path.join(root, "fly-data"), output = path.join(root, "runner-backup"), bin = path.join(root, "bin");
  for (const dir of [source, output, bin, path.join(source, "platform-current"), path.join(source, "platforms"), path.join(source, "history-ledger"), path.join(source, "backups"), path.join(source, "runtime-interactive-workloads")]) fs.mkdirSync(dir, { recursive: true });
  const platforms = ["douyin", "xiaohongshu", "bilibili", "weixin_channels", "kuaishou", "toutiao"];
  for (const p of platforms) {
    fs.writeFileSync(path.join(source, "platform-current", `${p}.current.json.gz`), gzipSync(JSON.stringify({ platform: p, collection: { items: [{ id: `${p}-before` }] } })));
    fs.writeFileSync(path.join(source, "platforms", `${p}.json`), JSON.stringify({ platform: p, items: [{ id: `${p}-directory` }] }));
    fs.writeFileSync(path.join(source, "history-ledger", `${p}.json`), JSON.stringify({ platform: p, ids: [`${p}-history`] }));
  }
  for (const name of ["current.json", "runtime-meta.json", "history-summary.json", "weixin-channels-miner.json", "platform-current-manifest.json", "backups/growth-debug-summary.json"])
    fs.writeFileSync(path.join(source, name), JSON.stringify({ epoch: "before", platforms: {} }));
  fs.writeFileSync(path.join(source, "archive-index.json"), JSON.stringify({
    updatedAt: "2026-11-06T00:00:00.000Z",
    archiveIndex: [{ platform: "bilibili", file: "archive/2026-11-04-15/bilibili.json.gz", itemCount: 1 }],
  }, null, 2) + "\n");
  const paid=path.join(source,"paid-research/guaikei"); fs.mkdirSync(paid,{recursive:true});
  const tiktokId="11111111-1111-4111-8111-111111111111", excludedId="22222222-2222-4222-8222-222222222222";
  fs.writeFileSync(path.join(paid,"index.json"),JSON.stringify({version:1,jobs:[
    {id:tiktokId,input:{platform:"tiktok"},status:"completed",items:[{id:"tiktok-one"}]},
    {id:excludedId,input:{platform:"kuaishou"},status:"completed",items:[{id:"excluded-one"}]},
  ]}));
  fs.writeFileSync(path.join(paid,"automation.json"),JSON.stringify({version:1,runs:[{platform:"tiktok",jobIds:[tiktokId]}]}));
  fs.writeFileSync(path.join(paid,`${tiktokId}.raw.json`),JSON.stringify({errcode:0,data:[{id:"tiktok-one"}]}));
  fs.writeFileSync(path.join(paid,`${tiktokId}.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.normalized.json`),JSON.stringify({items:[{id:"tiktok-one"}]}));
  fs.writeFileSync(path.join(paid,`${excludedId}.raw.json`),"{}");
  fs.writeFileSync(path.join(source,"platforms/._douyin.json"),"AppleDouble metadata");
  fs.mkdirSync(path.join(source, "paid-research"),{recursive:true});
  fs.writeFileSync(path.join(source, "paid-research", "must-remain.json"), '{"private":true}');
  fs.writeFileSync(path.join(output, "storage.env"), "EXTERNALIZE_PLATFORMS=false\nEXTERNALIZE_HISTORY_LEDGER=false\nSHOULD_OFFLOAD=false\n");
  const log = path.join(root, "fly-calls.jsonl");
  executable(path.join(bin, "flyctl"), `#!${process.execPath}\n` + String.raw`
const fs=require("fs"),path=require("path"),zlib=require("zlib"),{spawnSync}=require("child_process");
const args=process.argv.slice(2),source=process.env.TEST_FLY_SOURCE,repo=process.env.TEST_REPO;
fs.appendFileSync(process.env.TEST_FLY_LOG,JSON.stringify(args)+"\n");
if(args[0]==="machines"&&args[1]==="list") { console.log(JSON.stringify([{id:"fixture-app",state:"started"}])); process.exit(0); }
if(args[0]!=="ssh") throw Error("unexpected Fly mutation");
if(args[1]==="sftp"&&args[2]==="get") {
 const [input,output]=args.slice(-2);
 if(!input.startsWith(source+"/backups/current-batches/")) throw Error("live core fetch is not a snapshot:"+input);
 fs.copyFileSync(input,output); process.exit(0);
}
const index=args.indexOf("-C");if(index<0)throw Error("missing remote command");
let command=args[index+1].replaceAll("/app",repo).replaceAll("pnpm exec tsx","node --import tsx").replaceAll("sh -lc","sh -c");
const isSnapshot=command.includes("snapshot-growth-platform-current-batch.mts");
function epoch(value) {
 for(const name of ["current.json","runtime-meta.json","history-summary.json","weixin-channels-miner.json","platform-current-manifest.json","backups/growth-debug-summary.json"]) {
  const file=path.join(source,name);fs.writeFileSync(file+".test-next",JSON.stringify({epoch:value,platforms:{}}));fs.renameSync(file+".test-next",file);
 }
 for(const p of ["douyin","xiaohongshu","bilibili","weixin_channels","kuaishou","toutiao"]) {
  const file=path.join(source,"platform-current",p+".current.json.gz");
  fs.writeFileSync(file+".test-next",zlib.gzipSync(JSON.stringify({platform:p,collection:{items:[{id:p+"-"+value}]}})));fs.renameSync(file+".test-next",file);
  for(const directory of ["platforms","history-ledger"]) {
   const data=path.join(source,directory,p+".json");
   fs.writeFileSync(data+".test-next",JSON.stringify({platform:p,epoch:value,items:[{id:p+"-"+value}]}));fs.renameSync(data+".test-next",data);
  }
 }
}
if(isSnapshot)epoch("snapshot-epoch");
const result=spawnSync("/bin/sh",["-c",command],{env:process.env,stdio:"inherit"});
if(isSnapshot&&result.status===0)epoch("after-snapshot");
process.exit(result.status??1);
`);
  // GNU CLI portability adapters only. Actual hashing, archive creation, JSON and snapshot code run unchanged.
  executable(path.join(bin, "stat"), `#!${process.execPath}\nconst fs=require('fs');const a=process.argv.slice(2);if(a[0]!=='-c%s')throw Error('unexpected stat');console.log(fs.statSync(a[1]).size);\n`);
  executable(path.join(bin, "timeout"), `#!/bin/sh\ncase "$1" in --kill-after=*) shift ;; esac\nshift\nexec "$@"\n`);
  executable(path.join(bin, "sleep"), "#!/bin/sh\nexec /bin/sleep 0.05\n");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, COPYFILE_DISABLE: "1", GROWTH_STORE_DIR: source, GROWTH_INTERACTIVE_FALLBACK_DIR: path.join(root, "no-interactive"), FLY_MACHINE_ID: "fixture-app", FLY_API_TOKEN: "test-not-a-credential", GH_TOKEN: "test-not-a-credential", GITHUB_RUN_ID: "999001", GITHUB_RUN_ATTEMPT: "1", GITHUB_REPOSITORY: "fixture/repo", GITHUB_ENV: path.join(root, "github.env"), GITHUB_STEP_SUMMARY: path.join(root, "summary.md"), TEST_FLY_SOURCE: source, TEST_REPO: repo, TEST_FLY_LOG: log };
  const script = fetchStep().replaceAll("/tmp/growth-backup", output).replaceAll("/data/growth", source).replaceAll("/tmp/acquire-growth-backup-lane.sh", path.join(root, "acquire-lane.sh"));
  const scriptFile = path.join(root, "actual-fetch-step.sh"); fs.writeFileSync(scriptFile, script);
  return { root, source, output, log, env, scriptFile, platforms };
}

test("actual backup YAML snapshots same-generation core and four authorized platforms, verifies parts and builds restorable bundles", { timeout: 60_000 }, t => {
  const fixture = prepare();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const result = spawnSync("/bin/bash", ["-e", "-o", "pipefail", fixture.scriptFile], { cwd: repo, env: fixture.env, encoding: "utf8", timeout: 45_000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.error || ""}\n${result.stderr}\n${result.stdout}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(fixture.output, "platform-current-snapshot-manifest.json")));
  assert.equal(manifest.files.length, 4);
  assert.deepEqual(manifest.excludedPlatforms,["kuaishou","toutiao"]);
  assert.equal(manifest.coreFiles.length, 7);
  for (const file of manifest.coreFiles) {
    const raw = fs.readFileSync(path.join(fixture.output, "store", file.relativePath));
    assert.equal(raw.length, file.bytes); assert.equal(sha(raw), file.sha256);
    if (file.relativePath !== "archive-index.json") assert.equal(JSON.parse(raw).epoch, "snapshot-epoch");
  }
  for (const file of manifest.files) {
    const raw = fs.readFileSync(path.join(fixture.output, "platform-current", file.logicalAssetName));
    assert.equal(sha(raw), file.sha256); assert.equal(raw.length, file.bytes);
    assert.equal(JSON.parse(gunzipSync(raw)).collection.items[0].id, `${file.platform}-snapshot-epoch`);
    for (const part of file.parts) {
      const bytes = fs.readFileSync(path.join(fixture.output, "release-current", part.assetName));
      assert.equal(sha(bytes), part.sha256); assert.equal(bytes.length, part.bytes);
    }
  }
  assert.deepEqual(manifest.directoryRoots,["platforms","history-ledger","paid-research/guaikei"]);
  assert.equal(manifest.directoryFiles.length,12);
  for(const file of manifest.directoryFiles) {
    const raw=fs.readFileSync(path.join(fixture.output,"store",file.relativePath));
    assert.equal(raw.length,file.bytes); assert.equal(sha(raw),file.sha256);
    if (!file.relativePath.startsWith("paid-research/")) assert.equal(JSON.parse(raw).epoch,"snapshot-epoch");
  }
  for(const platform of ["kuaishou","toutiao"]) {
    assert(fs.existsSync(path.join(fixture.source,"platform-current",`${platform}.current.json.gz`)));
    assert(!fs.existsSync(path.join(fixture.output,"platform-current",`platform-current-${platform}.current.json.gz`)));
    for(const directory of ["platforms","history-ledger"]) {
      assert(fs.existsSync(path.join(fixture.source,directory,`${platform}.json`)));
      assert(!fs.existsSync(path.join(fixture.output,"store",directory,`${platform}.json`)));
    }
  }
  const finalized = JSON.parse(fs.readFileSync(path.join(fixture.output, "release-current/platform-current-batch-manifest.json")));
  const bundle = Buffer.concat(finalized.bundle.parts.map(p => {
    const raw = fs.readFileSync(path.join(fixture.output, "release-current", p.assetName));
    assert.equal(sha(raw), p.sha256); return raw;
  }));
  assert.equal(sha(bundle), finalized.bundle.sha256); assert.equal(bundle.length, finalized.bundle.bytes);
  const restored = path.join(fixture.root, "restored-core"); fs.mkdirSync(restored);
  execFileSync("tar", ["-xzf", path.join(fixture.output, "growth-restore-bundle.tar.gz"), "-C", restored]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(restored, "current.json"))).epoch, "snapshot-epoch");
  const indexRaw = fs.readFileSync(path.join(fixture.source, "archive-index.json"));
  assert.deepEqual(fs.readFileSync(path.join(restored, "archive-index.json")), indexRaw);
  assert.equal(finalized.coreFiles.find(file => file.relativePath === "archive-index.json").sha256, sha(indexRaw));
  assert.equal(JSON.parse(indexRaw).archiveIndex[0].itemCount, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.output, "backup-manifest.json"))).totals.archiveRuns, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.source, "current.json"))).epoch, "after-snapshot");
  assert.equal(fs.existsSync(path.join(restored, "platforms/toutiao.json")), false);
  assert.equal(fs.existsSync(path.join(restored, "history-ledger/kuaishou.json")), false);
  const paidRestored=path.join(restored,"paid-research/guaikei");
  assert.equal(fs.readFileSync(path.join(paidRestored,".growth-offline-restore"),"utf8").trim(),"offline-audit-only");
  assert(!fs.existsSync(path.join(fixture.source,"paid-research/guaikei/.growth-offline-restore")));
  const blocked=spawnSync(process.execPath,["--import","tsx","--input-type=module","-e",`
    import assert from 'node:assert/strict';
    import {GuaikeiAutomation} from './server/growth/guaikei/automation.ts';
    import {GuaikeiService} from './server/growth/guaikei/service.ts';
    const root=process.env.RESTORED_PAID_ROOT;
    let requests=0;const service=new GuaikeiService({root,request:async()=>{requests++;throw Error('unexpected request')},ready:()=>true});
    await assert.rejects(new GuaikeiAutomation({root,service}).tick(),/离线还原/);
    await assert.rejects(service.poll(1,'old-job'),/离线还原/);
    await assert.rejects(service.submit(1,{platform:'tiktok',operation:'search',query:'x',limit:1},'new-job',100),/离线还原/);
    assert.equal(requests,0);
  `],{cwd:repo,env:{...fixture.env,RESTORED_PAID_ROOT:paidRestored},encoding:'utf8'});
  assert.equal(blocked.status,0,blocked.stderr);
  const restoredIndex=JSON.parse(fs.readFileSync(path.join(paidRestored,"index.json")));
  assert.equal(restoredIndex.jobs.find(job=>job.input.platform==="tiktok").items[0].id,"tiktok-one");
  assert.equal(JSON.parse(fs.readFileSync(path.join(paidRestored,"11111111-1111-4111-8111-111111111111.raw.json"))).data[0].id,"tiktok-one");
  assert.equal(JSON.parse(fs.readFileSync(path.join(paidRestored,"11111111-1111-4111-8111-111111111111.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.normalized.json"))).items[0].id,"tiktok-one");
  assert.equal(JSON.parse(fs.readFileSync(path.join(paidRestored,"automation.json"))).runs[0].platform,"tiktok");
  assert(!fs.existsSync(path.join(paidRestored,"22222222-2222-4222-8222-222222222222.raw.json")));
  assert.equal(manifest.paidResearch.automaticResumeAllowed,false);
  assert.equal(manifest.paidResearch.sharedLedgersMayContainExcludedPlatformMetadata,true);
  assert.deepEqual(manifest.dataPlatforms,["douyin","xiaohongshu","bilibili","weixin_channels","tiktok"]);
  const coverage = JSON.parse(fs.readFileSync(path.join(fixture.output, "source-coverage.json")));
  assert.equal(coverage.fullStoreComplete, false);
  assert(coverage.uncovered.some(row => row.path === "paid-research/must-remain.json"));
  assert.equal(coverage.excluded.length,7);
  assert.equal(coverage.excludedFilesystemMetadata.length,1);
  assert.equal(fs.existsSync(path.join(fixture.source, "paid-research/must-remain.json")), true);
  assert.equal(fs.existsSync(path.join(fixture.source, ".growth-platform-collection.lock")), false);
  assert.equal(fs.existsSync(path.join(fixture.source, ".growth-store-mutation.lock")), false);
  const calls = fs.readFileSync(fixture.log, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(calls.filter(args => args[1] === "sftp").length, 9); // manifest + seven core files + coverage
  console.log(JSON.stringify({ actualWorkflowStep: "Fetch growth store files from Fly", tiktokItems:manifest.paidResearch.tiktokItems, dataPlatforms:manifest.dataPlatforms, platforms: manifest.files.length, coreFiles: manifest.coreFiles.length, directoryFiles:manifest.directoryFiles.length, excludedPlatforms:manifest.excludedPlatforms, partFiles: manifest.files.reduce((n, f) => n + f.parts.length, 0), bundleParts: finalized.bundle.parts.length, snapshotEpochPreserved: true, sourceStillPresent: true, fullStoreComplete: false }));
});
