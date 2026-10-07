import { mkdir, readFile, open } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  IMAGE_WORLD_ANALYSIS_PROMPT,
  parseImageWorldAnalysis,
} from "../../shared/imageWorld";
import { extractFirstChoicePlainText, type InvokeResult } from "../_core/llm";
import { runCanvasTerraVisionJson } from "./canvasTerraMultimodal";
import {
  downloadGcsObject,
  getGcsBucketName,
  signGsUriV4ReadUrl,
  uploadBufferToGcs,
  uploadBufferToGcsIfAbsent,
} from "./gcs";
import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource";

const spoolRoot = () =>
  process.env.IMAGE_WORLD_EVIDENCE_DIR || "/data/growth/image-world-evidence";
const defaults = {
  async spool(objectName: string, buffer: Buffer) {
    const file = path.join(spoolRoot(), objectName);
    await mkdir(path.dirname(file), { recursive: true });
    try {
      const handle = await open(file, "wx", 0o600);
      try {
        await handle.writeFile(buffer);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (!(await readFile(file)).equals(buffer))
        throw new Error("原始证据已存在且内容不同，未覆盖");
    }
    const dir = await open(path.dirname(file), "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  },
  async local(objectName: string) {
    try {
      return await readFile(path.join(spoolRoot(), objectName));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  },
  resolve: resolveRegisteredPostProdMediaSource,
  read: downloadGcsObject,
  save: uploadBufferToGcs,
  create: uploadBufferToGcsIfAbsent,
  sign: signGsUriV4ReadUrl,
  bucket: getGcsBucketName,
  invoke: runCanvasTerraVisionJson,
};
/** Permanent one-shot intent: restarting/repeating this request never buys the same analysis twice. */
export async function analyzeImageWorld(
  userId: number,
  input: { requestId: string; sourceUri: string },
  deps = defaults,
  queryOnly = false
) {
  const canonical = await deps.resolve({
    userId: String(userId),
    source: input.sourceUri,
  });
  if (!canonical.startsWith("gs://"))
    throw new Error("请先将来源图保存到账号素材库");
  const key = createHash("sha256")
    .update(JSON.stringify([userId, input.requestId]))
    .digest("hex");
  const prefix = `image-world/${userId}/${key}`,
    bucket = deps.bucket();
  const read = async (name: string) => {
    try {
      return (await deps.read({ gcsUri: `gs://${bucket}/${prefix}/${name}` }))
        .buffer;
    } catch (e) {
      if (
        e instanceof Error &&
        e.message.startsWith("gcs_download_failed:404:")
      )
        return null;
      throw e;
    }
  };
  const receipts: Array<{
    name: string;
    bytes: number;
    sha256: string;
    gcsUri: string;
  }> = [];
  const save = async (name: string, value: unknown) => {
    const buffer = Buffer.from(JSON.stringify(value));
    // Independent stores: a failed local disk must not discard an available cloud copy.
    await deps.spool(`${prefix}/${name}`, buffer).catch(() => {
      console.error(
        "[image-world] local evidence unavailable; requiring cloud persistence"
      );
    });
    const saved = await deps.save({
      objectName: `${prefix}/${name}`,
      buffer,
      contentType: "application/json",
    });
    receipts.push({
      name,
      bytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      gcsUri: saved.gcsUri,
    });
  };
  const intent = {
    version: 1,
    userId,
    requestId: input.requestId,
    sourceUri: canonical,
    prompt: IMAGE_WORLD_ANALYSIS_PROMPT,
  };
  const claim = queryOnly
    ? { created: false }
    : await deps.create({
        objectName: `${prefix}/intent.json`,
        buffer: Buffer.from(JSON.stringify(intent)),
        contentType: "application/json",
      });
  let text: string;
  if (!claim.created) {
    const stored = await read("intent.json");
    if (!stored) throw new Error("未找到已提交的分析请求，未发起新调用");
    if (stored.toString() !== JSON.stringify(intent))
      throw new Error("同一分析请求不能更换来源，请查询原方案");
    const completed = await read("result.json");
    if (completed)
      return JSON.parse(completed.toString()) as {
        text: string;
        objectCount: number;
        evidence: typeof receipts;
      };
    const localResult = await deps.local(`${prefix}/result.json`);
    if (localResult) {
      await deps.save({
        objectName: `${prefix}/result.json`,
        buffer: localResult,
        contentType: "application/json",
      });
      return JSON.parse(localResult.toString()) as {
        text: string;
        objectCount: number;
        evidence: typeof receipts;
      };
    }
    const raw =
      (await read("response.raw.json")) ||
      (await deps.local(`${prefix}/response.raw.json`));
    if (!raw)
      throw new Error(
        "原分析已提交，尚未确认结果；未重复调用，请稍后查询原任务"
      );
    const envelope = JSON.parse(raw.toString()) as {
      text: string;
      status: number;
    };
    await save("response.raw.json", envelope);
    if (envelope.status < 200 || envelope.status >= 300)
      throw new Error("原分析请求返回失败，证据已保留，未自动重试");
    const parsed = JSON.parse(envelope.text) as InvokeResult;
    await save("response.parsed.json", parsed);
    if (parsed.choices?.[0]?.finish_reason !== "stop")
      throw new Error("原分析回答未完整结束，证据已保留");
    text = extractFirstChoicePlainText(parsed).trim();
  } else {
    text = await deps.invoke(
      {
        prompt: IMAGE_WORLD_ANALYSIS_PROMPT,
        images: [{ url: deps.sign(canonical, 3600), mimeType: "image/png" }],
      },
      {
        singleAttempt: true,
        requestId: key,
        onPreparedRequest: async (body, route) =>
          save("request.json", { body, route }),
        onRawCompletion: async raw => {
          await save("response.raw.json", raw);
          if (raw.status >= 200 && raw.status < 300) {
            const parsed = JSON.parse(raw.text) as InvokeResult;
            await save("response.parsed.json", parsed);
            if (parsed.choices?.[0]?.finish_reason !== "stop")
              throw new Error("分析回答未完整结束，证据已保留");
          }
        },
      }
    );
  }
  await save("analysis.text.json", { text });
  const plan = parseImageWorldAnalysis(text);
  await save("analysis.parsed.json", plan);
  // Strict parser rejects excess objects; never silently drops an observation.
  const result = { text, objectCount: plan.objects.length, evidence: receipts };
  await save("result.json", result);
  return result;
}
