import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { gzipSync, gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { restoreGrowthArchive, parseGrowthArchiveManifest } from "./growthArchiveRestore.mjs";

const DIR = "2026-10-08-16";
const hash = data => createHash("sha256").update(data).digest("hex");
const roots = [];
test.after(async () => { for (const root of roots) await fs.rm(root, { recursive: true, force: true }); });
async function fixture({ split = false, mode = "valid", legacy = false, pointer = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-restore-test-")); roots.push(root);
  const source = path.join(root, "source");
  await fs.mkdir(path.join(source, DIR), { recursive: true });
  const payload = mode === "zero" ? Buffer.alloc(0) : mode === "bad-gzip" ? Buffer.from("broken") : gzipSync(mode === "bad-json" ? "{" : JSON.stringify({ items: [] }));
  const filename = "bilibili-test.json.gz";
  await fs.writeFile(path.join(source, DIR, filename), payload);
  if (mode === "symlink") await fs.symlink("/outside/evidence", path.join(source, DIR, "link.json.gz"));
  const bundleFile = path.join(root, "bundle.tar.gz");
  execFileSync("tar", ["-czf", bundleFile, "-C", source, DIR], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const raw = await fs.readFile(bundleFile);
  const archive = { assetName: `archive-${DIR}.tar.gz`, bytes: raw.length, sha256: hash(raw) };
  const values = split ? [raw.subarray(0, Math.floor(raw.length/2)), raw.subarray(Math.floor(raw.length/2))] : [raw];
  const parts = values.map((value, index) => ({ assetName: split ? `${archive.assetName}.part-${String(index).padStart(4,"0")}` : archive.assetName, index, bytes: value.length, sha256: hash(value) }));
  const manifest = { schemaVersion: 1, dir: DIR, archive, parts, inventory: [{ path: filename, bytes: payload.length, sha256: hash(payload), items: 0 }] };
  if (legacy || mode !== "valid") delete manifest.inventory;
  const manifestName = `archive-${DIR}.manifest.json`;
  const files = new Map(parts.map((part, i) => [part.assetName, values[i]]));
  files.set(manifestName, Buffer.from(JSON.stringify(manifest)));
  const tag = `growth-archive-revision-${DIR}-${"a".repeat(64)}`;
  if (pointer) files.set(`archive-${DIR}.latest.json`, Buffer.from(JSON.stringify({schemaVersion:1,dir:DIR,releaseTag:tag,manifest:{assetName:manifestName,bytes:files.get(manifestName).length,sha256:hash(files.get(manifestName))}})));
  const calls = [];
  const fetchAsset = async (name, legacyOnly, releaseTag) => {
    calls.push({name,legacyOnly,releaseTag});
    const data = files.get(name);
    return data === undefined ? new Response("missing",{status:404}) : new Response(data);
  };
  return { root, raw, files, manifest, manifestName, archive, fetchAsset, calls, options: {dir:DIR,cacheRoot:path.join(root,"cache"),fetchAsset}, filename, tag };
}

test("multipart restores exact payload and legal empty items through production validator", async () => {
  const f = await fixture({split:true});
  const dir = await restoreGrowthArchive(f.options);
  assert.deepEqual(JSON.parse(gunzipSync(await fs.readFile(path.join(dir,f.filename)))), {items:[]});
  assert.equal(f.calls.filter(c=>c.name.includes(".part-")).length,2);
});
test("single part old manifest remains compatible", async () => {
  const f = await fixture({legacy:true});
  const dir = await restoreGrowthArchive(f.options);
  assert.ok(await fs.stat(path.join(dir,f.filename)));
});
test("unmanifested legacy requires legacy-only fetch and strict validation", async () => {
  const f = await fixture({legacy:true}); f.files.delete(f.manifestName);
  assert.ok(await restoreGrowthArchive(f.options));
  assert.equal(f.calls.find(c=>c.name===f.archive.assetName).legacyOnly,true);
});
test("corrupted cache is retained and rebuilt, never trusted for existence", async () => {
  const f = await fixture(); const dir = await restoreGrowthArchive(f.options);
  await fs.writeFile(path.join(dir,f.filename),"damaged");
  assert.equal(await restoreGrowthArchive(f.options),dir);
  assert.deepEqual(JSON.parse(gunzipSync(await fs.readFile(path.join(dir,f.filename)))),{items:[]});
  assert.ok((await fs.readdir(path.dirname(dir))).some(n=>n.startsWith("contents.invalid-")));
});
test("same-process concurrent restores share one acquisition", async () => {
  const f = await fixture({split:true});
  const [a,b] = await Promise.all([restoreGrowthArchive(f.options),restoreGrowthArchive(f.options)]);
  assert.equal(a,b); assert.equal(f.calls.filter(c=>c.name===f.manifestName).length,1);
});
test("another process lock is not stolen", async () => {
  const f = await fixture();
  const lock = path.join(f.options.cacheRoot,"archive-verified",DIR,f.archive.sha256,".restore.lock");
  await fs.mkdir(lock,{recursive:true}); await fs.writeFile(path.join(lock,"owner"),"other");
  await assert.rejects(restoreGrowthArchive(f.options),/restore_busy/);
  assert.equal(await fs.readFile(path.join(lock,"owner"),"utf8"),"other");
});
for (const mode of ["zero","bad-gzip","bad-json","symlink"]) test(`rejects ${mode} without returning a restored directory`,async()=>{
  const f=await fixture({mode}); await assert.rejects(restoreGrowthArchive(f.options));
  const root=path.join(f.options.cacheRoot,"archive-verified",DIR,f.archive.sha256);
  await assert.rejects(fs.stat(path.join(root,"contents")),{code:"ENOENT"});
});
test("part mismatch leaves source fixture unchanged and can retry",async()=>{
  const f=await fixture({split:true}); const name=f.manifest.parts[1].assetName, original=f.files.get(name);
  f.files.set(name,Buffer.from("truncated"));
  await assert.rejects(restoreGrowthArchive(f.options),/part_mismatch/);
  f.files.set(name,original); assert.ok(await restoreGrowthArchive(f.options));
});
test("manifest inventory mismatch blocks extraction",async()=>{
  const f=await fixture();f.manifest.inventory[0].sha256="f".repeat(64);f.files.set(f.manifestName,Buffer.from(JSON.stringify(f.manifest)));
  await assert.rejects(restoreGrowthArchive(f.options),/inventory_mismatch/);
});
test("revision pointer binds exact manifest and parts release",async()=>{
  const f=await fixture({pointer:true,split:true});assert.ok(await restoreGrowthArchive(f.options));
  assert.ok(f.calls.filter(c=>c.name!==`archive-${DIR}.latest.json`).every(c=>c.releaseTag===f.tag));
});
test("broken revision pointer cannot fall back to canonical",async()=>{
  const f=await fixture({pointer:true});f.files.set(f.manifestName,Buffer.from("{}"));
  await assert.rejects(restoreGrowthArchive(f.options),/pointer_manifest_mismatch/);
  assert.equal(f.calls.filter(c=>c.name===f.archive.assetName).length,0);
});
test("authorization/network error cannot be interpreted as missing pointer",async()=>{
  const f=await fixture();let calls=0;
  await assert.rejects(restoreGrowthArchive({...f.options,fetchAsset:async()=>{calls++;return new Response("denied",{status:403});}}),/pointer_fetch:403/);
  assert.equal(calls,1);
});
test("multipart parser rejects duplicate, wrong index, total and traversal",async()=>{
  const f=await fixture({split:true});
  for(const mutate of [m=>m.parts[1].index=0,m=>m.parts[1].assetName="../escape",m=>m.parts[1].bytes++,m=>m.parts=[]]) {
    const m=structuredClone(f.manifest);mutate(m);assert.throws(()=>parseGrowthArchiveManifest(m,DIR),/manifest_invalid/);
  }
});
test("lost lease refuses commit and leaves the new owner untouched",async()=>{
  const f=await fixture();const lock=path.join(f.options.cacheRoot,"archive-verified",DIR,f.archive.sha256,".restore.lock");
  const original=f.fetchAsset;
  const fetchAsset=async(name,legacy,tag)=>{
    const response=await original(name,legacy,tag);
    if(name===f.archive.assetName) await fs.writeFile(path.join(lock,"owner"),"replacement-owner");
    return response;
  };
  await assert.rejects(restoreGrowthArchive({...f.options,fetchAsset}),/lease_lost/);
  assert.equal(await fs.readFile(path.join(lock,"owner"),"utf8"),"replacement-owner");
  await assert.rejects(fs.stat(path.join(path.dirname(lock),"contents")),{code:"ENOENT"});
});
test("whole archive hash is checked after valid parts are assembled",async()=>{
  const f=await fixture({split:true});f.manifest.archive.sha256="f".repeat(64);f.files.set(f.manifestName,Buffer.from(JSON.stringify(f.manifest)));
  await assert.rejects(restoreGrowthArchive(f.options),/reassembly_mismatch/);
});
test("stream interruption leaves no committed contents and retry uses retained valid parts",async()=>{
  const f=await fixture({split:true});let interrupted=false;
  const fetchAsset=async(name,legacy,tag)=>{
    if(name===f.manifest.parts[1].assetName&&!interrupted){interrupted=true;return new Response(new ReadableStream({start(controller){controller.error(Error("synthetic disconnect"));}}));}
    return f.fetchAsset(name,legacy,tag);
  };
  await assert.rejects(restoreGrowthArchive({...f.options,fetchAsset}),/synthetic disconnect/);
  assert.ok(await restoreGrowthArchive({...f.options,fetchAsset}));
  assert.equal(f.calls.filter(c=>c.name===f.manifest.parts[0].assetName).length,1);
});
