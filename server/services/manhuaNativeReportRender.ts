/**
 * 原生精读证据 → 报告 HTML 渲染服务（¥0，零模型调用）。
 * **只渲染模型字段原文，不加任何编辑/蒸馏层，不做任何内容截断**；字幕折叠存证不铺开；
 * 帧包优先 frames-v2（按戏抽帧，带 reasons 徽章），回退 frames，均无则出无帧提示。
 *
 * 两个入口：
 * - renderNativeEvidenceReportFromObjectNames：生产路由唯一入口。按 provenance 里的
 *   精确证据对象名逐个下载，缺失/损坏/段号断裂/digest 混杂一律抛错（fail closed），
 *   绝不列目录猜证据、绝不上传半成品报告。帧包例外：帧缺失只降级为「未抽帧」。
 * - renderNativeEvidenceReport：旧列目录入口，仅供 CLI 探针脚本兼容使用。
 */
import { Storage } from "@google-cloud/storage";
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcs,
} from "./gcs.js";

const FIELD_LABELS: Record<string, string> = {
  emotionTagsZh: "情绪", narrativeFeatureTagsZh: "叙事特色", performanceTagsZh: "表演",
  audiovisualTagsZh: "视听", audienceExperienceTagsZh: "观众体验",
  beatStructureZh: "节拍结构", moodArcZh: "情绪弧", reusableZh: "可复用手法", genPromptHintZh: "生成提示线索",
  unitTypeZh: "单元类型", shotSizeZh: "景别", angleZh: "机位角度", compositionZh: "构图", cameraMoveZh: "运镜",
  blockingZh: "调度", bodyActionZh: "身体动作", limbPropActionZh: "肢体道具", microExpressionZh: "微表情",
  gazeBreathZh: "视线呼吸", relationshipReactionZh: "关系反应", lightingZh: "灯光", actionZh: "动作叙述",
  transitionInZh: "入镜转场", evidenceRole: "证据角色",
  emotionArcZh: "情绪弧", toneZh: "语气", sfxZh: "音效", bgmZh: "配乐",
  atmosphereZh: "气氛", silenceZh: "留白",
  audioBeatStructureZh: "声音节奏", mixNotesZh: "混音", reusableAudioZh: "可复用声音手法",
  genAudioHintZh: "生成声音要素",
};
const fieldLabel = (key: string): string => FIELD_LABELS[key] ?? key;

const esc = (v: unknown): string => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mmss = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function makeSigner() {
  const creds = JSON.parse(String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "{}")) as {
    client_email?: string; private_key?: string; project_id?: string;
  };
  const storage = new Storage({
    credentials: { client_email: creds.client_email, private_key: creds.private_key },
    projectId: creds.project_id,
  });
  return async (bucketName: string, objectName: string): Promise<string> => {
    const [url] = await storage.bucket(bucketName).file(objectName).getSignedUrl({
      version: "v4", action: "read", expires: Date.now() + 6 * 24 * 3600 * 1000,
    });
    return url;
  };
}

async function tryJson(bucket: string, objectName: string): Promise<Record<string, unknown> | null> {
  try {
    const { buffer } = await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${objectName}` });
    return JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** fail closed：证据对象必须存在且是合法 JSON 对象，缺失/损坏直接抛错。 */
async function mustJson(bucket: string, objectName: string): Promise<Record<string, unknown>> {
  let buffer: Buffer;
  try {
    ({ buffer } = await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${objectName}` }));
  } catch (e) {
    throw new Error(`证据对象缺失或不可读：${objectName}（${e instanceof Error ? e.message : String(e)}）`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error(`证据对象损坏（非法 JSON）：${objectName}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`证据对象损坏（非对象）：${objectName}`);
  }
  return parsed as Record<string, unknown>;
}

const SUMMARY_TEXT_KEYS = ["beatStructureZh", "moodArcZh", "reusableZh", "genPromptHintZh"] as const;

type SegmentRaw = { segmentIndex: number; raw: Record<string, unknown> };

/**
 * 段卡拼接（无删节）：shots/subtitles/audioResolution 顺序合并；
 * 摘要四字段与五维分类不再「取第一个非空」，而是**合并全段**：
 * 文本字段按段号标注拼接，分类标签跨段去重并集。
 */
function assembleCardFromSegments(segments: SegmentRaw[]): Record<string, unknown> {
  const merged: Record<string, unknown> = { shots: [], subtitles: [], audioResolution: [] };
  const chunkSpans: Array<{ chunkIndex: number; startSec: number; endSec: number }> = [];
  const summaryParts: Record<string, string[]> = {};
  const classification: Record<string, unknown[]> = {};
  for (const { segmentIndex, raw } of segments) {
    for (const key of ["shots", "subtitles", "audioResolution"] as const) {
      (merged[key] as unknown[]).push(...(Array.isArray(raw[key]) ? raw[key] as unknown[] : []));
    }
    for (const span of Array.isArray(raw.chunkSpans) ? raw.chunkSpans as Array<Record<string, unknown>> : []) {
      chunkSpans.push({
        chunkIndex: Number(span.chunkIndex),
        startSec: Number(span.startSec),
        endSec: Number(span.endSec),
      });
    }
    for (const key of SUMMARY_TEXT_KEYS) {
      const value = String(raw[key] ?? "").trim();
      if (value) (summaryParts[key] ??= []).push(`【第${segmentIndex + 1}段】${value}`);
    }
    const cl = raw.classification;
    if (cl && typeof cl === "object" && !Array.isArray(cl)) {
      for (const [key, value] of Object.entries(cl as Record<string, unknown>)) {
        if (!Array.isArray(value)) continue;
        const bucketList = (classification[key] ??= []);
        for (const tag of value) if (!bucketList.includes(tag)) bucketList.push(tag);
      }
    }
  }
  for (const key of SUMMARY_TEXT_KEYS) {
    if (summaryParts[key]?.length) merged[key] = summaryParts[key].join("\n");
  }
  if (Object.keys(classification).length) merged.classification = classification;
  if (chunkSpans.length > 0) merged.chunkSpans = chunkSpans;
  return merged;
}

type RenderCoreInput = {
  labelZh: string;
  card: Record<string, unknown>;
  /** 报告头部注明的数据来源口径 */
  sourceLabelZh: string;
  framesV2SummaryObjectName?: string;
  framesPrefix?: string;
  reportObjectName: string;
};

export type NativeReportRenderResult = {
  reportUrl: string; bytes: number; frames: number; frameSource: string; shots: number;
};

async function renderCardToReport(input: RenderCoreInput): Promise<NativeReportRenderResult> {
  const bucket = getGcsBucketName();
  const sign = makeSigner();
  const card = input.card;

  const shots = ((Array.isArray(card.shots) ? card.shots : []) as Array<Record<string, unknown>>)
    .filter((shot) => shot.evidenceRole !== "non_story_ad");
  if (shots.length === 0) {
    throw new Error("该集没有逐镜证据层（v8 之前学习的旧集需重学后才能出报告）");
  }

  // 帧包**始终可选**：summary 缺失/损坏只降级为「未抽帧」，绝不让报告因此失败。
  const framesSummary = input.framesV2SummaryObjectName
    ? await tryJson(bucket, input.framesV2SummaryObjectName)
    : null;
  let frameSource = "frames-v2（按戏抽帧）";
  let frameList = (Array.isArray(framesSummary?.frames) ? framesSummary!.frames : []) as Array<Record<string, unknown>>;
  if (frameList.length === 0 && input.framesPrefix) {
    frameSource = "frames（逐镜中点）";
    let names: string[] = [];
    try {
      names = await listGcsObjectNamesByPrefix({
        prefix: input.framesPrefix, literalPrefix: true, maxResults: 400,
      });
    } catch {
      names = [];
    }
    frameList = names.map((objectName) => {
      const m = /seg(\d+)\/shot(\d+)-(\d+)ds/.exec(objectName);
      return { seg: Number(m?.[1] ?? 0), shot: Number(m?.[2] ?? 0), atSec: Number(m?.[3] ?? 0) / 10, reasons: [], objectName };
    });
  }
  if (frameList.length === 0) frameSource = "未抽帧（该集尚无帧包）";
  const tiles: string[] = [];
  for (const frame of frameList) {
    const url = await sign(bucket, String(frame.objectName));
    const reasons = (Array.isArray(frame.reasons) ? frame.reasons : []) as string[];
    const badge = reasons.map((r) => `<span style="background:#1d2733;border-radius:8px;padding:0 6px;margin-right:3px">${esc(r)}</span>`).join("");
    const frameAtSec = Number(frame.atSec);
    const shot = shots.find((s) => frameAtSec >= Number(s.startSec) && frameAtSec < Number(s.endSec)) || {};
    tiles.push(`<div style="width:158px"><a href="${url}" target="_blank"><img loading="lazy" src="${url}" style="width:158px;border-radius:4px"></a><div style="font-size:.7em;color:#8fa3bd">${mmss(frameAtSec)} ${badge}${esc(shot.actionZh)}</div></div>`);
  }

  const cl = (card.classification ?? {}) as Record<string, unknown>;
  const tags = Object.entries(cl)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `<div style="margin:4px 0"><b style="color:#e8c66a">${esc(fieldLabel(k))}</b>：${(v as unknown[]).map((t) => `<span style="background:#1d2733;border-radius:10px;padding:2px 10px;margin:2px;display:inline-block">${esc(t)}</span>`).join(" ")}</div>`)
    .join("");
  /**
   * 0830 报告规格：摘要四栏拆成四个独立区块（可复用手法 / 生成提示要素 /
   * 节奏结构 / 情绪推进），不再挤成一叠小卡——它们是这张卡最值钱的部分。
   */
  const summaryTextOf = (key: (typeof SUMMARY_TEXT_KEYS)[number]): string =>
    String(card[key] ?? "").trim() || "本卡未产出该项";

  const FIELDS = ["unitTypeZh", "shotSizeZh", "angleZh", "compositionZh", "cameraMoveZh", "blockingZh", "bodyActionZh", "limbPropActionZh", "microExpressionZh", "gazeBreathZh", "relationshipReactionZh", "lightingZh", "actionZh", "transitionInZh"];
  const shotRows = shots.map((shot) => `<tr><td style="position:sticky;left:0;background:#141b24;color:#e8c66a;white-space:nowrap">${mmss(Number(shot.startSec) || 0)}–${mmss(Number(shot.endSec) || 0)}</td>${FIELDS.map((field) => `<td style="padding:3px 8px;min-width:90px">${esc(shot[field])}</td>`).join("")}</tr>`).join("");

  const AUDIO_TRACK_FIELDS = ["emotionArcZh", "toneZh", "sfxZh", "bgmZh", "atmosphereZh", "silenceZh"] as const;
  const AUDIO_CHUNK_FIELDS = ["audioBeatStructureZh", "mixNotesZh", "reusableAudioZh", "genAudioHintZh"] as const;
  const audioChunks = (Array.isArray(card.audioResolution) ? card.audioResolution : []) as Array<{
    chunkIndex?: number;
    analysis?: Record<string, unknown> & { audioTrack?: Array<Record<string, unknown>> };
  }>;
  const spanByChunk = new Map<number, number>(
    (Array.isArray((card as { chunkSpans?: unknown }).chunkSpans)
      ? (card as { chunkSpans: Array<{ chunkIndex: number; startSec: number }> }).chunkSpans
      : []
    ).map((span) => [Number(span.chunkIndex), Number(span.startSec)]),
  );
  const audioSections = audioChunks.map((chunk) => {
    // 真实段界优先（第四节 chunkSpans）；仅无段界的旧卡回落 300s 惯例偏移。
    const offset = spanByChunk.get(Number(chunk.chunkIndex) || 0)
      ?? (Number(chunk.chunkIndex) || 0) * 300;
    const analysis = (chunk.analysis ?? {}) as Record<string, unknown> & { audioTrack?: Array<Record<string, unknown>> };
    const chunkMeta = AUDIO_CHUNK_FIELDS
      .map((key) => `<div style="margin:2px 0"><b style="color:#e8c66a">${fieldLabel(key)}</b>：<span style="color:#9db4d0;white-space:pre-wrap">${esc(analysis[key])}</span></div>`)
      .join("");
    const trackRows = (Array.isArray(analysis.audioTrack) ? analysis.audioTrack : []).map((track) => {
      const cues = (Array.isArray(track.cues) ? track.cues : []) as Array<Record<string, unknown>>;
      const cueSpans = cues.map((cue) => `<span style="background:#1d2733;border-radius:8px;padding:1px 8px;display:inline-block;margin:1px">${mmss(offset + Number(cue.atSec))} ${esc(cue.kind)} ${esc(cue.detailZh)}</span>`).join(" ");
      return `<tr><td style="color:#e8c66a;white-space:nowrap">${mmss(offset + Number(track.fromSec))}–${mmss(offset + Number(track.toSec))}</td>${AUDIO_TRACK_FIELDS.map((key) => `<td style="padding:3px 8px">${esc(track[key])}</td>`).join("")}<td style="color:#9db4d0">${cueSpans}</td></tr>`;
    }).join("");
    return `<div style="margin:14px 0"><h3 style="color:#8fa3bd;margin:6px 0">分片 ${Number(chunk.chunkIndex) || 0}（模型原文区）</h3>${chunkMeta}<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:.85em"><tr><th style="padding:4px 8px;color:#8fa3bd">秒位</th>${AUDIO_TRACK_FIELDS.map((key) => `<th style="padding:4px 8px;color:#8fa3bd">${fieldLabel(key)}</th>`).join("")}<th style="padding:4px 8px;color:#8fa3bd">声音事件</th></tr>${trackRows}</table></div></div>`;
  }).join("");

  const subtitles = (Array.isArray(card.subtitles) ? card.subtitles : []) as Array<Record<string, unknown>>;
  const subRows = subtitles.map((s) => `<tr><td style="color:#e8c66a">${mmss(Number(s.atSec))}</td><td>${esc(s.textZh)}</td></tr>`).join("");

  /* ───────── 0830 用户拍板的报告规格：KPI / 镜长分布 / 重点时刻 / 剧情节点 ───────── */

  const shotSpans = shots
    .map((shot) => ({ from: Number(shot.startSec), to: Number(shot.endSec) }))
    .filter((x) => Number.isFinite(x.from) && Number.isFinite(x.to) && x.to > x.from);
  const coveredSec = shotSpans.reduce((sum, x) => sum + (x.to - x.from), 0);
  const avgShotSec = shotSpans.length ? coveredSec / shotSpans.length : 0;
  const adShotCount = shots.filter((shot) => shot.evidenceRole === "non_story_ad").length;
  const adRanges = (Array.isArray((card as { excludedAdRanges?: unknown }).excludedAdRanges)
    ? (card as { excludedAdRanges: Array<Record<string, unknown>> }).excludedAdRanges
    : []);
  const audioSegCount = audioChunks.reduce((sum, chunk) => (
    sum + (Array.isArray(chunk.analysis?.audioTrack) ? chunk.analysis!.audioTrack!.length : 0)
  ), 0);

  /** 重点时刻（v12）：模型自报的抓帧秒位，五类＝切镜/情绪/灯光/剧情/音轨。 */
  const keyMoments = (Array.isArray((card as { keyMoments?: unknown }).keyMoments)
    ? (card as { keyMoments: Array<Record<string, unknown>> }).keyMoments
    : []).slice().sort((a, b) => Number(a.atSec) - Number(b.atSec));
  const KIND_ICON: Record<string, string> = {
    切镜: "🎬", 情绪: "😨", 灯光: "💡", 剧情: "📖", 音轨: "🎵",
  };
  const kmRows = keyMoments.map((row) => (
    `<tr><td style="color:#e8c66a;white-space:nowrap">${mmss(Number(row.atSec))}</td>`
    + `<td style="white-space:nowrap">${KIND_ICON[String(row.kindZh)] ?? ""} ${esc(row.kindZh)}</td>`
    + `<td>${esc(row.noteZh)}</td></tr>`
  )).join("");

  /**
   * 剧情节点表：字幕**压缩成节点**，不逐字铺（呈现铁律第一条）。
   * 6 秒内视作同一事件合并；原始逐条字幕仍在下方折叠存证，一条不删。
   */
  type SubNode = { from: number; to: number; lines: string[] };
  const subNodes: SubNode[] = [];
  for (const row of subtitles.slice().sort((a, b) => Number(a.atSec) - Number(b.atSec))) {
    const at = Number(row.atSec);
    const text = String(row.textZh ?? "").trim();
    if (!Number.isFinite(at) || !text) continue;
    const last = subNodes.at(-1);
    if (last && at - last.to <= 6) { last.to = at; last.lines.push(text); }
    else subNodes.push({ from: at, to: at, lines: [text] });
  }
  const nodeRows = subNodes.map((node) => (
    `<tr><td style="color:#e8c66a;white-space:nowrap">${mmss(node.from)}–${mmss(node.to)}</td>`
    + `<td style="white-space:nowrap;color:#9db4d0">${node.lines.length} 句</td>`
    // 🔴 节点内**全部句子照列，一句不砍**（0830 用户发现旧版只显示前 3 句）。
    // 本表的「不逐字铺」体现在**分组**，不体现在删句子——本文件顶部写明「不做任何内容截断」。
    + `<td>${esc(node.lines.join("｜"))}</td></tr>`
  )).join("");

  /** 镜长分布：一眼看粒度，长镜区间标红。 */
  const buckets: Array<[string, number, number]> = [
    ["0–2s", 0, 2], ["2–4s", 2, 4], ["4–6s", 4, 6], ["6–10s", 6, 10],
    ["10–15s", 10, 15], ["15–30s", 15, 30], ["30s+", 30, Number.POSITIVE_INFINITY],
  ];
  const hist = buckets.map(([label, lo, hi]) => ({
    label,
    n: shotSpans.filter((x) => (x.to - x.from) >= lo && (x.to - x.from) < hi).length,
    warn: lo >= 15,
  }));
  const histPeak = Math.max(1, ...hist.map((row) => row.n));
  const histBars = hist.map((row) => (
    `<div style="display:flex;align-items:center;gap:10px;margin:5px 0">`
    + `<span style="width:64px;color:#9db4d0;font-size:12px">${row.label}</span>`
    + `<span style="height:15px;border-radius:3px;min-width:2px;width:${Math.round((row.n / histPeak) * 100)}%;`
    + `background:${row.warn ? "#e8756a" : "#cbb3e6"}"></span>`
    + `<span style="color:#9db4d0;font-size:12px">${row.n}</span></div>`
  )).join("");

  /**
   * 粒度判定用**膨胀倍数**而非绝对镜长——绝对值是体裁相关的
   * （漫剧 2.8–4.3s/镜，真人剧更长），跨体裁会误判。此处无输入基准，
   * 故只在明显异常（平均 >12 秒）时示警，其余一律按正常呈现。
   */
  const grainBad = avgShotSec > 12;
  const grainColor = grainBad ? "#e8756a" : "#cbb3e6";
  const grainText = grainBad
    ? `🔴 平均镜长 ${avgShotSec.toFixed(1)} 秒，疑似镜头被过度合并`
    : `✅ 粒度正常 · 平均镜长 ${avgShotSec.toFixed(1)} 秒`;

  const kpi = [
    [String(shots.length), "镜头数"],
    [`${avgShotSec.toFixed(1)}s`, "平均镜长"],
    [String(subtitles.length), "字幕"],
    [String(keyMoments.length), "重点时刻"],
    [String(audioSegCount), "音轨段"],
    [String(adRanges.length), "广告区间"],
  ].map(([value, label]) => (
    `<div style="background:rgba(20,27,36,.62);border:1px solid rgba(232,198,106,.22);border-radius:10px;`
    + `padding:12px 16px;min-width:120px"><b style="display:block;font-size:1.7em;color:#fff;line-height:1.3">`
    + `${esc(value)}</b>${esc(label)}</div>`
  )).join("");

  const section = (titleZh: string, body: string, highlight = false) => (
    `<h2 style="color:${highlight ? "#fff" : "#e8c66a"};margin-top:30px;`
    + `${highlight ? "background:rgba(232,198,106,.18);padding:6px 12px;border-radius:8px;border-left:4px solid #e8c66a" : ""}">`
    + `${esc(titleZh)}</h2>${body}`
  );
  const panel = (text: unknown) => (
    `<div style="background:rgba(20,27,36,.62);border:1px solid rgba(232,198,106,.22);border-radius:10px;`
    + `padding:14px 18px;margin-top:10px;white-space:pre-wrap">${esc(text)}</div>`
  );
  const tableOf = (headers: string[], rows: string) => (
    `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:.85em;margin-top:10px">`
    + `<tr>${headers.map((h) => `<th style="padding:5px 9px;color:#8fa3bd;text-align:left">${esc(h)}</th>`).join("")}</tr>`
    + `${rows}</table></div>`
  );

  const html = `<title>${esc(input.labelZh)} 模型产出报告</title><div style="font-family:'Songti SC',serif;background:linear-gradient(165deg,#7a1f3d 0%,#8e4a8b 55%,#cbb3e6 100%);background-attachment:fixed;color:#dce3ec;padding:28px;max-width:1200px;margin:auto">
<p style="color:#e8c66a;letter-spacing:.3em;font-size:.8em">${esc(input.labelZh)} · ${esc(input.sourceLabelZh)} · 模型字段原样渲染，无编辑层、无删节</p>
<h1 style="font-size:1.8em;margin:.2em 0">模型产出报告</h1>
<p style="color:#8fa3bd;margin:.3em 0 0">${shots.length} 镜（含 ${adShotCount} 广告镜）· ${subtitles.length} 字幕 → ${subNodes.length} 剧情节点 · ${keyMoments.length} 重点时刻 · ${frameSource} ${tiles.length} 帧 · 覆盖 ${(coveredSec / 60).toFixed(1)} 分钟</p>

<div style="display:flex;gap:12px;flex-wrap:wrap;margin:18px 0">${kpi}</div>
<p style="color:${grainColor};font-weight:600">${grainText}</p>

${section("镜长分布", histBars)}
${section("可复用手法总结", panel(summaryTextOf("reusableZh")))}
${section("生成提示要素", panel(summaryTextOf("genPromptHintZh")))}
${section("节奏结构", panel(summaryTextOf("beatStructureZh")))}
${section("情绪推进", panel(summaryTextOf("moodArcZh")))}
${section("五维标签墙", tags)}
${section(`重点时刻表 · ${keyMoments.length} 条`, keyMoments.length
    ? tableOf(["秒位", "类型", "说明"], kmRows)
    : `<p style="color:#9db4d0">本卡无重点时刻（v12 之前的产出没有这个字段）</p>`, true)}
${section(`剧情节点表 · ${subNodes.length} 节点（${subtitles.length} 条字幕压缩，非逐字铺）`, tableOf(["区间", "密度", "关键句"], nodeRows))}
${section("画面时间轴", `<div style="display:flex;flex-wrap:wrap;gap:8px">${tiles.join("")}</div>`)}
${section("音轨解析（模型原文）", audioSections)}
<details style="margin-top:30px" open><summary style="color:#e8c66a;font-size:1.2em;cursor:pointer">全镜头表 · ${shots.length} 镜 × ${FIELDS.length} 字段</summary><div style="overflow-x:auto;max-height:70vh;overflow-y:auto"><table style="border-collapse:collapse;font-size:.8em"><tr><th style="position:sticky;left:0;background:#141b24">秒位</th>${FIELDS.map((f) => `<th style="padding:4px 8px;color:#8fa3bd">${fieldLabel(f)}</th>`).join("")}</tr>${shotRows}</table></div></details>
<details style="margin-top:30px"><summary style="color:#e8c66a;font-size:1.1em;cursor:pointer">字幕原始证据 · ${subtitles.length} 条（折叠存证，一条不删）</summary><div style="overflow-x:auto;max-height:50vh;overflow-y:auto"><table style="border-collapse:collapse;font-size:.85em">${subRows}</table></div></details>
<p style="color:#5d6b80;font-size:.8em;margin-top:36px">帧图与本页为 GCS V4 签名链接（6 天）· 证据永久存 GCS · 本页由代码从模型 JSON 确定性渲染</p></div>`;

  await uploadBufferToGcs({
    bucket,
    objectName: input.reportObjectName,
    contentType: "text/html; charset=utf-8",
    buffer: Buffer.from(html, "utf8"),
  });
  const reportUrl = await sign(bucket, input.reportObjectName);
  return { reportUrl, bytes: html.length, frames: tiles.length, frameSource, shots: shots.length };
}

export type NativeReportFromObjectNamesInput = {
  labelZh: string;
  /** provenance.nativeVideoDeepRead.segmentEvidenceObjectNames 的精确对象名，禁止列目录推断。 */
  evidenceObjectNames: string[];
  /** 路由已知集号时传入，与每份证据的 episodeIndex 强校验。 */
  expectEpisodeIndex?: number;
  /** 路由已知系列时传入，与每份证据的 seriesKey 强校验（防跨系列证据拼进同一报告）。 */
  expectSeriesKey?: string;
  /** 卡片 provenance 的 sourceDigest；与证据 digest 强校验（防换来源快照）。 */
  expectSourceDigest?: string;
  /** 卡片 provenance 的 attemptedSegments；证据名个数必须严格等于它（防少段导出）。 */
  expectSegmentCount?: number;
  /** GLM 整集卡对象名（provenance 明示时传入；传了就必须能读到，fail closed）。 */
  glmCardObjectName?: string;
  framesV2SummaryObjectName?: string;
  framesPrefix?: string;
  reportObjectName: string;
};

/**
 * 生产路由唯一入口：按精确证据对象名渲染。
 * 校验：每个对象必须存在且合法；证据名个数与卡片 attemptedSegments 一致；
 * episodeIndex/seriesKey 全一致（且与 expectEpisodeIndex/expectSeriesKey 一致）；
 * segmentIndex 无重复且严格等于下标（0..n-1，缺首段/末段一样拦下）；
 * sourceDigest 合法（64 位 hex）、全一致且与卡片 provenance 一致。
 * 任一不满足即抛错，不上传半成品。
 */
export async function renderNativeEvidenceReportFromObjectNames(
  input: NativeReportFromObjectNamesInput,
): Promise<NativeReportRenderResult> {
  const bucket = getGcsBucketName();
  const names = (input.evidenceObjectNames ?? []).map((n) => String(n || "").trim()).filter(Boolean);

  if (input.glmCardObjectName) {
    const glm = await mustJson(bucket, input.glmCardObjectName);
    return renderCardToReport({
      labelZh: input.labelZh,
      card: glm,
      sourceLabelZh: "GLM 整集卡（provenance 精确寻址）",
      framesV2SummaryObjectName: input.framesV2SummaryObjectName,
      framesPrefix: input.framesPrefix,
      reportObjectName: input.reportObjectName,
    });
  }

  if (names.length === 0) {
    throw new Error("provenance 没有 segmentEvidenceObjectNames，拒绝列目录猜证据；该集需重学后再出报告");
  }
  // 段数门禁：卡片 provenance 说有 N 段，证据名就必须正好 N 个。
  // 少首段、少末段都在这里拦下——排序连续性检查看不出「整体少一段」。
  if (input.expectSegmentCount !== undefined) {
    const expected = Number(input.expectSegmentCount);
    if (!Number.isInteger(expected) || expected < 1 || names.length !== expected) {
      throw new Error(`证据段数不完整：卡片应有 ${input.expectSegmentCount} 段，provenance 只有 ${names.length} 段`);
    }
  }
  const segments: Array<SegmentRaw & {
    objectName: string; episodeIndex: number; seriesKey: string; sourceDigest: string;
  }> = [];
  for (const objectName of names) {
    const entry = await mustJson(bucket, objectName);
    const raw = entry.raw;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`证据对象缺少 raw 段卡本体：${objectName}`);
    }
    const episodeIndex = Number(entry.episodeIndex);
    const segmentIndex = Number(entry.segmentIndex);
    const seriesKey = String(entry.seriesKey ?? "").trim();
    const sourceDigest = String(entry.sourceDigest ?? "").trim();
    if (!Number.isInteger(episodeIndex) || !Number.isInteger(segmentIndex) || segmentIndex < 0) {
      throw new Error(`证据对象 episodeIndex/segmentIndex 非法：${objectName}`);
    }
    if (!seriesKey) {
      throw new Error(`证据对象缺少 seriesKey：${objectName}`);
    }
    if (!/^[a-f0-9]{64}$/i.test(sourceDigest)) {
      throw new Error(`证据对象 sourceDigest 非法：${objectName}`);
    }
    segments.push({ objectName, episodeIndex, seriesKey, segmentIndex, sourceDigest, raw: raw as Record<string, unknown> });
  }

  const episodes = new Set(segments.map((s) => s.episodeIndex));
  if (episodes.size !== 1) {
    throw new Error(`证据 episodeIndex 不一致：${Array.from(episodes).join(",")}`);
  }
  if (input.expectEpisodeIndex !== undefined && segments[0]!.episodeIndex !== input.expectEpisodeIndex) {
    throw new Error(`证据 episodeIndex=${segments[0]!.episodeIndex} 与请求集号 ${input.expectEpisodeIndex} 不符`);
  }
  const seriesKeys = new Set(segments.map((s) => s.seriesKey));
  if (seriesKeys.size !== 1) {
    throw new Error(`证据 seriesKey 不一致：${Array.from(seriesKeys).join(",")}`);
  }
  if (input.expectSeriesKey !== undefined && segments[0]!.seriesKey !== input.expectSeriesKey) {
    throw new Error(`证据 seriesKey=${segments[0]!.seriesKey} 与请求系列 ${input.expectSeriesKey} 不符`);
  }
  const digests = new Set(segments.map((s) => s.sourceDigest));
  if (digests.size !== 1) {
    throw new Error("证据 sourceDigest 混杂：不同来源快照的段卡不能拼进同一份报告");
  }
  if (input.expectSourceDigest !== undefined
    && segments[0]!.sourceDigest.toLowerCase() !== String(input.expectSourceDigest).trim().toLowerCase()) {
    throw new Error("证据 sourceDigest 与卡片 provenance 不符");
  }
  segments.sort((a, b) => a.segmentIndex - b.segmentIndex);
  for (let i = 0; i < segments.length; i++) {
    if (i > 0 && segments[i]!.segmentIndex === segments[i - 1]!.segmentIndex) {
      throw new Error(`证据 segmentIndex 重复：seg${segments[i]!.segmentIndex}`);
    }
    // 严格等于下标：0..n-1 一个不缺。只查「相邻连续」会放过整体缺首段/缺末段。
    if (segments[i]!.segmentIndex !== i) {
      throw new Error(`证据 segmentIndex 不完整：应有 seg${i}，实际为 seg${segments[i]!.segmentIndex}`);
    }
  }

  return renderCardToReport({
    labelZh: input.labelZh,
    card: assembleCardFromSegments(segments),
    sourceLabelZh: `parsed 段卡拼接 · ${segments.length} 段（provenance 精确寻址）`,
    framesV2SummaryObjectName: input.framesV2SummaryObjectName,
    framesPrefix: input.framesPrefix,
    reportObjectName: input.reportObjectName,
  });
}

export type NativeReportRenderInput = {
  /** 报告标题里的身份标识（run id 或 剧集标识） */
  labelZh: string;
  /** parsed 段卡前缀（segment-evidence/tpl_native_..._epNNN/） */
  evidencePrefix: string;
  /** GLM 整集卡对象名（可无） */
  glmCardObjectName?: string;
  /** 帧包前缀（无 v2 时回退；可都不存在） */
  framesV2SummaryObjectName?: string;
  framesPrefix?: string;
  /** 报告落点对象名 */
  reportObjectName: string;
};

/**
 * 旧列目录入口：仅供 CLI 探针脚本兼容。生产路由一律走
 * renderNativeEvidenceReportFromObjectNames（provenance 精确寻址）。
 */
export async function renderNativeEvidenceReport(input: NativeReportRenderInput): Promise<NativeReportRenderResult> {
  const bucket = getGcsBucketName();

  const glm = input.glmCardObjectName ? await tryJson(bucket, input.glmCardObjectName) : null;
  let card = glm;
  if (!card) {
    const names = await listGcsObjectNamesByPrefix({
      prefix: input.evidencePrefix, literalPrefix: true, maxResults: 200,
    });
    // 同契约重跑会产生同段多份不可变证据：按 segmentIndex 去重，取排序最后一份。
    const dedupedBySegment = new Map<number, string>();
    for (const name of names.sort()) {
      const m = /\/seg(\d+)-/.exec(name);
      dedupedBySegment.set(Number(m?.[1] ?? -1), name);
    }
    const segments: SegmentRaw[] = [];
    for (const [segmentIndex, name] of Array.from(dedupedBySegment.entries()).sort((a, b) => a[0] - b[0])) {
      const entry = await tryJson(bucket, name);
      const raw = (entry?.raw ?? {}) as Record<string, unknown>;
      segments.push({ segmentIndex: segmentIndex >= 0 ? segmentIndex : segments.length, raw });
    }
    card = assembleCardFromSegments(segments);
  }

  return renderCardToReport({
    labelZh: input.labelZh,
    card,
    sourceLabelZh: glm ? "GLM 整集卡" : "parsed 段卡拼接（CLI 列目录兼容口径）",
    framesV2SummaryObjectName: input.framesV2SummaryObjectName,
    framesPrefix: input.framesPrefix,
    reportObjectName: input.reportObjectName,
  });
}
