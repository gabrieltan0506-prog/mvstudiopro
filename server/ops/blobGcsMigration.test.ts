import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hashBytes,
  runBlobGcsMigration,
  type BlobEntry,
  type MigrationDeps,
  type MigrationOptions,
} from "./blobGcsMigration";
import { migrationMain, parseMigrationArgs } from "./blobGcsMigrationCli";
const sdk = vi.hoisted(() => ({ list: vi.fn(), head: vi.fn(), get: vi.fn() }));
vi.mock("@vercel/blob", () => sdk);
const gcs = vi.hoisted(() => ({
  getGcsBucketName: vi.fn(),
  uploadBufferToGcsIfAbsent: vi.fn(),
  statGcsObjectVersion: vi.fn(),
  inspectGcsObjectBounded: vi.fn(),
}));
vi.mock("../services/gcs.js", () => gcs);
const disk = vi.hoisted(() => ({ mkdir: vi.fn(), open: vi.fn() }));
vi.mock("node:fs/promises", () => disk);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const entry: BlobEntry = {
  url: "https://test.public.blob.vercel-storage.com/file",
  pathname: "file",
  size: 3,
  etag: "etag-1",
  uploadedAt: "2026-09-12T00:00:00Z",
};
const options: MigrationOptions = {
  copy: true,
  maxObjectBytes: 64,
  maxTransferBytes: 128,
  delayMs: 0,
};
function setup() {
  const records: Array<{ kind: string; value: any }> = [];
  const deps: MigrationDeps = {
    list: vi.fn(async () => ({ blobs: [entry], hasMore: false })),
    head: vi.fn(async () => ({
      ...entry,
      contentType: "application/octet-stream",
    })),
    read: vi.fn(async () => ({
      bytes: Buffer.from("abc"),
      etag: entry.etag,
      pathname: entry.pathname,
    })),
    create: vi.fn(async () => ({ created: true, generation: "17" })),
    inspect: vi.fn(async () => ({
      generation: "17",
      bytes: 3,
      sha256: hashBytes("abc"),
    })),
    record: vi.fn(async (kind, value) => {
      records.push({ kind, value });
    }),
    pause: vi.fn(async () => {}),
  };
  return { deps, records };
}
describe("Blob 清点与复制验真", () => {
  it.each(["public", "private"])(
    "实际CLI读取%s采用默认缓存且保留If-Match及身份验证",
    async access => {
      vi.stubEnv("FLY_APP_NAME", "mvstudiopro");
      vi.stubEnv("FLY_MACHINE_ID", "test-machine");
      vi.stubEnv("MVSP_READ_WRITE_TOKEN", "test-key");
      disk.mkdir.mockResolvedValue(undefined);
      disk.open.mockImplementation(async () => ({
        writeFile: vi.fn().mockResolvedValue(undefined),
        sync: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }));
      sdk.list.mockResolvedValue({ blobs: [entry], hasMore: false });
      sdk.head.mockResolvedValue({
        ...entry,
        contentType: "application/octet-stream",
      });
      sdk.get.mockResolvedValue({
        statusCode: 200,
        blob: { ...entry, contentType: "application/octet-stream" },
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from("abc"));
            controller.close();
          },
        }),
      });
      gcs.getGcsBucketName.mockReturnValue("test-bucket");
      gcs.uploadBufferToGcsIfAbsent.mockResolvedValue({
        created: true,
        generation: "17",
      });
      gcs.statGcsObjectVersion.mockResolvedValue({ generation: "17" });
      gcs.inspectGcsObjectBounded.mockResolvedValue({
        byteLength: 3,
        sha256: hashBytes("abc"),
      });
      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await migrationMain(["--copy", "--access", access, "--delay-ms", "0"]);
        expect(sdk.get).toHaveBeenCalledOnce();
        expect(sdk.get).toHaveBeenCalledWith(
          entry.url,
          expect.objectContaining({
            access,
            token: "test-key",
            useCache: true,
            headers: { "If-Match": entry.etag },
          })
        );
        expect(sdk.head).toHaveBeenCalledTimes(3);
        expect(gcs.inspectGcsObjectBounded).toHaveBeenCalledWith(
          expect.objectContaining({ generation: "17" })
        );
        expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
          copied: 1,
          failed: 0,
        });
      } finally {
        output.mockRestore();
      }
    }
  );

  it.each([
    ["", ""],
    ["another-app", "test-machine"],
    ["mvstudiopro", ""],
    ["mvstudiopro", "   "],
  ])("拒绝应用%s机器%s，且不访问Blob或GCS SDK", async (app, machine) => {
    vi.stubEnv("FLY_APP_NAME", app);
    vi.stubEnv("FLY_MACHINE_ID", machine);
    vi.stubEnv("MVSP_READ_WRITE_TOKEN", "test-key");
    await expect(migrationMain([])).rejects.toThrow("fly_server_required");
    for (const operation of [...Object.values(sdk), ...Object.values(gcs)]) {
      expect(operation).not.toHaveBeenCalled();
    }
  });

  it("默认仅清点且拒绝token及未知参数，不回显秘密", () => {
    expect(parseMigrationArgs([]).copy).toBe(false);
    expect(parseMigrationArgs(["--copy"]).copy).toBe(true);
    expect(() => parseMigrationArgs(["--token", "test-secret"])).toThrow(
      "invalid_arguments"
    );
  });
  it("全分页先存原页，默认不读媒体或写目标", async () => {
    const { deps, records } = setup();
    vi.mocked(deps.list)
      .mockResolvedValueOnce({ blobs: [entry], hasMore: true, cursor: "page2" })
      .mockResolvedValueOnce({ blobs: [], hasMore: false });
    const result = await runBlobGcsMigration({ ...options, copy: false }, deps);
    expect(result).toMatchObject({
      pages: 2,
      listed: 1,
      inventoryComplete: true,
      sourceDeleted: 0,
    });
    expect(deps.list).toHaveBeenNthCalledWith(2, "page2");
    expect(records[0]).toEqual({
      kind: "list-page",
      value: {
        requestCursor: null,
        response: { blobs: [entry], hasMore: true, cursor: "page2" },
      },
    });
    expect(deps.read).not.toHaveBeenCalled();
    expect(deps.create).not.toHaveBeenCalled();
  });
  it("复制成功必须SHA字节generation闭合且留计划、回执", async () => {
    const { deps, records } = setup();
    expect(await runBlobGcsMigration(options, deps)).toMatchObject({
      copied: 1,
      failed: 0,
      sourceDeleted: 0,
    });
    expect(deps.create).toHaveBeenCalledWith(
      `blob-migration/objects/${hashBytes(entry.url)}`,
      Buffer.from("abc"),
      "application/octet-stream"
    );
    expect(records.find(r => r.kind === "object-result")?.value).toMatchObject({
      generation: "17",
      bytes: 3,
      sha256: hashBytes("abc"),
      status: "copied_verified",
    });
  });
  it("续跑不信done文件，目标已存在仍验真", async () => {
    const { deps } = setup();
    vi.mocked(deps.create).mockResolvedValue({ created: false });
    expect(await runBlobGcsMigration(options, deps)).toMatchObject({
      copied: 0,
      resumed: 1,
    });
    expect(deps.inspect).toHaveBeenCalledOnce();
  });
  it.each(["bytes", "sha256", "generation"] as const)(
    "目标%s冲突不得覆盖或记成功",
    async field => {
      const { deps, records } = setup();
      vi.mocked(deps.inspect).mockResolvedValue({
        generation: "17",
        bytes: 3,
        sha256: hashBytes("abc"),
        [field]: field === "bytes" ? 9 : "different",
      } as any);
      expect(await runBlobGcsMigration(options, deps)).toMatchObject({
        copied: 0,
        resumed: 0,
        failed: 1,
        sourceDeleted: 0,
      });
      expect(records.find(r => r.kind === "object-result")?.value.status).toBe(
        "failed"
      );
      expect(deps.create).toHaveBeenCalledOnce();
    }
  );
  it.each([1, 2, 3])("源第%d次head变化拒收且不删源", async call => {
    const { deps } = setup();
    let count = 0;
    vi.mocked(deps.head).mockImplementation(async () => ({
      ...entry,
      etag: ++count === call ? "changed" : entry.etag,
      contentType: "application/octet-stream",
    }));
    expect(await runBlobGcsMigration(options, deps)).toMatchObject({
      copied: 0,
      failed: 1,
      sourceDeleted: 0,
    });
    if (call < 3) expect(deps.create).not.toHaveBeenCalled();
  });
  it("流回执ETag变化在写目标前拒收", async () => {
    const { deps } = setup();
    vi.mocked(deps.read).mockResolvedValue({
      bytes: Buffer.from("abc"),
      etag: "changed",
      pathname: entry.pathname,
    });
    expect(await runBlobGcsMigration(options, deps)).toMatchObject({
      failed: 1,
    });
    expect(deps.create).not.toHaveBeenCalled();
  });
  it("超对象或总流量预算明确pending不静默截断", async () => {
    const { deps } = setup();
    expect(
      await runBlobGcsMigration({ ...options, maxTransferBytes: 8 }, deps)
    ).toMatchObject({ pending: 1, copied: 0, inventoryComplete: true });
    expect(deps.read).not.toHaveBeenCalled();
  });
  it("重复游标终止，不无限循环或虚报完整", async () => {
    const { deps } = setup();
    vi.mocked(deps.list).mockResolvedValue({
      blobs: [],
      hasMore: true,
      cursor: "same",
    });
    await expect(runBlobGcsMigration(options, deps)).rejects.toThrow(
      "pagination_cursor_missing_or_repeated"
    );
    expect(deps.list).toHaveBeenCalledTimes(2);
  });
  it("原页存证失败不消费或写目标", async () => {
    const { deps } = setup();
    vi.mocked(deps.record).mockRejectedValueOnce(new Error("test-failure"));
    await expect(runBlobGcsMigration(options, deps)).rejects.toThrow(
      "test-failure"
    );
    expect(deps.read).not.toHaveBeenCalled();
    expect(deps.create).not.toHaveBeenCalled();
  });
  it("下游故障不把可能包含令牌的原始Error写进JSON", async () => {
    const { deps, records } = setup();
    vi.mocked(deps.create).mockRejectedValue(
      new Error("test-secret-request-token")
    );
    expect(await runBlobGcsMigration(options, deps)).toMatchObject({
      failed: 1,
      sourceDeleted: 0,
    });
    expect(JSON.stringify(records)).not.toContain("test-secret-request-token");
    expect(records.find(r => r.kind === "object-result")?.value.error).toBe(
      "operation_failed"
    );
  });
});
