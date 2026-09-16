import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SubmitRejectedError, SubmitUnknownError } from "./submitOutcomeErrors.js";
import {
  advanceManhuaWorldTask,
  createManhuaWorldTask,
  deleteManhuaWorldTask,
  getManhuaWorldTask,
  listManhuaWorldTasks,
  resetManhuaWorldTaskDependenciesForTests,
  retryManhuaWorldTask,
  setManhuaWorldTaskDependenciesForTests,
  shouldManhuaWorldWorkerTouch,
} from "./manhuaWorldTask.js";

const upstream = {
  spzUrls: { "500k": "https://up/500k.spz", full_res: "https://up/full.spz" },
  metricScaleFactor: 2.4,
  groundPlaneOffset: 1.6,
  colliderMeshUrl: "https://up/c.glb",
  panoUrl: "https://up/p.jpg",
  thumbnailUrl: "https://up/t.jpg",
  caption: "deck",
  worldMarbleUrl: "https://marble/w1",
};

function baseInput(over: Partial<Parameters<typeof createManhuaWorldTask>[0]> = {}) {
  return {
    userId: 7,
    sceneRef: "scene:deck",
    sourceVersion: "gs://b/deck.png",
    sourceImageUrl: "https://signed/deck.png?sig=1",
    sourceImageGcsUri: "gs://b/deck.png",
    displayName: "船甲板",
    model: "marble-1.1" as const,
    prompt: { type: "image" as const, isPano: false, textPrompt: "暴风雨夜" },
    ...over,
  };
}

describe("manhuaWorldTask", () => {
  let dir = "";
  let bridge = "";
  const submit = vi.fn();
  const poll = vi.fn();
  const mirror = vi.fn();
  const archive = vi.fn();
  const deleteWorld = vi.fn();
  const signSource = vi.fn();
  const submitDepth = vi.fn();
  const pollDepth = vi.fn();
  const fetchSource = vi.fn();
  const uploadMedia = vi.fn();
  const depthMeta = { width: 1024, height: 512, zMin: 0.3, zMax: 60, encoding: "log_inverse_01" as const };
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "mw-"));
    bridge = await fs.mkdtemp(path.join(os.tmpdir(), "mwb-"));
    process.env.MANHUA_WORLD_TASK_DIR = dir;
    process.env.MANHUA_BRIDGE_DIR = bridge;
    submit.mockReset().mockResolvedValue({ operationId: "op1", worldId: "w1" });
    poll.mockReset().mockResolvedValue({ state: "running", status: "PENDING" });
    mirror.mockReset().mockImplementation(async (ref: { ns: string; id: string; name: string }) => ({ relPath: `${ref.ns}/${ref.id}/${ref.name}`, bytes: 10 }));
    archive.mockReset().mockImplementation(async (_rel: string, objectName: string) => ({ gcsUri: `gs://bucket/${objectName}` }));
    deleteWorld.mockReset().mockResolvedValue(true);
    signSource.mockReset().mockResolvedValue("https://signed/deck.png?sig=fresh");
    submitDepth.mockReset().mockResolvedValue({ operationId: "dop1" });
    pollDepth.mockReset().mockResolvedValue({ state: "running", status: "PENDING" });
    fetchSource.mockReset().mockResolvedValue(new Uint8Array([0x89, 0x50]));
    uploadMedia.mockReset().mockResolvedValue({ mediaAssetId: "ma_depth" });
    setManhuaWorldTaskDependenciesForTests({ isConfigured: () => true, submit, poll, mirror, archive, deleteWorld, signSource, submitDepth, pollDepth, fetchSource, uploadMedia, now: () => new Date("2026-09-16T04:00:00.000Z") });
  });
  afterEach(async () => {
    resetManhuaWorldTaskDependenciesForTests();
    delete process.env.MANHUA_WORLD_TASK_DIR;
    delete process.env.MANHUA_BRIDGE_DIR;
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(bridge, { recursive: true, force: true });
  });

  it("未配置钥匙：建单前失败，不落记录", async () => {
    setManhuaWorldTaskDependenciesForTests({ isConfigured: () => false });
    await expect(createManhuaWorldTask(baseInput())).rejects.toThrow("manhua_world_service_unavailable");
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("建单：场景图按 gs:// 重签后提交，进入 running；同人同图同模型同提示词幂等不重复建单", async () => {
    const view = await createManhuaWorldTask(baseInput());
    expect(view.status).toBe("running");
    expect(view.worldId).toBe("w1");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]).toMatchObject({ model: "marble-1.1", prompt: { type: "image", imageUrl: "https://signed/deck.png?sig=fresh", isPano: false, textPrompt: "暴风雨夜" } });
    const again = await createManhuaWorldTask(baseInput({ sourceImageUrl: "https://signed/deck.png?sig=rotated" }));
    expect(again.taskId).toBe(view.taskId);
    expect(submit).toHaveBeenCalledTimes(1);
    const other = await createManhuaWorldTask(baseInput({ model: "marble-1.0-draft" }));
    expect(other.taskId).not.toBe(view.taskId);
  });

  it("完成：产物镜像到 Fly 桥（稳定地址）并归档 gs://；视图不带上游链接", async () => {
    const view = await createManhuaWorldTask(baseInput());
    poll.mockResolvedValue({ state: "completed", worldId: "w1", assets: upstream });
    const done = await advanceManhuaWorldTask(view.taskId);
    expect(done?.status).toBe("succeeded");
    expect(done?.assets).toMatchObject({
      spz500kUrl: `https://mvstudiopro.com/api/jobs?op=manhuaBridgeMedia&relPath=${encodeURIComponent(`world/${view.taskId}/scene-500k.spz`)}`,
      spz500kGcsUri: `gs://bucket/manhua-world/u7/${view.taskId}/scene-500k.spz`,
      panoUrl: expect.stringContaining("pano.jpg"),
      colliderGlbUrl: expect.stringContaining("collider.glb"),
      thumbnailUrl: expect.stringContaining("thumb.jpg"),
      metricScaleFactor: 2.4,
      groundPlaneOffset: 1.6,
      caption: "deck",
      worldMarbleUrl: "https://marble/w1",
    });
    expect(mirror).toHaveBeenCalledTimes(4);
    expect(mirror.mock.calls[0][1]).toBe("https://up/500k.spz");
    const got = await getManhuaWorldTask(view.taskId, 7);
    expect(JSON.stringify(got)).not.toContain("https://up/");
    expect(await getManhuaWorldTask(view.taskId, 8)).toBeNull();
  });

  it("主产物镜像失败保持 running 下轮重试；归档失败不挡成功、下轮补归档", async () => {
    const view = await createManhuaWorldTask(baseInput());
    poll.mockResolvedValue({ state: "completed", worldId: "w1", assets: upstream });
    mirror.mockRejectedValueOnce(new Error("bridge_fetch_http_500"));
    const r1 = await advanceManhuaWorldTask(view.taskId);
    expect(r1?.status).toBe("running");
    archive.mockRejectedValueOnce(new Error("gcs down"));
    const r2 = await advanceManhuaWorldTask(view.taskId);
    expect(r2?.status).toBe("succeeded");
    expect(r2?.assets?.spz500kUrl).toBeTruthy();
    expect(r2?.assets?.spz500kGcsUri).toBeUndefined();
    // 1472 R3：worker 必须会挑到「成功但主产物未归档」的记录，否则「下轮补归档」永远不发生
    const t2 = Date.parse(r2!.updatedAt);
    expect(shouldManhuaWorldWorkerTouch(r2!, t2 + 5 * 60_000)).toBe(true);
    // 刚失败过：5 分钟内退避，不每 tick 重打 GCS
    expect(shouldManhuaWorldWorkerTouch(r2!, t2 + 60_000)).toBe(false);
    const r3 = await advanceManhuaWorldTask(view.taskId);
    expect(r3?.assets?.spz500kGcsUri).toBe(`gs://bucket/manhua-world/u7/${view.taskId}/scene-500k.spz`);
    expect(shouldManhuaWorldWorkerTouch(r3!, t2 + 10 * 60_000)).toBe(false);
    expect(shouldManhuaWorldWorkerTouch({ status: "failed", updatedAt: r2!.updatedAt }, t2)).toBe(false);
    expect(shouldManhuaWorldWorkerTouch({ status: "running", updatedAt: r2!.updatedAt }, t2)).toBe(true);
    expect(shouldManhuaWorldWorkerTouch({ ...r2!, deletedAt: "2026-09-16T05:00:00.000Z" }, t2 + 10 * 60_000)).toBe(false);
  });

  it("提交 rejected → failed 可重试（新任务号）；unknown → reconcile 禁重试；上游报错 → failed", async () => {
    submit.mockRejectedValueOnce(new SubmitRejectedError("marble_submit_rejected_422"));
    const failed = await createManhuaWorldTask(baseInput());
    expect(failed.status).toBe("failed");
    submit.mockResolvedValueOnce({ operationId: "op2" });
    const submitsBefore = submit.mock.calls.length;
    const retried = await retryManhuaWorldTask(failed.taskId, 7);
    expect(retried?.status).toBe("running");
    expect(retried?.taskId).not.toBe(failed.taskId);
    // 1472 R1：同一失败任务再点一次重试 → 同一个重试任务号，不再向上游提交第二单
    const again = await retryManhuaWorldTask(failed.taskId, 7);
    expect(again?.taskId).toBe(retried?.taskId);
    expect(submit.mock.calls.length).toBe(submitsBefore + 1);
    await expect(retryManhuaWorldTask(retried!.taskId, 7)).rejects.toThrow("manhua_world_retry_not_failed");

    submit.mockRejectedValueOnce(new SubmitUnknownError("marble_submit_network:AbortError"));
    const unknown = await createManhuaWorldTask(baseInput({ sceneRef: "scene:2" }));
    expect(unknown.status).toBe("reconcile_manual");
    await expect(retryManhuaWorldTask(unknown.taskId, 7)).rejects.toThrow("manhua_world_retry_reconcile_forbidden");

    const running = await createManhuaWorldTask(baseInput({ sceneRef: "scene:3" }));
    poll.mockResolvedValueOnce({ state: "failed", error: "[3] nsfw" });
    expect((await advanceManhuaWorldTask(running.taskId))?.status).toBe("failed");
  });

  it("超时转人工对账；列表只列本人未删除；删除调上游删世界、进行中的不许删", async () => {
    const a = await createManhuaWorldTask(baseInput());
    await expect(deleteManhuaWorldTask(a.taskId, 7)).rejects.toThrow("manhua_world_delete_busy");
    setManhuaWorldTaskDependenciesForTests({ isConfigured: () => true, submit, poll, mirror, archive, deleteWorld, signSource, now: () => new Date("2026-09-16T06:00:00.000Z") });
    expect((await advanceManhuaWorldTask(a.taskId))?.status).toBe("reconcile_manual");
    expect((await listManhuaWorldTasks(7)).map((t) => t.taskId)).toEqual([a.taskId]);
    expect(await listManhuaWorldTasks(8)).toEqual([]);
    expect(await deleteManhuaWorldTask(a.taskId, 7)).toBe(true);
    expect(deleteWorld).toHaveBeenCalledWith("w1");
    expect(await listManhuaWorldTasks(7)).toEqual([]);
    expect(await getManhuaWorldTask(a.taskId, 7)).toBeNull();
  });

  it("PR-11/WL-D01 layout：深度 PNG 先传 media asset，再以 media_asset 引用 + z_min/z_max 提交 depth_to_rgb，得全景后以 is_pano:true 建世界；两步 operationId 与 cost 各自持久化", async () => {
    const input = baseInput({ sceneRef: "scene:layout", sourceImageUrl: "https://signed/depth.png", sourceImageGcsUri: undefined, prompt: { type: "layout", depthPanoUrl: "https://signed/depth.png", depthMeta, textPrompt: "雨夜甲板" } });
    const view = await createManhuaWorldTask(input);
    expect(view.status).toBe("running");
    expect(fetchSource).toHaveBeenCalledWith("https://signed/depth.png");
    expect(uploadMedia).toHaveBeenCalledWith(expect.objectContaining({ contentType: "image/png", kind: "image", extension: "png" }));
    expect(submitDepth).toHaveBeenCalledWith({ depth: { source: "media_asset", mediaAssetId: "ma_depth" }, textPrompt: "雨夜甲板", zMin: 0.3, zMax: 60 });
    expect(submit).not.toHaveBeenCalled();
    let rec = JSON.parse(await fs.readFile(path.join(dir, `${view.taskId}.json`), "utf8"));
    expect(rec.depthMediaAssetId).toBe("ma_depth");
    expect(rec.depthOperationId).toBe("dop1");
    expect(rec.operationId).toBeUndefined();
    // 元数据原样持久化并可恢复
    expect(rec.prompt.depthMeta).toEqual(depthMeta);

    pollDepth.mockResolvedValueOnce({ state: "completed", panoUrl: "https://up/rgb-pano.jpg", cost: { totalCredits: 150 } });
    await advanceManhuaWorldTask(view.taskId);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ prompt: { type: "image", imageUrl: "https://up/rgb-pano.jpg", isPano: true, textPrompt: "雨夜甲板" } }));
    rec = JSON.parse(await fs.readFile(path.join(dir, `${view.taskId}.json`), "utf8"));
    expect(rec.depthPanoRgbUrl).toBe("https://up/rgb-pano.jpg");
    expect(rec.depthCost).toEqual({ totalCredits: 150 });
    expect(rec.operationId).toBe("op1");
    expect(rec.status).toBe("running");

    poll.mockResolvedValueOnce({ state: "completed", worldId: "w9", assets: upstream, cost: { totalCredits: 1500 } });
    const done = await advanceManhuaWorldTask(view.taskId);
    expect(done?.status).toBe("succeeded");
    expect(done?.assets?.spz500kUrl).toMatch(/scene-500k\.spz/);
    expect(done?.worldCost).toEqual({ totalCredits: 1500 });
    expect(done?.depthCost).toEqual({ totalCredits: 150 });
  });

  it("WL-D01：缺/坏 depthMeta 建单前拒，零上游调用（不拉图、不传、不提交）", async () => {
    for (const bad of [undefined, { ...depthMeta, zMin: 0 }, { ...depthMeta, zMax: 0.3 }, { ...depthMeta, height: 500 }, { ...depthMeta, encoding: "near_bright_linear" }]) {
      await expect(
        createManhuaWorldTask(baseInput({ sceneRef: `scene:bad-${String(bad ? JSON.stringify(bad).length : 0)}`, prompt: { type: "layout", depthPanoUrl: "https://signed/d.png", depthMeta: bad as never, textPrompt: "夜" } })),
      ).rejects.toThrow("invalid_manhua_world_depth_meta");
    }
    expect(fetchSource).not.toHaveBeenCalled();
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(submitDepth).not.toHaveBeenCalled();
  });

  it("PR-11 layout：带 gs:// 时第一步先重新签名再拉图（签名 url 过期后重试也能用）；签名/拉图/上传失败 → failed 不占上游", async () => {
    const view = await createManhuaWorldTask(baseInput({ sceneRef: "scene:lg", sourceImageUrl: "https://signed/d.png", sourceImageGcsUri: undefined, prompt: { type: "layout", depthPanoUrl: "https://signed/stale.png", depthPanoGcsUri: "gs://b/depth.png", depthMeta, textPrompt: "夜" } }));
    expect(view.status).toBe("running");
    expect(signSource).toHaveBeenCalledWith("gs://b/depth.png");
    expect(fetchSource).toHaveBeenCalledWith("https://signed/deck.png?sig=fresh");
    signSource.mockRejectedValueOnce(new Error("sign_down"));
    const bad = await createManhuaWorldTask(baseInput({ sceneRef: "scene:lg2", sourceImageUrl: "https://signed/d.png", sourceImageGcsUri: undefined, prompt: { type: "layout", depthPanoUrl: "https://signed/stale.png", depthPanoGcsUri: "gs://b/depth2.png", depthMeta, textPrompt: "夜" } }));
    expect(bad.status).toBe("failed");
    fetchSource.mockRejectedValueOnce(new Error("depth_source_http_403"));
    const bad2 = await createManhuaWorldTask(baseInput({ sceneRef: "scene:lg3", sourceImageUrl: "https://signed/d.png", sourceImageGcsUri: undefined, prompt: { type: "layout", depthPanoUrl: "https://signed/d3.png", depthMeta, textPrompt: "夜" } }));
    expect(bad2.status).toBe("failed");
    expect(bad2.errorZh).toContain("拉取失败");
    uploadMedia.mockRejectedValueOnce(new SubmitRejectedError("marble_media_put_http_403"));
    const bad3 = await createManhuaWorldTask(baseInput({ sceneRef: "scene:lg4", sourceImageUrl: "https://signed/d.png", sourceImageGcsUri: undefined, prompt: { type: "layout", depthPanoUrl: "https://signed/d4.png", depthMeta, textPrompt: "夜" } }));
    expect(bad3.status).toBe("failed");
    expect(bad3.errorZh).toContain("素材库");
    expect(submitDepth).toHaveBeenCalledTimes(1);
  });

  it("PR-11 layout：第一步 rejected → failed 可重试（media asset 留用不重传）；第一步 poll 报错 → failed；第二步提交 unknown → reconcile（第一步产物留在记录里）", async () => {
    submitDepth.mockRejectedValueOnce(new SubmitRejectedError("marble_depth_submit_rejected_422"));
    const failed = await createManhuaWorldTask(baseInput({ sceneRef: "scene:l1", sourceImageUrl: "https://signed/d.png", sourceImageGcsUri: undefined, prompt: { type: "layout", depthPanoUrl: "https://signed/d.png", depthMeta, textPrompt: "夜" } }));
    expect(failed.status).toBe("failed");
    expect(failed.errorZh).toContain("深度全景");
    const retried = await retryManhuaWorldTask(failed.taskId, 7);
    expect(retried?.status).toBe("running");
    expect(submitDepth).toHaveBeenCalledTimes(2);
    expect(uploadMedia).toHaveBeenCalledTimes(1);

    const running = await createManhuaWorldTask(baseInput({ sceneRef: "scene:l2", sourceImageUrl: "https://signed/d.png", sourceImageGcsUri: undefined, prompt: { type: "layout", depthPanoUrl: "https://signed/d.png", depthMeta, textPrompt: "夜" } }));
    pollDepth.mockResolvedValueOnce({ state: "failed", error: "[9] bad depth" });
    expect((await advanceManhuaWorldTask(running.taskId))?.status).toBe("failed");

    const second = await createManhuaWorldTask(baseInput({ sceneRef: "scene:l3", sourceImageUrl: "https://signed/d.png", sourceImageGcsUri: undefined, prompt: { type: "layout", depthPanoUrl: "https://signed/d.png", depthMeta, textPrompt: "夜" } }));
    pollDepth.mockResolvedValueOnce({ state: "completed", panoUrl: "https://up/p.jpg" });
    submit.mockRejectedValueOnce(new SubmitUnknownError("marble_submit_network:AbortError"));
    const rec = await advanceManhuaWorldTask(second.taskId);
    expect(rec?.status).toBe("reconcile_manual");
    expect(rec?.depthPanoRgbUrl).toBe("https://up/p.jpg");
    expect(rec?.depthOperationId).toBe("dop1");
    await expect(retryManhuaWorldTask(second.taskId, 7)).rejects.toThrow("manhua_world_retry_reconcile_forbidden");

    // 非 https 深度图 / 空提示：建单前拒
    await expect(createManhuaWorldTask(baseInput({ sceneRef: "scene:l4", prompt: { type: "layout", depthPanoUrl: "http://x/d.png", depthMeta, textPrompt: "夜" } }))).rejects.toThrow("invalid_manhua_world_task_input");
  });

  it("两步恢复：第二步（建世界）rejected 失败后重试只重做第二步——不重传、不重新上色、不重付第一步", async () => {
    const view = await createManhuaWorldTask(baseInput({ sceneRef: "scene:l5", sourceImageUrl: "https://signed/d.png", sourceImageGcsUri: undefined, prompt: { type: "layout", depthPanoUrl: "https://signed/d.png", depthMeta, textPrompt: "夜" } }));
    pollDepth.mockResolvedValueOnce({ state: "completed", panoUrl: "https://up/p5.jpg", cost: { totalCredits: 150 } });
    submit.mockRejectedValueOnce(new SubmitRejectedError("marble_submit_rejected_422"));
    const failed = await advanceManhuaWorldTask(view.taskId);
    expect(failed?.status).toBe("failed");
    expect(failed?.depthPanoRgbUrl).toBe("https://up/p5.jpg");
    const retried = await retryManhuaWorldTask(view.taskId, 7);
    expect(retried?.status).toBe("running");
    expect(uploadMedia).toHaveBeenCalledTimes(1);
    expect(submitDepth).toHaveBeenCalledTimes(1);
    // 建单时轮询一次（running）+ 完成一次 = 2；重试后不再轮第一步
    expect(pollDepth).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: { type: "image", imageUrl: "https://up/p5.jpg", isPano: true, textPrompt: "夜" } }));
    const rec = JSON.parse(await fs.readFile(path.join(dir, `${retried!.taskId}.json`), "utf8"));
    expect(rec.depthMediaAssetId).toBe("ma_depth");
    expect(rec.depthOperationId).toBe("dop1");
    expect(rec.depthCost).toEqual({ totalCredits: 150 });
    expect(rec.worldCost).toBeUndefined();
  });
});
