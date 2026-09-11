import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  growthColdStoreReleaseTag,
  growthColdStoreAssetUrls,
  fetchGrowthColdStoreAsset,
} from "../../shared/growthColdStoreRelease.mjs";
import {
  loadArchiveInventory,
  planArchiveBatch,
} from "../../scripts/growth-archive-plan.mjs";

const roots: string[] = [];
const servers: Server[] = [];
const sha = (raw: Buffer | string) =>
  createHash("sha256").update(raw).digest("hex");
async function temp() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-release-test-"));
  roots.push(root);
  return root;
}
async function http(routes: Map<string, Buffer | string | number>) {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const url = (req.url || "").split("?")[0];
    requests.push(url);
    const body = routes.get(url) ?? 404;
    if (typeof body === "number") {
      res.statusCode = body;
      res.end();
    } else res.end(body);
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as { port: number }).port}/releases/download/growth-cold-store-latest`,
    requests,
  };
}
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.closeAllConnections();
          server.close(() => resolve());
        })
    )
  );
  await Promise.all(
    roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("冷备分仓路由与真实 HTTP", () => {
  it("新批次、每日归档分仓；固定清单、旧格式和自定义镜像保持兼容", () => {
    expect(
      growthColdStoreReleaseTag("platform-current-douyin.batch-123-1.part-0000")
    ).toBe("growth-current-batch-123-1");
    expect(
      growthColdStoreReleaseTag(
        "growth-platform-current-complete.batch-123-1.tar.part-0001"
      )
    ).toBe("growth-current-batch-123-1");
    for (const name of [
      "archive-2026-09-11-00.tar.gz",
      "archive-2026-09-11-23.manifest.json",
      "archive-2026-09-11.tar.gz.part-0000",
    ])
      expect(growthColdStoreReleaseTag(name)).toBe("growth-archive-2026-09-11");
    expect(
      growthColdStoreReleaseTag("platform-current-batch-manifest.json")
    ).toBe("growth-cold-store-latest");
    expect(
      growthColdStoreReleaseTag("platform-current-douyin.old.part-0000")
    ).toBe("growth-cold-store-latest");
    expect(
      growthColdStoreAssetUrls(
        "https://mirror.test/backups",
        "archive-2026-09-11.tar.gz"
      )
    ).toEqual(["https://mirror.test/backups/archive-2026-09-11.tar.gz"]);
    expect(() => growthColdStoreReleaseTag("../secret")).toThrow();
  });
  it("仅新仓 404 回退旧仓，503 不隐瞒故障，取消不重试", async () => {
    const name = "platform-current-douyin.batch-123-1.part-0000";
    const routes = new Map<string, string | number>([
      [`/releases/download/growth-cold-store-latest/${name}`, "旧批次正文"],
    ]);
    const { base, requests } = await http(routes);
    expect(await (await fetchGrowthColdStoreAsset(base, name))?.text()).toBe(
      "旧批次正文"
    );
    expect(requests).toHaveLength(2);
    routes.set(`/releases/download/growth-current-batch-123-1/${name}`, 503);
    expect((await fetchGrowthColdStoreAsset(base, name))?.status).toBe(503);
    expect(requests).toHaveLength(3);
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchGrowthColdStoreAsset(base, name, { signal: controller.signal })
    ).rejects.toThrow();
    expect(requests).toHaveLength(3);
  });
  it.each(["new", "legacy"])(
    "生产读取器从 %s 仓恢复非空四层数据并保持 SHA 校验",
    async mode => {
      const root = await temp();
      const name = "platform-current-douyin.batch-123-1.part-0000";
      const raw = gzipSync(
        JSON.stringify({
          collection: {
            platform: "douyin",
            source: "live",
            collectedAt: "2026-09-11T00:00:00Z",
            items: [{ id: "真实恢复条目", title: "恢复内容非空" }],
          },
        })
      );
      const manifest = {
        schemaVersion: 1,
        batchId: "123-1",
        files: [
          {
            platform: "douyin",
            logicalAssetName: "platform-current-douyin.current.json.gz",
            bytes: raw.length,
            sha256: sha(raw),
            parts: [
              {
                index: 0,
                offset: 0,
                bytes: raw.length,
                sha256: sha(raw),
                assetName: name,
              },
            ],
          },
        ],
      };
      const tag =
        mode === "new"
          ? "growth-current-batch-123-1"
          : "growth-cold-store-latest";
      const routes = new Map<string, string | Buffer>([
        [
          "/releases/download/growth-cold-store-latest/platform-current-batch-manifest.json",
          JSON.stringify(manifest),
        ],
        [`/releases/download/${tag}/${name}`, raw],
      ]);
      const { base, requests } = await http(routes);
      vi.stubEnv("GROWTH_STORE_DIR", path.join(root, "store"));
      vi.stubEnv("GROWTH_GITHUB_OFFLOAD_CACHE_DIR", path.join(root, "cache"));
      vi.stubEnv("GROWTH_GITHUB_COLD_STORE_BASE_URL", base);
      const { readTrendStoreForPlatforms } = await import("./trendStore");
      const result = await readTrendStoreForPlatforms(["douyin"], {
        preferDerivedFiles: true,
      });
      expect(result.collections.douyin?.items[0].title).toBe("恢复内容非空");
      expect(requests).toContain(`/releases/download/${tag}/${name}`);
      expect(
        sha(
          await fs.readFile(
            path.join(
              root,
              "cache/platform-current-batches/123-1/platform-current-douyin.current.json.gz"
            )
          )
        )
      ).toBe(sha(raw));
    }
  );
  it.each(["new", "legacy"])(
    "生产归档读取器从 %s 仓下载、校验、解包到实际 JSON",
    async mode => {
      const root = await temp(),
        dir = "2026-09-11-03";
      await fs.mkdir(path.join(root, dir));
      await fs.writeFile(
        path.join(root, dir, "items.json"),
        JSON.stringify([{ title: "历史内容保留" }])
      );
      execFileSync("tar", [
        "-czf",
        path.join(root, "archive.tar.gz"),
        "-C",
        root,
        dir,
      ]);
      const raw = await fs.readFile(path.join(root, "archive.tar.gz"));
      const assetName = `archive-${dir}.tar.gz`,
        archive = { assetName, bytes: raw.length, sha256: sha(raw) };
      const manifest = {
        schemaVersion: 1,
        dir,
        archive,
        parts: [{ ...archive, index: 0 }],
      };
      const tag =
        mode === "new"
          ? "growth-archive-2026-09-11"
          : "growth-cold-store-latest";
      const { base } = await http(
        new Map([
          [`/releases/download/${tag}/${assetName}`, raw],
          [
            `/releases/download/${tag}/archive-${dir}.manifest.json`,
            Buffer.from(JSON.stringify(manifest)),
          ],
        ])
      );
      vi.stubEnv("GROWTH_STORE_DIR", path.join(root, "store"));
      vi.stubEnv("GROWTH_GITHUB_OFFLOAD_CACHE_DIR", path.join(root, "cache"));
      vi.stubEnv("GROWTH_GITHUB_COLD_STORE_BASE_URL", base);
      const { ensureOffloadedArchiveDir } = await import("./trendStore");
      const restored = await ensureOffloadedArchiveDir(dir);
      expect(
        JSON.parse(
          await fs.readFile(path.join(restored!, "items.json"), "utf8")
        )
      ).toEqual([{ title: "历史内容保留" }]);
    }
  );
  it("新仓只上传 tar 尚无清单时不走旧格式免校验旁路", async () => {
    const root = await temp(),
      dir = "2026-09-11-03";
    const { base, requests } = await http(
      new Map([
        [
          `/releases/download/growth-archive-2026-09-11/archive-${dir}.tar.gz`,
          "未验证的新包",
        ],
      ])
    );
    vi.stubEnv("GROWTH_STORE_DIR", path.join(root, "store"));
    vi.stubEnv("GROWTH_GITHUB_OFFLOAD_CACHE_DIR", path.join(root, "cache"));
    vi.stubEnv("GROWTH_GITHUB_COLD_STORE_BASE_URL", base);
    const { ensureOffloadedArchiveDir } = await import("./trendStore");
    expect(await ensureOffloadedArchiveDir(dir)).toBeNull();
    expect(requests).not.toContain(
      `/releases/download/growth-archive-2026-09-11/archive-${dir}.tar.gz`
    );
  });
});

describe("分仓增量盘点", () => {
  it("枚举旧仓和相关日仓，新仓已验证记录可复用，不读取无关批次仓", async () => {
    const root = await temp();
    const dir = "2026-09-11-03",
      name = `archive-${dir}.manifest.json`,
      body = "归档正文",
      fingerprint = "a".repeat(64);
    const archive = {
      assetName: `archive-${dir}.tar.gz`,
      bytes: Buffer.byteLength(body),
      sha256: sha(body),
    };
    const raw = JSON.stringify({
      schemaVersion: 1,
      dir,
      sourceFingerprint: fingerprint,
      archive,
      parts: [{ ...archive, index: 0 }],
    });
    const asset = (name: string, body: string) => ({
      name,
      size: Buffer.byteLength(body),
      digest: `sha256:${sha(body)}`,
      state: "uploaded",
    });
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      if (args[0] === "release") {
        execFileSync(process.execPath, [
          "-e",
          "require('fs').writeFileSync(process.argv[1],process.argv[2])",
          path.join(args[args.indexOf("--dir") + 1], name),
          raw,
        ]);
        return "";
      }
      if (args.at(-1)?.endsWith("releases?per_page=100"))
        return JSON.stringify([
          [
            { id: 1, tag_name: "growth-cold-store-latest" },
            { id: 2, tag_name: "growth-archive-2026-09-11" },
            { id: 3, tag_name: "growth-current-batch-123-1" },
          ],
        ]);
      return JSON.stringify([
        args.at(-1)?.includes("/2/")
          ? [asset(name, raw), asset(archive.assetName, body)]
          : [],
      ]);
    };
    const snapshot = `${dir}\t${fingerprint}\t100\n`;
    const inventory = loadArchiveInventory(root, snapshot, "owner/repo", gh);
    expect(
      planArchiveBatch(snapshot, inventory.assets, inventory.manifests)
    ).toMatchObject({ reused: 1, selected: [] });
    expect(
      calls.some(args => args.some(arg => arg.includes("/3/assets")))
    ).toBe(false);
    expect(() =>
      loadArchiveInventory(root, snapshot, "owner/repo", () => {
        throw new Error("503");
      })
    ).toThrow("503");
  });
});

describe("真实工作流上传函数离线执行", () => {
  it.each([
    ".github/workflows/growth-backup.yml",
    ".github/workflows/growth-archive-offload.yml",
  ])("%s 在旧仓满 1000 附件时仍向新仓上传并回读", async workflow => {
    const root = await temp(),
      bin = path.join(root, "bin");
    await fs.mkdir(bin);
    const text = await fs.readFile(path.resolve(workflow), "utf8");
    expect(text).not.toContain(
      "run: bash scripts/prune-growth-release-batch-assets.sh"
    );
    const functions = Array.from(
      text.matchAll(
        /          upload_and_readback_asset\(\) \{[\s\S]*?\n          \}/g
      )
    );
    expect(functions.length).toBe(
      workflow.endsWith("growth-backup.yml") ? 2 : 1
    );
    // 仅测试夹具实现 gh；实际执行工作流内的 shell 函数，不调用远端、不接触凭证。
    const gh = `#!${process.execPath}
const fs=require('fs'),path=require('path'),a=process.argv.slice(2),root=process.env.TEST_RELEASE_ROOT;
fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify(a)+'\\n');
const dir=path.join(root,a[2]||'');
if(a[0]!=='release')process.exit(20);
if(a[1]==='view')process.exit(fs.existsSync(dir)?0:1);
if(a[1]==='create'){if(!a.includes('--latest=false'))process.exit(21);fs.mkdirSync(dir,{recursive:true});process.exit(0);}
if(a[1]==='upload'){const file=a[3].split('#')[0],name=path.basename(file);if(a[2]==='growth-cold-store-latest'&&!fs.existsSync(path.join(dir,name))){console.error('file_count limited to 1000 assets per release');process.exit(22);}fs.copyFileSync(file,path.join(dir,name));process.exit(0);}
if(a[1]==='download'){const name=a[a.indexOf('-p')+1],dest=a[a.indexOf('-D')+1];fs.copyFileSync(path.join(dir,name),path.join(dest,name));process.exit(0);}
process.exit(23);`;
    await fs.writeFile(path.join(bin, "gh"), gh, { mode: 0o755 });
    await fs.writeFile(
      path.join(bin, "stat"),
      `#!${process.execPath}\nconsole.log(require('fs').statSync(process.argv.at(-1)).size);`,
      { mode: 0o755 }
    );
    await fs.mkdir(path.join(root, "growth-cold-store-latest"));
    for (let i = 0; i < functions.length; i++) {
      const name =
        i === 0 && workflow.endsWith("growth-backup.yml")
          ? "growth-platform-current-complete.batch-123-1.tar.part-0000"
          : "archive-2026-09-11-03.tar.gz";
      const file = path.join(root, name);
      await fs.writeFile(file, "真实上传与回读正文");
      const fn = functions[i][0]
        .replaceAll("/tmp/growth-backup", path.join(root, "backup"))
        .replaceAll("/tmp/growth-archive-offload", path.join(root, "offload"));
      execFileSync(
        "bash",
        ["-eu", "-c", `${fn}\nupload_and_readback_asset "$1"`, "test", file],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            TEST_RELEASE_ROOT: root,
            GITHUB_SHA: "test-commit",
          },
        }
      );
      expect(
        await fs.readFile(
          path.join(root, growthColdStoreReleaseTag(name), name),
          "utf8"
        )
      ).toBe("真实上传与回读正文");
    }
    const calls = (await fs.readFile(path.join(root, "calls.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(line => JSON.parse(line) as string[]);
    expect(
      calls
        .filter(args => args[1] === "upload")
        .every(args => args[2] !== "growth-cold-store-latest")
    ).toBe(true);
    expect(
      calls.some(args => args.includes("delete") || args.includes("DELETE"))
    ).toBe(false);
    expect(calls.filter(args => args[1] === "download")).toHaveLength(
      functions.length
    );
    if (workflow.endsWith("growth-backup.yml")) {
      expect(
        text.indexOf(
          "upload_and_readback_asset /tmp/growth-backup/release-current/platform-current-batch-manifest.json"
        )
      ).toBeGreaterThan(
        text.indexOf("for asset in /tmp/growth-backup/release-current/*.part-*")
      );
    }
  });
});
