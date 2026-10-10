import { expect, it, vi } from "vitest";
vi.mock("./gcs", async importOriginal => ({
  ...(await importOriginal<typeof import("./gcs")>()),
  signGsUriV4ReadUrl: (uri: string) =>
    `https://fixture.test/${encodeURIComponent(uri)}`,
}));
import {
  submitCodeMotionSound,
  listCodeMotionSounds,
  adoptCodeMotionSound,
  type CodeMotionSoundDeps,
} from "./codeMotionSound";
import {
  saveCodeMotion,
  loadCodeMotion,
  type CodeMotionStoreDeps,
} from "./codeMotionStore";
import {
  compileCodeMotion,
  codeMotionProjectSchema,
} from "../../shared/codeMotion";
import { adoptCodeMotionSoundInProject } from "../../shared/codeMotionSoundAdoption";
import { assertCodeMotionGeneratedAudio } from "./codeMotionAudioReceipt";
const projectId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const request = {
  kind: "speech",
  requestId,
  sceneIndex: 0,
  text: "欢迎光临",
  voice: "female",
} as const;
const project = codeMotionProjectSchema.parse({
  id: projectId,
  brief: {
    title: "原文",
    request: "原文",
    style: "words",
    duration: 30,
    orientation: "landscape",
  },
  plan: {
    version: 1,
    summary: "原文",
    scenes: [
      {
        heading: "欢迎",
        body: "",
        duration: 30,
        speech: { text: request.text, voice: request.voice },
      },
    ],
  },
});
async function setup() {
  const objects = new Map<string, { body: Buffer; generation: string }>();
  const storage: CodeMotionStoreDeps = {
    read: async key => objects.get(key) ?? null,
    list: async prefix =>
      Array.from(objects.keys()).filter(key => key.startsWith(prefix)),
    write: async (key, body, expected) => {
      const version = objects.get(key)?.generation ?? "0";
      if (version !== expected) throw new Error("版本冲突");
      const generation = String(Number(version) + 1);
      objects.set(key, { body, generation });
      return generation;
    },
  };
  await saveCodeMotion("1", project, "0", storage);
  let done = false;
  const deps = {
    storage,
    speech: vi.fn(async () => {
      done = true;
    }),
    speechStatus: vi.fn(async () =>
      done
        ? {
            status: "succeeded",
            canResumeSettlement: false,
            result: {
              gcsUri: "gs://test/post-prod/1/dialogue/original.wav",
              audioUrl: "https://fixture.test/original.wav",
              durationSec: 3,
            },
          }
        : null
    ),
    bgm: vi.fn(),
    job: vi.fn(async () => null),
    importAudio: vi.fn(async (input: any) => ({
      id: input.sourceId,
      name: input.name,
      gcsUri: `gs://test/post-prod/1/code-motion/${projectId}/audio/${input.sourceId}/${"a".repeat(64)}.wav`,
      duration: 3,
      mimeType: "audio/wav",
      sha256: "a".repeat(64),
      bytes: 1234,
      generated: input.generated,
    })),
  } as unknown as CodeMotionSoundDeps;
  return { deps, storage };
}
it("沿漫剧音色库逐镜编译情绪，回执保存语气，改情绪不能复用旧配音", async () => {
  const { deps, storage } = await setup();
  const emotional = structuredClone(project);
  emotional.plan!.scenes[0].speech!.emotion = "[tired][very fast]";
  await saveCodeMotion("1", emotional, "1", storage);
  const r = { ...request, emotion: "[tired][very fast]" };
  await submitCodeMotionSound("1", projectId, "2", r, deps);
  expect(deps.speech).toHaveBeenCalledWith(1, expect.objectContaining({
    input: "[tired][very fast]欢迎光临", voice: "longanlingxin", voiceStateZh: "[tired][very fast]",
  }));
  const source = await adoptCodeMotionSound("1", projectId, requestId, 0, deps);
  expect(source.generated?.emotion).toBe(r.emotion);
  const adopted = adoptCodeMotionSoundInProject(emotional, source);
  expect(() => compileCodeMotion(adopted.brief, adopted.plan)).not.toThrow();
  adopted.plan!.scenes[0].speech!.emotion = "[empathetic]";
  expect(() => compileCodeMotion(adopted.brief, adopted.plan)).toThrow("配音");
  expect(() => adoptCodeMotionSoundInProject(adopted, source)).toThrow("旁白内容已变化");
  await expect(submitCodeMotionSound("1", projectId, "2", { ...r, emotion: "[warm]" }, deps)).rejects.toThrow("情绪");
  expect(deps.speech).toHaveBeenCalledTimes(1);
});
it("已保存镜头→既有Qwen入口→刷新恢复→采用→保存再打开→正式编译消费同一音源", async () => {
  const { deps, storage } = await setup();
  await submitCodeMotionSound("1", projectId, "1", request, deps);
  expect(deps.speech).toHaveBeenCalledWith(
    1,
    expect.objectContaining({
      voice: "longanlingxin",
      input: request.text,
      billingRequestId: requestId,
    })
  );
  const rows = await listCodeMotionSounds("1", projectId, deps);
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe("succeeded");
  expect(await listCodeMotionSounds("2", projectId, deps)).toEqual([]);
  const source = await adoptCodeMotionSound("1", projectId, requestId, 0, deps);
  const value = adoptCodeMotionSoundInProject(project, source);
  await saveCodeMotion("1", value, "1", storage);
  const restored = await loadCodeMotion("1", projectId, storage);
  const spec = compileCodeMotion(
    restored!.project.brief,
    restored!.project.plan
  );
  expect(spec.inkSpeech).toBeUndefined();
  expect(spec.codeAudio?.sources[0]).toEqual(source);
  expect(spec.codeAudio?.audioTimeline[0]).toMatchObject({
    at: 0,
    duration: 3,
    trimStart: 0,
    volume: 1,
  });
  await expect(
    assertCodeMotionGeneratedAudio("1", projectId, source, storage)
  ).resolves.toBeUndefined();
  await expect(
    assertCodeMotionGeneratedAudio(
      "1",
      projectId,
      { ...source, generated: { ...source.generated!, text: "伪造台词" } },
      storage
    )
  ).rejects.toThrow("回执");
});
it("写入失败不发上游，断线仍恢复原请求编号，查询不生成不计费", async () => {
  const { deps, storage } = await setup();
  await expect(
    submitCodeMotionSound("1", projectId, "1", request, {
      ...deps,
      storage: {
        ...storage,
        write: async () => {
          throw Error("offline");
        },
      },
    })
  ).rejects.toThrow("offline");
  expect(deps.speech).not.toHaveBeenCalled();
  vi.mocked(deps.speech).mockRejectedValueOnce(Error("response lost"));
  await expect(
    submitCodeMotionSound("1", projectId, "1", request, deps)
  ).rejects.toThrow("response lost");
  const rows = await listCodeMotionSounds("1", projectId, deps);
  expect(rows[0].request.requestId).toBe(requestId);
  expect(deps.speech).toHaveBeenCalledTimes(1);
  await expect(
    submitCodeMotionSound(
      "1",
      projectId,
      "1",
      { ...request, text: "不同内容" },
      deps
    )
  ).rejects.toThrow("原请求编号");
  expect(deps.speech).toHaveBeenCalledTimes(1);
});
it("旧版本或非本镜台词不生成，过长旁白不截断，改词后旧音源不能通过编译", async () => {
  const { deps } = await setup();
  await expect(
    submitCodeMotionSound("1", projectId, "0", request, deps)
  ).rejects.toThrow("版本");
  await expect(
    submitCodeMotionSound(
      "1",
      projectId,
      "1",
      { ...request, text: "不同内容" },
      deps
    )
  ).rejects.toThrow("旁白已修改");
  expect(deps.speech).not.toHaveBeenCalled();
  await submitCodeMotionSound("1", projectId, "1", request, deps);
  const source = await adoptCodeMotionSound("1", projectId, requestId, 0, deps);
  expect(() =>
    adoptCodeMotionSoundInProject(project, { ...source, duration: 31 })
  ).toThrow("超过本镜");
  const adopted = adoptCodeMotionSoundInProject(project, source);
  adopted.plan!.scenes[0].speech!.text = "新台词";
  expect(() => compileCodeMotion(adopted.brief, adopted.plan)).toThrow(
    "配音尚未生成"
  );
});

it("BGM复用既有Suno队列，持久化双候选，并允许长音源在正式时间轴裁入片长", async () => {
  const { deps, storage } = await setup();
  let job: any = null;
  vi.mocked(deps.bgm).mockImplementation(async (_user, input) => {
    job = {
      id: `bgm_${input.billingRequestId.replace(/-/g, "")}`,
      userId: "1",
      type: "audio",
      status: "succeeded",
      input: { action: "manhua_bgm_v55", params: { brief: input.brief } },
      output: {
        variants: [0, 1].map(index => ({
          index,
          gcsUri: `gs://test/post-prod/1/bgm/candidate${index}.mp3`,
          durationSec: 240,
        })),
      },
    };
    return {} as any;
  });
  vi.mocked(deps.job).mockImplementation(async () => job);
  await submitCodeMotionSound(
    "1",
    projectId,
    "1",
    { kind: "bgm", requestId, direction: "轻快纯音乐" },
    deps
  );
  expect(deps.bgm).toHaveBeenCalledWith(
    "1",
    expect.objectContaining({
      brief: expect.objectContaining({ model: "suno-v6", instrumental: true }),
    })
  );
  const rows = await listCodeMotionSounds("1", projectId, deps);
  expect(rows[0].variants).toHaveLength(2);
  const original = deps.importAudio;
  deps.importAudio = vi.fn(async (input, dependencies) => ({
    ...(await original(input, dependencies)),
    duration: 240,
  }));
  const audio = await adoptCodeMotionSound("1", projectId, requestId, 1, deps);
  const silent = structuredClone(project);
  delete silent.plan!.scenes[0].speech;
  const adopted = adoptCodeMotionSoundInProject(silent, audio);
  await saveCodeMotion("1", adopted, "1", storage);
  expect(
    compileCodeMotion(adopted.brief, adopted.plan).codeAudio?.audioTimeline[0]
  ).toMatchObject({ duration: 30, volume: 0.25 });
});
