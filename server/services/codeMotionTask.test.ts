import { expect, it, vi } from "vitest";
import {
  codeMotionRenderIdentity,
  submitCodeMotion,
  type CodeMotionTaskDeps,
} from "./codeMotionTask";
import { codeMotionProjectSchema } from "../../shared/codeMotion";
const project = codeMotionProjectSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  brief: {
    title: "作品",
    request: "介绍原文",
    text: "",
    style: "words",
    duration: 15,
    orientation: "landscape",
    images: [],
    data: [],
    unit: "",
  },
  plan: {
    version: 1,
    summary: "一页说明",
    scenes: [
      {
        heading: "介绍",
        body: "原文",
        speech: { text: "原文", voice: "female" },
        duration: 15,
      },
    ],
  },
});
it("同版本重复点击与重进页面恢复原任务，不新排队", async () => {
  const identity = codeMotionRenderIdentity("1", project);
  const row = {
    id: identity.jobId,
    userId: "1",
    type: "post_prod",
    status: "failed",
    input: {
      action: "art_motion",
      scopeKey: identity.scopeKey,
      requestId: identity.requestId,
      params: Object.fromEntries(Object.entries(identity.spec).reverse()),
    },
    output: null,
    error: "fixture",
    provider: "canvas-art-motion",
    createdAt: null,
    updatedAt: null,
  };
  const queue = vi.fn(),
    resolve = vi.fn();
  const deps = {
    load: async () => row,
    queue,
    resolve,
    view: (r: typeof row) => ({ ...r, jobId: r.id }),
  } as unknown as CodeMotionTaskDeps;
  expect(
    await submitCodeMotion("1", project, identity.fingerprint, deps)
  ).toEqual({ jobId: identity.jobId, status: "failed" });
  expect(queue).not.toHaveBeenCalled();
  expect(resolve).not.toHaveBeenCalled();
  await expect(
    submitCodeMotion("1", project, "0".repeat(64), deps)
  ).rejects.toThrow("内容已修改");
  expect(codeMotionRenderIdentity("2", project).jobId).not.toBe(identity.jobId);
});
it("首次提交先走素材归属核验，再走原幂等队列", async () => {
  const identity = codeMotionRenderIdentity("1", project),
    queue = vi
      .fn()
      .mockResolvedValue({ jobId: identity.jobId, status: "queued" }),
    resolve = vi.fn(async (v: { input: unknown }) => v.input);
  const deps = {
    load: async () => null,
    speechEnabled: () => true,
    queue,
    resolve,
    view: vi.fn(),
  } as unknown as CodeMotionTaskDeps;
  await submitCodeMotion("1", project, identity.fingerprint, deps);
  expect(resolve).toHaveBeenCalledOnce();
  expect(queue).toHaveBeenCalledWith("1", {
    action: "art_motion",
    scopeKey: identity.scopeKey,
    requestId: identity.requestId,
    params: identity.spec,
  });
});

function silentProject() {
  return codeMotionProjectSchema.parse({
    id: project.id,
    brief: {
      ...project.brief,
      request: "九十秒无声逐镜作品",
      style: "scenes",
      duration: 90,
    },
    plan: {
      version: 1,
      summary: "文字沿画面移动，无声展示",
      scenes: [
        {
          heading: "无声画面",
          body: "",
          duration: 90,
          composition: {
            id: "silent_scene",
            duration: 90,
            elements: [
              {
                id: "moving_text",
                type: "text",
                text: "真实编译的画面",
                keyframes: [
                  { at: 0, x: 0.2 },
                  { at: 90, x: 0.8 },
                ],
              },
            ],
          },
        },
      ],
    },
  });
}

it("无声逐镜沿原权限和名额来源提交，恢复同任务并保留账号及版本门禁", async () => {
  const p = silentProject(),
    identity = codeMotionRenderIdentity("1", p);
  const source = { day: "2026-10-11", ipHash: "test-ip-hash" };
  const load = vi.fn(async () => null as unknown);
  const queue = vi.fn(async () => ({
    jobId: identity.jobId,
    status: "queued",
  }));
  const resolve = vi.fn(async ({ input }: { input: unknown }) => input);
  const audioOwnership = vi.fn(async () => {});
  const deps = {
    load,
    queue,
    resolve,
    audioOwnership,
    view: vi.fn(() => ({ jobId: identity.jobId, status: "queued" })),
  } as unknown as CodeMotionTaskDeps;
  expect(identity.spec.inkSpeech).toBeUndefined();
  expect(identity.spec.codeAudio).toBeUndefined();
  expect(identity.spec.composition?.scenes[0].elements[0]).toMatchObject({
    type: "text",
    text: "真实编译的画面",
  });
  const input = {
    action: "art_motion",
    scopeKey: identity.scopeKey,
    requestId: identity.requestId,
    params: identity.spec,
  };
  expect(
    await submitCodeMotion("1", p, identity.fingerprint, deps, source)
  ).toEqual({ jobId: identity.jobId, status: "queued" });
  expect(resolve).toHaveBeenCalledWith({ userId: "1", input });
  expect(resolve.mock.invocationCallOrder[0]).toBeLessThan(
    queue.mock.invocationCallOrder[0]
  );
  expect(queue).toHaveBeenCalledWith("1", input, source);
  expect(audioOwnership).not.toHaveBeenCalled();
  load.mockResolvedValue({
    id: identity.jobId,
    userId: "1",
    type: "post_prod",
    input,
  });
  await submitCodeMotion("1", p, identity.fingerprint, deps, source);
  expect(queue).toHaveBeenCalledOnce();
  expect(resolve).toHaveBeenCalledOnce();
  await expect(
    submitCodeMotion("2", p, identity.fingerprint, deps, source)
  ).rejects.toThrow("内容已修改");
  const changed = silentProject();
  const element = changed.plan!.scenes[0].composition!.elements[0];
  if (element.type === "text") element.text = "修改后的画面";
  await expect(
    submitCodeMotion("1", changed, identity.fingerprint, deps, source)
  ).rejects.toThrow("内容已修改");
  expect(queue).toHaveBeenCalledOnce();
});

it("无声提交仍由原编译合同拦截缺方案、空镜头和空画面，不查询或排队", async () => {
  const load = vi.fn(),
    queue = vi.fn(),
    resolve = vi.fn();
  const deps = {
    load,
    queue,
    resolve,
    view: vi.fn(),
  } as unknown as CodeMotionTaskDeps;
  const p = silentProject();
  const identity = codeMotionRenderIdentity("1", p);
  const noPlan = silentProject();
  noPlan.plan = null;
  const noScene = silentProject();
  noScene.plan!.scenes = [];
  const noComposition = silentProject();
  delete noComposition.plan!.scenes[0].composition;
  const noElement = silentProject();
  noElement.plan!.scenes[0].composition!.elements = [];
  for (const invalid of [noPlan, noScene, noComposition, noElement])
    await expect(
      submitCodeMotion("1", invalid, identity.fingerprint, deps)
    ).rejects.toThrow();
  expect(load).not.toHaveBeenCalled();
  expect(resolve).not.toHaveBeenCalled();
  expect(queue).not.toHaveBeenCalled();
});

it("未开放的合成配音在名额与排队之前拒绝，原任务仍能恢复", async () => {
  const identity = codeMotionRenderIdentity("1", project),
    queue = vi.fn(),
    resolve = vi.fn();
  const deps = {
    load: async () => null,
    queue,
    resolve,
    view: vi.fn(),
    speechEnabled: () => false,
  } as unknown as CodeMotionTaskDeps;
  await expect(
    submitCodeMotion("1", project, identity.fingerprint, deps)
  ).rejects.toThrow("暂未开放");
  expect(queue).not.toHaveBeenCalled();
  expect(resolve).not.toHaveBeenCalled();
});
