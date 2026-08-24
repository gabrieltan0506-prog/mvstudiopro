/**
 * 建单与续跑必须分开：worker 重启只恢复轮询，绝不重新建单。
 * 全部注入假实现，**零付费调用**。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const up = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), pick: vi.fn() }));
const store = vi.hoisted(() => ({ upload: vi.fn(), sign: vi.fn() }));

vi.mock("./evolinkSunoMusic.js", () => ({
  createEvolinkSunoTask: up.create,
  getEvolinkSunoTask: up.get,
  pickEvolinkSunoAudioUrls: up.pick,
}));
vi.mock("./gcs.js", () => ({
  uploadBufferToGcs: store.upload,
  signGsUriV4ReadUrl: store.sign,
}));
vi.mock("./postProdMediaSource.js", () => ({
  postProdOutputPrefix: (uid: string) => `post-prod/${uid}/`,
}));

import {
  createManhuaBgmTask,
  resumeManhuaBgmTask,
  scoringBgmObjectName,
} from "./manhuaScoringRoom";

const brief = {
  model: "suno-v5.5-beta",
  custom_mode: true,
  instrumental: true,
  style: "s",
  prompt: "[Intro]\n[End]",
  title: "t",
  duration: 21,
  negative_tags: "vocals",
  style_weight: 0.78,
  weirdness_constraint: 0.25,
} as never;

beforeEach(() => {
  up.create.mockReset();
  up.get.mockReset();
  up.pick.mockReset();
  store.upload.mockReset();
  store.sign.mockReset();
  store.upload.mockImplementation(async (a: { objectName: string }) => ({
    gcsUri: `gs://b/${a.objectName}`,
  }));
  store.sign.mockImplementation((u: string) => `${u}?sig`);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })),
  );
});

describe("落库位置", () => {
  it("BGM 必须落**本人 post-prod 前缀** —— 别的前缀过不了 bgm_mount 的登记核对", () => {
    expect(scoringBgmObjectName("42", "task-abc", 0)).toMatch(
      /^post-prod\/42\/bgm\/\d{8}\/task-abc-v0\.mp3$/,
    );
  });

  it("taskId 里的非法字符被剥掉，不拼出非法对象名", () => {
    expect(scoringBgmObjectName("42", "a/b?c", 1)).toContain("abc-v1.mp3");
  });
});

describe("建单与续跑分开", () => {
  it("建单只发一次 POST，立刻返回 taskId 供持久化", async () => {
    up.create.mockResolvedValue({ id: "t1" });
    await expect(createManhuaBgmTask(brief)).resolves.toEqual({ taskId: "t1" });
    expect(up.create).toHaveBeenCalledTimes(1);
  });

  it("续跑只吃 taskId，**不碰建单** —— worker 重启不会再付一次", async () => {
    up.get.mockResolvedValue({ task: { status: "completed" }, raw: {} });
    up.pick.mockReturnValue(["https://cdn/1.mp3"]);
    await resumeManhuaBgmTask({ taskId: "t1", userId: "42", brief, pollIntervalMs: 1 });
    expect(up.create).not.toHaveBeenCalled();
  });

  it("变体全部转存返回 —— skill 要求「先量再听」，只留第一条没法量", async () => {
    up.get.mockResolvedValue({ task: { status: "completed" }, raw: {} });
    up.pick.mockReturnValue(["https://cdn/1.mp3", "https://cdn/2.mp3"]);
    const r = await resumeManhuaBgmTask({ taskId: "t1", userId: "42", brief, pollIntervalMs: 1 });
    expect(r.variants).toHaveLength(2);
    expect(r.variants[0]!.gcsUri).toContain("post-prod/42/bgm/");
    expect(r.variants[1]!.index).toBe(1);
  });

  it("上游判失败就抛，不静默返回空结果", async () => {
    up.get.mockResolvedValue({ task: { status: "failed" }, raw: {} });
    await expect(resumeManhuaBgmTask({ taskId: "t1", userId: "42", brief, pollIntervalMs: 1 })).rejects.toThrow(
      "failed",
    );
  });

  it("缺 userId 直接拒 —— 落不到本人前缀就等于生成了也用不了", async () => {
    await expect(
      resumeManhuaBgmTask({ taskId: "t1", userId: "  ", brief }),
    ).rejects.toThrow("会话用户");
  });
});
