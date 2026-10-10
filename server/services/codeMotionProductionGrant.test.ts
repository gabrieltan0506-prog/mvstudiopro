import { describe, it, expect, vi } from "vitest";
import {
  ensureCodeMotionProductionGrant,
  reserveCodeMotionProductionSlot,
  assertCodeMotionProductionSlot,
  codeMotionProductionDigest,
  codeMotionProductionFingerprint,
  type CodeMotionProductionGrantDeps,
} from "./codeMotionProductionGrant";
import { codeMotionProjectSchema } from "../../shared/codeMotion";
const projectId = "11111111-1111-4111-8111-111111111111";
function fixture() {
  return codeMotionProjectSchema.parse({
    id: projectId,
    brief: {
      title: "排练",
      request: "表演讲述",
      text: "",
      style: "words",
      duration: 20,
      orientation: "landscape",
      images: [],
      data: [],
      unit: "",
      chart: "bar",
      period: "",
      source: "",
    },
    plan: {
      version: 1,
      summary: "四镜",
      scenes: Array.from({ length: 4 }, (_, i) => ({
        heading: `动作${i}`,
        body: "角色向前一步",
        duration: 5,
        production: {
          imagePrompt: "场景",
          motion: "natural",
          videoPrompt: "角色向前一步",
        },
      })),
    },
  });
}
function setup() {
  const files = new Map<string, { body: Buffer; generation: string }>();
  let generation = 1;
  const project = fixture();
  files.set(`code-motion/u7/projects/${projectId}.json`, {
    body: Buffer.from(
      JSON.stringify({ project, updatedAt: new Date().toISOString() })
    ),
    generation: "1",
  });
  const deps: CodeMotionProductionGrantDeps = {
    storage: {
      read: async n => files.get(n) || null,
      write: async (n, b, g) => {
        const old = files.get(n);
        if ((old?.generation || "0") !== g) throw Error("conflict");
        const v = String(++generation);
        files.set(n, { body: b, generation: v });
        return v;
      },
      list: async p => Array.from(files.keys()).filter(n => n.startsWith(p)),
    },
    plan: vi.fn(async () => "free" as const),
    claim: vi.fn(async () => {}),
  };
  return { files, deps, project };
}
describe("映客整作品制作预算", () => {
  it("成本之前抢一次账号/IP名额，同作品恢复复用grant，不再领额", async () => {
    const { deps } = setup();
    const input = {
      projectId,
      expectedGeneration: "1",
      source: { day: "2026-10-10", ipHash: "ip" },
    };
    const a = await ensureCodeMotionProductionGrant("7", input, deps);
    const b = await ensureCodeMotionProductionGrant("7", input, deps);
    expect(a).toEqual(b);
    expect(deps.claim).toHaveBeenCalledTimes(1);
    expect(a.tier).toBe("free");
  });
  it("并发槽只有一个请求身份；未知结果、改digest、新request都不能重投", async () => {
    const { deps } = setup();
    const grant = await ensureCodeMotionProductionGrant(
      "7",
      {
        projectId,
        expectedGeneration: "1",
        source: { day: "2026-10-10", ipHash: "ip" },
      },
      deps
    );
    const slot = {
      projectId,
      grantId: grant.id,
      kind: "video" as const,
      index: 0,
      requestId: "fixed",
      digest: codeMotionProductionDigest("shot"),
    };
    await Promise.all([
      reserveCodeMotionProductionSlot("7", slot, deps),
      reserveCodeMotionProductionSlot("7", slot, deps),
    ]);
    await expect(
      assertCodeMotionProductionSlot("7", slot, deps)
    ).resolves.toMatchObject({ tier: "free" });
    await expect(
      reserveCodeMotionProductionSlot("7", { ...slot, requestId: "new" }, deps)
    ).rejects.toThrow("已占用");
    await expect(
      reserveCodeMotionProductionSlot(
        "7",
        { ...slot, digest: codeMotionProductionDigest("changed") },
        deps
      )
    ).rejects.toThrow("已占用");
    await expect(
      reserveCodeMotionProductionSlot("7", { ...slot, index: 4 }, deps)
    ).rejects.toThrow("超过作品预算");
  });
  it("会员档位来自服务端plan，不消耗免费额度", async () => {
    const { deps } = setup();
    deps.plan = vi.fn(async () => "pro" as const);
    const grant = await ensureCodeMotionProductionGrant(
      "7",
      {
        projectId,
        expectedGeneration: "1",
        source: { day: "2026-10-10", ipHash: "ip" },
      },
      deps
    );
    expect(grant.tier).toBe("paid");
    expect(deps.claim).not.toHaveBeenCalled();
  });
  it("采用图音仅更新素材；改变分镜必须停止新成本", async () => {
    const { deps, project, files } = setup();
    const grant = await ensureCodeMotionProductionGrant(
      "7",
      {
        projectId,
        expectedGeneration: "1",
        source: { day: "2026-10-10", ipHash: "ip" },
      },
      deps
    );
    const adopted = structuredClone(project);
    adopted.plan!.scenes[0].imageId = "22222222-2222-4222-8222-222222222222";
    expect(codeMotionProductionFingerprint(adopted)).toBe(grant.fingerprint);
    project.plan!.scenes[0].body = "改变剧情";
    files.set(`code-motion/u7/projects/${projectId}.json`, {
      body: Buffer.from(
        JSON.stringify({ project, updatedAt: new Date().toISOString() })
      ),
      generation: "2",
    });
    await expect(
      reserveCodeMotionProductionSlot(
        "7",
        {
          projectId,
          grantId: grant.id,
          kind: "image",
          index: 0,
          requestId: "one",
          digest: codeMotionProductionDigest("image"),
        },
        deps
      )
    ).rejects.toThrow("分镜已变化");
  });
  it("没有服务端占位不能伪造免费上下文", async () => {
    const { deps } = setup();
    const grant = await ensureCodeMotionProductionGrant(
      "7",
      {
        projectId,
        expectedGeneration: "1",
        source: { day: "2026-10-10", ipHash: "ip" },
      },
      deps
    );
    await expect(
      assertCodeMotionProductionSlot(
        "7",
        {
          projectId,
          grantId: grant.id,
          kind: "bgm",
          index: 0,
          requestId: "unclaimed",
          digest: codeMotionProductionDigest("bgm"),
        },
        deps
      )
    ).rejects.toThrow("预算与请求");
  });
  it("redraw adoption may replace original image layers while retaining the non-image code identity",()=>{
    const {project}=setup();const a=structuredClone(project);
    a.plan!.scenes[0].composition={id:"scene0",duration:5,elements:[{id:"source-photo",type:"image",imageId:"22222222-2222-4222-8222-222222222222",width:1,height:1},{id:"caption",type:"text",text:"原标题"}]} as any;
    const b=structuredClone(a);b.plan!.scenes[0].composition!.elements=b.plan!.scenes[0].composition!.elements.filter(e=>e.type!=="image");
    b.plan!.scenes[0].composition!.elements.push({id:"ink-generated-image-0",type:"image",imageId:"33333333-3333-4333-8333-333333333333",width:1,height:1} as any);
    expect(codeMotionProductionFingerprint(a)).toBe(codeMotionProductionFingerprint(b));
    (b.plan!.scenes[0].composition!.elements.find(e=>e.type==="text") as any).text="用户修改文字";
    expect(codeMotionProductionFingerprint(a)).not.toBe(codeMotionProductionFingerprint(b));
  });

});
