import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";

const base =
  "https://generation.test.invalid/owner/repo/releases/download/growth-cold-store-latest";
const platforms = [
  "douyin",
  "xiaohongshu",
  "bilibili",
  "weixin_channels",
] as const;
const sha = (raw: Buffer) => createHash("sha256").update(raw).digest("hex");
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  await Promise.all(
    roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  );
});

function generation(batchId: string, missing?: string) {
  const releaseTag = `growth-backup-${batchId}`;
  const collections = Object.fromEntries(
    platforms.map(platform => [
      platform,
      {
        platform,
        source: "live",
        collectedAt: "2026-11-05T10:00:00Z",
        items: [
          {
            id: `${batchId}-${platform}`,
            title: "isolated fixture",
            platform,
            publishedAt: "2026-11-05T09:00:00Z",
          },
        ],
      },
    ])
  );
  const archiveIndex = [
    {
      platform: "bilibili",
      file: `/data/growth/archive/2026-10-08-16/${batchId}.json.gz`,
      archivedAt: "2026-10-08T16:00:00Z",
      itemCount: 123,
    },
  ];
  const logical = new Map<string, Buffer>([
    [
      "current.json.gz",
      gzipSync(
        JSON.stringify({
          updatedAt: "2026-11-05T10:00:00Z",
          collections,
          archiveIndex,
        })
      ),
    ],
    ["archive-index.json.gz", gzipSync(JSON.stringify(archiveIndex))],
    [
      "runtime-meta.json.gz",
      gzipSync(
        JSON.stringify({ updatedAt: "2026-11-05T10:00:00Z", scheduler: {} })
      ),
    ],
    ["history-summary.json.gz", gzipSync(JSON.stringify({ platforms: {} }))],
  ]);
  for (const platform of platforms)
    logical.set(
      `platform-current-${platform}.current.json.gz`,
      gzipSync(
        JSON.stringify({
          platform,
          truthSource: "platform-current",
          collection: collections[platform],
        })
      )
    );
  if (missing) logical.delete(missing);
  const files = Array.from(logical).map(([logicalAssetName, raw]) => ({
    logicalAssetName,
    bytes: raw.length,
    sha256: sha(raw),
    parts: [
      {
        assetName: logicalAssetName,
        index: 0,
        offset: 0,
        bytes: raw.length,
        sha256: sha(raw),
      },
    ],
  }));
  const manifest = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      batchId,
      releaseTag,
      scope: "test",
      coverage: { complete: false },
      files,
    })
  );
  const pointer = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      batchId,
      releaseTag,
      manifest: {
        assetName: "growth-backup-generation.json",
        bytes: manifest.length,
        sha256: sha(manifest),
      },
    })
  );
  logical.set("growth-backup-generation.json", manifest);
  return { batchId, releaseTag, logical, pointer };
}

async function setup(
  options: { missing?: string; status?: number; switchPointer?: boolean } = {}
) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "growth-generation-consumer-")
  );
  roots.push(root);
  vi.stubEnv("GROWTH_STORE_DIR", path.join(root, "source"));
  vi.stubEnv("GROWTH_LEGACY_STORE_FILE", path.join(root, "legacy.json"));
  vi.stubEnv("GROWTH_GITHUB_OFFLOAD_CACHE_DIR", path.join(root, "cache"));
  vi.stubEnv("GROWTH_GITHUB_COLD_STORE_BASE_URL", base);
  vi.resetModules();
  const first = generation("123-1", options.missing),
    second = generation("124-1");
  let active = first;
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url === `${base}/growth-backup-latest.json`)
        return options.status
          ? new Response("denied", { status: options.status })
          : new Response(active.pointer);
      const match = url.match(
        /releases\/download\/(growth-backup-\d+-\d+)\/([^/?]+)$/
      );
      if (match) {
        const version = match[1] === first.releaseTag ? first : second;
        const raw = version.logical.get(match[2]);
        if (
          options.switchPointer &&
          match[2] !== "growth-backup-generation.json"
        )
          active = second;
        return raw
          ? new Response(new Uint8Array(raw))
          : new Response("missing", { status: 404 });
      }
      // Legacy endpoints contain deliberately different data. They must never be used.
      if (url.includes("growth-cold-store-latest"))
        return new Response(
          gzipSync(
            JSON.stringify({
              collections: { bilibili: { items: [{ id: "WRONG-LEGACY" }] } },
            })
          )
        );
      throw new Error(`Unexpected network request: ${url}`);
    })
  );
  const consumer = await import("./trendStore");
  return { ...consumer, calls, root };
}
const legacyDataCalls = (calls: string[]) =>
  calls.filter(
    url =>
      url.includes("growth-cold-store-latest") &&
      !url.endsWith("growth-backup-latest.json")
  );

it("real readTrendStore consumes current and archive-index from the same committed generation", async () => {
  const { readTrendStore, calls } = await setup();
  const full = await readTrendStore();
  expect(full.collections.bilibili?.items[0].id).toBe("123-1-bilibili");
  const derived = await readTrendStore({ preferDerivedFiles: true });
  expect(derived.collections.bilibili?.items[0].id).toBe("123-1-bilibili");
  expect(derived.archiveIndex[0]?.file).toContain("123-1.json.gz");
  expect(
    calls.some(url => url.endsWith("growth-backup-123-1/archive-index.json.gz"))
  ).toBe(true);
  expect(
    calls.some(url => url.endsWith("growth-backup-123-1/current.json.gz"))
  ).toBe(true);
  expect(legacyDataCalls(calls)).toEqual([]);
});

it("pointer changes stay atomic within a read and new reads discover the next generation", async () => {
  const { readTrendStoreForPlatforms, readTrendStore, calls } = await setup({
    switchPointer: true,
  });
  const platform = await readTrendStoreForPlatforms(["bilibili"], {
    preferDerivedFiles: true,
  });
  expect(platform.collections.bilibili?.items[0].id).toBe("123-1-bilibili");
  const full = await readTrendStore({ preferDerivedFiles: true });
  expect(full.archiveIndex[0]?.file).toContain("124-1.json.gz");
  expect(full.collections.bilibili?.items[0].id).toBe("124-1-bilibili");
  expect(
    calls.filter(url => url.endsWith("growth-backup-latest.json"))
  ).toHaveLength(2);
  expect(calls.some(url => url.includes("growth-backup-124-1"))).toBe(true);
  expect(legacyDataCalls(calls)).toEqual([]);
});

it.each([
  "archive-index.json.gz",
  "current.json.gz",
  "runtime-meta.json.gz",
  "platform-current-bilibili.current.json.gz",
])(
  "a present generation missing required %s cannot silently fall back or succeed as empty",
  async missing => {
    const { readTrendStore, calls } = await setup({ missing });
    await expect(
      readTrendStore({ preferDerivedFiles: missing !== "current.json.gz" })
    ).rejects.toThrow(/growth_backup_/);
    expect(legacyDataCalls(calls)).toEqual([]);
  }
);

it("403 in the generation pointer fails the real consumer without requesting legacy data", async () => {
  const { readTrendStore, calls } = await setup({ status: 403 });
  await expect(readTrendStore({ preferDerivedFiles: true })).rejects.toThrow(
    /pointer_http_403/
  );
  await expect(readTrendStore()).rejects.toThrow(/pointer_http_403/);
  expect(legacyDataCalls(calls)).toEqual([]);
});

it("an initial missing generation pointer does not permanently pin future reads to legacy", async () => {
  const options: { status?: number } = { status: 404 };
  const { readTrendStore, calls } = await setup(options);
  const old = await readTrendStore();
  expect(old.collections.bilibili?.items[0].id).toBe("WRONG-LEGACY");
  options.status = undefined;
  const fresh = await readTrendStore();
  expect(fresh.collections.bilibili?.items[0].id).toBe("123-1-bilibili");
  expect(
    calls.filter(url => url.endsWith("growth-backup-latest.json"))
  ).toHaveLength(2);
});

async function setupPrivateConsumer(pointerStatus?: number) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "growth-private-consumer-")
  );
  roots.push(root);
  const repository = "test-owner/private-growth-data";
  const privateBase = `https://github.com/${repository}/releases/download/growth-cold-store-latest`;
  const legacyBase =
    "https://github.com/test-owner/public-code/releases/download/growth-cold-store-latest";
  const token = "synthetic-private-backup-token";
  vi.stubEnv("GROWTH_STORE_DIR", path.join(root, "source"));
  vi.stubEnv("GROWTH_LEGACY_STORE_FILE", path.join(root, "legacy.json"));
  vi.stubEnv("GROWTH_GITHUB_OFFLOAD_CACHE_DIR", path.join(root, "cache"));
  vi.stubEnv("GROWTH_GITHUB_PRIVATE_COLD_STORE_BASE_URL", privateBase);
  vi.stubEnv("GROWTH_GITHUB_COLD_STORE_BASE_URL", legacyBase);
  vi.stubEnv("GROWTH_BACKUP_REPOSITORY", repository);
  vi.stubEnv("GROWTH_BACKUP_GITHUB_TOKEN", token);
  vi.resetModules();
  const current = generation("123-1"),
    historical = generation("99-1");
  const assets = new Map<number, Buffer>([[1, current.pointer]]);
  const generationAssets = Array.from(current.logical).map(([name, raw], index) => {
    assets.set(index + 2, raw);
    return { id: index + 2, name, state: "uploaded" };
  });
  const calls: Array<{
    url: string;
    authorization: string | null;
    cookie: string | null;
  }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input),
        headers = new Headers(init?.headers);
      calls.push({
        url,
        authorization: headers.get("authorization"),
        cookie: headers.get("cookie"),
      });
      const api = `https://api.github.com/repos/${repository}/releases/`;
      if (url.startsWith(api)) {
        expect(headers.get("authorization")).toBe(`Bearer ${token}`);
        if (pointerStatus)
          return new Response("synthetic unavailable", {
            status: pointerStatus,
          });
        if (url === `${api}tags/growth-cold-store-latest`)
          return Response.json({
            id: 1,
            assets: [
              { id: 1, name: "growth-backup-latest.json", state: "uploaded" },
            ],
          });
        if (url === `${api}tags/growth-backup-123-1`)
          return Response.json({ id: 2, assets: generationAssets });
        const match = url.match(/\/assets\/(\d+)$/);
        const raw = match ? assets.get(Number(match[1])) : undefined;
        if (raw) return new Response(new Uint8Array(raw));
        return new Response("missing", { status: 404 });
      }
      if (url.startsWith(legacyBase)) {
        expect(headers.has("authorization")).toBe(false);
        expect(headers.has("cookie")).toBe(false);
        const raw = historical.logical.get(url.slice(legacyBase.length + 1));
        return raw
          ? new Response(new Uint8Array(raw))
          : new Response("missing", { status: 404 });
      }
      throw new Error(
        `unexpected network in private integration fixture: ${url}`
      );
    })
  );
  return { ...(await import("./trendStore")), calls, legacyBase, repository };
}

it("private API consumer restores the committed store and sends its token only to the private release API", async () => {
  const { readTrendStore, calls, legacyBase, repository } =
    await setupPrivateConsumer();
  const full = await readTrendStore();
  expect(full.collections.bilibili?.items[0].id).toBe("123-1-bilibili");
  const derived = await readTrendStore({ preferDerivedFiles: true });
  expect(derived.archiveIndex[0]?.file).toContain("123-1.json.gz");
  expect(derived.collections.bilibili?.items[0].id).toBe("123-1-bilibili");
  expect(calls.some(call => /\/assets\/\d+$/.test(call.url))).toBe(true);
  expect(calls.some(call => call.url.startsWith(legacyBase))).toBe(false);
  expect(
    calls.every(call =>
      call.url.startsWith(
        `https://api.github.com/repos/${repository}/releases/`
      )
    )
  ).toBe(true);
});

it("private API consumer permits public legacy fallback only after an explicit missing generation and never sends its token there", async () => {
  const { readTrendStore, calls, legacyBase } = await setupPrivateConsumer(404);
  const full = await readTrendStore();
  expect(full.collections.bilibili?.items[0].id).toBe("99-1-bilibili");
  const publicCalls = calls.filter(call => call.url.startsWith(legacyBase));
  expect(publicCalls.length).toBeGreaterThan(0);
  expect(
    publicCalls.every(
      call => call.authorization === null && call.cookie === null
    )
  ).toBe(true);
  expect(calls[0].url).toContain(
    "api.github.com/repos/test-owner/private-growth-data/releases/tags/growth-cold-store-latest"
  );
});

it("private API consumer refuses 403 without fetching any public fallback asset", async () => {
  const { readTrendStore, calls, legacyBase } = await setupPrivateConsumer(403);
  await expect(readTrendStore()).rejects.toThrow(
    /growth_backup_unavailable.*pointer_http_403/
  );
  expect(calls.some(call => call.url.startsWith(legacyBase))).toBe(false);
});
