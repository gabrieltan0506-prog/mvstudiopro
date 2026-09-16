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
    setManhuaWorldTaskDependenciesForTests({ isConfigured: () => true, submit, poll, mirror, archive, deleteWorld, signSource, submitDepth, pollDepth, now: () => new Date("2026-09-16T04:00:00.000Z") });
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

  it("PR-11 layout：两步链路——先 depth_to_rgb 得全景，再以 is_pano:true 建世界；两步各记 operationId", async () => {
    const input = baseInput({ sceneRef: "scene:layout", sourceImageUrl: "https://signed/depth.png", sourceImageGcsUri: undefined, prompt: { type: "layout", depthPanoUrl: "https://signed/depth.png", textPrompt: "雨夜甲板" } });
    const view = await createManhuaWorldTask(input);
    expect(view.status).toBe("running");
    expect(submitDepth).toHaveBeenCalledWith({ depthPanoUrl: "https://signed/depth.png", textPrompt: "雨夜甲板" });
    expect(submit).not.toHaveBeenCalled();
    let rec = JSON.parse(await fs.readFile(path.join(dir, `${view.taskId}.json`), "utf8"));
    expect(rec.depthOperationId).toBe("dop1");
    expect(rec.operationId).toBeUndefined();

    pollDepth.mockResolvedValueOnce({ state: "completed", panoUrl: "https://up/rgb-pano.jpg" });
    await advanceManhuaWorldTask(view.taskId);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ prompt: { type: "image", imageUrl: "https://up/rgb-pano.jpg", isPano: true, textPrompt: "雨夜甲板" } }));
    rec = JSON.parse(await fs.readFile(path.join(dir, `${view.taskId}.json`), "utf8"));
    expect(rec.depthPanoRgbUrl).toBe("https://up/rgb-pano.jpg");
    expect(rec.operationId).toBe("op1");
    expect(rec.status).toBe("running");

    poll.mockResolvedValueOnce({ state: "completed", worldId: "w9", assets: upstream });
    const done = await advanceManhuaWorldTask(view.taskId);
    expect(done?.status).toBe("succeeded");
    expect(done?.assets?.spz500kUrl).toMatch(/scene-500k\.spz/);
  });

  it("PR-11 layout：带 gs:// 时第一步先重新签名再提交（签名 url 过期后重试也能用）；签名失败 → failed 不占上游", async () => {
    const view = await createManhuaWorldTask(baseInput({ sceneRef: "scene:lg", sourceImageUrl: "https://signed/d.png", sourceImageGcsUri: undefined, prompt: { type: "layout", depthPanoUrl: "https://signed/stale.png", depthPanoGcsUri: "gs://b/depth.png", textPrompt: "夜" } }));
    expect(view.status).toBe("running");
    expect(signSource).toHaveBeenCalledWith("gs://b/depth.png");
    expect(submitDepth).toHaveBeenCalledWith({ depthPanoUrl: "https://signed/deck.png?sig=fresh", textPrompt: "夜" });
    signSource.mockRejectedValueOnce(new Error("sign_down"));
    const bad = await createManhuaWorldTask(baseInput({ sceneRef: "scene:lg2", sourceImageUrl: "https://signed/d.png", sourceImageGcsUri: undefined, prompt: { type: "layout", depthPanoUrl: "https://signed/stale.png", depthPanoGcsUri: "gs://b/depth2.png", textPrompt: "夜" } }));
    expect(bad.status).toBe("failed");
    expect(submitDepth).toHaveBeenCalledTimes(1);
  });

  it("PR-11 layout：第一步 rejected → failed 可重试；第一步 poll 报错 → failed；第二步提交 unknown → reconcile", async () => {
    submitDepth.mockRejectedValueOnce(new SubmitRejectedError("marble_depth_submit_rejected_422"));
    const failed = await createManhuaWorldTask(baseInput({ sceneRef: "scene:l1", sourceImageUrl: "https://signed/d.png", sourceImageGcsUri: undefined, prompt: { type: "layout", depthPanoUrl: "https://signed/d.png", textPrompt: "夜" } }));
    expect(failed.status).toBe("failed");
    expect(failed.errorZh).toContain("深度全景");
    const retried = await retryManhuaWorldTask(failed.taskId, 7);
    expect(retried?.status).toBe("running");
    expect(submitDepth).toHaveBeenCalledTimes(2);

    const running = await createManhuaWorldTask(baseInput({ sceneRef: "scene:l2", sourceImageUrl: "https://signed/d.png", sourceImageGcsUri: undefined, prompt: { type: "layout", depthPanoUrl: "https://signed/d.png", textPrompt: "夜" } }));
    pollDepth.mockResolvedValueOnce({ state: "failed", error: "[9] bad depth" });
    expect((await advanceManhuaWorldTask(running.taskId))?.status).toBe("failed");

    const second = await createManhuaWorldTask(baseInput({ sceneRef: "scene:l3", sourceImageUrl: "https://signed/d.png", sourceImageGcsUri: undefined, prompt: { type: "layout", depthPanoUrl: "https://signed/d.png", textPrompt: "夜" } }));
    pollDepth.mockResolvedValueOnce({ state: "completed", panoUrl: "https://up/p.jpg" });
    submit.mockRejectedValueOnce(new SubmitUnknownError("marble_submit_network:AbortError"));
    const rec = await advanceManhuaWorldTask(second.taskId);
    expect(rec?.status).toBe("reconcile_manual");
    await expect(retryManhuaWorldTask(second.taskId, 7)).rejects.toThrow("manhua_world_retry_reconcile_forbidden");

    // 非 https 深度图 / 空提示：建单前拒
    await expect(createManhuaWorldTask(baseInput({ sceneRef: "scene:l4", prompt: { type: "layout", depthPanoUrl: "http://x/d.png", textPrompt: "夜" } }))).rejects.toThrow("invalid_manhua_world_task_input");
  });
});
