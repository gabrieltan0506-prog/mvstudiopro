import { createHash, randomUUID } from "node:crypto";
import { geminiAudioJsonWithFallback } from "../gemini-audio";
import { downloadGcsObject, getGcsBucketName, signGsUriV4ReadUrl, uploadBufferToGcsIfAbsent } from "./gcs";
import { CREATIVE_AUDIO_READ_INSTRUCTIONS, creativeAudioEvidenceSchema, parseCreativeAudioEvidence } from "../../shared/creativeMediaEvidence";
import { normalizeMediaSections, repairJsonShape } from "../../shared/creativeProposalRepair";

/** 1109 通道合规：MV 顾问听歌只走 Gemini 3.8 Flash（Vertex gs:// → EvoLink 签名 URL），禁 Pro、禁直连 key、禁 base64。 */
export const SONG_HEARING_MODEL = "gemini-3.8-flash";
const INSTRUCTIONS_SHA = createHash("sha256").update(CREATIVE_AUDIO_READ_INSTRUCTIONS).digest("hex").slice(0, 12);

const evidenceNativeSchema = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING" }, sourceKey: { type: "STRING" }, summaryZh: { type: "STRING" },
    sections: { type: "ARRAY", items: { type: "OBJECT", properties: {
      startSec: { type: "NUMBER" }, endSec: { type: "NUMBER" }, labelZh: { type: "STRING" }, heardZh: { type: "STRING" },
      emotion: { type: "OBJECT", properties: { fromZh: { type: "STRING" }, toZh: { type: "STRING" }, triggerZh: { type: "STRING" }, musicZh: { type: "STRING" }, visualZh: { type: "STRING" } } },
    }, required: ["startSec", "endSec", "labelZh", "heardZh"] } },
    uncertaintiesZh: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["kind", "sourceKey", "summaryZh", "sections", "uncertaintiesZh"],
};

export type SongHearingInput = { gcsUri: string; mimeType: string; durationSec: number; audioSha256: string };
export type SongHearing = {
  /** 与具体 MV 方案无关的歌曲证据（sourceKey 为 song:<sha256>），调用方改写为本次 sourceKey 再校验。 */
  evidence: unknown;
  audioTokens: number;
  channel: string;
  model: string;
  reused: boolean;
  cacheObject: string;
  evidencePrefix: string;
};

type Deps = {
  listen: typeof geminiAudioJsonWithFallback;
  sign: (gsUri: string) => string;
  upload: typeof uploadBufferToGcsIfAbsent;
  readJson: (objectName: string) => Promise<unknown | undefined>;
  bucket: () => string;
  uuid: () => string;
};
const realDeps: Deps = {
  listen: geminiAudioJsonWithFallback,
  sign: gsUri => signGsUriV4ReadUrl(gsUri, 3600),
  upload: uploadBufferToGcsIfAbsent,
  readJson: async objectName => {
    try {
      const { buffer } = await downloadGcsObject({ gcsUri: `gs://${getGcsBucketName()}/${objectName}` });
      return JSON.parse(buffer.toString("utf8"));
    } catch (error) {
      if (/404|not ?found|No such object/i.test(error instanceof Error ? error.message : String(error))) return undefined;
      throw error;
    }
  },
  bucket: getGcsBucketName,
  uuid: randomUUID,
};

const audioTokensOf = (payload: unknown) =>
  ((payload as { usageMetadata?: { promptTokensDetails?: Array<{ modality?: unknown; tokenCount?: number }> } })?.usageMetadata?.promptTokensDetails || [])
    .filter(row => String(row.modality) === "AUDIO").reduce((sum, row) => sum + (row.tokenCount || 0), 0);

/**
 * 「不看剧情」独立听歌：只送歌曲本身与时长，不送创作要求/歌词/剧情；剧情在后续 GLM 编排阶段才合入。
 * 结果按「歌曲 SHA-256 + 模型 + 听歌指令版本」永久存档并复用，同一首歌不重复听。
 * 每跳 request/raw/decoded/parsed/rejected 由两跳函数永久落档；解析后的歌曲证据另存为 cacheObject。
 */
export async function hearSongIndependently(input: SongHearingInput, deps: Deps = realDeps): Promise<SongHearing> {
  if (!/^gs:\/\/[^/]+\/.+/.test(input.gcsUri)) throw new Error("听歌素材须为云端长期对象（gs://）");
  if (!/^[0-9a-f]{64}$/.test(input.audioSha256)) throw new Error("听歌缺少歌曲指纹");
  const songKey = `song:${input.audioSha256}`;
  const base = `canvas-music-mv/song-hearing/${input.audioSha256}`;
  const cacheObject = `${base}/${SONG_HEARING_MODEL}-${INSTRUCTIONS_SHA}.json`;
  const cached = await deps.readJson(cacheObject) as SongHearing | undefined;
  if (cached?.evidence) return { ...cached, reused: true, cacheObject };
  const evidencePrefix = `${base}/attempts/${deps.uuid()}`;
  const save = async (name: string, value: unknown) => {
    const buffer = Buffer.from(JSON.stringify(value));
    const saved = await deps.upload({ bucket: deps.bucket(), objectName: `${evidencePrefix}/${name}.json`, buffer, contentType: "application/json" });
    if (!saved.created) throw new Error("听歌证据已存在，未覆盖原记录");
    return saved;
  };
  const result = await deps.listen({
    media: { vertexFileUri: input.gcsUri, evolinkFileUri: () => deps.sign(input.gcsUri) },
    audioTimestamp: true,
    model: SONG_HEARING_MODEL,
    mimeType: input.mimeType,
    systemInstruction: CREATIVE_AUDIO_READ_INSTRUCTIONS,
    prompt: JSON.stringify({ sourceKey: songKey, audioDurationSec: input.durationSec, task: "独立听完整首歌，只给音乐结构与逐段情绪；不看剧情、不生成创作方案" }),
    nativeSchema: evidenceNativeSchema,
    schemaName: "native_music_evidence_v1",
    maxOutputTokens: 32768,
    timeoutMs: 240_000,
    checkPayload: payload => {
      if (!(audioTokensOf(payload) > 0)) return "未取得歌曲音频处理回执";
      const finish = (payload as { candidates?: Array<{ finishReason?: string }> })?.candidates?.[0]?.finishReason;
      if (finish !== "STOP") return `结束状态不符：${String(finish)}`;
      return undefined;
    },
    validate: decoded => {
      const shape = repairJsonShape(decoded, creativeAudioEvidenceSchema);
      const sections = normalizeMediaSections(shape.value, input.durationSec, 0.1);
      parseCreativeAudioEvidence(sections.value, songKey, input.durationSec);
      return { evidence: sections.value, fixes: { shape: shape.fixes, sections: sections.fixes } };
    },
    save,
  });
  const hearing: SongHearing = {
    evidence: result.value.evidence, audioTokens: audioTokensOf(result.payload), channel: result.channel, model: result.model,
    reused: false, cacheObject, evidencePrefix,
  };
  // 解析后的歌曲证据单独永久存档（IfAbsent：并发同歌时先到者为准，不覆盖）。
  await deps.upload({ bucket: deps.bucket(), objectName: cacheObject, buffer: Buffer.from(JSON.stringify({ ...hearing, fixes: result.value.fixes, failuresZh: result.failuresZh })), contentType: "application/json" });
  return hearing;
}
