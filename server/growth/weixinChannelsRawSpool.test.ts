import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupWeixinChannelsCollectorTempFiles,
  closeWeixinChannelsRawRun,
  commitWeixinChannelsRawItem,
  ensureWeixinChannelsRawRun,
  failWeixinChannelsRawRun,
  inspectWeixinChannelsRawSpool,
  listWeixinChannelsRawManifests,
  listWeixinChannelsRawRuns,
  pruneWeixinChannelsCompletedRawRuns,
  recordWeixinChannelsRawFailureEvidence,
  reserveWeixinChannelsRawSlot,
  resolveWeixinChannelsRawAssetPath,
  sealWeixinChannelsRawRun,
  updateWeixinChannelsRawManifest,
  WEIXIN_CHANNELS_RAW_BATCH_INTERVAL_MS,
} from "../../scripts/weixin-channels-raw-spool.mts";

const temporaryRoots: string[] = [];

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "weixin-raw-spool-test-"));
  temporaryRoots.push(root);
  return root;
}

async function makePngLikeFile(root: string, name: string, body = "png") {
  const file = path.join(root, name);
  await fs.writeFile(file, body);
  return file;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, {
    recursive: true,
    force: true,
  })));
});

describe("视频号 raw spool", () => {
  it("正式 raw 批次每二十分钟封存一次", () => {
    expect(WEIXIN_CHANNELS_RAW_BATCH_INTERVAL_MS).toBe(20 * 60_000);
  });

  it("双窗并发预约不会突破两千条批次上限", async () => {
    const root = await makeRoot();
    const { run } = await ensureWeixinChannelsRawRun({ root, maxItems: 2 });
    const reservations = await Promise.all([1, 2, 3, 4].map((windowId) => (
      reserveWeixinChannelsRawSlot({
        root,
        run,
        source: "recommendation",
        taskId: "task-1",
        query: "推荐页",
        windowId,
      })
    )));
    expect(reservations.filter(Boolean)).toHaveLength(2);
    const snapshot = await inspectWeixinChannelsRawSpool({ root, run });
    expect(snapshot.reservations).toBe(2);
    expect(snapshot.remaining).toBe(0);
  });

  it("最新搜索最多预约五十条且不占用最热门剩余额度", async () => {
    const root = await makeRoot();
    const { run } = await ensureWeixinChannelsRawRun({
      root,
      maxItems: 4,
      latestLimit: 2,
    });
    const latest = [];
    for (let index = 0; index < 3; index += 1) {
      latest.push(await reserveWeixinChannelsRawSlot({
        root,
        run,
        source: "search_latest",
        taskId: "task-1",
        query: "企业文化",
        windowId: 2,
      }));
    }
    expect(latest.filter(Boolean)).toHaveLength(2);
    expect(await reserveWeixinChannelsRawSlot({
      root,
      run,
      source: "search_hottest",
      taskId: "task-1",
      query: "企业文化",
      windowId: 2,
    })).not.toBeNull();
  });

  it("二十分钟到点即封批，不等待凑满两千条", async () => {
    const root = await makeRoot();
    const { run } = await ensureWeixinChannelsRawRun({
      root,
      maxItems: 2_000,
      batchIntervalMs: 60_000,
      now: Date.now() - 120_000,
    });
    expect(await reserveWeixinChannelsRawSlot({
      root,
      run,
      source: "recommendation",
      taskId: "task-1",
      query: "推荐页",
      windowId: 1,
    })).toBeNull();
    const snapshot = await inspectWeixinChannelsRawSpool({ root, run });
    expect(snapshot.remaining).toBe(2_000);
  });

  it("封批释放 active run 并明确丢弃未完成预约", async () => {
    const root = await makeRoot();
    const first = await ensureWeixinChannelsRawRun({ root, maxItems: 4 });
    expect(await reserveWeixinChannelsRawSlot({
      root,
      run: first.run,
      source: "recommendation",
      taskId: "task-1",
      query: "推荐页",
      windowId: 101,
    })).not.toBeNull();
    const sealed = await sealWeixinChannelsRawRun({ root, run: first.run });
    expect(sealed.phase).toBe("processing");
    expect(sealed.abandonedReservations).toBe(1);
    const second = await ensureWeixinChannelsRawRun({ root, maxItems: 4 });
    expect(second.run.runId).not.toBe(first.run.runId);
    expect((await listWeixinChannelsRawRuns({ root, phase: "processing" }))
      .map((run) => run.runId)).toContain(first.run.runId);
  });

  it("损坏批次连续失败后隔离且不再阻塞后续 processing 批次", async () => {
    const root = await makeRoot();
    const first = await ensureWeixinChannelsRawRun({ root, maxItems: 1 });
    const firstSealed = await sealWeixinChannelsRawRun({ root, run: first.run });
    const failed = await failWeixinChannelsRawRun({
      root,
      run: firstSealed,
      reason: "manifest_json_corrupted",
      attempts: 3,
      now: Date.parse("2026-08-15T00:00:00.000Z"),
    });
    expect(failed).toMatchObject({
      phase: "failed",
      failureReason: "manifest_json_corrupted",
      processingFailures: 3,
    });
    const second = await ensureWeixinChannelsRawRun({ root, maxItems: 1 });
    await sealWeixinChannelsRawRun({ root, run: second.run });
    expect((await listWeixinChannelsRawRuns({ root, phase: "processing" }))
      .map((run) => run.runId)).toEqual([second.run.runId]);
    expect((await listWeixinChannelsRawRuns({ root, phase: "failed" }))
      .map((run) => run.runId)).toEqual([first.run.runId]);
  });

  it("只在素材完整复制后原子出现 complete manifest", async () => {
    const root = await makeRoot();
    const source = await makePngLikeFile(root, "base.png", "base-image");
    const { run } = await ensureWeixinChannelsRawRun({ root, maxItems: 2 });
    const slot = await reserveWeixinChannelsRawSlot({
      root,
      run,
      source: "recommendation",
      taskId: "task-1",
      query: "推荐页",
      windowId: 101,
    });
    expect(slot).not.toBeNull();
    const committed = await commitWeixinChannelsRawItem({
      root,
      reservation: slot!.reservation,
      capturedAt: "2026-08-15T00:00:00.000Z",
      completedAt: "2026-08-15T00:00:20.000Z",
      captureElapsedMs: 20_000,
      commentsStatus: "entry_missing",
      assets: [{ kind: "player_base", sourceFile: source }],
    });
    expect(committed.manifest.state).toBe("complete");
    const manifests = await listWeixinChannelsRawManifests({ root, runId: run.runId });
    expect(manifests).toHaveLength(1);
    const assetPath = resolveWeixinChannelsRawAssetPath({
      root,
      manifest: manifests[0]!,
      asset: manifests[0]!.assets[0]!,
    });
    expect(await fs.readFile(assetPath, "utf8")).toBe("base-image");
    const snapshot = await inspectWeixinChannelsRawSpool({ root, run });
    expect(snapshot.complete).toBe(1);
    expect(snapshot.reservations).toBe(0);
  });

  it("右窗 UI 失败保留当前截图与 OCR 证据，但不伪造 complete raw item", async () => {
    const root = await makeRoot();
    const screenshot = await makePngLikeFile(root, "right-close-failed.jpg", "right-frame");
    const { run } = await ensureWeixinChannelsRawRun({ root, maxItems: 2 });
    const slot = await reserveWeixinChannelsRawSlot({
      root,
      run,
      source: "recommendation",
      taskId: "task-right",
      query: "推荐页",
      windowId: 58429,
    });
    const evidence = await recordWeixinChannelsRawFailureEvidence({
      root,
      reservation: slot!.reservation,
      reason: "weixin_channels_raw_comments_close_click_not_effective",
      screenshot,
      ocrLines: [{ text: "评论 80", confidence: 0.99, x: 0.08, y: 0.86, width: 0.16, height: 0.04 }],
    });
    const directory = path.join(root, "runs", run.runId, "failures");
    expect(evidence.windowId).toBe(58429);
    expect(evidence.screenshot).toMatch(/\.jpg$/);
    expect(JSON.parse(await fs.readFile(path.join(directory, `${path.basename(evidence.screenshot!, ".jpg")}.json`), "utf8")))
      .toMatchObject({ reason: "weixin_channels_raw_comments_close_click_not_effective", windowId: 58429 });
    expect(await fs.readFile(path.join(directory, evidence.screenshot!), "utf8")).toBe("right-frame");
    expect(await listWeixinChannelsRawManifests({ root, runId: run.runId })).toHaveLength(0);
  });

  it("离线状态只更新 manifest，不改写原始素材", async () => {
    const root = await makeRoot();
    const source = await makePngLikeFile(root, "base.png", "immutable-image");
    const { run } = await ensureWeixinChannelsRawRun({ root, maxItems: 1 });
    const slot = await reserveWeixinChannelsRawSlot({
      root,
      run,
      source: "search_hottest",
      taskId: "task-1",
      query: "陕西女人",
      windowId: 2,
    });
    const committed = await commitWeixinChannelsRawItem({
      root,
      reservation: slot!.reservation,
      capturedAt: "2026-08-15T00:00:00.000Z",
      completedAt: "2026-08-15T00:00:20.000Z",
      captureElapsedMs: 20_000,
      commentsStatus: "captured",
      assets: [{ kind: "player_base", sourceFile: source }],
    });
    const rejected = await updateWeixinChannelsRawManifest({
      root,
      manifest: committed.manifest,
      state: "rejected",
      rejectionReason: "advertisement",
    });
    expect(rejected.state).toBe("rejected");
    expect(await fs.readFile(path.join(committed.directory, rejected.assets[0]!.file), "utf8"))
      .toBe("immutable-image");
  });

  it("磁盘维护只删除旧 completed 批次素材，保留最近批次和审计状态", async () => {
    const root = await makeRoot();
    for (let index = 0; index < 3; index += 1) {
      const source = await makePngLikeFile(root, `source-${index}.png`, `image-${index}`);
      const current = await ensureWeixinChannelsRawRun({
        root,
        maxItems: 1,
        now: Date.now() + index * 1_000,
      });
      const slot = await reserveWeixinChannelsRawSlot({
        root,
        run: current.run,
        source: "recommendation",
        taskId: "task-1",
        query: "推荐页",
        windowId: 101,
      });
      await commitWeixinChannelsRawItem({
        root,
        reservation: slot!.reservation,
        capturedAt: new Date(Date.now() + index * 1_000).toISOString(),
        completedAt: new Date(Date.now() + index * 1_000 + 500).toISOString(),
        captureElapsedMs: 500,
        commentsStatus: "entry_missing",
        assets: [{ kind: "player_base", sourceFile: source }],
      });
      const sealed = await sealWeixinChannelsRawRun({ root, run: current.run });
      await closeWeixinChannelsRawRun({ root, run: sealed });
    }
    const result = await pruneWeixinChannelsCompletedRawRuns({
      root,
      keepRunsWithAssets: 2,
    });
    expect(result).toMatchObject({ completedRuns: 3, prunedRuns: 1 });
    expect(result.releasedBytes).toBeGreaterThan(0);
    const completed = await listWeixinChannelsRawRuns({ root, phase: "complete" });
    expect(completed).toHaveLength(3);
    const oldestManifests = await listWeixinChannelsRawManifests({
      root,
      runId: completed[0]!.runId,
    });
    expect(oldestManifests).toEqual([]);
  });

  it("临时清理只删除过期截图，不删除 pending 和新文件", async () => {
    const root = await makeRoot();
    const oldRaw = await makePngLikeFile(root, "weixin-channels-raw-old.jpg", "old");
    const newRaw = await makePngLikeFile(root, "weixin-channels-raw-new.jpg", "new");
    const pending = await makePngLikeFile(root, "weixin-channels-pending-safe.json", "pending");
    const now = Date.now();
    await fs.utimes(oldRaw, new Date(now - 120_000), new Date(now - 120_000));
    const result = await cleanupWeixinChannelsCollectorTempFiles({
      tempDir: root,
      olderThanMs: 60_000,
      now,
    });
    expect(result).toEqual({ removedFiles: 1, releasedBytes: 3 });
    await expect(fs.stat(oldRaw)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(newRaw, "utf8")).resolves.toBe("new");
    await expect(fs.readFile(pending, "utf8")).resolves.toBe("pending");
  });
});
