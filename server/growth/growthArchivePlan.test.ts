import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planArchiveBatch, writeArchivePlan } from "../../scripts/growth-archive-plan.mjs";
const sha = (raw: string) => createHash("sha256").update(raw).digest("hex");
function fixture(dir = "2026-09-01-00") {
  const body = "真实归档字节",
    fingerprint = "a".repeat(64);
  const archive = {
    assetName: `archive-${dir}.tar.gz`,
    bytes: Buffer.byteLength(body),
    sha256: sha(body),
  };
  const manifest = {
    schemaVersion: 1,
    dir,
    sourceFingerprint: fingerprint,
    archive,
    parts: [{ ...archive, index: 0 }],
  };
  const raw = JSON.stringify(manifest),
    name = `archive-${dir}.manifest.json`;
  const asset = (name: string, bytes: number, digest: string) => ({
    name,
    size: bytes,
    digest: `sha256:${digest}`,
    state: "uploaded",
  });
  return {
    row: `${dir}\t${fingerprint}\t100\n`,
    manifest,
    name,
    raw,
    assets: [
      asset(name, Buffer.byteLength(raw), sha(raw)),
      asset(archive.assetName, archive.bytes, archive.sha256),
    ],
  };
}
describe("归档断点规划", () => {
  it("发布凭证与资产摘要一致才跳过；变化目录重新备份", () => {
    const f = fixture();
    expect(
      planArchiveBatch(f.row, f.assets, new Map([[f.name, f.raw]]))
    ).toMatchObject({ reused: 1, selected: [], reclaim: [], remaining: 0 });
    expect(
      planArchiveBatch(
        f.row.replace("a".repeat(64), "b".repeat(64)),
        f.assets,
        new Map([[f.name, f.raw]])
      )
    ).toMatchObject({ reused: 0, reclaim: [], pending: 1 });
  });
  it.each([
    "missing",
    "corrupt",
    "legacy",
    "payload-missing",
    "payload-changed",
    "manifest-changed",
  ])("%s 不允许冒充已备份", mode => {
    const f = fixture();
    let raw = f.raw;
    if (mode === "missing") raw = "";
    if (mode === "corrupt") raw = "{broken";
    if (mode === "legacy")
      raw = JSON.stringify({ ...f.manifest, sourceFingerprint: undefined });
    if (mode === "payload-missing") f.assets.pop();
    if (mode === "payload-changed")
      f.assets[1].digest = `sha256:${"b".repeat(64)}`;
    if (mode === "manifest-changed") f.assets[0].digest = "";
    expect(
      planArchiveBatch(f.row, f.assets, new Map([[f.name, raw]]))
    ).toMatchObject({ reused: 0, reclaim: [], pending: 1 });
  });
  it("大积压分批，下一轮靠已发布凭证向前推进", () => {
    const fixtures = Array.from({ length: 30 }, (_, i) =>
      fixture(`2026-09-${String(i + 1).padStart(2, "0")}-00`)
    );
    const snapshot = fixtures.map(f => f.row).join("");
    const first = planArchiveBatch(snapshot, [], new Map());
    expect(first).toMatchObject({ reused: 0, pending: 30, remaining: 18 });
    expect(first.selected).toHaveLength(12);
    const second = planArchiveBatch(
      snapshot,
      fixtures.slice(0, 12).flatMap(f => f.assets),
      new Map(fixtures.slice(0, 12).map(f => [f.name, f.raw]))
    );
    expect(second).toMatchObject({ reused: 12, pending: 18, remaining: 6 });
    expect(second.selected[0]).toContain("2026-09-13-00");
  });
  it("数据量也有上限，超大单目录不被永久饿死", () => {
    const f = fixture();
    const big = f.row.replace("\t100\n", "\t800000000\n");
    expect(
      planArchiveBatch(big + fixture("2026-09-02-00").row, [], new Map())
        .selected
    ).toHaveLength(1);
  });
  it("缺少逐文件清单的已备份目录只计复用，不产生清理候选", () => {
    const f=fixture();
    const plan=planArchiveBatch(f.row,f.assets,new Map([[f.name,f.raw]]));
    expect(plan).toMatchObject({reused:1,reclaim:[],reclaimRemaining:0,selected:[]});
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"growth-retain-test-"));
    try {
      writeArchivePlan(root,plan);
      expect(fs.existsSync(path.join(root,"EMPTY"))).toBe(true);
      expect(fs.readFileSync(path.join(root,"reclaim.tsv"),"utf8")).toBe("");
    } finally {fs.rmSync(root,{recursive:true,force:true});}
  });
  it("非法路径/指纹/空字节数中止而非静默过滤", () => {
    for (const row of ["../bad\tx\t1", `ok\t${"a".repeat(64)}\t`, ""]) {
      if (row) expect(() => planArchiveBatch(row, [], new Map())).toThrow();
    }
  });
});

function completeFixture(dir = "2026-09-01-00", bytes = 100) {
  const f = fixture(dir);
  const inventory = [{path:"bilibili-feed+bilibili_ranking.json.gz",bytes,sha256:sha("source"),items:1}];
  const fingerprint = sha(JSON.stringify(inventory.map(row=>[row.path,row.bytes,row.sha256])));
  const manifest = {...f.manifest,sourceFingerprint:fingerprint,inventory};
  const raw = JSON.stringify(manifest,null,"\t");
  return {...f,manifest,raw,row:`${dir}\t${fingerprint}\t${bytes}\n`,assets:[
    {...f.assets[0],size:Buffer.byteLength(raw),digest:`sha256:${sha(raw)}`},f.assets[1]],fingerprint};
}
it("完整同源复用桶形成独立清理包，原始manifest字节保留且不新上传",()=>{
  const f=completeFixture(), plan=planArchiveBatch(f.row,f.assets,new Map([[f.name,f.raw]]));
  expect(plan.selected).toEqual([]);expect(plan.reclaim).toHaveLength(1);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"growth-reuse-cleanup-"));
  try {
    fs.writeFileSync(path.join(root,"batch-id.txt"),"123-1-backup");
    writeArchivePlan(root,plan);
    expect(fs.existsSync(path.join(root,"EMPTY"))).toBe(false);
    expect(fs.existsSync(path.join(root,"UPLOAD_EMPTY"))).toBe(true);
    const input=JSON.parse(fs.readFileSync(path.join(root,"reused-cleanup-input.json"),"utf8"));
    expect(input.batch.archives).toEqual([{dir:f.manifest.dir,releaseTag:"growth-archive-2026-09-01",sourceFingerprint:f.fingerprint}]);
    expect(input.publication.reused).toEqual([{dir:f.manifest.dir,releaseTag:"growth-archive-2026-09-01"}]);
    expect(Buffer.from(input.manifests[f.name],"base64").toString()).toBe(f.raw);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
it("复用清理最多四桶及512MiB，不影响原上传选择",()=>{
  const fsx=Array.from({length:7},(_,i)=>completeFixture(`2026-09-${String(i+1).padStart(2,"0")}-00`,i===0?600*1024*1024:100*1024*1024));
  const plan=planArchiveBatch(fsx.map(f=>f.row).join(""),fsx.flatMap(f=>f.assets),new Map(fsx.map(f=>[f.name,f.raw])));
  expect(plan.reused).toBe(7);expect(plan.selected).toEqual([]);expect(plan.reclaim).toHaveLength(4);expect(plan.reclaimRemaining).toBe(3);
  expect(plan.reclaim[0]).toContain("2026-09-02-00");
});
it("清单源hash不匹配或部件不在同一release时不生成清理候选",()=>{
  const f=completeFixture();
  const wrong={...f.manifest,inventory:f.manifest.inventory.map(row=>({...row,sha256:sha("other")}))};
  const raw=JSON.stringify(wrong);
  const assets=[{...f.assets[0],size:Buffer.byteLength(raw),digest:`sha256:${sha(raw)}`},f.assets[1]];
  expect(planArchiveBatch(f.row,assets,new Map([[f.name,raw]])).reclaim).toEqual([]);
  expect(planArchiveBatch(f.row,[f.assets[0],{...f.assets[1],releaseTag:"growth-cold-store-latest"}],new Map([[f.name,f.raw]])).reclaim).toEqual([]);
});

it("修订复用只有当前指针指向同一完整清单才进入清理候选",()=>{
  const f=completeFixture();
  const releaseTag=`growth-archive-revision-${f.manifest.dir}-${f.fingerprint}`;
  const assets=f.assets.map(asset=>({...asset,releaseTag}));
  const manifests=new Map([[f.name,f.raw]]);
  expect(planArchiveBatch(f.row,assets,manifests).reclaim).toEqual([]);
  const raw=JSON.stringify({schemaVersion:1,dir:f.manifest.dir,releaseTag,
    manifest:{assetName:f.name,bytes:Buffer.byteLength(f.raw),sha256:sha(f.raw)}},null,2);
  const pointer={name:`archive-${f.manifest.dir}.latest.json`,size:Buffer.byteLength(raw),
    digest:`sha256:${sha(raw)}`,state:"uploaded",releaseTag:"growth-archive-2026-09-01"};
  expect(planArchiveBatch(f.row,[...assets,pointer],manifests).reclaim).toHaveLength(1);
  expect(planArchiveBatch(f.row,[...assets,{...pointer,digest:`sha256:${sha("stale")}`}],manifests).reclaim).toEqual([]);
});
