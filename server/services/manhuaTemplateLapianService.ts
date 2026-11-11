/**
 * 模板学习 · 拉片式派生（站长专用）：复刻提示词按段懒生成、视觉基因一次汇总、可播放片段按需裁切。
 *
 * - 只读已入库学习卡 JSON，不重看视频、不碰精读契约 / 段缓存 / 学习卡身份；派生产物单独存放、不写回学习卡。
 * - 文字模型走仓库既有三跳 CREATIVE_LLM_HOPS（GLM 5.3 FlashX@EvoLink → @OpenRouter → DeepSeek V4.1 Flash）：
 *   通道失败直接切跳；写坏（非 JSON / 校验不过）先带原因重写一次，再坏切跳。
 * - 每一发的 request / raw / error / parsed / rejected 分对象永久落 GCS（条件创建、独立 runId，失败与重试都不删）。
 * - 片段：用精读时的 GCS 源分片（prepared-media 恢复索引）按段起止秒裁切，找不到分片就不出片段。
 * - 计费：站长 / 管理员 0 扣费，本模块不调用任何扣费函数。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank";
import {
  buildManhuaTemplateLapianGenesEvidence,
  buildManhuaTemplateLapianSegmentEvidence,
  formatManhuaTemplateLapianGenes,
  formatManhuaTemplateLapianRecreatePrompt,
  manhuaTemplateLapianDurationSec,
  MANHUA_TEMPLATE_LAPIAN_VERSION,
  planManhuaTemplateLapianSegments,
  validateManhuaTemplateLapianGenesOutput,
  validateManhuaTemplateLapianSegmentOutput,
  type ManhuaTemplateLapianGenes,
  type ManhuaTemplateLapianSegmentOutput,
} from "../../shared/manhuaTemplateLapianView";
import { CREATIVE_LLM_HOPS, creativeHopSlug, CreativeHopTransportError, type CreativeHopResult, type CreativeLlmHop, type Save } from "./creativeLlmHops";
import type { PreparedMediaIdentity, PreparedMediaVideo } from "./manhuaNativePreparedMediaCache";

export const MANHUA_TEMPLATE_LAPIAN_ROOT = `manhua-template-learn/lapian-derived/${MANHUA_TEMPLATE_LAPIAN_VERSION.replace(/^tpl_lapian_/, "")}`;
/** 片段签名有效期（与正式卡截图同口径）。 */
export const MANHUA_TEMPLATE_LAPIAN_SIGN_SECONDS = 15 * 60;
/** 裁切输出帧率：videoSegmentCutRate 只接受 24–60，统一 30。 */
export const MANHUA_TEMPLATE_LAPIAN_CLIP_FPS = 30;

export class ManhuaTemplateLapianError extends Error {
  constructor(readonly code: "NOT_FOUND" | "BAD_REQUEST" | "PRECONDITION_FAILED" | "INTERNAL_SERVER_ERROR", message: string) {
    super(message);
    this.name = "ManhuaTemplateLapianError";
  }
}

export type ManhuaTemplateLapianDeps = {
  loadCard: (templateId: string) => Promise<ManhuaViralTemplateCard | null>;
  read: (objectName: string) => Promise<Buffer | null>;
  /** 条件创建：已存在返回 created=false，绝不覆盖。 */
  createIfAbsent: (objectName: string, buffer: Buffer, contentType: string) => Promise<{ created: boolean }>;
  hops: readonly CreativeLlmHop[];
  invokeHop: (hop: CreativeLlmHop, instructions: string, input: unknown, save: Save) => Promise<CreativeHopResult>;
  readPreparedVideo: (identity: PreparedMediaIdentity) => Promise<PreparedMediaVideo | null>;
  /** 从源分片按相对秒裁出一段并以条件创建上传到 objectName。 */
  cutClip: (input: { gsUri: string; startSec: number; endSec: number; objectName: string }) => Promise<{ mode: "remote" | "download"; fallbackReason?: string; bytes: number }>;
  sign: (objectName: string, seconds: number) => string;
  now: () => number;
  runId: () => string;
  log: (line: string) => void;
};

let gcsModule: typeof import("./gcs") | undefined;
const gcs = async () => (gcsModule ??= await import("./gcs"));
const notFound = (e: unknown) => e instanceof Error && /^gcs_(?:stat|download)_failed:404(?:\b|:)/.test(e.message);

const realDeps: ManhuaTemplateLapianDeps = {
  loadCard: async (templateId) => {
    const store = await import("./manhuaViralTemplateStore");
    return (await store.getGcsManhuaViralApprovedForDisplay(templateId)) ?? (await store.getGcsManhuaViralProposal(templateId));
  },
  read: async (objectName) => {
    const g = await gcs();
    try {
      return (await g.downloadGcsObjectVersioned({ gcsUri: `gs://${g.getGcsBucketName()}/${objectName}` })).buffer;
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  },
  createIfAbsent: async (objectName, buffer, contentType) => {
    const r = await (await gcs()).uploadBufferToGcsIfAbsent({ objectName, buffer, contentType });
    return { created: r.created };
  },
  hops: CREATIVE_LLM_HOPS,
  invokeHop: async (hop, instructions, input, save) =>
    (await import("./creativeLlmHops")).invokeCreativeHop(hop, instructions, input, save, { timeoutMs: 240_000 }),
  readPreparedVideo: async (identity) => (await import("./manhuaNativePreparedMediaCache")).readPreparedMedia(identity),
  cutClip: async ({ gsUri, startSec, endSec, objectName }) => {
    const [{ cutVideoSegmentToFile }, pp, g] = await Promise.all([import("./videoPartialEditCut"), import("./postProduction"), gcs()]);
    const dir = await mkdtemp(path.join(os.tmpdir(), "tpl-lapian-clip-"));
    const signal = AbortSignal.timeout(10 * 60_000);
    try {
      const cut = await cutVideoSegmentToFile({ videoUri: gsUri, startSec, endSec, fps: MANHUA_TEMPLATE_LAPIAN_CLIP_FPS, dir, signal }, {
        runMediaTool: pp.runMediaTool, probe: pp.probe,
        download: (uri, file, s) => pp.fetchPostProdSourceToFile(uri, file, { signal: s }),
        signRead: (uri) => g.signGsUriV4ReadUrl(uri, 3600),
      });
      const buffer = await readFile(cut.filePath);
      await g.uploadBufferToGcsIfAbsent({ objectName, buffer, contentType: "video/mp4", signal });
      return { mode: cut.mode, fallbackReason: cut.fallbackReason, bytes: buffer.length };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  },
  sign: (objectName, seconds) => {
    if (!gcsModule) throw new Error("gcs module not loaded");
    return gcsModule.signGcsObjectPathV4ReadUrl(gcsModule.getGcsBucketName(), objectName, seconds);
  },
  now: () => Date.now(),
  runId: () => `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
  log: (line) => console.log(line),
};

async function depsOf(partial: Partial<ManhuaTemplateLapianDeps>): Promise<ManhuaTemplateLapianDeps> {
  if (!partial.sign) await gcs().catch(() => undefined);
  return { ...realDeps, ...partial };
}

const json = (v: unknown) => Buffer.from(JSON.stringify(v, null, 2));

// ─── 身份与路径 ───────────────────────────────────────

/** 派生证据摘要：派生版本 + 参与派生的全部证据。卡被优化修订后摘要变化，派生自然重做，旧产物原样保留。 */
export function manhuaTemplateLapianEvidenceDigest(card: ManhuaViralTemplateCard): string {
  const native = card.provenance?.nativeVideoDeepRead;
  return createHash("sha256").update(JSON.stringify({
    version: MANHUA_TEMPLATE_LAPIAN_VERSION,
    beatGrid: card.beatGrid || [],
    audioTrack: card.audioStory?.audioTrack || [],
    mixNotesZh: card.audioStory?.mixNotesZh || "",
    evidenceFrames: (card.evidenceFrames || []).map(f => [f.atSec, f.kindZh, f.noteZh]),
    segmentSpans: native?.segmentSpans || [],
    durationSec: manhuaTemplateLapianDurationSec(card),
    reusableZh: card.reusableZh || "",
    genPromptHintZh: card.genPromptHintZh || "",
    audiovisualTagsZh: card.classification?.audiovisualTagsZh || [],
  })).digest("hex");
}

export function manhuaTemplateLapianPrefix(templateId: string, digest: string): string {
  return `${MANHUA_TEMPLATE_LAPIAN_ROOT}/${templateId}/${digest.slice(0, 16)}`;
}
const segKey = (i: number) => `seg${String(i).padStart(3, "0")}`;

// ─── 三跳调用 ─────────────────────────────────────────

export type ManhuaTemplateLapianReceipt = {
  hopIndex: number;
  hopLabel: string;
  model: string;
  runId: string;
  attempt: number;
  rawObjectName: string;
  parsedObjectName: string;
  /** 之前失败的跳 / 尝试（中文原因），供对账。 */
  failuresZh: string[];
};

function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

async function runHops<T>(
  d: ManhuaTemplateLapianDeps,
  runPrefix: string,
  instructions: string,
  input: unknown,
  validate: (value: unknown) => { ok: true; value: T } | { ok: false; issues: string[] },
): Promise<{ value: T; receipt: ManhuaTemplateLapianReceipt }> {
  const runId = d.runId();
  const failuresZh: string[] = [];
  for (let h = 0; h < d.hops.length; h++) {
    const hop = d.hops[h]!;
    let reasonZh = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const base = `${runPrefix}/runs/${runId}/hop${h + 1}-${creativeHopSlug(hop)}-try${attempt}`;
      const save: Save = async (name, value) => {
        const { created } = await d.createIfAbsent(`${base}-${name}.json`, json(value), "application/json");
        if (!created) throw new Error(`证据对象已存在，拒绝覆盖：${base}-${name}.json`);
      };
      const prompt = reasonZh
        ? `${instructions}\n\n【上一次输出未通过校验，请修正后重新输出完整 JSON】${reasonZh}`
        : instructions;
      let result: CreativeHopResult;
      try {
        result = await d.invokeHop(hop, prompt, input, save);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failuresZh.push(`${hop.label} 第${attempt}次：${message.slice(0, 300)}`);
        if (!(error instanceof CreativeHopTransportError)) {
          // 证据落盘失败 / 输入超容量等本地故障：切跳只会继续烧钱且回执存不下，立即停止。
          d.log(`[tplLapian] hop_local_error run=${runId} hop=${h + 1} ${message.slice(0, 200)}`);
          throw new ManhuaTemplateLapianError("INTERNAL_SERVER_ERROR", `本地故障，已停止调用（不切跳）：${message.slice(0, 200)}`);
        }
        // 通道层失败不重写，直接切下一跳。
        break;
      }
      let parsed: unknown;
      try {
        parsed = parseJsonText(result.text);
      } catch {
        reasonZh = "输出不是合法 JSON 对象。";
        await save("rejected", { reasonZh, model: result.model });
        failuresZh.push(`${hop.label} 第${attempt}次：${reasonZh}`);
        continue;
      }
      const checked = validate(parsed);
      if (!checked.ok) {
        reasonZh = checked.issues.join("；").slice(0, 1200);
        await save("rejected", { issues: checked.issues, parsed, model: result.model });
        failuresZh.push(`${hop.label} 第${attempt}次：校验不过（${reasonZh.slice(0, 200)}）`);
        continue;
      }
      await save("parsed", checked.value);
      return {
        value: checked.value,
        receipt: { hopIndex: h + 1, hopLabel: hop.label, model: result.model, runId, attempt,
          rawObjectName: `${base}-raw.json`, parsedObjectName: `${base}-parsed.json`, failuresZh },
      };
    }
  }
  throw new ManhuaTemplateLapianError("INTERNAL_SERVER_ERROR", `三跳文字模型均未产出合格结果（${failuresZh.length} 次失败，回执已永久保存）`);
}

// ─── 指令 ─────────────────────────────────────────────

export const MANHUA_TEMPLATE_LAPIAN_SEGMENT_INSTRUCTIONS = [
  "你是漫剧（竖屏 9:16 短剧）分镜编剧。输入是一部整集学习卡中某个剧情段的逐镜证据（段内相对秒）、该段音轨与重点时刻，以及整集可复用手法。",
  "任务：按「秒锁复刻提示词」格式，为这一段写一份可直接交给 AI 视频生成的竖屏漫剧复刻提示词，供站长做漫剧创作参考。",
  "只输出一个 JSON 对象：{\"title\":string,\"recreatePrompt\":{\"subject\":string,\"scene\":string,\"timeline\":[{\"fromSec\":number,\"toSec\":number,\"text\":string}],\"camera\":string,\"lightColor\":string,\"rhythm\":string,\"constraints\":string}}。",
  "规则：",
  "1. timeline 用段内相对秒：从 0 开始，按时间顺序，相邻时间窗首尾相接，最后一窗 toSec 不超过输入 lengthSec；最多 40 窗，相邻同质镜头可合为一窗，但每个镜头的时间都要落在某一窗内。",
  "2. 每窗写清景别、人物表情与动作、光线、氛围，并把原片横屏构图改写成竖屏构图（主体放在画面上三分之一、利用纵向纵深与前景遮挡）。",
  "3. subject 写主体一致性（外形、服饰、发型、年龄感全程一致）；scene 写场景与美术；camera 写摄影机与构图；lightColor 写光色与材质；rhythm 写节奏与声音；constraints 写必须保留与必须避免。",
  "4. 不写原剧角色名、剧名、演员名，不照抄台词原文；人物用中性称谓（如「黑袍青年将军」）。",
  "5. 只依据输入证据，不补造输入里没有的情节或画面。",
  "6. 字数上限：title 80；subject、scene、constraints、每窗 text 各 600；camera、lightColor、rhythm 各 400。",
].join("\n");

export const MANHUA_TEMPLATE_LAPIAN_GENES_INSTRUCTIONS = [
  "你是漫剧（竖屏 9:16 短剧）视觉指导。输入是一部整集学习卡的全片逐镜视觉证据（全部镜头，绝对秒）、景别/机位/运镜/转场的全量频次统计，以及整集视听标签与可复用手法。",
  "任务：归纳这一集的「视觉基因」，供站长做漫剧创作参考。",
  "只输出一个 JSON 对象：{\"visualGenes\":{\"mediumAndArtStyle\":string,\"color\":string,\"lighting\":string,\"materialTexture\":string,\"composition\":string,\"camera\":string},\"recurringElements\":string[],\"mustKeep\":string[]}。",
  "规则：",
  "1. 六维分别是：媒介与美术风格、色彩体系、光线体系、材质与质感、构图体系、摄影机体系；每维 600 字以内，具体到可写进生成提示词的程度，摄影机与构图须引用频次统计里的真实分布。",
  "2. recurringElements：全片反复出现的画面元素，1–12 条，每条 200 字以内。",
  "3. mustKeep：复刻到竖屏漫剧时必须保留的要点，1–12 条，每条 300 字以内，写成可执行的生成指令。",
  "4. 不写原剧角色名、剧名、演员名；只依据输入证据，不补造。",
].join("\n");

// ─── 对外：段复刻提示词 ────────────────────────────────

export type ManhuaTemplateLapianSegmentView = {
  templateId: string;
  segmentIndex: number;
  startSec: number;
  endSec: number;
  status: "cached" | "generated" | "absent";
  title?: string;
  recreatePrompt?: ManhuaTemplateLapianSegmentOutput["recreatePrompt"];
  text?: string;
};

type StoredResult<T> = {
  version: string;
  templateId: string;
  evidenceDigest: string;
  value: T;
  receipt: ManhuaTemplateLapianReceipt;
  createdAt: string;
  segmentIndex?: number;
  startSec?: number;
  endSec?: number;
};

async function readStored<T>(d: ManhuaTemplateLapianDeps, objectName: string): Promise<StoredResult<T> | null> {
  const buf = await d.read(objectName);
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString("utf8")) as StoredResult<T>;
  } catch {
    // 结果文件损坏不覆盖（条件创建也覆盖不了），显式失败交人处理。
    throw new ManhuaTemplateLapianError("INTERNAL_SERVER_ERROR", `派生结果文件损坏：${objectName}`);
  }
}

async function loadCardOrThrow(d: ManhuaTemplateLapianDeps, templateId: string) {
  const card = await d.loadCard(templateId);
  if (!card) throw new ManhuaTemplateLapianError("NOT_FOUND", "模板不存在");
  if (!(card.beatGrid || []).length) throw new ManhuaTemplateLapianError("PRECONDITION_FAILED", "该模板没有逐镜证据，无法派生拉片视图");
  return card;
}

const inflight = new Map<string, Promise<unknown>>();
function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = inflight.get(key);
  if (hit) return hit as Promise<T>;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** 仅测试：清进程内在途表。 */
export function resetManhuaTemplateLapianInflightForTest() {
  inflight.clear();
}

export async function getManhuaTemplateLapianSegmentPrompt(
  input: { templateId: string; segmentIndex: number; generate: boolean },
  deps: Partial<ManhuaTemplateLapianDeps> = {},
): Promise<ManhuaTemplateLapianSegmentView> {
  const d = await depsOf(deps);
  const card = await loadCardOrThrow(d, input.templateId);
  const segments = planManhuaTemplateLapianSegments(card);
  const segment = segments[input.segmentIndex];
  if (!segment) throw new ManhuaTemplateLapianError("BAD_REQUEST", `段号越界（共 ${segments.length} 段）`);
  const digest = manhuaTemplateLapianEvidenceDigest(card);
  const prefix = `${manhuaTemplateLapianPrefix(input.templateId, digest)}/segments/${segKey(segment.index)}`;
  const base = { templateId: input.templateId, segmentIndex: segment.index, startSec: segment.startSec, endSec: segment.endSec };
  const view = (s: StoredResult<ManhuaTemplateLapianSegmentOutput>, status: "cached" | "generated"): ManhuaTemplateLapianSegmentView => ({
    ...base, status, title: s.value.title, recreatePrompt: s.value.recreatePrompt,
    text: formatManhuaTemplateLapianRecreatePrompt(s.value.recreatePrompt),
  });
  const cached = await readStored<ManhuaTemplateLapianSegmentOutput>(d, `${prefix}/result.json`);
  if (cached) return view(cached, "cached");
  if (!input.generate) return { ...base, status: "absent" };
  if (!segment.shotIndexes.length) throw new ManhuaTemplateLapianError("PRECONDITION_FAILED", "本段没有剧情镜头（可能是已剔除的广告区间），不生成提示词");
  return once(`${prefix}`, async () => {
    const evidence = buildManhuaTemplateLapianSegmentEvidence(card, segment);
    const { value, receipt } = await runHops(d, prefix, MANHUA_TEMPLATE_LAPIAN_SEGMENT_INSTRUCTIONS, evidence,
      (v) => validateManhuaTemplateLapianSegmentOutput(v, evidence.lengthSec));
    const stored: StoredResult<ManhuaTemplateLapianSegmentOutput> = {
      version: MANHUA_TEMPLATE_LAPIAN_VERSION, templateId: input.templateId, evidenceDigest: digest,
      value, receipt, createdAt: new Date(d.now()).toISOString(), ...base,
    };
    const { created } = await d.createIfAbsent(`${prefix}/result.json`, json(stored), "application/json");
    if (!created) {
      const winner = await readStored<ManhuaTemplateLapianSegmentOutput>(d, `${prefix}/result.json`);
      if (winner) return view(winner, "cached");
    }
    d.log(`[tplLapian] segment_generated template=${input.templateId} seg=${segment.index} hop=${receipt.hopIndex} attempt=${receipt.attempt}`);
    return view(stored, "generated");
  });
}

// ─── 对外：视觉基因 ───────────────────────────────────

export type ManhuaTemplateLapianGenesView = {
  templateId: string;
  status: "cached" | "generated" | "absent";
  genes?: ManhuaTemplateLapianGenes;
  text?: string;
};

export async function getManhuaTemplateLapianGenes(
  input: { templateId: string; generate: boolean },
  deps: Partial<ManhuaTemplateLapianDeps> = {},
): Promise<ManhuaTemplateLapianGenesView> {
  const d = await depsOf(deps);
  const card = await loadCardOrThrow(d, input.templateId);
  const digest = manhuaTemplateLapianEvidenceDigest(card);
  const prefix = `${manhuaTemplateLapianPrefix(input.templateId, digest)}/genes`;
  const view = (s: StoredResult<ManhuaTemplateLapianGenes>, status: "cached" | "generated"): ManhuaTemplateLapianGenesView => ({
    templateId: input.templateId, status, genes: s.value, text: formatManhuaTemplateLapianGenes(s.value),
  });
  const cached = await readStored<ManhuaTemplateLapianGenes>(d, `${prefix}/result.json`);
  if (cached) return view(cached, "cached");
  if (!input.generate) return { templateId: input.templateId, status: "absent" };
  return once(prefix, async () => {
    const evidence = buildManhuaTemplateLapianGenesEvidence(card);
    const { value, receipt } = await runHops(d, prefix, MANHUA_TEMPLATE_LAPIAN_GENES_INSTRUCTIONS, evidence, validateManhuaTemplateLapianGenesOutput);
    const stored: StoredResult<ManhuaTemplateLapianGenes> = {
      version: MANHUA_TEMPLATE_LAPIAN_VERSION, templateId: input.templateId, evidenceDigest: digest,
      value, receipt, createdAt: new Date(d.now()).toISOString(),
    };
    const { created } = await d.createIfAbsent(`${prefix}/result.json`, json(stored), "application/json");
    if (!created) {
      const winner = await readStored<ManhuaTemplateLapianGenes>(d, `${prefix}/result.json`);
      if (winner) return view(winner, "cached");
    }
    return view(stored, "generated");
  });
}

// ─── 对外：可播放片段 ─────────────────────────────────

export type ManhuaTemplateLapianClipView =
  | { available: true; url: string; startSec: number; endSec: number }
  | { available: false; reasonZh: string; startSec: number; endSec: number };

/** 卡 id → 系列键与集号（修订卡取父卡 id）。只认原生逐集卡 tpl_native_<seriesKey>_ep###。 */
export function parseManhuaTemplateLapianEpisodeRef(card: Pick<ManhuaViralTemplateCard, "id" | "revision">): { seriesKey: string; episodeIndex: number } | null {
  const id = String(card.revision?.parentTemplateId || card.id || "");
  const m = id.match(/^tpl_native_([0-9A-Za-z_-]{1,40})_ep(\d{3})$/);
  if (!m) return null;
  const episodeIndex = Number(m[2]);
  return episodeIndex >= 1 ? { seriesKey: m[1]!, episodeIndex } : null;
}

export async function getManhuaTemplateLapianSegmentClip(
  input: { templateId: string; segmentIndex: number },
  deps: Partial<ManhuaTemplateLapianDeps> = {},
): Promise<ManhuaTemplateLapianClipView> {
  const d = await depsOf(deps);
  const card = await loadCardOrThrow(d, input.templateId);
  const segments = planManhuaTemplateLapianSegments(card);
  const segment = segments[input.segmentIndex];
  if (!segment) throw new ManhuaTemplateLapianError("BAD_REQUEST", `段号越界（共 ${segments.length} 段）`);
  const span = { startSec: segment.startSec, endSec: segment.endSec };
  const digest = manhuaTemplateLapianEvidenceDigest(card);
  const clipBase = `${manhuaTemplateLapianPrefix(input.templateId, digest)}/clips/${segKey(segment.index)}`;
  const signed = () => ({ available: true as const, url: d.sign(`${clipBase}.mp4`, MANHUA_TEMPLATE_LAPIAN_SIGN_SECONDS), ...span });
  if (await d.read(`${clipBase}.json`)) return signed();
  const unavailable = (reasonZh: string) => ({ available: false as const, reasonZh, ...span });
  const native = card.provenance?.nativeVideoDeepRead;
  const ref = parseManhuaTemplateLapianEpisodeRef(card);
  const sourceDigest = String(native?.sourceDigest || "").toLowerCase();
  const sourceDurationSec = Number(native?.sourceDurationSec);
  if (!ref || !/^[a-f0-9]{64}$/.test(sourceDigest) || !Number.isFinite(sourceDurationSec) || !(native?.segmentSpans || []).length) {
    return unavailable("该卡没有精读分片恢复身份（旧链路或非逐集卡），只保留重点时刻截图");
  }
  const learnSpan = native!.segmentSpans![segment.learnSpanIndex]!;
  return once(clipBase, async () => {
    const legacyFrameSourceName = `manhua-template-learn/native-frame-sources/${createHash("sha256").update(JSON.stringify({
      seriesKey: ref.seriesKey, episodeIndex: ref.episodeIndex, sourceDigest, segmentIndex: segment.learnSpanIndex, span: learnSpan,
    })).digest("hex")}.json`;
    let video: PreparedMediaVideo | null = null;
    try {
      video = await d.readPreparedVideo({ seriesKey: ref.seriesKey, sourceDigest, episodeIndex: ref.episodeIndex, sourceDurationSec,
        startSec: learnSpan.startSec, endSec: learnSpan.endSec, legacyFrameSourceName });
    } catch (error) {
      d.log(`[tplLapian] prepared_media_read_failed template=${input.templateId} span=${segment.learnSpanIndex} ${error instanceof Error ? error.message.slice(0, 200) : "error"}`);
      return unavailable("源分片索引读取失败，暂不能出片段；重点时刻截图仍可查看");
    }
    if (!video) return unavailable("精读用的源分片已不在 GCS，只保留重点时刻截图");
    const rel = { startSec: Math.max(0, segment.startSec - learnSpan.startSec), endSec: Math.min(learnSpan.endSec - learnSpan.startSec, segment.endSec - learnSpan.startSec) };
    let cut: Awaited<ReturnType<ManhuaTemplateLapianDeps["cutClip"]>>;
    try {
      cut = await d.cutClip({ gsUri: video.gsUri, ...rel, objectName: `${clipBase}.mp4` });
    } catch (error) {
      d.log(`[tplLapian] clip_cut_failed template=${input.templateId} seg=${segment.index} ${error instanceof Error ? error.message.slice(0, 200) : "error"}`);
      return unavailable("片段裁切失败，可稍后重试；重点时刻截图仍可查看");
    }
    await d.createIfAbsent(`${clipBase}.json`, json({
      version: MANHUA_TEMPLATE_LAPIAN_VERSION, templateId: input.templateId, evidenceDigest: digest, segmentIndex: segment.index,
      ...span, learnSpanIndex: segment.learnSpanIndex, sourceGsUri: video.gsUri, relativeStartSec: rel.startSec, relativeEndSec: rel.endSec,
      mode: cut.mode, fallbackReason: cut.fallbackReason, bytes: cut.bytes, fps: MANHUA_TEMPLATE_LAPIAN_CLIP_FPS, createdAt: new Date(d.now()).toISOString(),
    }), "application/json");
    return signed();
  });
}
