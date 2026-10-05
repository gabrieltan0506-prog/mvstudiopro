import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManhuaStoryAssetRefreshRunError, readManhuaStoryAssetRefreshRun, runManhuaStoryAssetRefresh, type ManhuaStoryAssetRefreshRunInput, type ManhuaStoryAssetRefreshRunRecord } from "./manhuaStoryAssetRefreshRun";

beforeEach(() => { vi.stubGlobal("navigator", undefined); });
afterEach(() => { vi.unstubAllGlobals(); });
function storage() {
  const values = new Map<string, string>();
  const writes: Array<{ key: string; record: ManhuaStoryAssetRefreshRunRecord }> = [];
  const state = { fail: (_key: string, _value: string) => false, ignore: false };
  return { values, writes, state,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (state.fail(key, value)) throw new Error("本机存储空间不足");
      writes.push({ key, record: JSON.parse(value) });
      if (!state.ignore) values.set(key, value);
    },
  };
}
function fixture() {
  const store = storage();
  const state = { current: true };
  const input: ManhuaStoryAssetRefreshRunInput = {
    storage: store, key: "asset-journal:7:project-a", operationId: "accepted-edit-1", scopeKey: "7:project-a", sourceFingerprint: "accepted-body-v1",
    isCurrent: () => state.current,
    generateSettings: vi.fn(async () => "## 人物表\n完整人物设定\n## 道具表\n完整道具设定\n## 场景表\n完整场景设定"),
    applySettingsAndGenerateImages: vi.fn(async (_text, controls) => {
      controls.assertCurrent();
      controls.onImageTaskCreated("propsheet-jade", "real-job-1");
      return { planned: 1, completed: 1 };
    }),
  };
  return { store, input, state };
}
const seed = (input: ManhuaStoryAssetRefreshRunInput, status: ManhuaStoryAssetRefreshRunRecord["status"]): ManhuaStoryAssetRefreshRunRecord => ({ version: 1, operationId: input.operationId, scopeKey: input.scopeKey, sourceFingerprint: input.sourceFingerprint, status, imageTasks: [], createdAt: "2026-10-05T15:00:00.000Z", updatedAt: "2026-10-05T15:00:00.000Z" });

describe("剧情确认后资产原链只执行一次并保全回执", () => {
  it("调用前started读回，模型原文立刻保存，每笔真实jobId都先保存再继续", async () => {
    const { store, input } = fixture();
    const longText = "原始资产设定".repeat(10000) + "尾部仍在";
    input.generateSettings = vi.fn(async ({ operationId }) => {
      expect(operationId).toBe(input.operationId);
      expect(readManhuaStoryAssetRefreshRun(store, input.key)?.status).toBe("started");
      return longText;
    });
    input.applySettingsAndGenerateImages = vi.fn(async (text, controls) => {
      expect(text).toBe(longText);
      expect(readManhuaStoryAssetRefreshRun(store, input.key)).toMatchObject({ status: "images_running", settingsText: longText });
      for (const [blockId, jobId] of [["propsheet-jade", "real-job-1"], ["sceneplate-lake", "real-job-2"]]) {
        controls.assertCurrent();
        controls.onImageTaskCreated(blockId, jobId);
        expect(readManhuaStoryAssetRefreshRun(store, input.key)?.imageTasks.at(-1)).toMatchObject({ blockId, jobId });
      }
      return { planned: 2, completed: 2 };
    });
    const result = await runManhuaStoryAssetRefresh(input);
    expect(result).toMatchObject({ status: "done", settingsText: longText, result: { planned: 2, completed: 2 } });
    expect(store.writes.map(write => write.record.status)).toEqual(["started", "settings_received", "images_running", "images_running", "images_running", "images_running", "done"]);
  });

  it.each(["started", "settings_received", "images_running", "failed"] as const)("原记录%s一律不重新下单", async status => {
    const { store, input } = fixture();
    const previous = seed(input, status); store.values.set(input.key, JSON.stringify(previous));
    await expect(runManhuaStoryAssetRefresh({ ...input, operationId: "new-random-id" })).rejects.toThrow("未重复提交");
    expect(input.generateSettings).not.toHaveBeenCalled(); expect(input.applySettingsAndGenerateImages).not.toHaveBeenCalled();
    expect(readManhuaStoryAssetRefreshRun(store, input.key)).toEqual(previous);
  });

  it("相同剧情已done直接读回；新剧情先归档旧回执，同一编号不得换剧情", async () => {
    const { store, input } = fixture();
    const result = await runManhuaStoryAssetRefresh(input);
    await expect(runManhuaStoryAssetRefresh({ ...input, operationId: "another-random-id" })).resolves.toEqual(result);
    expect(input.generateSettings).toHaveBeenCalledTimes(1);
    await expect(runManhuaStoryAssetRefresh({ ...input, sourceFingerprint: "accepted-body-v2" })).rejects.toThrow("同一操作编号");
    const next = await runManhuaStoryAssetRefresh({ ...input, operationId: "accepted-edit-2", sourceFingerprint: "accepted-body-v2" });
    expect(next.status).toBe("done");
    expect(JSON.parse(store.getItem(`${input.key}:history:${input.operationId}`)!)).toEqual(result);
    expect(input.generateSettings).toHaveBeenCalledTimes(2);
  });

  it("started写入或readback失败时不调用付费模型", async () => {
    for (const failure of ["throw", "ignore"]) {
      const { store, input } = fixture();
      if (failure === "throw") store.state.fail = () => true; else store.state.ignore = true;
      await expect(runManhuaStoryAssetRefresh(input)).rejects.toBeInstanceOf(ManhuaStoryAssetRefreshRunError);
      expect(input.generateSettings).not.toHaveBeenCalled(); expect(input.applySettingsAndGenerateImages).not.toHaveBeenCalled();
    }
  });

  it("三表解析或写回失败仍保留完整模型原文，只保存错误message且禁止再生成", async () => {
    const { store, input } = fixture();
    const cause = Object.assign(new Error("三表缺字段"), { response: "不应入记录的响应体" });
    input.applySettingsAndGenerateImages = vi.fn(async () => { throw cause; });
    await expect(runManhuaStoryAssetRefresh(input)).rejects.toThrow("三表缺字段");
    const failed = readManhuaStoryAssetRefreshRun(store, input.key)!;
    expect(failed).toMatchObject({ status: "failed", error: "三表缺字段", settingsText: expect.stringContaining("完整场景设定") });
    expect(JSON.stringify(failed)).not.toMatch(/response|stack|响应体/);
    await expect(runManhuaStoryAssetRefresh(input)).rejects.toThrow("未重复提交");
    expect(input.generateSettings).toHaveBeenCalledTimes(1);
  });

  it("晚到模型回包先保存原文，再因作品变化停止写表与生图", async () => {
    const { store, input, state } = fixture();
    input.generateSettings = vi.fn(async () => { state.current = false; return "已付费返回的三表全文"; });
    await expect(runManhuaStoryAssetRefresh(input)).rejects.toThrow("作品或已接受剧情已变化");
    expect(readManhuaStoryAssetRefreshRun(store, input.key)).toMatchObject({ status: "failed", settingsText: "已付费返回的三表全文" });
    expect(input.applySettingsAndGenerateImages).not.toHaveBeenCalled();
  });

  it("晚到图片jobId即使已切作品也先保全，之后禁止写回新作品", async () => {
    const { store, input, state } = fixture();
    input.applySettingsAndGenerateImages = vi.fn(async (_text, controls) => {
      state.current = false;
      controls.onImageTaskCreated("sceneplate-lake", "late-real-job");
      return { planned: 1, completed: 1 };
    });
    await expect(runManhuaStoryAssetRefresh(input)).rejects.toThrow("作品或已接受剧情已变化");
    expect(readManhuaStoryAssetRefreshRun(store, input.key)).toMatchObject({ status: "failed", imageTasks: [expect.objectContaining({ jobId: "late-real-job" })] });
  });

  it("回执存储失败设粘性阻断，宿主吞错后也不能提交下一张；错误对象带完整回执", async () => {
    const { store, input } = fixture();
    let refusedOnce = false;
    store.state.fail = (_key, raw) => { if (!refusedOnce && JSON.parse(raw).imageTasks?.length) { refusedOnce = true; return true; } return false; };
    input.applySettingsAndGenerateImages = vi.fn(async (_text, controls) => {
      try { controls.onImageTaskCreated("propsheet-jade", "paid-job-1"); } catch { /* 模拟原宿主处理单图失败后继续循环。 */ }
      expect(() => controls.assertCurrent()).toThrow("本机存储空间不足");
      return { planned: 2, completed: 1 };
    });
    let failure: unknown;
    try { await runManhuaStoryAssetRefresh(input); } catch (cause) { failure = cause; }
    expect(failure).toBeInstanceOf(ManhuaStoryAssetRefreshRunError);
    expect((failure as ManhuaStoryAssetRefreshRunError).record?.imageTasks).toEqual([expect.objectContaining({ jobId: "paid-job-1" })]);
    expect(readManhuaStoryAssetRefreshRun(store, input.key)).toMatchObject({ status: "failed", imageTasks: [expect.objectContaining({ jobId: "paid-job-1" })] });
  });

  it("模型完成后持续不可写仍通过错误record保全原文，不触发生图", async () => {
    const { store, input } = fixture();
    input.generateSettings = vi.fn(async () => { store.state.fail = () => true; return "不能丢失的付费原文"; });
    let failure: unknown;
    try { await runManhuaStoryAssetRefresh(input); } catch (cause) { failure = cause; }
    expect((failure as ManhuaStoryAssetRefreshRunError).record).toMatchObject({ status: "failed", settingsText: "不能丢失的付费原文" });
    expect(input.applySettingsAndGenerateImages).not.toHaveBeenCalled();
  });

  it("其他操作覆盖journal时不回写旧scope，已返回原文保留在错误record", async () => {
    const { store, input } = fixture();
    const newer = { ...seed(input, "started"), operationId: "newer-id", scopeKey: "7:project-b" };
    input.generateSettings = vi.fn(async () => { store.values.set(input.key, JSON.stringify(newer)); return "旧任务的完整回包"; });
    let failure: unknown;
    try { await runManhuaStoryAssetRefresh(input); } catch (cause) { failure = cause; }
    expect((failure as ManhuaStoryAssetRefreshRunError).record?.settingsText).toBe("旧任务的完整回包");
    expect(readManhuaStoryAssetRefreshRun(store, input.key)).toEqual(newer);
    expect(input.applySettingsAndGenerateImages).not.toHaveBeenCalled();
  });

  it("部分图片结果保留回执而非done；没有真实jobId不能把旧图当新成功", async () => {
    for (const hasTask of [true, false]) {
      const { store, input } = fixture();
      input.applySettingsAndGenerateImages = vi.fn(async (_text, controls) => {
        if (hasTask) controls.onImageTaskCreated("propsheet-jade", "paid-job");
        return { planned: 2, completed: hasTask ? 1 : 2 };
      });
      await expect(runManhuaStoryAssetRefresh(input)).rejects.toThrow("尚未全部取得成功回执");
      expect(readManhuaStoryAssetRefreshRun(store, input.key)).toMatchObject({ status: "failed", result: { planned: 2, completed: hasTask ? 1 : 2 } });
    }
  });

  it("同页并发触发只调用模型一次，模型断网状态不明也禁止刷新重提", async () => {
    const { input, store } = fixture();
    let release!: () => void;
    input.generateSettings = vi.fn(() => new Promise<string>((_resolve, reject) => { release = () => reject(new Error("请求中断，任务状态未知")); }));
    const first = runManhuaStoryAssetRefresh(input);
    await expect(runManhuaStoryAssetRefresh(input)).rejects.toThrow("正在执行");
    release();
    await expect(first).rejects.toThrow("任务状态未知");
    await expect(runManhuaStoryAssetRefresh(input)).rejects.toThrow("未重复提交");
    expect(input.generateSettings).toHaveBeenCalledTimes(1);
    expect(readManhuaStoryAssetRefreshRun(store, input.key)?.status).toBe("failed");
  });

  it("跨标签锁不可用拒绝付费，恢复只读不调用生产者", async () => {
    const { input, store } = fixture();
    vi.stubGlobal("navigator", { locks: { request: vi.fn(async (_key, _options, callback) => callback(null)) } });
    await expect(runManhuaStoryAssetRefresh(input)).rejects.toThrow("另一标签");
    expect(readManhuaStoryAssetRefreshRun(store, input.key)).toBeNull();
    expect(input.generateSettings).not.toHaveBeenCalled();
  });

  it("损坏记录只读报错，不覆盖为新操作或自动付费", async () => {
    for (const raw of ["null", "not-json", JSON.stringify({ version: 1, operationId: 5 })]) {
      const { input, store } = fixture();
      store.values.set(input.key, raw);
      await expect(runManhuaStoryAssetRefresh(input)).rejects.toBeInstanceOf(ManhuaStoryAssetRefreshRunError);
      expect(store.getItem(input.key)).toBe(raw);
      expect(input.generateSettings).not.toHaveBeenCalled();
    }
  });
});
