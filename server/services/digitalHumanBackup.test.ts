import { describe, expect, it, vi } from "vitest";
import {
  createDigitalHumanBackupService,
  type DigitalHumanBackupDeps,
} from "./digitalHumanBackup";
import { newDigitalHumanDraft } from "../../shared/digitalHumanStudio";
import { collectDigitalHumanBackupSources } from "../../shared/digitalHumanBackup";

function fixture() {
  const draft = newDigitalHumanDraft(
    "7",
    "00000000-0000-4000-8000-000000000007"
  );
  draft.script = "原正文";
  draft.portrait = {
    source: "gs://test-only/uploads/u7/person.png",
    name: "本人",
  };
  const objects = new Map<
    string,
    { buffer: Buffer; generation: string; crc32c: string }
  >();
  let revision = 10;
  const put = (name: string, buffer: Buffer = Buffer.from("图像")) => {
    const item = {
      buffer,
      generation: String(++revision),
      crc32c: buffer.toString("base64"),
    };
    objects.set(name, item);
    return item;
  };
  const nameOf = (uri: string) => uri.replace("gs://test-only/", "");
  put("uploads/u7/person.png");
  let current = { draft, generation: "9", updatedAt: "2026-10-18" };
  let interrupted = false;
  const deps = {
    now: () => 1792317600000,
    bucket: () => "test-only",
    getDraft: vi.fn(async () => structuredClone(current)),
    saveDraft: vi.fn(async (_owner, draft, expected) => {
      if (current.generation !== expected) throw new Error("版本冲突");
      current = {
        draft: structuredClone(draft),
        generation: String(++revision),
        updatedAt: "2026-10-18",
      };
      return { generation: current.generation, updatedAt: current.updatedAt };
    }),
    list: vi.fn(async ({ prefix }) =>
      Array.from(objects.keys()).filter(k => k.startsWith(prefix))
    ),
    read: vi.fn(async ({ gcsUri }) => {
      const item = objects.get(nameOf(gcsUri));
      if (!item) throw new Error("gcs_stat_failed:404");
      return { buffer: item.buffer, generation: item.generation };
    }),
    write: vi.fn(async ({ objectName, buffer, ifGenerationMatch }) => {
      const item = objects.get(objectName);
      if (
        ifGenerationMatch !== undefined &&
        (item?.generation || "0") !== ifGenerationMatch
      )
        throw new Error("gcs_upload_failed:412:{}");
      const result = put(objectName, buffer);
      return {
        generation: result.generation,
        gcsUri: `gs://test-only/${objectName}`,
      };
    }),
    stat: vi.fn(async ({ gcsUri }) => {
      const item = objects.get(nameOf(gcsUri));
      if (!item) throw new Error("gcs_stat_failed:404");
      return {
        generation: item.generation,
        crc32c: item.crc32c,
        byteLength: item.buffer.length,
      };
    }),
    copy: vi.fn(
      async ({
        sourceUri,
        sourceGeneration,
        destinationObject,
        rewriteToken,
      }) => {
        if (interrupted && !rewriteToken)
          return {
            gcsUri: `gs://test-only/${destinationObject}`,
            rewriteToken: "same-copy-token",
          };
        const source = objects.get(nameOf(sourceUri));
        if (!source || source.generation !== sourceGeneration)
          throw new Error("source_generation_changed");
        const item =
          objects.get(destinationObject) ||
          put(destinationObject, source.buffer);
        return {
          gcsUri: `gs://test-only/${destinationObject}`,
          generation: item.generation,
        };
      }
    ),
    resources: vi.fn(async () => []),
    owned: vi.fn(async () => async (source: string) => {
      if (!source.startsWith("gs://test-only/uploads/u7/"))
        throw new Error("非本人素材");
      return source;
    }),
  } as unknown as DigitalHumanBackupDeps;
  return {
    service: createDigitalHumanBackupService(deps),
    deps,
    objects,
    put,
    current: () => current,
    change: () => {
      current = { ...current, generation: "other-device" };
    },
    interrupt: () => {
      interrupted = true;
    },
  };
}

describe("数字人云备份真实服务边界（虚构存储，零模型调用）", () => {
  it("完整稿、结构化缓存媒体与提示词URL区分", () => {
    expect(
      collectDigitalHumanBackupSources({
        script: "https://example.test/not-media",
        postProdStorage: {
          key: JSON.stringify({
            source: "gs://b/v.mp4",
            imageUrl: "gs://b/p.png",
          }),
        },
      })
    ).toEqual(["gs://b/v.mp4", "gs://b/p.png"]);
  });
  it("同请求快照幂等，rewrite断线续同token且完整校验后才能回填", async () => {
    const f = fixture();
    f.interrupt();
    const item = await f.service.create(7, {
      requestId: "same-request",
      expectedGeneration: "9",
    });
    expect(
      await f.service.create(7, {
        requestId: "same-request",
        expectedGeneration: "9",
      })
    ).toEqual(item);
    expect((await f.service.advance(7, item.id)).status).toBe("pending");
    await expect(f.service.restore(7, item.id, "9")).rejects.toThrow(
      "尚未完整"
    );
    expect((await f.service.advance(7, item.id)).status).toBe("complete");
    expect(vi.mocked(f.deps.copy).mock.calls[1][0].rewriteToken).toBe(
      "same-copy-token"
    );
    expect((await f.service.list(7))[0].savedAssets).toBe(1);
  });
  it("媒体丢失可从副本恢复，身份/原编号/缓存完整保留，不生成任务", async () => {
    const f = fixture();
    const item = await f.service.create(7);
    await f.service.advance(7, item.id);
    // 当前稿件使用另一张现存素材，回填前能够独立保全。
    f.current().draft.portrait!.source =
      "gs://test-only/uploads/u7/current.png";
    f.put("uploads/u7/current.png");
    f.objects.delete("uploads/u7/person.png");
    const restored = await f.service.restore(7, item.id, "9");
    expect(restored.status).toBe("restored");
    expect(f.current().draft.portrait?.source).toBe(
      "gs://test-only/uploads/u7/person.png"
    );
    expect(f.objects.has("uploads/u7/person.png")).toBe(true);
    expect(
      (await f.service.list(7)).some(
        i => i.reason === "before-restore" && i.status === "complete"
      )
    ).toBe(true);
    expect(f.deps.saveDraft).toHaveBeenCalledTimes(1);
    // 丢失成功响应后重试原generation，不重复覆盖。
    expect((await f.service.restore(7, item.id, "9")).status).toBe("restored");
    expect(f.deps.saveDraft).toHaveBeenCalledTimes(1);
  });
  it("跨账号、外部未归档媒体和另一设备的新稿均不得被覆盖", async () => {
    const f = fixture();
    const item = await f.service.create(7);
    await f.service.advance(7, item.id);
    await expect(f.service.read(8, item.id)).rejects.toThrow("404");
    f.change();
    await expect(f.service.restore(7, item.id, "9")).rejects.toThrow(
      "云端数字人稿件已变化"
    );
    expect(f.deps.saveDraft).not.toHaveBeenCalled();
    const g = fixture();
    g.current().draft.portrait!.source = "https://external.test/image.png";
    const other = await g.service.create(7);
    const pending = await g.service.advance(7, other.id);
    expect(pending.status).toBe("pending");
    expect(pending.error).toContain("非本人");
    expect(g.deps.copy).not.toHaveBeenCalled();
  });
  it("原素材内容被替换时拒绝回填，不能把新素材覆盖为旧版本", async () => {
    const f = fixture();
    const item = await f.service.create(7);
    await f.service.advance(7, item.id);
    f.put("uploads/u7/person.png", Buffer.from("新素材"));
    await expect(f.service.restore(7, item.id, "9")).rejects.toThrow(
      "原素材内容已变化"
    );
    expect(f.deps.saveDraft).not.toHaveBeenCalled();
  });
  it("并发推进同一个清单不丢字段，已完整副本不重复复制", async () => {
    const f = fixture();
    const item = await f.service.create(7);
    await Promise.all([
      f.service.advance(7, item.id),
      f.service.advance(7, item.id),
    ]);
    expect((await f.service.advance(7, item.id)).status).toBe("complete");
    const count = vi.mocked(f.deps.copy).mock.calls.length;
    await f.service.advance(7, item.id);
    expect(f.deps.copy).toHaveBeenCalledTimes(count);
  });
});

it("三维权威回执中的资产参与备份，损坏缓存不被伪装成完整", async () => {
  const f = fixture(); f.put("worlds/own.spz");
  vi.mocked(f.deps.resources).mockResolvedValue([{ kind: "world", taskId: "mw_own", view: { assets: { splatGcsUri: "gs://test-only/worlds/own.spz" } } }]);
  const item = await f.service.create(7);
  expect((await f.service.advance(7, item.id)).status).toBe("complete");
  expect((await f.service.read(7, item.id)).backup.assets.map(a => a.source)).toContain("gs://test-only/worlds/own.spz");
  const g = fixture(); g.current().draft.postProdStorage.bad = "{invalid";
  const damaged = await g.service.create(7);
  expect((await g.service.advance(7, damaged.id)).status).toBe("pending");
  expect((await g.service.read(7, damaged.id)).backup.error).toContain("无法解析");
});

it("清单成功但索引丢失仍可列出原快照，自动快照在同十分钟槽内幂等", async () => {
  const f = fixture(); const item = await f.service.create(7, { reason: "automatic" });
  expect((await f.service.create(7, { reason: "automatic" })).id).toBe(item.id);
  await f.service.advance(7, item.id);
  f.objects.delete(`digital-human-backups/user-7/index/${item.id}.json`);
  expect(await f.service.list(7)).toEqual([expect.objectContaining({ id: item.id, status: "complete" })]);
});

it("原三维任务已删除或失权时保留现稿，不把失效任务号当恢复成功", async () => {
  const f = fixture(); const item = await f.service.create(7); await f.service.advance(7, item.id);
  vi.mocked(f.deps.resources).mockRejectedValue(new Error("三维任务回执无法核实"));
  await expect(f.service.restore(7, item.id, "9")).rejects.toThrow("无法核实");
  expect(f.deps.saveDraft).not.toHaveBeenCalled();
});

it("按活动段、历史段与整片范围收集任务，但显式采用的跨范围媒体仍必备份", () => {
  const storage = (scope: string, source: string) => ({ "postProd.jobs.v2.u7": JSON.stringify([
    { scopeKey: scope, output: { gcsUri: source } },
    { scopeKey: "manhua:other", output: { gcsUri: "gs://test-only/foreign.mp4" } },
  ]) });
  const value = { id: "a", postProdStorage: storage("digital-human:a", "gs://test-only/a.mp4"), project: {
    id: "p", postProdStorage: storage("digital-human:project:p", "gs://test-only/project.mp4"),
    segments: [{ id: "b", selectedSource: "gs://test-only/foreign.mp4", draft: { id: "b", postProdStorage: storage("digital-human:b", "gs://test-only/b.mp4") } }],
  } };
  const before = JSON.stringify(value);
  expect(collectDigitalHumanBackupSources(value)).toEqual(["gs://test-only/a.mp4", "gs://test-only/project.mp4", "gs://test-only/foreign.mp4", "gs://test-only/b.mp4"]);
  expect(JSON.stringify(value)).toBe(before);
});

it("旧pending继续备份可排除异项目404，保留原稿历史；本段404仍阻断", async () => {
  const f = fixture();
  const missing = "gs://test-only/uploads/u7/old.mp4";
  f.current().draft.postProdStorage["postProd.jobs.v2.u7"] = JSON.stringify([{ scopeKey: "manhua:other", output: { gcsUri: missing } }]);
  const item = await f.service.create(7, { expectedGeneration: "9", requestId: "foreign-history" });
  const name = Array.from(f.objects.keys()).find(n => n.includes("/manifests/") && n.includes(item.id))!;
  const old = JSON.parse(f.objects.get(name)!.buffer.toString());
  old.assets.push({ source: missing, error: "gcs_stat_failed:404" });
  old.discoveryComplete = true;
  f.put(name, Buffer.from(JSON.stringify(old)));
  expect((await f.service.advance(7, item.id)).status).toBe("complete");
  const saved = (await f.service.read(7, item.id)).backup;
  expect(saved.assets.map(a => a.source)).not.toContain(missing);
  expect(saved.draft.postProdStorage["postProd.jobs.v2.u7"]).toContain(missing);
  const g = fixture();
  g.current().draft.postProdStorage["postProd.jobs.v2.u7"] = JSON.stringify([{ scopeKey: `digital-human:${g.current().draft.id}`, output: { gcsUri: missing } }]);
  const required = await g.service.create(7, { expectedGeneration: "9", requestId: "own-history" });
  expect((await g.service.advance(7, required.id)).status).toBe("pending");
  await expect(g.service.restore(7, required.id, "9")).rejects.toThrow("云备份尚未完整");
});

it("已核归属的三维HTTPS别名完整备份并恢复，签名变化不阻断且不放行相似外部对象", async () => {
  const f = fixture();
  const uri = "gs://test-only/manhua-3d/u7/model.glb";
  const source = "https://storage.googleapis.com/test-only/manhua-3d/u7/model.glb?X-Goog-Signature=test-only-expired";
  f.put("manhua-3d/u7/model.glb", Buffer.from("真实复制边界的虚构模型内容"));
  f.current().draft.scene = { source, name: "已有模型" };
  vi.mocked(f.deps.resources).mockResolvedValue([{ kind: "model", taskId: "m3d_own", view: { glbGcsUri: uri } }]);
  const item = await f.service.create(7, { expectedGeneration: "9", requestId: "owned-https" });
  expect((await f.service.advance(7, item.id)).status).toBe("complete");
  const b = (await f.service.read(7, item.id)).backup;
  expect(b.assets.find(a => a.source === source)?.resolvedSource).toBe(uri);
  let restored = await f.service.restore(7, item.id, "9");
  for (let i = 0; i < 10 && restored.status !== "restored"; i++) restored = await f.service.restore(7, item.id, "9");
  expect(restored.status).toBe("restored");
  expect(f.current().draft.scene?.source).toBe(source);
  const g = fixture();
  g.current().draft.scene = { source: source.replace("model.glb?", "model.glb.other?"), name: "相似地址" };
  vi.mocked(g.deps.resources).mockResolvedValue([{ kind: "model", taskId: "m3d_own", view: { glbGcsUri: uri } }]);
  const blocked = await g.service.create(7, { expectedGeneration: "9", requestId: "other-object" });
  expect((await g.service.advance(7, blocked.id)).status).toBe("pending");
  expect((await g.service.read(7, blocked.id)).backup.assets.some(a => a.error === "非本人素材")).toBe(true);
});
