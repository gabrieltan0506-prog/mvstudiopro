/** Saved shot image batches. Immutable grant and fixed job identities precede queueing. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import sharp from "sharp";
import { decideCodeMotionImagePreflight, codeMotionImageEvidenceSchema, type CodeMotionImageEvidence } from "../../shared/codeMotionImagePreflight";
import {
  codeMotionImageContextSchema,
  codeMotionImagePolicy,
  codeMotionImagePrompts,
  type CodeMotionImageContext,
} from "../../shared/codeMotionImageProduction";
import {
  codeMotionStorage,
  loadCodeMotion,
  type CodeMotionStoreDeps,
} from "./codeMotionStore";
import { createJob, getJobByIdStrict } from "../jobs/repository";
import { importCodeMotionFile } from "./codeMotionImport";
import {
  getGcsBucketName,
  inspectGcsObjectBounded,
  signGcsObjectPathV4ReadUrl,
  uploadBufferToGcsIfAbsent,
} from "./gcs";
import {
  extractSystemObjectName,
  resolveRegisteredPostProdMediaSource,
} from "./postProdMediaSource";
import {
  getCodeMotionProductionGrant,
  reserveCodeMotionProductionSlot,
  assertCodeMotionProductionSlot,
  codeMotionProductionFingerprint,
  prepareCodeMotionProductionGrant,
} from "./codeMotionProductionGrant";

const shotSchema = z
  .object({
    index: z.number().int().min(0).max(5),
    name: z.string().min(1).max(160),
    prompt: z.string().min(1).max(6000),
    requestId: z.string().uuid(),
    jobId: z.string(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    mode:z.enum(["generate","edit","reuse"]).optional(),
    referenceImageUrls:z.array(z.string().regex(/^gs:\/\//)).max(16).optional(),
    preflight:z.object({reasons:z.array(z.string()),semanticAssessment:z.literal("not_performed"),images:z.array(codeMotionImageEvidenceSchema)}).optional(),
  })
  .strict();
const manifestSchema = z
  .object({
    projectId: z.string().uuid(),
    grantId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    generation: z.string().regex(/^\d+$/),
    tier: z.enum(["free", "paid"]),
    aspectRatio: z.enum(["16:9", "9:16"]),
    createdAt: z.string().datetime(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    shots: z.array(shotSchema).min(4).max(6),
  })
  .strict();
type Manifest = z.infer<typeof manifestSchema>;
export type CodeMotionImagesDeps = {
  storage: CodeMotionStoreDeps;
  grant: typeof getCodeMotionProductionGrant;
  prepareGrant: typeof prepareCodeMotionProductionGrant;
  reserve: typeof reserveCodeMotionProductionSlot;
  assertSlot: typeof assertCodeMotionProductionSlot;
  create: typeof createJob;
  job: typeof getJobByIdStrict;
  importFile: typeof importCodeMotionFile;
  resolve: typeof resolveRegisteredPostProdMediaSource;
  imageSize(uri: string): Promise<number>;
  preview(uri: string): Promise<string>;
  inspectImage?(imageId:string,uri:string):Promise<CodeMotionImageEvidence>;
};
const real: CodeMotionImagesDeps = {
  storage: codeMotionStorage,
  grant: getCodeMotionProductionGrant,
  prepareGrant: prepareCodeMotionProductionGrant,
  reserve: reserveCodeMotionProductionSlot,
  assertSlot: assertCodeMotionProductionSlot,
  create: createJob,
  job: getJobByIdStrict,
  importFile: importCodeMotionFile,
  resolve: resolveRegisteredPostProdMediaSource,
  async inspectImage(imageId,gcsUri) {
    const chunks:Buffer[]=[];
    await inspectGcsObjectBounded({gcsUri,maxBytes:8*1024*1024,timeoutMs:30_000,onChunk:b=>{chunks.push(Buffer.from(b));}});
    const buffer=Buffer.concat(chunks),metadata=await sharp(buffer,{limitInputPixels:16*1024*1024,animated:false}).metadata();
    await sharp(buffer,{limitInputPixels:16*1024*1024,animated:false,failOn:"warning"}).stats();
    return codeMotionImageEvidenceSchema.parse({imageId,gcsUri,width:metadata.width,height:metadata.height,bytes:buffer.length,sha256:createHash("sha256").update(buffer).digest("hex")});
  },
  async imageSize(gcsUri) {
    let size = 0;
    await inspectGcsObjectBounded({
      gcsUri,
      maxBytes: 8 * 1024 * 1024,
      timeoutMs: 30_000,
      onChunk: b => {
        size += b.length;
      },
    });
    return size;
  },
  async preview(uri) {
    const object = extractSystemObjectName(uri, getGcsBucketName());
    if (!object) throw new Error("图片尚未保存，请恢复原任务核对");
    return signGcsObjectPathV4ReadUrl(getGcsBucketName(), object, 60 * 60);
  },
};
function hash(v: unknown) {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}
function uuid(v: string) {
  const h = hash(v);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function prefix(userId: string, projectId: string) {
  if (!/^[1-9]\d*$/.test(userId)) throw new Error("请重新登录");
  z.string().uuid().parse(projectId);
  return `code-motion/u${userId}/images/${projectId}/`;
}
function objectName(userId: string, projectId: string, grantId: string) {
  z.string()
    .regex(/^[a-zA-Z0-9_-]{1,128}$/)
    .parse(grantId);
  return `${prefix(userId, projectId)}${grantId}.json`;
}
async function read(
  userId: string,
  projectId: string,
  grantId: string,
  deps: CodeMotionImagesDeps
) {
  const obj = await deps.storage.read(objectName(userId, projectId, grantId));
  if (!obj) return null;
  const m = manifestSchema.parse(JSON.parse(obj.body.toString("utf8")));
  if (m.projectId !== projectId || m.grantId !== grantId)
    throw new Error("场景图请求身份不一致");
  return m;
}
export type CodeMotionImageBatchInput = {
  projectId: string;
  expectedGeneration: string;
  grantId: string;
};
export async function prepareCodeMotionImages(
  userId: string,
  input: CodeMotionImageBatchInput,
  deps = real
) {
  const prior = await read(userId, input.projectId, input.grantId, deps);
  if (prior) return withQuote(prior);
  const saved = await loadCodeMotion(userId, input.projectId, deps.storage);
  if (!saved || saved.generation !== input.expectedGeneration)
    throw new Error("作品版本已变化，请先保存并核对");
  const grant =
    (await deps.grant(userId, input.projectId, input.grantId)) ??
    (await deps.prepareGrant(userId, input));
  if (
    !grant ||
    grant.fingerprint !== codeMotionProductionFingerprint(saved.project)
  )
    throw new Error("本次生产绑定了另一份分镜，请恢复原任务");
  const aspectRatio =
    saved.project.brief.orientation === "landscape" ? "16:9" : "9:16";
  const evidence=new Map<string,CodeMotionImageEvidence>();
  for (const image of saved.project.brief.images) {
    if(!deps.inspectImage)throw new Error("图片预检暂不可用，原图保留，未提交重绘");
    const uri=await deps.resolve({userId,source:image.gcsUri});
    evidence.set(image.id,await deps.inspectImage(image.id,uri));
  }
  const shots = codeMotionImagePrompts(saved.project).map(s => {
    const scene=saved.project.plan!.scenes[s.index];
    const ids=new Set([scene.imageId,...(scene.composition?.elements.filter(e=>e.type==="image").map(e=>e.type==="image"?e.imageId:undefined)||[])].filter((id):id is string=>!!id));
    const decision=decideCodeMotionImagePreflight(Array.from(ids).map(id=>evidence.get(id)!).filter(Boolean),saved.project.brief.orientation);
    const {mode,...preflight}=decision;
    const referenceImageUrls=decision.images.map(i=>i.gcsUri);
    const prompt=mode==="edit"?`${s.prompt}\n保留所附原图的人物、物品身份和可用细节，只重绘一次以修复以下可测问题并适配分镜；不得改成无关人物：${decision.reasons.join("；")}`:s.prompt;
    const requestId = uuid(`${input.grantId}:image:${s.index}`);
    return {
      ...s,
      prompt,mode,preflight,referenceImageUrls,
      requestId,
      jobId: `inkimage_${requestId.replace(/-/g, "")}`,
      digest: hash({
        ...s,
        prompt,mode,referenceImageUrls,preflight,
        aspectRatio,
        tier: grant.tier,
        model: codeMotionImagePolicy(grant.tier, s.index).model,
      }),
    };
  });
  const fingerprint = hash({
    projectId: input.projectId,
    grantId: input.grantId,
    generation: saved.generation,
    tier: grant.tier,
    aspectRatio,
    shots,
  });
  return withQuote(
    manifestSchema.parse({
      projectId: input.projectId,
      grantId: input.grantId,
      generation: saved.generation,
      tier: grant.tier,
      aspectRatio,
      createdAt: new Date().toISOString(),
      fingerprint,
      shots,
    })
  );
}
function withQuote(m: Manifest) {
  return {
    ...m,
    shots: m.shots.map(s => ({
      ...s,
      ...codeMotionImagePolicy(m.tier, s.index),
      ...(s.mode==="reuse"?{credits:0}:{}),
    })),
    credits: m.shots.reduce(
      (sum, s) => sum + (s.mode==="reuse"?0:codeMotionImagePolicy(m.tier, s.index).credits),
      0
    ),
  };
}
function context(
  m: Manifest,
  s: Manifest["shots"][number]
): CodeMotionImageContext {
  return {
    projectId: m.projectId,
    grantId: m.grantId,
    kind: "image",
    index: s.index,
    requestId: s.requestId,
    digest: s.digest,
  };
}
function jobInput(m: Manifest, s: Manifest["shots"][number]) {
  return {
    action: "canvas_gpt_image2",
    params: {
      prompt: s.prompt,
      aspectRatio: m.aspectRatio,
      providerOverride: "openai",
      imageLane: "keyart",
      gcsSubdir: `code-motion/${m.projectId}`,
      batchIndex: s.index,
      ...(s.mode==="edit"?{referenceImageUrls:s.referenceImageUrls}:{}),
      codeMotionImage: context(m, s),
    },
  };
}
export async function submitCodeMotionImages(
  userId: string,
  input: CodeMotionImageBatchInput & { fingerprint: string },
  deps = real
) {
  let m = await read(userId, input.projectId, input.grantId, deps);
  if (!m) {
    const prepared = await prepareCodeMotionImages(userId, input, deps);
    if (prepared.fingerprint !== input.fingerprint)
      throw new Error("本次场景图内容已变化，请重新核对");
    const { credits: _credits, ...batch } = prepared;
    m = manifestSchema.parse({
      ...batch,
      shots: prepared.shots.map(({ model, quality, credits, ...s }) => s),
    });
    try {
      await deps.storage.write(
        objectName(userId, input.projectId, input.grantId),
        Buffer.from(JSON.stringify(m)),
        "0"
      );
    } catch (error) {
      const existing = await read(userId, input.projectId, input.grantId, deps);
      if (!existing || existing.fingerprint !== input.fingerprint) throw error;
      m = existing;
    }
  }
  if (m.fingerprint !== input.fingerprint)
    throw new Error("请恢复原批次，不能替换已提交内容");
  const enqueueErrors: Record<string, string> = {};
  // Resume only absent fixed jobs. Failed/unknown jobs never receive a replacement identity.
  for (const s of m.shots) {
    if(s.mode==="reuse")continue;
    try {
      await deps.reserve(userId, context(m, s));
      const existing = await deps.job(s.jobId);
      if (existing) {
        assertJob(existing, userId, m, s);
        continue;
      }
      try {
        await deps.create({
          id: s.jobId,
          userId,
          type: "image",
          provider: "openai-gpt-image-2",
          input: jobInput(m, s),
        });
      } catch (error) {
        const recovered = await deps.job(s.jobId);
        if (!recovered) throw error;
        assertJob(recovered, userId, m, s);
      }
    } catch (error) {
      console.warn("[codeMotionImages] queue outcome", s.jobId, error);
      enqueueErrors[s.jobId] = "这张场景图的提交尚未确认，请恢复原批次核对";
    }
  }
  return {
    ...(await getCodeMotionImages(
      userId,
      input.projectId,
      input.grantId,
      deps
    )),
    enqueueErrors,
  };
}
function assertJob(
  job: NonNullable<Awaited<ReturnType<typeof getJobByIdStrict>>>,
  userId: string,
  m: Manifest,
  s: Manifest["shots"][number]
) {
  if (
    String(job.userId) !== userId ||
    job.type !== "image" ||
    !isDeepStrictEqual(job.input, jobInput(m, s))
  )
    throw new Error("图片任务身份或内容不一致，已停止恢复");
}
export async function getCodeMotionImages(
  userId: string,
  projectId: string,
  grantId: string,
  deps = real
) {
  const m = await read(userId, projectId, grantId, deps);
  if (!m) throw new Error("没有找到这份作品的场景图请求");
  const shots = [];
  for (const s of m.shots) {
    if(s.mode==="reuse") {
      const uri=s.referenceImageUrls?.[0];
      shots.push({...s,status:"reused",error:null,gcsUri:uri||null,previewUrl:uri?await deps.preview(uri):null,canResume:false});
      continue;
    }
    const job = await deps.job(s.jobId);
    if (job) assertJob(job, userId, m, s);
    const output = job?.output as { imageUrl?: string } | null;
    const uri =
      job?.status === "succeeded" && output?.imageUrl
        ? await deps.resolve({ userId, source: output.imageUrl })
        : null;
    shots.push({
      ...s,
      status: job?.status ?? "not_started",
      error: job?.error
        ? "该场景图未完成，请保留原任务核对；不会自动再次付费"
        : null,
      gcsUri: uri,
      previewUrl: uri ? await deps.preview(uri) : null,
      canResume: !job,
    });
  }
  return { ...m, shots };
}
export async function listCodeMotionImages(
  userId: string,
  projectId: string,
  deps = real
) {
  const p = prefix(userId, projectId),
    names = await deps.storage.list(p);
  const rows = [];
  for (const name of names) {
    const match = name.slice(p.length).match(/^([a-zA-Z0-9_-]{1,128})\.json$/);
    if (match)
      rows.push(await getCodeMotionImages(userId, projectId, match[1]!, deps));
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function adoptCodeMotionImage(
  userId: string,
  input: { projectId: string; grantId: string; index: number },
  deps = real
) {
  const batch = await getCodeMotionImages(
    userId,
    input.projectId,
    input.grantId,
    deps
  );
  const shot = batch.shots.find(s => s.index === input.index);
  if (!shot?.gcsUri || shot.status !== "succeeded")
    throw new Error("该场景图尚未完成，不能采用");
  const extension = shot.gcsUri.split(".").at(-1)?.toLowerCase();
  if (!extension || !["png", "jpeg", "jpg", "webp"].includes(extension))
    throw new Error("场景图格式无法确认");
  const result = await deps.importFile(userId, {
    gcsUri: shot.gcsUri,
    name: `${shot.name}.${extension}`,
    bytes: await deps.imageSize(shot.gcsUri),
  });
  if (result.kind !== "image") throw new Error("场景图内容无法确认");
  return {
    sceneIndex: shot.index,
    image: { ...result.image, id: shot.requestId },
    ...(shot.mode==="edit" && shot.preflight?.images[0]?{replacesImageId:shot.preflight.images[0].imageId,replacesImageIds:shot.preflight.images.map(i=>i.imageId)}:{}),
  };
}
/** Worker trusts only this server-created manifest plus a reserved grant slot. */
export async function resolveCodeMotionImageWorkerPolicy(
  userId: string,
  jobId: string,
  raw: unknown,
  actualInput: unknown,
  deps = real
) {
  const c = codeMotionImageContextSchema.parse(raw);
  const m = await read(userId, c.projectId, c.grantId, deps);
  const s = m?.shots[c.index];
  if (
    !m ||
    !s ||
    s.jobId !== jobId ||
    !isDeepStrictEqual(context(m, s), c) ||
    !isDeepStrictEqual(jobInput(m, s), actualInput)
  )
    throw new Error("场景图生产凭据无效，未调用上游");
  const slot = await deps.assertSlot(userId, c);
  if (slot.tier !== m.tier) throw new Error("场景图档位不一致");
  return codeMotionImagePolicy(m.tier, s.index);
}

/** Evidence is permanent, before parsing/consumption. Unknown writes stop the same job, never regenerate. */
export async function persistCodeMotionImageResponse(
  userId: string,
  raw: unknown,
  response: { status: number; body: string }
) {
  const c = codeMotionImageContextSchema.parse(raw);
  const base = `${prefix(userId, c.projectId)}evidence/${c.requestId}`;
  const rawBuffer = Buffer.from(response.body);
  await uploadBufferToGcsIfAbsent({
    objectName: `${base}.raw.json`,
    buffer: rawBuffer,
    contentType: "application/json",
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    parsed = { status: response.status, invalidJson: true };
  }
  const parsedBuffer = Buffer.from(JSON.stringify(parsed));
  await uploadBufferToGcsIfAbsent({
    objectName: `${base}.parsed.json`,
    buffer: parsedBuffer,
    contentType: "application/json",
  });
  await uploadBufferToGcsIfAbsent({
    objectName: `${base}.receipt.json`,
    buffer: Buffer.from(
      JSON.stringify({
        requestId: c.requestId,
        status: response.status,
        raw: {
          objectName: `${base}.raw.json`,
          bytes: rawBuffer.length,
          sha256: createHash("sha256").update(rawBuffer).digest("hex"),
        },
        parsed: {
          objectName: `${base}.parsed.json`,
          bytes: parsedBuffer.length,
          sha256: createHash("sha256").update(parsedBuffer).digest("hex"),
        },
      })
    ),
    contentType: "application/json",
  });
}
