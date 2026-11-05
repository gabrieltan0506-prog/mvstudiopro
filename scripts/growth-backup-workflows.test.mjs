import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { restoreGrowthArchive } from "../shared/growthArchiveRestore.mjs";
const sha = b => createHash("sha256").update(b).digest("hex");
const workflows = [
  ".github/workflows/growth-backup.yml",
  ".github/workflows/growth-archive-offload.yml",
];
function step(text, name) {
  const body = text.split(`      - name: ${name}\n`)[1]?.split("\n      - ")[0];
  assert(body, `step ${name}`);
  return body.split("        run: |\n")[1].replace(/^ {10}/gm, "");
}
function executable(file, text) {
  fs.writeFileSync(file, text, { mode: 0o755 });
}
for (const workflow of workflows)
  test(`${workflow}: actual snapshot → plan → bundle → publication → restore, mixed bad buckets preserved`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "growth-workflow-"));
    const source = path.join(root, "source"),
      archive = path.join(source, "archive"),
      out = path.join(root, "offload"),
      backup = path.join(root, "backup"),
      bin = path.join(root, "bin"),
      remote = path.join(root, "remote");
    for (const d of [archive, out, backup, bin, remote])
      fs.mkdirSync(d, { recursive: true });
    fs.mkdirSync(path.join(remote, "growth-cold-store-latest"));
    fs.writeFileSync(path.join(backup, "storage.env"), "SHOULD_OFFLOAD=true\n");
    const dirs = Array.from(
        { length: 10 },
        (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}-00`
      ),
      before = new Map();
    for (const [i, d] of dirs.entries()) {
      fs.mkdirSync(path.join(archive, d));
      if (i === 0) continue;
      for (const platform of ["bilibili", "douyin", "xiaohongshu", "weixin_channels", "tiktok", "kuaishou", "toutiao", "unidentified"]) {
        const file = path.join(archive, d, `${platform}-data.json.gz`);
        let raw = gzipSync(
          JSON.stringify({ items: i === 7 ? [] : [{ id: `${platform}-${i}` }] })
        );
        if (platform === "bilibili" && [2, 3].includes(i))
          raw = Buffer.alloc(0);
        if (platform === "bilibili" && i === 4) raw = Buffer.from("bad-gzip");
        if (platform === "bilibili" && i === 5) raw = gzipSync("{broken");
        fs.writeFileSync(file, raw);
        before.set(file, sha(raw));
      }
    }
    executable(
      path.join(bin, "flyctl"),
      `#!/usr/bin/env node
const fs=require('fs'),{spawnSync}=require('child_process');const a=process.argv.slice(2),cmd=a[a.indexOf('-C')+1];fs.appendFileSync(process.env.TEST_CALLS,cmd+'\\n');if(!cmd.startsWith('sh -s -- '))throw Error('unexpected Fly command');const r=spawnSync('sh',['-c',cmd],{input:fs.readFileSync(0),env:process.env});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exit(r.status??1);
`
    );
    executable(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n");
    // macOS lacks GNU timeout. The outer spawnSync timeout still bounds this
    // synthetic cleanup; validate the production wrapper arguments explicitly.
    executable(path.join(bin, "timeout"), '#!/bin/sh\n[ "$1" = "--kill-after=5s" ] && [ "$2" = "60s" ] || exit 99\nshift 2\nexec "$@"\n');
    executable(
      path.join(bin, "stat"),
      `#!/usr/bin/env node
if(process.argv[2]!=='-c%s')process.exit(99);console.log(require('fs').statSync(process.argv[3]).size);
`
    );
    executable(
      path.join(bin, "gh"),
      `#!/usr/bin/env node
const fs=require('fs'),path=require('path'),crypto=require('crypto');const a=process.argv.slice(2),root=process.env.TEST_REMOTE,sha=b=>crypto.createHash('sha256').update(b).digest('hex');const tags=fs.readdirSync(root).sort();const assets=tag=>fs.readdirSync(path.join(root,tag)).map(name=>{const b=fs.readFileSync(path.join(root,tag,name));return {name,state:'uploaded',size:b.length,digest:'sha256:'+sha(b)}});
let result='';if(a[0]==='repo')result=JSON.stringify({nameWithOwner:'gabrieltan0506-prog/mvstudiopro-growth-data',isPrivate:true});else if(a[0]==='api'){const e=a.at(-1);if(e.endsWith('releases?per_page=100'))result=JSON.stringify([tags.map((tag_name,id)=>({tag_name,id:id+1}))]);else result=JSON.stringify([assets(tags[Number(e.match(/releases\\/(\\d+)/)[1])-1])]);}
else if(a[0]==='release'){const [_,mode,tag]=a,target=path.join(root,tag);if(mode==='create')fs.mkdirSync(target);else if(mode==='upload'){const [file,name]=a[3].split('#');if(fs.existsSync(path.join(target,name))&&!a.includes('--clobber'))throw Error('immutable conflict');if(a.includes('--clobber')&&!name.endsWith('.latest.json'))throw Error('forbidden overwrite');fs.copyFileSync(file,path.join(target,name));}else if(mode==='download'){const pattern=a[a.indexOf('-p')+1]||a[a.indexOf('--pattern')+1];const dest=a[a.indexOf('-D')+1]||a[a.indexOf('--dir')+1];fs.mkdirSync(dest,{recursive:true});for(const name of fs.readdirSync(target)){if(pattern===name||pattern==='archive-*.manifest.json'&&name.endsWith('.manifest.json'))fs.copyFileSync(path.join(target,name),path.join(dest,name));}}else throw Error('unexpected gh');}else throw Error('unexpected gh');process.stdout.write(result);
`
    );
    const env = {
      ...process.env,
      GH_TOKEN: "synthetic-backup-token",
      PATH: `${bin}:${process.env.PATH}`,
      GROWTH_STORE_DIR: source,
      GROWTH_INTERACTIVE_FALLBACK_DIR: path.join(root, "interactive"),
      TEST_REMOTE: remote,
      TEST_CALLS: path.join(root, "calls"),
      FLY_MACHINE_ID: "synthetic",
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_STEP_SUMMARY: path.join(root, "summary"),
      GITHUB_SHA: "fixture",
      COPYFILE_DISABLE: "1",
    };
    const text = fs.readFileSync(workflow, "utf8");
    assert(!text.includes("sh -s -- delete"));
    assert(!text.includes("growth-release-headroom.sh"));
    for (const name of [
      "Create leased archive snapshot on Fly",
      "Plan bounded incremental archive batch",
      "Download and verify archive bundles locally",
      "Publish and read back archive bundles",
    ]) {
      const script = step(text, name)
        .replaceAll("/tmp/growth-archive-offload", out)
        .replaceAll("/tmp/growth-backup", backup);
      const result = spawnSync("bash", ["-eo", "pipefail", "-c", script], {
        env,
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });
      assert.equal(
        result.status,
        0,
        `${name}\n${result.stdout}\n${result.stderr}`
      );
    }
    const report = JSON.parse(
      fs.readFileSync(path.join(out, "source-inventory.json"))
    );
    assert.equal(report.anomalies.length, 4);
    assert.equal(report.excluded.length, 14);
    assert.equal(report.uncovered.length, 7);
    assert(report.excluded.every(row => /^(kuaishou|toutiao)-/.test(row.path)));
    assert(report.uncovered.every(row => row.path === "unidentified-data.json.gz"));
    const uploaded = JSON.parse(
      fs.readFileSync(path.join(out, "publication-result.json"))
    );
    assert.deepEqual(
      uploaded.uploaded.map(x => x.dir),
      [dirs[1], dirs[6], dirs[7]]
    );
    assert.equal(uploaded.sourceDeletionAuthorized, false);
    for (const { dir } of uploaded.uploaded) {
      const restored = await restoreGrowthArchive({
        dir: dir,
        cacheRoot: path.join(root, "restore"),
        fetchAsset: async (name, legacyOnly = false, releaseTag) => {
          const tag =
            releaseTag ||
            (legacyOnly
              ? "growth-cold-store-latest"
              : `growth-archive-${dir.slice(0, 10)}`);
          const file = path.join(remote, tag, name);
          return fs.existsSync(file)
            ? new Response(fs.readFileSync(file))
            : new Response("", { status: 404 });
        },
      });
      assert(restored);
      assert.equal(
        fs.readdirSync(restored).filter(n => n.endsWith(".json.gz")).length,
        5
      );
      assert.deepEqual(fs.readdirSync(restored).sort(), ["bilibili", "douyin", "xiaohongshu", "weixin_channels", "tiktok"].map(p => `${p}-data.json.gz`).sort());
    }
    assert(fs.existsSync(path.join(out, "UPLOAD_VERIFIED")));
    assert(!fs.existsSync(path.join(out, "DELETE_READY")));
    for (const [file, digest] of before)
      assert.equal(sha(fs.readFileSync(file)), digest);
    assert(fs.existsSync(path.join(archive, dirs[0])));
    const cleanup = step(text, "Always release archive hardlink snapshot")
      .replaceAll("/tmp/growth-archive-offload", out);
    const cleaned = spawnSync("bash", ["-eo", "pipefail", "-c", cleanup], { env, encoding: "utf8", timeout: 10000 });
    assert.equal(cleaned.status, 0, cleaned.stderr);
    const batch = fs.readFileSync(path.join(out, "batch-id.txt"), "utf8").trim();
    assert(!fs.existsSync(path.join(source, "backups/archive-offload", batch)), cleaned.stdout + cleaned.stderr);
    for (const [file, digest] of before) assert.equal(sha(fs.readFileSync(file)), digest);
    console.log(
      JSON.stringify({
        workflow,
        healthy: 3,
        anomalous: 4,
        zeroFiles: 2,
        sourceFilesPreserved: before.size,
        restoredFiles: 15,
        excluded: report.excluded.length,
        uncovered: report.uncovered.length,
        ownedSnapshotRemoved: true,
      })
    );
  });

test("archive cleanup rejects unowned snapshots, parent links, legacy current bypass and occupied lease", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "growth-cleanup-safety-"));
  const source = path.join(root, "source"), batch = "123-1", bin = path.join(root, "bin");
  const target = path.join(source, "backups/archive-offload", batch);
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(bin);
  executable(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n");
  fs.writeFileSync(path.join(target, "evidence"), "must-remain");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GROWTH_STORE_DIR: source,
    GROWTH_INTERACTIVE_FALLBACK_DIR: path.join(root, "interactive") };
  const run = mode => spawnSync("sh", ["scripts/growth-archive-offload-remote.sh", mode, batch], { env, encoding: "utf8", timeout: 10000 });
  let result = run("cleanup");
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(path.join(target,"evidence"),"utf8"), "must-remain");
  fs.writeFileSync(path.join(target,".snapshot-owner.json"), JSON.stringify({ schemaVersion:1,batchId:batch,kind:"archive-hardlink-snapshot" }));
  fs.writeFileSync(path.join(source,".growth-platform-collection.lock"), "another-owner");
  result = run("cleanup");
  assert.equal(result.status, 43);
  assert.equal(fs.readFileSync(path.join(source,".growth-platform-collection.lock"),"utf8"), "another-owner");
  fs.unlinkSync(path.join(source,".growth-platform-collection.lock"));
  const current = path.join(source,"backups/current-batches",batch);
  fs.mkdirSync(current,{recursive:true});
  fs.writeFileSync(path.join(current,"evidence"),"preserve");
  assert.equal(run("cleanup-current-batch").status,64);
  assert(fs.existsSync(path.join(current,"evidence")));
  fs.renameSync(path.join(source,"backups"),path.join(root,"outside"));
  fs.symlinkSync(path.join(root,"outside"),path.join(source,"backups"));
  result=run("cleanup");
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/archive_snapshot_path_type_invalid/);
  assert(fs.existsSync(path.join(root,"outside/archive-offload",batch,"evidence")));
});
