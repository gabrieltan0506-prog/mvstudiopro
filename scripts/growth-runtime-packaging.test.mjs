import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";

// Fly uses the source tree with node --import tsx (not a bundled dist entry).
// Recreate that layout in a new root, so accidental repository-cwd resolution fails.
test("Fly source-layout runtime loads both new modules and executes the shipped Python validator", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "growth-runtime-layout-")
  );
  const repository = process.cwd();
  try {
    const dockerfile = await fs.readFile(
      path.join(repository, "Dockerfile"),
      "utf8"
    );
    const fly = await fs.readFile(path.join(repository, "fly.toml"), "utf8");
    const pkg = JSON.parse(
      await fs.readFile(path.join(repository, "package.json"), "utf8")
    );
    const config = JSON.parse(
      await fs.readFile(path.join(repository, "tsconfig.json"), "utf8")
    );
    assert.match(dockerfile, /COPY \. \./);
    assert.match(dockerfile, /python3/);
    assert.match(
      dockerfile,
      /CMD \["node","--max-old-space-size=6144","--import","tsx","server\/_core\/index.ts"\]/
    );
    assert.match(
      fly,
      /node --max-old-space-size=6144 --import tsx server\/_core\/index.ts/
    );
    assert.equal(pkg.scripts.build, "tsc");
    assert.equal(config.compilerOptions.noEmit, true);
    for (const directory of [
      "shared",
      "scripts",
      "server/_core",
      "source/2026-10-08-16",
    ])
      await fs.mkdir(path.join(root, directory), { recursive: true });
    for (const relative of [
      "shared/growthArchiveRestore.mjs",
      "shared/growthBackupGeneration.mjs",
      "scripts/validate-growth-archive.py",
    ])
      await fs.copyFile(
        path.join(repository, relative),
        path.join(root, relative)
      );
    await fs.symlink(
      path.join(repository, "node_modules"),
      path.join(root, "node_modules")
    );
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ type: "module" })
    );
    await fs.writeFile(
      path.join(root, "source/2026-10-08-16/bilibili-runtime.json.gz"),
      gzipSync(JSON.stringify({ items: [{ id: "runtime-layout" }] }))
    );
    execFileSync(
      "tar",
      [
        "-czf",
        path.join(root, "archive.tar.gz"),
        "-C",
        path.join(root, "source"),
        "2026-10-08-16",
      ],
      { env: { ...process.env, COPYFILE_DISABLE: "1" } }
    );
    const program = `
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { restoreGrowthArchive } from '../../shared/growthArchiveRestore.mjs';
import { loadGrowthBackupGeneration, downloadGrowthBackupGenerationAsset } from '../../shared/growthBackupGeneration.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const root=process.cwd(), dir='2026-10-08-16', raw=await fs.readFile('archive.tar.gz');
const archive={assetName:'archive-'+dir+'.tar.gz',bytes:raw.length,sha256:sha(raw)};
const manifest=Buffer.from(JSON.stringify({schemaVersion:1,dir,archive,parts:[{...archive,index:0}]}));
const restored=await restoreGrowthArchive({dir,cacheRoot:path.join(root,'cache'),fetchAsset:async(name)=>name.endsWith('.latest.json')?new Response('',{status:404}):name.endsWith('.manifest.json')?new Response(manifest):new Response(raw)});
const items=JSON.parse(gunzipSync(await fs.readFile(path.join(restored,'bilibili-runtime.json.gz')))).items;
if(items.length!==1||items[0].id!=='runtime-layout')throw Error('archive runtime mismatch');
const current=gzipSync(JSON.stringify({collections:{bilibili:{items:[{id:'generation-runtime'}]}}}));
const version={schemaVersion:1,batchId:'123-1',releaseTag:'growth-backup-123-1',scope:'synthetic',coverage:{complete:false},files:[{logicalAssetName:'current.json.gz',bytes:current.length,sha256:sha(current),parts:[{assetName:'current.json.gz',index:0,offset:0,bytes:current.length,sha256:sha(current)}]}]};
const versionRaw=Buffer.from(JSON.stringify(version));
const pointer={schemaVersion:1,batchId:'123-1',releaseTag:version.releaseTag,manifest:{assetName:'growth-backup-generation.json',bytes:versionRaw.length,sha256:sha(versionRaw)}};
const baseUrl='https://not-a-real-service.invalid/releases/download/growth-cold-store-latest';
const fetchImpl=async(url)=>url.endsWith('/growth-backup-latest.json')?Response.json(pointer):url.endsWith('/growth-backup-generation.json')?new Response(versionRaw):new Response(current);
const generation=await loadGrowthBackupGeneration(baseUrl,{fetchImpl});
const result=await downloadGrowthBackupGenerationAsset({baseUrl,logicalName:'current.json.gz',cacheDir:path.join(root,'generation-cache'),generation,fetchImpl});
const value=JSON.parse(gunzipSync(await fs.readFile(result.filePath)));
if(value.collections.bilibili.items[0].id!=='generation-runtime')throw Error('generation runtime mismatch');
console.log(JSON.stringify({runtime:'node --import tsx',archiveItems:items.length,generationId:result.generationId,pythonValidatorExecuted:true,relocatedSourceRoot:true}));
`;
    await fs.writeFile(path.join(root, "server/_core/smoke.ts"), program);
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", "server/_core/smoke.ts"],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, NODE_ENV: "production", TSX_DISABLE_CACHE: "1" },
      }
    );
    const result = JSON.parse(output.trim());
    assert.deepEqual(result, {
      runtime: "node --import tsx",
      archiveItems: 1,
      generationId: "123-1",
      pythonValidatorExecuted: true,
      relocatedSourceRoot: true,
    });
    console.log(output.trim());
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
