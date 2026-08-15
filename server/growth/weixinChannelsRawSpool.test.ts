import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  commitWeixinChannelsRawItem,
  ensureWeixinChannelsRawRun,
  inspectWeixinChannelsRawSpool,
  listWeixinChannelsRawManifests,
  reserveWeixinChannelsRawSlot,
  resolveWeixinChannelsRawAssetPath,
  updateWeixinChannelsRawManifest,
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

  it("三十分钟到点即封批，不等待凑满两千条", async () => {
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
});
