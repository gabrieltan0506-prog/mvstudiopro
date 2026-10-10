import { beforeEach, describe, expect, it, vi } from "vitest";
import { codeMotionProjectSchema } from "../../shared/codeMotion";
const h = vi.hoisted(() => ({
  files: new Map<string, { body: Buffer; generation: string }>(),
  n: 0,
}));
vi.mock("./codeMotionStore", async original => {
  const actual = await original<any>();
  const storage = {
    read: async (n: string) => h.files.get(n) || null,
    write: async (n: string, b: Buffer, g: string) => {
      if ((h.files.get(n)?.generation || "0") !== g) throw Error("CAS");
      const generation = String(++h.n);
      h.files.set(n, { body: b, generation });
      return generation;
    },
    list: async () => [],
  };
  return { ...actual, codeMotionStorage: storage };
});
import { codeMotionStorage, saveCodeMotion } from "./codeMotionStore";
import {
  codeMotionProductionFingerprint,
  getCodeMotionProductionGrant,
  writeCodeMotionRevisionGrant,
  reserveCodeMotionProductionSlot,
} from "./codeMotionProductionGrant";
import {
  quoteCodeMotionRevision,
  submitCodeMotionRevision,
  codeMotionRevisionAssetParent,
  type RevisionDeps,
} from "./codeMotionRevision";
const projectId = "11111111-1111-4111-8111-111111111111",
  grantId = "22222222-2222-4222-8222-222222222222";
let generation = "",
  completed = true,
  paid = false;
const project = () =>
  codeMotionProjectSchema.parse({
    id: projectId,
    brief: {
      title: "局部修改",
      request: "技术四镜",
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
        heading: `原标题${i}`,
        body: "原正文",
        duration: 5,
      })),
    },
  });
const deps: RevisionDeps = {
  storage: codeMotionStorage,
  grant: getCodeMotionProductionGrant,
  writeGrant: writeCodeMotionRevisionGrant,
  plan: async () => (paid ? "pro" : "free"),
  completed: async () => completed,
};
const input = (i: number) => ({
  projectId,
  expectedGeneration: generation,
  requestId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
  changes: [{ index: 1, heading: `新标题${i}`, body: "局部正文" }],
});
beforeEach(async () => {
  h.files.clear();
  h.n = 0;
  completed = true;
  paid = false;
  const p = project();
  generation = (await saveCodeMotion("7", p, "0", codeMotionStorage))
    .generation;
  await codeMotionStorage.write(
    `code-motion/u7/production/${projectId}/grant.json`,
    Buffer.from(
      JSON.stringify({
        id: grantId,
        userId: "7",
        projectId,
        generation,
        tier: "free",
        fingerprint: codeMotionProductionFingerprint(p),
        sceneCount: 4,
        duration: 20,
        createdAt: new Date().toISOString(),
        slots: {},
      })
    ),
    "0"
  );
});
describe("confirmed local revisions", () => {
  it("previews consume none; concurrent requests accept only two; identical request restores same child", async () => {
    expect(
      (await quoteCodeMotionRevision("7", projectId, deps)).remaining
    ).toBe(2);
    const results = await Promise.allSettled(
      [1, 2, 3].map(i => submitCodeMotionRevision("7", input(i), deps))
    );
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(2);
    const first = results.findIndex(r => r.status === "fulfilled") + 1;
    const a = await submitCodeMotionRevision("7", input(first), deps),
      b = await submitCodeMotionRevision("7", input(first), deps);
    expect(a.project.id).toBe(b.project.id);
    expect(
      (await quoteCodeMotionRevision("7", projectId, deps)).remaining
    ).toBe(0);
    await expect(
      submitCodeMotionRevision(
        "7",
        {
          ...input(first),
          changes: [{ index: 1, heading: "改请求", body: "" }],
        },
        deps
      )
    ).rejects.toThrow("编号");
    await expect(
      reserveCodeMotionProductionSlot("7", {
        projectId: a.project.id,
        grantId: a.grant.id,
        kind: "image",
        index: 1,
        requestId: "extra",
        digest: "a".repeat(64),
      })
    ).rejects.toThrow("沿用");
  });
  it("unfinished version and other account cannot obtain revision; no ledger is consumed", async () => {
    completed = false;
    await expect(submitCodeMotionRevision("7", input(1), deps)).rejects.toThrow(
      "成片"
    );
    await expect(submitCodeMotionRevision("8", input(1), deps)).rejects.toThrow(
      "授权"
    );
    expect(
      (await quoteCodeMotionRevision("7", projectId, deps)).remaining
    ).toBe(2);
  });
  it("second revision of a child shares the root limit, upgrade code-only uses no guessed provider charge", async () => {
    const child = await submitCodeMotionRevision("7", input(1), deps);
    await submitCodeMotionRevision(
      "7",
      {
        ...input(2),
        projectId: child.project.id,
        expectedGeneration: child.generation,
      },
      deps
    );
    await expect(submitCodeMotionRevision("7", input(3), deps)).rejects.toThrow(
      "充值升级"
    );
    paid = true;
    const upgraded = await submitCodeMotionRevision("7", input(3), deps);
    expect(upgraded.grant.tier).toBe("paid");
    expect(
      (await quoteCodeMotionRevision("7", projectId, deps)).costCredits
    ).toBe(0);
  });
  it("asset reuse requires exact original revision snapshot; unrelated source metadata cannot inherit authority", async () => {
    const p = project();
    const source = {
      id: "44444444-4444-4444-8444-444444444444",
      name: "原音",
      gcsUri: `gs://bucket/post-prod/7/code-motion/${projectId}/audio/44444444-4444-4444-8444-444444444444/${"a".repeat(64)}.wav`,
      duration: 20,
      mimeType: "audio/wav" as const,
      sha256: "a".repeat(64),
      bytes: 48000,
    };
    p.brief.audios = [source];
    p.plan!.audioTimeline = [
      {
        sourceId: source.id,
        role: "bgm",
        at: 0,
        trimStart: 0,
        duration: 20,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
      },
    ];
    generation = (await saveCodeMotion("7", p, generation, codeMotionStorage))
      .generation;
    const child = await submitCodeMotionRevision("7", input(1), deps);
    expect(
      await codeMotionRevisionAssetParent(
        "7",
        child.project.id,
        "audio",
        source
      )
    ).toBe(projectId);
    expect(
      await codeMotionRevisionAssetParent("7", child.project.id, "audio", {
        ...source,
        sha256: "b".repeat(64),
      })
    ).toBeNull();
    expect(
      await codeMotionRevisionAssetParent(
        "8",
        child.project.id,
        "audio",
        source
      )
    ).toBeNull();
    const { assertCodeMotionAudioOwnership } = await import(
      "./codeMotionAudio"
    );
    const owned = {
      userId: "7",
      projectId: child.project.id,
      audio: { sources: [source], audioTimeline: p.plan!.audioTimeline },
    };
    await expect(
      assertCodeMotionAudioOwnership(owned, {
        resolve: async ({ source }) => source,
        revisionParent: (u, p, a) =>
          codeMotionRevisionAssetParent(u, p, "audio", a),
      })
    ).resolves.toBeUndefined();
    await expect(
      assertCodeMotionAudioOwnership(
        {
          ...owned,
          audio: {
            ...owned.audio,
            sources: [{ ...source, sha256: "b".repeat(64) }],
          },
        },
        {
          resolve: async ({ source }) => source,
          revisionParent: (u, p, a) =>
            codeMotionRevisionAssetParent(u, p, "audio", a),
        }
      )
    ).rejects.toThrow("归档身份");
  });

  it("lost response plus browser reload/new request UUID restores the same confirmed edit without consuming another chance", async () => {
    const a = await submitCodeMotionRevision("7", input(1), deps);
    const b = await submitCodeMotionRevision(
      "7",
      { ...input(1), requestId: input(2).requestId },
      deps
    );
    expect(a.project.id).toBe(b.project.id);
    expect(
      (await quoteCodeMotionRevision("7", projectId, deps)).remaining
    ).toBe(1);
  });
  it("official child export keeps parent audio and untouched generated video through compiler and ownership gates", async () => {
    const p = project();
    const source = {
      id: "44444444-4444-4444-8444-444444444444",
      name: "原混音",
      gcsUri: `gs://bucket/post-prod/7/code-motion/${projectId}/audio/44444444-4444-4444-8444-444444444444/${"a".repeat(64)}.wav`,
      duration: 20,
      mimeType: "audio/wav" as const,
      sha256: "a".repeat(64),
      bytes: 48000,
    };
    p.brief.audios = [source];
    p.plan!.audioTimeline = [
      {
        sourceId: source.id,
        role: "bgm",
        at: 0,
        trimStart: 0,
        duration: 20,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
      },
    ];
    const asset = {
      id: "original-clip",
      videoUri: "gs://bucket/archived/original.mp4",
      sha256: "b".repeat(64),
      durationSec: 5,
    };
    p.brief.style = "scenes";
    p.plan!.scenes.forEach((scene, index) => {
      scene.composition = {
        id: `scene${index}`,
        duration: 5,
        elements: [{ id: `title${index}`, type: "text", text: scene.heading }],
      } as any;
    });
    p.plan!.scenes[0].production = {
      imagePrompt: "原图",
      videoPrompt: "原动作",
      motion: "natural",
    };
    p.plan!.codeVideo = {
      version: 1,
      assets: [asset],
      clips: [
        {
          assetId: asset.id,
          at: 0,
          duration: 5,
          sourceStartSec: 0,
          fit: "cover",
        },
      ],
    };
    generation = (await saveCodeMotion("7", p, generation, codeMotionStorage))
      .generation;
    await codeMotionStorage.write(
      `code-motion/u7/production/${projectId}/video-sources/${asset.id}.json`,
      Buffer.from(JSON.stringify(asset)),
      "0"
    );
    const child = await submitCodeMotionRevision("7", input(1), deps);
    const { codeMotionRenderIdentity, submitCodeMotion } = await import(
      "./codeMotionTask"
    );
    const { assertCodeMotionAudioOwnership } = await import(
      "./codeMotionAudio"
    );
    const { assertCodeMotionProductionVideos } = await import(
      "./codeMotionProductionVideo"
    );
    const queued: unknown[] = [];
    const identity = codeMotionRenderIdentity("7", child.project);
    const result = await submitCodeMotion(
      "7",
      child.project,
      identity.fingerprint,
      {
        load: async () => null,
        resolve: async ({ input }) => input,
        queue: async (_u, input) => {
          queued.push(input);
          return { jobId: "child-job", status: "queued" };
        },
        view: vi.fn() as any,
        audioOwnership: input =>
          assertCodeMotionAudioOwnership(input, {
            resolve: async ({ source }) => source,
            revisionParent: (u, p, a) =>
              codeMotionRevisionAssetParent(u, p, "audio", a),
          }),
        videoOwnership: assertCodeMotionProductionVideos,
      }
    );
    expect(result.jobId).toBe("child-job");
    expect((queued[0] as any).params.codeAudio.sources).toEqual([source]);
    expect((queued[0] as any).params.codeVideo.assets).toEqual([asset]);
    expect((queued[0] as any).params.codeVideo.clips[0].at).toBe(0);
  });
});
