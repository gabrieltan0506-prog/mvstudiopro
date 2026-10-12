import { expect, it } from "vitest";
import {
  CODE_MOTION_PROJECT_MAX_BYTES,
  codeMotionObjectName,
  loadCodeMotion,
  saveCodeMotion,
  type CodeMotionStoreDeps,
} from "./codeMotionStore";
const project = {
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
  plan: null,
};
it("草稿按账号隔离、服务失败不冒充空稿，版本冲突不覆盖", async () => {
  let body: Buffer | null = null,
    generation = "0";
  const deps: CodeMotionStoreDeps = {
    read: async () => (body ? { body, generation } : null),
    list: async () => [],
    write: async (_, next, expected) => {
      if (expected !== generation) throw Error("版本冲突");
      body = next;
      generation = String(Number(generation) + 1);
      return generation;
    },
  };
  expect(codeMotionObjectName("1", project.id)).not.toBe(
    codeMotionObjectName("2", project.id)
  );
  expect(() => codeMotionObjectName("../2", project.id)).toThrow();
  expect((await saveCodeMotion("1", project, "0", deps)).generation).toBe("1");
  await expect(
    saveCodeMotion(
      "1",
      { ...project, brief: { ...project.brief, title: "覆盖" } },
      "0",
      deps
    )
  ).rejects.toThrow("冲突");
  expect(
    (await loadCodeMotion("1", project.id, deps))?.project.brief.title
  ).toBe("作品");
  await expect(
    loadCodeMotion("1", project.id, {
      ...deps,
      read: async () => {
        throw Error("offline");
      },
    })
  ).rejects.toThrow("offline");
});

it("超过旧100KB的合法中文镜头工程保存后完整恢复，超新上限拒绝", async () => {
  const large = {
    ...project,
    brief: { ...project.brief, style: "scenes", duration: 180 },
    plan: {
      version: 1,
      summary: "中文画面",
      scenes: Array.from({ length: 12 }, (_, i) => ({
        heading: `镜头${i}`,
        body: "",
        duration: 15,
        composition: {
          id: `scene${i}`,
          duration: 15,
          elements: Array.from({ length: 8 }, (_, k) => ({
            id: `text${k}`,
            type: "text",
            text: "中".repeat(600),
          })),
        },
      })),
    },
  };
  let body: Buffer | null = null;
  const deps: CodeMotionStoreDeps = {
    read: async () => (body ? { body, generation: "1" } : null),
    list: async () => [],
    write: async (_, b) => {
      body = b;
      return "1";
    },
  };
  const saved = await saveCodeMotion("1", large, "0", deps);
  expect(body!.length).toBeGreaterThan(100_000);
  expect(body!.length).toBeLessThan(CODE_MOTION_PROJECT_MAX_BYTES);
  expect((await loadCodeMotion("1", project.id, deps))?.project).toEqual(
    saved.project
  );
  body = Buffer.alloc(CODE_MOTION_PROJECT_MAX_BYTES + 1);
  await expect(loadCodeMotion("1", project.id, deps)).rejects.toThrow(
    "保存上限"
  );
  const huge = structuredClone(large);
  huge.plan.scenes.forEach(scene => {
    scene.composition.elements = Array.from({ length: 42 }, (_, k) => ({
      id: `text${k}`,
      type: "text",
      text: "中".repeat(600),
    }));
  });
  await expect(saveCodeMotion("1", huge, "1", deps)).rejects.toThrow(
    /保存上限|动画配置过大/
  );
});
