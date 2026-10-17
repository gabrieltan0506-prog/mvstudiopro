import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  mkdir,
  writeFile,
  link,
  unlink,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  digitalHumanOmniInputSchema,
  digitalHumanOmniSubmitSchema,
  type DigitalHumanOmniInput,
  type DigitalHumanOmniQuote,
} from "../../shared/digitalHumanOmni";
import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource";
import { fetchPostProdSourceToFile, probeAudio } from "./postProduction";
import { signGsUriV4ReadUrl } from "./gcs";
import { quoteWavespeedOmniHuman } from "./wavespeedOmniHuman";
import { createCanvasVideoTask, peekCanvasVideoTask } from "./canvasVideoTask";

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const identity = (userId: number, requestId: string) =>
  `cv_omni_${hash(`${userId}:${requestId}`).slice(0, 48)}`;
const reservationPath = (id: string) =>
  join(
    process.env.CANVAS_VIDEO_TASK_DIR || "/data/growth/canvas-video",
    "omni-intents",
    `${id}.json`
  );
async function readReservation(
  id: string
): Promise<{
  requestDigest: string;
  status?: "failed";
  error?: string;
} | null> {
  try {
    return JSON.parse(await readFile(reservationPath(id), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("原请求登记不可读取，已停止提交");
  }
}
async function claimReservation(
  id: string,
  requestDigest: string
): Promise<boolean> {
  const file = reservationPath(id);
  await mkdir(join(file, ".."), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify({ requestDigest }), { flag: "wx" });
  try {
    await link(tmp, file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}
export type DigitalHumanOmniPrepared = DigitalHumanOmniInput & {
  fingerprint: string;
  durationSec: number;
};

/** 以本人已登记素材的真实字节与音频时长核价，不相信客户端时长与跨账号地址。 */
export async function prepareDigitalHumanOmni(
  userId: number,
  raw: DigitalHumanOmniInput
): Promise<DigitalHumanOmniPrepared> {
  const input = digitalHumanOmniInputSchema.parse(raw);
  const image = await resolveRegisteredPostProdMediaSource({
    userId: String(userId),
    source: input.image,
  });
  const audio = await resolveRegisteredPostProdMediaSource({
    userId: String(userId),
    source: input.audio,
  });
  if (!image.startsWith("gs://") || !audio.startsWith("gs://"))
    throw new Error("请先将本次图片和配音保存到站内素材");
  const dir = await mkdtemp(join(tmpdir(), "dh-omni-input-"));
  const signal = AbortSignal.timeout(120_000);
  try {
    const imageFile = join(dir, "image"),
      audioFile = join(dir, "audio");
    await fetchPostProdSourceToFile(image, imageFile, {
      signal,
      maxBytes: 20 * 1024 * 1024,
    });
    await fetchPostProdSourceToFile(audio, audioFile, {
      signal,
      maxBytes: 100 * 1024 * 1024,
    });
    const imageBytes = await readFile(imageFile);
    const info = await sharp(imageBytes, {
      limitInputPixels: 40_000_000,
    }).metadata();
    if (
      !info.width ||
      !info.height ||
      !["jpeg", "png", "webp"].includes(info.format || "") ||
      (info.pages || 1) > 1
    )
      throw new Error("请使用可读取的单张静态人物画面");
    // 强制解码，损坏图片不能仅凭文件头通过。
    await sharp(imageBytes, { limitInputPixels: 40_000_000 }).stats();
    const durationSec = await probeAudio(audioFile, signal);
    if (!Number.isFinite(durationSec) || durationSec < 4 || durationSec > 300)
      throw new Error("本次配音须为4至300秒，请调整音频后重新核价");
    return {
      image,
      audio,
      prompt: input.prompt,
      durationSec,
      fingerprint: hash(
        JSON.stringify({
          userId,
          image,
          audio,
          prompt: input.prompt,
          imageSha: hash(imageBytes),
          audioSha: hash(await readFile(audioFile)),
          durationSec,
        })
      ),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function omniProviderInput(
  prepared: DigitalHumanOmniPrepared
): DigitalHumanOmniInput {
  return {
    image: signGsUriV4ReadUrl(prepared.image, 3600),
    audio: signGsUriV4ReadUrl(prepared.audio, 3600),
    prompt: prepared.prompt,
  };
}

export async function quoteDigitalHumanOmni(
  userId: number,
  input: DigitalHumanOmniInput
) {
  const prepared = await prepareDigitalHumanOmni(userId, input);
  const result = await quoteWavespeedOmniHuman(
    { userId, requestId: `quote_${prepared.fingerprint}` },
    omniProviderInput(prepared)
  );
  const now = Date.now();
  const quote: DigitalHumanOmniQuote = {
    fingerprint: prepared.fingerprint,
    durationSec: prepared.durationSec,
    priceUsd: result.priceUsd,
    discountedPriceUsd: result.discountedPriceUsd,
    quotedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 5 * 60_000).toISOString(),
  };
  return { quote, evidence: result.evidence };
}

export async function getDigitalHumanOmni(userId: number, requestId: string) {
  const id = identity(userId, requestId);
  const row = await readReservation(id);
  if (!row) return null;
  if (row.status === "failed")
    return {
      taskId: undefined,
      status: "failed" as const,
      error: row.error,
      videoUrl: undefined,
    };
  const task = await peekCanvasVideoTask(id, userId);
  return task
    ? {
        taskId: id,
        status: task.status,
        videoUrl: task.videoUrl,
        error: task.error,
      }
    : {
        taskId: undefined,
        status: "reconcile_manual" as const,
        error: "提交记录已保存，任务回执待核对；请勿重新提交",
      };
}

/** 持久目录原子占位先于异步任务创建；回执中断只恢复原编号，不重新付费。 */
export async function queueDigitalHumanOmni(userId: number, raw: unknown) {
  const input = digitalHumanOmniSubmitSchema.parse(raw);
  const id = identity(userId, input.requestId);
  const requestDigest = hash(
    JSON.stringify({
      image: input.image,
      audio: input.audio,
      prompt: input.prompt,
      quote: input.quote,
    })
  );
  const existing = await readReservation(id);
  if (existing) {
    if (existing.requestDigest !== requestDigest)
      throw new Error("请求编号已经用于其他输入，请先核对原任务");
    return getDigitalHumanOmni(userId, input.requestId);
  }
  if (!(await claimReservation(id, requestDigest))) {
    const winner = await readReservation(id);
    if (winner?.requestDigest !== requestDigest)
      throw new Error("请求编号已经用于其他输入");
    return getDigitalHumanOmni(userId, input.requestId);
  }
  let prepared: DigitalHumanOmniPrepared;
  try {
    if (
      Date.parse(input.quote.expiresAt) < Date.now() ||
      Date.parse(input.quote.quotedAt) > Date.now() ||
      Date.now() - Date.parse(input.quote.quotedAt) > 5 * 60_000
    )
      throw new Error("报价已过期，请重新核价并确认");
    prepared = await prepareDigitalHumanOmni(userId, {
      image: input.image,
      audio: input.audio,
      prompt: input.prompt,
    });
    if (
      prepared.fingerprint !== input.quote.fingerprint ||
      Math.abs(prepared.durationSec - input.quote.durationSec) > 0.001
    )
      throw new Error("素材已变化，请重新查看输入并核价");
    const latest = await quoteWavespeedOmniHuman(
      { userId, requestId: input.requestId },
      omniProviderInput(prepared)
    );
    if (latest.discountedPriceUsd > input.quote.discountedPriceUsd + 0.000001)
      throw new Error("本次费用高于已确认报价，请重新核价");
  } catch (error) {
    // 占位已存在但尚未创建任务，明确记录未提交；重启不会再走本请求的付费路径。
    const tmp = `${reservationPath(id)}.${randomUUID()}.tmp`;
    await writeFile(
      tmp,
      JSON.stringify({
        requestDigest,
        status: "failed",
        error:
          error instanceof Error ? error.message : "输入核验失败，未提交生成",
      })
    );
    await rename(tmp, reservationPath(id));
    return getDigitalHumanOmni(userId, input.requestId);
  }
  const task = await createCanvasVideoTask({
    taskId: id,
    userId,
    creditsCharged: 0,
    engine: "omnihuman2-wavespeed",
    label: "音频驱动人物视频",
    prompt: input.prompt || "自然讲述，口型与音频同步。",
    imageUrls: [prepared.image],
    audioUrls: [prepared.audio],
    duration: prepared.durationSec,
    omni: {
      ...prepared,
      requestId: input.requestId,
      maxPriceUsd: input.quote.discountedPriceUsd,
    },
  });
  return {
    taskId: id,
    status: task.status,
    videoUrl: task.videoUrl,
    error: task.error,
  };
}
