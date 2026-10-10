import { expect, it } from "vitest";
import {
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
