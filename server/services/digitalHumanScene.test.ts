import { describe, expect, it, vi } from "vitest";
vi.mock("../db", () => ({ getDb: vi.fn() }));
import {
  assertDigitalHumanSceneJob,
  digitalHumanSceneJob,
} from "./digitalHumanScene";
const input = {
  requestId: "a51d8a78-1c90-4f1d-9c1e-324e7a3f4659",
  description: "明亮自然光的书房",
  aspectRatio: "9:16" as const,
};
describe("数字人场景幂等与参数门禁", () => {
  it("同账号同请求固定任务，不同账号隔离", () => {
    expect(digitalHumanSceneJob(7, input).id).toBe(
      digitalHumanSceneJob(7, input).id
    );
    expect(digitalHumanSceneJob(8, input).id).not.toBe(
      digitalHumanSceneJob(7, input).id
    );
  });
  it("请求内容变化可检测，不能换参复用", () => {
    expect(
      digitalHumanSceneJob(7, { ...input, description: "另一间办公室" }).digest
    ).not.toBe(digitalHumanSceneJob(7, input).digest);
  });
  it("数据库JSON重排后保留精确Sunburst 2K medium", () => {
    const t = digitalHumanSceneJob(7, input);
    const serialized = JSON.parse(JSON.stringify(t.input));
    serialized.params = Object.fromEntries(
      Object.entries(serialized.params).reverse()
    );
    expect(assertDigitalHumanSceneJob(7, t.id, serialized)).toEqual({
      exactSunburst: true,
      qualityOverride: "medium",
      evolinkResolution: "2K",
      openaiSize: "1152x2048",
    });
  });
  it("伪造任务、价格折扣或换模型参数在扣费前拒绝", () => {
    const t = digitalHumanSceneJob(7, input);
    expect(() => assertDigitalHumanSceneJob(8, t.id, t.input)).toThrow();
    expect(() =>
      assertDigitalHumanSceneJob(7, t.id, {
        ...t.input,
        params: { ...t.input.params, batchIndex: 2 },
      })
    ).toThrow();
    expect(() =>
      assertDigitalHumanSceneJob(7, t.id, {
        ...t.input,
        params: { ...t.input.params, openaiImageVariant: "flare" },
      })
    ).toThrow();
  });
});
