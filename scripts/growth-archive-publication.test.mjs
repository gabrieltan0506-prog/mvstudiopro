import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  prepareArchivePublication,
  publishArchiveBatch,
} from "./growth-archive-publish.mjs";
import { planArchiveBatch } from "./growth-archive-plan.mjs";
import {
  growthColdStoreReleaseTag,
  LEGACY_GROWTH_RELEASE,
} from "../shared/growthColdStoreRelease.mjs";

const dir = "2026-09-11-01",
  fingerprint = "a".repeat(64);
const digest = b => createHash("sha256").update(b).digest("hex");
const temp = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "growth-publication-test-"));
// 只在测试专用目录构造数据；网络边界由内存仓模拟，生产脚本保持原样执行。
function fixture(mode = "valid", split = false) {
  const root = temp();
  fs.mkdirSync(path.join(root, "assets"));
  fs.mkdirSync(path.join(root, "source", dir), { recursive: true });
  const payload = gzipSync(JSON.stringify({ items: [{ id: "one" }] }));
  if (mode !== "empty")
    fs.writeFileSync(
      path.join(root, "source", dir, "items.json.gz"),
      mode === "bad-gzip"
        ? Buffer.from("broken")
        : mode === "bad-json"
          ? gzipSync("{broken")
          : mode === "bad-schema"
            ? gzipSync('{"items":null}')
            : payload
    );
  if (mode === "symlink")
    fs.symlinkSync("/etc/passwd", path.join(root, "source", dir, "escape"));
  const name = `archive-${dir}.tar.gz`,
    file = path.join(root, "assets", name);
  execFileSync("tar", ["-czf", file, "-C", path.join(root, "source"), dir], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const raw = fs.readFileSync(file),
    sourceBytes =
      mode === "empty"
        ? 1
        : fs.statSync(path.join(root, "source", dir, "items.json.gz")).size;
  const parts = split
    ? [
        raw.subarray(0, Math.floor(raw.length / 2)),
        raw.subarray(Math.floor(raw.length / 2)),
      ]
    : [raw];
  const partRows = parts.map((b, i) => {
    const n = split ? `${name}.part-${String(i).padStart(4, "0")}` : name;
    fs.writeFileSync(path.join(root, "assets", n), b);
    return [dir, n, b.length, digest(b), name, i].join("\t");
  });
  fs.writeFileSync(path.join(root, "batch-id.txt"), "123-1\n");
  fs.writeFileSync(path.join(root, "assets.tsv"), partRows.join("\n") + "\n");
  fs.writeFileSync(
    path.join(root, "archives.tsv"),
    [
      dir,
      name,
      raw.length,
      digest(raw),
      fingerprint,
      sourceBytes,
      parts.length,
    ].join("\t") + "\n"
  );
  return root;
}
function remote(options = {}) {
  const releases = new Map(),
    calls = [];
  let next = 1;
  function add(tag, name, body) {
    if (!releases.has(tag)) releases.set(tag, { id: next++, files: new Map() });
    releases.get(tag).files.set(name, Buffer.from(body));
  }
  const gh = args => {
    calls.push(args);
    assert(
      !args.includes("--clobber") || args[3].endsWith(".latest.json"),
      "仅最后提交的指针可以替换"
    );
    assert(
      !args.includes("delete") && !args.includes("DELETE"),
      "发布不能删除"
    );
    if (args[0] === "repo")
      return JSON.stringify({
        nameWithOwner: "gabrieltan0506-prog/mvstudiopro-growth-data",
        isPrivate: true,
      });
    if (args[0] === "api") {
      const endpoint = args.at(-1);
      if (endpoint.endsWith("releases?per_page=100"))
        return JSON.stringify([
          [...releases].map(([tag, r]) => ({ tag_name: tag, id: r.id })),
        ]);
      const id = Number(endpoint.match(/releases\/(\d+)\/assets/)[1]);
      const r = [...releases.values()].find(r => r.id === id);
      return JSON.stringify([
        [...r.files].map(([name, b]) => ({
          name,
          state: "uploaded",
          size: b.length,
          digest: options.corruptReadback ? "sha256:" + "0".repeat(64) : `sha256:${digest(b)}`,
        })),
      ]);
    }
    const [_, action, tag] = args;
    if (action === "create") {
      releases.set(tag, { id: next++, files: new Map() });
      return "";
    }
    const r = releases.get(tag);
    if (action === "upload") {
      const [file, name] = args[3].split("#");
      if (options.race && name.endsWith(".tar.gz")) {
        r.files.set(name, Buffer.from("concurrent-original"));
        throw Error("already_exists");
      }
      if (r.files.has(name) && !args.includes("--clobber")) throw Error("already_exists");
      r.files.set(name, fs.readFileSync(file));
      if (options.interrupt && name.endsWith(".tar.gz")) {
        options.interrupt = false;
        throw Error("upload_connection_lost");
      }
      return "";
    }
    if (action === "download") {
      assert.fail("发布阶段不得再次下载备份");
      const name = args[args.indexOf("-p") + 1],
        target = args[args.indexOf("-D") + 1];
      fs.writeFileSync(
        path.join(target, name),
        options.corruptReadback ? Buffer.from("corrupt") : r.files.get(name)
      );
      return "";
    }
    throw Error("unexpected command " + args);
  };
  return { gh, add, releases, calls };
}
const writes = r =>
  r.calls.filter(
    a => a[0] === "release" && ["create", "upload"].includes(a[1])
  );
for (const mode of ["empty", "bad-gzip", "bad-json", "bad-schema", "symlink"])
  test(`发布前拒绝${mode}且零远端写入`, () => {
    const root = fixture(mode),
      r = remote();
    assert.throws(() => publishArchiveBatch(root, r.gh), {
      message: new RegExp(
        {
          empty: "archive_content_empty",
          "bad-gzip": "Not a gzipped file",
          "bad-json": "Expecting property name",
          "bad-schema": "archive_json_invalid",
          symlink: "archive_member_invalid",
        }[mode]
      ),
    });
    assert.equal(r.calls.length, 0);
    assert(!fs.existsSync(path.join(root, "UPLOAD_VERIFIED")));
  });
test("正常归档发布、实际回读、同名完全一致重跑零上传", () => {
  const root = fixture(),
    r = remote();
  publishArchiveBatch(root, r.gh);
  assert(fs.existsSync(path.join(root, "UPLOAD_VERIFIED")));
  const before = writes(r).length;
  publishArchiveBatch(root, r.gh);
  assert.equal(writes(r).length, before);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, "content-validation.json")))[0]
      .files,
    1
  );
  assert.equal(
    fs
      .readFileSync(path.join(root, "verified-assets.tsv"), "utf8")
      .trim()
      .split("\n").length,
    3
  );
});
for (const tag of [
  LEGACY_GROWTH_RELEASE,
  growthColdStoreReleaseTag(`archive-${dir}.tar.gz`),
])
  test(`保留${tag}同名不同内容，另存不可变版本后提交指针`, () => {
    const root = fixture(),
      r = remote(),
      name = `archive-${dir}.tar.gz`;
    r.add(tag, name, "original-valid-backup");
    publishArchiveBatch(root, r.gh);
    assert(writes(r).length > 0);
    assert(r.releases.has(`growth-archive-revision-${dir}-${fingerprint}`));
    assert.equal(
      r.releases.get(tag).files.get(name).toString(),
      "original-valid-backup"
    );
  });
test("manifest冲突保留原件并使用独立revision", () => {
  const root = fixture(),
    r = remote(),
    name = `archive-${dir}.manifest.json`;
  r.add(growthColdStoreReleaseTag(name), name, "old-manifest");
  publishArchiveBatch(root, r.gh);
  assert.equal(
    r.releases.get(growthColdStoreReleaseTag(name)).files.get(name).toString(),
    "old-manifest"
  );
  assert(r.releases.has(`growth-archive-revision-${dir}-${fingerprint}`));
});
test("预检后同名竞态不覆盖且不生成删源凭证", () => {
  const root = fixture(),
    r = remote({ race: true });
  assert.throws(() => publishArchiveBatch(root, r.gh), /already_exists/);
  assert(!fs.existsSync(path.join(root, "UPLOAD_VERIFIED")));
  assert.equal(
    r.releases
      .get(growthColdStoreReleaseTag(`archive-${dir}.tar.gz`))
      .files.get(`archive-${dir}.tar.gz`)
      .toString(),
    "concurrent-original"
  );
});
test("上传成功但回执丢失，下轮复核继续且不重传旧附件", () => {
  const root = fixture(),
    r = remote({ interrupt: true });
  assert.throws(
    () => publishArchiveBatch(root, r.gh),
    /upload_connection_lost/
  );
  assert(!fs.existsSync(path.join(root, "UPLOAD_VERIFIED")));
  publishArchiveBatch(root, r.gh);
  assert.equal(
    r.calls.filter(a => a[1] === "upload" && a[3].endsWith(".tar.gz")).length,
    1
  );
  assert(fs.existsSync(path.join(root, "UPLOAD_VERIFIED")));
});
test("上传metadata不符不能确认成功或生成删源凭证", () => {
  const root = fixture(),
    r = remote({ corruptReadback: true });
  assert.throws(
    () => publishArchiveBatch(root, r.gh),
    /archive_upload_metadata_mismatch/
  );
  assert(!fs.existsSync(path.join(root, "UPLOAD_VERIFIED")));
});
test("分片顺序拼接验证gzip与JSON内容，保持分片删源保护", () => {
  const root = fixture("valid", true),
    r = remote();
  publishArchiveBatch(root, r.gh);
  const m = JSON.parse(
    fs.readFileSync(path.join(root, "assets", `archive-${dir}.manifest.json`))
  );
  assert.equal(m.parts.length, 2);
});
test("分片缺失、摘要变化、源字节不符在发布前拒绝", () => {
  for (const mode of ["missing", "hash", "source"]) {
    const root = fixture(),
      r = remote();
    if (mode === "missing") fs.writeFileSync(path.join(root, "assets.tsv"), "");
    if (mode === "hash")
      fs.appendFileSync(
        path.join(root, "assets", `archive-${dir}.tar.gz`),
        "changed"
      );
    if (mode === "source") {
      const p = path.join(root, "archives.tsv"),
        f = fs.readFileSync(p, "utf8").trim().split("\t");
      f[5] = "999";
      fs.writeFileSync(p, f.join("\t") + "\n");
    }
    assert.throws(
      () => publishArchiveBatch(root, r.gh),
      /archive_(parts_incomplete|part_integrity|source_bytes_mismatch)/
    );
    assert.equal(r.calls.length, 0);
  }
});
test("规划拒绝零内容与旧空目录指纹，保留正常候选", () => {
  const row = n => `${dir}\t${fingerprint}\t${n}\n`;
  assert.equal(planArchiveBatch(row(0), [], new Map()).selected.length, 0);
  assert.equal(
    planArchiveBatch(
      row(4096).replace(fingerprint, digest("[]")),
      [],
      new Map()
    ).selected.length,
    0
  );
  assert.equal(planArchiveBatch(row(100), [], new Map()).selected.length, 1);
});
test("真实remote跳过空目录、嵌套空目录，保留最新两桶与正常资料", () => {
  const root = temp(),
    source = path.join(root, "archive");
  fs.mkdirSync(source);
  for (const d of [
    "2026-09-01-00",
    "2026-09-02-00",
    "2026-09-03-00",
    "2026-09-04-00",
    "2026-09-05-00",
  ])
    fs.mkdirSync(path.join(source, d));
  fs.mkdirSync(path.join(source, "2026-09-02-00", "nested"));
  fs.writeFileSync(
    path.join(source, "2026-09-03-00", "bilibili-feed+bilibili_ranking.json.gz"),
    gzipSync('{"items":[{}]}')
  );
  const env = {
    ...process.env,
    GROWTH_STORE_DIR: root,
    GROWTH_INTERACTIVE_FALLBACK_DIR: path.join(root, "interactive"),
  };
  const script = path.resolve("scripts/growth-archive-offload-remote.sh");
  const result = spawnSync("sh", [script, "prepare", "123-1"], {
    env,
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2026-09-03-00/);
  assert(!result.stdout.includes("2026-09-01-00"));
  assert(!result.stdout.includes("2026-09-04-00"));
  assert(fs.existsSync(path.join(source, "2026-09-01-00")));
  assert(fs.existsSync(path.join(source, "2026-09-03-00", "bilibili-feed+bilibili_ranking.json.gz")));
  const empty = path.join(root, "backups/archive-offload/123-1/2026-09-01-00");
  fs.mkdirSync(empty);
  const bundle = spawnSync("sh", [script, "bundle", "123-1", "2026-09-01-00"], {
    env,
    encoding: "utf8",
  });
  assert.equal(bundle.status, 65);
  assert.match(bundle.stderr, /archive_content_empty/);
  assert.equal(bundle.stdout, "");
});
test("旧仓1000附件不阻止归档和独立批次记录发布", () => {
  const root = fixture(),
    r = remote();
  for (let i = 0; i < 1000; i++)
    r.add(LEGACY_GROWTH_RELEASE, `kept-${i}`, `keep-${i}`);
  publishArchiveBatch(root, r.gh);
  assert.equal(r.releases.get(LEGACY_GROWTH_RELEASE).files.size, 1000);
  assert(
    writes(r)
      .filter(a => a[1] === "upload")
      .every(a => a[2] !== LEGACY_GROWTH_RELEASE)
  );
});
test("远端鉴权或清单读取错误不能当成不存在而上传", () => {
  const root = fixture(),
    calls = [];
  assert.throws(
    () =>
      publishArchiveBatch(root, args => {
        calls.push(args);
        throw Error("403 denied");
      }),
    /403 denied/
  );
  assert.equal(calls.length, 1);
  assert(!fs.existsSync(path.join(root, "UPLOAD_VERIFIED")));
});
test("真实remote拒绝快照后源改变与忙锁，保留全部测试来源", () => {
  const root = temp(),
    source = path.join(root, "archive");
  fs.mkdirSync(source);
  for (const d of [dir, "2026-09-12-00", "2026-09-13-00"]) {
    fs.mkdirSync(path.join(source, d));
    fs.writeFileSync(
      path.join(source, d, "items.json.gz"),
      gzipSync('{"items":[{}]}')
    );
  }
  const env = {
      ...process.env,
      GROWTH_STORE_DIR: root,
      GROWTH_INTERACTIVE_FALLBACK_DIR: path.join(root, "interactive"),
    },
    script = path.resolve("scripts/growth-archive-offload-remote.sh");
  const first = spawnSync("sh", [script, "prepare", "123-1"], {
    env,
    encoding: "utf8",
  });
  assert.equal(first.status, 0, first.stderr);
  const fp = first.stdout.trim().split("\t")[1];
  fs.appendFileSync(path.join(source, dir, "items.json.gz"), "change");
  const changed = spawnSync("sh", [script, "delete", "123-1", dir, fp], {
    env,
    encoding: "utf8",
  });
  assert.equal(changed.status, 64);
  assert.match(changed.stderr, /requires_explicit_file_receipt/);
  assert(fs.existsSync(path.join(source, dir)));
  const lock = path.join(root, ".growth-platform-collection.lock");
  fs.writeFileSync(lock, "other-owner");
  const busy = spawnSync("sh", [script, "prepare", "124-1"], {
    env,
    encoding: "utf8",
  });
  assert.equal(busy.status, 43);
  assert.equal(fs.readFileSync(lock, "utf8"), "other-owner");
});

test("backup suffix accepted and invalid batch paths rejected before remote writes", () => {
  const root = fixture(),
    r = remote();
  fs.writeFileSync(path.join(root, "batch-id.txt"), "123-1-backup");
  publishArchiveBatch(root, r.gh);
  assert(fs.existsSync(path.join(root, "UPLOAD_VERIFIED")));
  for (const id of ["..", ".", "../123", "123-1-backup-more"]) {
    fs.writeFileSync(path.join(root, "batch-id.txt"), id);
    assert.throws(
      () => prepareArchivePublication(root),
      /archive_batch_invalid/
    );
  }
});
test("exact source inventory rejects changed content even with matching byte totals", () => {
  const root = fixture(),
    file = path.join(root, "source", dir, "items.json.gz"),
    raw = fs.readFileSync(file);
  fs.writeFileSync(
    path.join(root, "source-inventory.json"),
    JSON.stringify({
      inventories: {
        [dir]: {
          errors: [],
          files: [
            {
              path: "items.json.gz",
              bytes: raw.length,
              sha256: "0".repeat(64),
              items: 1,
            },
          ],
        },
      },
    })
  );
  assert.throws(
    () => prepareArchivePublication(root),
    /archive_source_inventory_mismatch/
  );
});
test("verified multipart generation is reused without starvation or automatic reclamation", () => {
  const root = fixture("valid", true),
    r = remote();
  publishArchiveBatch(root, r.gh);
  const assets = [],
    manifests = new Map();
  for (const [tag, release] of r.releases)
    for (const [name, raw] of release.files) {
      assets.push({
        name,
        size: raw.length,
        digest: "sha256:" + digest(raw),
        state: "uploaded",
        releaseTag: tag,
      });
      if (name.endsWith(".manifest.json")) manifests.set(name, raw.toString());
    }
  const plan = planArchiveBatch(
    `${dir}\t${fingerprint}\t100\n`,
    assets,
    manifests
  );
  assert.equal(plan.reused, 1);
  assert.deepEqual(plan.selected, []);
  assert.deepEqual(plan.reclaim, []);
});
test("low-level snapshot cleanup rejects dot batch traversal", () => {
  const root = temp();
  fs.mkdirSync(path.join(root, "backups"));
  fs.writeFileSync(path.join(root, "backups", "keep"), "evidence");
  for (const id of [".", ".."]) {
    const run = spawnSync(
      "sh",
      [path.resolve("scripts/growth-archive-offload-remote.sh"), "cleanup", id],
      { env: { ...process.env, GROWTH_STORE_DIR: root }, encoding: "utf8" }
    );
    assert.equal(run.status, 64);
  }
  assert.equal(
    fs.readFileSync(path.join(root, "backups", "keep"), "utf8"),
    "evidence"
  );
});

test("archive publisher refuses public and unconfirmed repository before any remote mutation", () => {
  for (const isPrivate of [false, undefined]) {
    const calls = [];
    assert.throws(
      () =>
        publishArchiveBatch(fixture(), args => {
          calls.push(args);
          return JSON.stringify({
            nameWithOwner: "gabrieltan0506-prog/mvstudiopro-growth-data",
            isPrivate,
          });
        }),
      /confirmed_private/
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "repo");
  }
});

function publishedInventory(remote) {
  const assets = [], manifests = new Map();
  const order = tag => tag === LEGACY_GROWTH_RELEASE ? 0 : tag.startsWith("growth-archive-revision-") ? 2 : 1;
  for (const [tag, release] of [...remote.releases].sort((a,b)=>order(a[0])-order(b[0]))) {
    for (const [name, raw] of release.files) {
      assets.push({name,size:raw.length,digest:`sha256:${digest(raw)}`,state:"uploaded",releaseTag:tag});
      if(name.endsWith(".manifest.json")) manifests.set(name,raw.toString());
    }
  }
  return {assets,manifests};
}
test("修订附件已上传但指针失败，下轮不能误复用且可补提交",()=>{
  const root=fixture(), r=remote(), tag=growthColdStoreReleaseTag(`archive-${dir}.tar.gz`);
  r.add(tag,`archive-${dir}.tar.gz`,Buffer.from("historical-original"));
  assert.throws(()=>publishArchiveBatch(root,args=>{
    if(args[0]==="release"&&args[1]==="upload"&&args[3].endsWith(".latest.json"))throw Error("pointer-interrupted");
    return r.gh(args);
  }),/pointer-interrupted/);
  const inventory=publishedInventory(r);
  const plan=planArchiveBatch(`${dir}\t${fingerprint}\t100\n`,inventory.assets,inventory.manifests);
  assert.equal(plan.reused,0);assert.equal(plan.selected.length,1);
  assert(!fs.existsSync(path.join(root,"UPLOAD_VERIFIED")));
  const uploadsBefore=r.calls.filter(a=>a[1]==="upload"&&!a[3].endsWith(".latest.json")).length;
  publishArchiveBatch(root,r.gh);
  assert.equal(r.calls.filter(a=>a[1]==="upload"&&!a[3].endsWith(".latest.json")).length,uploadsBefore);
  const after=publishedInventory(r);
  assert.equal(planArchiveBatch(`${dir}\t${fingerprint}\t100\n`,after.assets,after.manifests).reused,1);
});
test("原版内容重新出现时必须更新旧修订指针，不能仅报告原版已发布",()=>{
  const root=fixture(),r=remote(),tag=growthColdStoreReleaseTag(`archive-${dir}.tar.gz`);
  publishArchiveBatch(root,r.gh);
  const original=Buffer.from(r.releases.get(tag).files.get(`archive-${dir}.tar.gz`));
  r.add(tag,`archive-${dir}.latest.json`,JSON.stringify({schemaVersion:1,dir,releaseTag:`growth-archive-revision-${dir}-${"b".repeat(64)}`}));
  const before=publishedInventory(r);
  assert.equal(planArchiveBatch(`${dir}\t${fingerprint}\t100\n`,before.assets,before.manifests).selected.length,1);
  fs.writeFileSync(path.join(root,"batch-id.txt"),"124-1");
  publishArchiveBatch(root,r.gh);
  const pointer=JSON.parse(r.releases.get(tag).files.get(`archive-${dir}.latest.json`).toString());
  assert.equal(pointer.releaseTag,`growth-archive-revision-${dir}-${fingerprint}`);
  assert.deepEqual(r.releases.get(tag).files.get(`archive-${dir}.tar.gz`),original);
  const after=publishedInventory(r);
  assert.equal(planArchiveBatch(`${dir}\t${fingerprint}\t100\n`,after.assets,after.manifests).reused,1);
});
