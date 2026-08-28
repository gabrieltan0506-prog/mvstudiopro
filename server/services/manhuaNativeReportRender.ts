/**
 * 原生精读证据 → 报告 HTML 渲染服务（¥0，零模型调用）。
 * **只渲染模型字段原文，不加任何编辑/蒸馏层**；字幕折叠存证不铺开；
 * 帧包优先 frames-v2（按戏抽帧，带 reasons 徽章），回退 frames，均无则出无帧提示。
 * 探针薄壳脚本与面板 renderEpisodeReport 路由共用本核心。
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

export async function renderNativeEvidenceReport(input: NativeReportRenderInput): Promise<{
  reportUrl: string; bytes: number; frames: number; frameSource: string; shots: number;
}> {
  const bucket = getGcsBucketName();
  const sign = makeSigner();

  const glm = input.glmCardObjectName ? await tryJson(bucket, input.glmCardObjectName) : null;
  let card = glm;
  if (!card) {
    const names = await listGcsObjectNamesByPrefix({
      prefix: input.evidencePrefix, literalPrefix: true, maxResults: 40,
    });
    const merged: Record<string, unknown> = { shots: [], subtitles: [], audioResolution: [] };
    for (const name of names.sort()) {
      const entry = await tryJson(bucket, name);
      const raw = (entry?.raw ?? {}) as Record<string, unknown>;
      for (const key of ["shots", "subtitles", "audioResolution"] as const) {
        (merged[key] as unknown[]).push(...(Array.isArray(raw[key]) ? raw[key] as unknown[] : []));
      }
      for (const key of ["beatStructureZh", "moodArcZh", "reusableZh", "genPromptHintZh", "classification"]) {
        if (raw[key] && !merged[key]) merged[key] = raw[key];
      }
    }
    card = merged;
  }
  const shots = ((Array.isArray(card.shots) ? card.shots : []) as Array<Record<string, unknown>>)
    .filter((shot) => shot.evidenceRole !== "non_story_ad");
  if (shots.length === 0) {
    throw new Error("该集没有逐镜证据层（v8 之前学习的旧集需重学后才能出报告）");
  }

  const framesSummary = input.framesV2SummaryObjectName
    ? await tryJson(bucket, input.framesV2SummaryObjectName)
    : null;
  let frameSource = "frames-v2（按戏抽帧）";
  let frameList = (Array.isArray(framesSummary?.frames) ? framesSummary!.frames : []) as Array<Record<string, unknown>>;
  if (frameList.length === 0 && input.framesPrefix) {
    frameSource = "frames（逐镜中点）";
    const names = await listGcsObjectNamesByPrefix({
      prefix: input.framesPrefix, literalPrefix: true, maxResults: 400,
    });
    frameList = names.map((objectName) => {
      const m = /seg(\d+)\/shot(\d+)-(\d+)ds/.exec(objectName);
      return { seg: Number(m?.[1] ?? 0), shot: Number(m?.[2] ?? 0), atSec: Number(m?.[3] ?? 0) / 10, reasons: [], objectName };
    });
  }
  if (frameList.length === 0) frameSource = "无帧包（该集尚未抽帧）";
  const tiles: string[] = [];
  for (const frame of frameList) {
    const url = await sign(bucket, String(frame.objectName));
    const reasons = (Array.isArray(frame.reasons) ? frame.reasons : []) as string[];
    const badge = reasons.map((r) => `<span style="background:#1d2733;border-radius:8px;padding:0 6px;margin-right:3px">${esc(r)}</span>`).join("");
    const frameAtSec = Number(frame.atSec);
    const shot = shots.find((s) => frameAtSec >= Number(s.startSec) && frameAtSec < Number(s.endSec)) || {};
    tiles.push(`<div style="width:158px"><a href="${url}" target="_blank"><img loading="lazy" src="${url}" style="width:158px;border-radius:4px"></a><div style="font-size:.7em;color:#8fa3bd">${mmss(frameAtSec)} ${badge}${esc(String(shot.actionZh ?? "").slice(0, 24))}</div></div>`);
  }

  const cl = (card.classification ?? {}) as Record<string, unknown>;
  const tags = Object.entries(cl)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `<div style="margin:4px 0"><b style="color:#e8c66a">${esc(fieldLabel(k))}</b>：${(v as unknown[]).map((t) => `<span style="background:#1d2733;border-radius:10px;padding:2px 10px;margin:2px;display:inline-block">${esc(t)}</span>`).join(" ")}</div>`)
    .join("");
  const summaryCards = (["beatStructureZh", "moodArcZh", "reusableZh", "genPromptHintZh"] as const)
    .map((key) => `<div style="background:#141b24;border-left:3px solid #e8c66a;padding:10px 14px;margin:8px 0"><b>${fieldLabel(key)}</b><br><span style="color:#9db4d0">${esc(card![key])}</span></div>`)
    .join("");

  const FIELDS = ["unitTypeZh", "shotSizeZh", "angleZh", "compositionZh", "cameraMoveZh", "blockingZh", "bodyActionZh", "limbPropActionZh", "microExpressionZh", "gazeBreathZh", "relationshipReactionZh", "lightingZh", "actionZh" , "transitionInZh"];
  const shotRows = shots.map((shot) => `<tr><td style="position:sticky;left:0;background:#141b24;color:#e8c66a;white-space:nowrap">${mmss(Number(shot.startSec) || 0)}–${mmss(Number(shot.endSec) || 0)}</td>${FIELDS.map((field) => `<td style="padding:3px 8px;min-width:90px">${esc(String(shot[field] ?? "").slice(0, 90))}</td>`).join("")}</tr>`).join("");

  const audioRows = (Array.isArray(card.audioResolution) ? card.audioResolution : [])
    .flatMap((chunk) => {
      const row = chunk as { chunkIndex?: number; analysis?: { audioTrack?: Array<Record<string, unknown>> } };
      const offset = (Number(row.chunkIndex) || 0) * 300;
      return (row.analysis?.audioTrack ?? []).map((track) => {
        const cues = (Array.isArray(track.cues) ? track.cues : []) as Array<Record<string, unknown>>;
        return `<tr><td style="color:#e8c66a;white-space:nowrap">${mmss(offset + Number(track.fromSec))}–${mmss(offset + Number(track.toSec))}</td><td>${esc(track.emotionArcZh)}</td><td>${esc(track.bgmZh)}</td><td style="color:#9db4d0">${cues.map((cue) => `<span style="background:#1d2733;border-radius:8px;padding:1px 8px">${mmss(offset + Number(cue.atSec))} ${esc(cue.kind)} ${esc(String(cue.detailZh ?? "").slice(0, 24))}</span>`).join(" ")}</td></tr>`;
      });
    }).join("");

  const subtitles = (Array.isArray(card.subtitles) ? card.subtitles : []) as Array<Record<string, unknown>>;
  const subRows = subtitles.map((s) => `<tr><td style="color:#e8c66a">${mmss(Number(s.atSec))}</td><td>${esc(s.textZh)}</td></tr>`).join("");

    const html = `<title>${esc(input.labelZh)} 模型产出报告</title><div style="font-family:'Songti SC',serif;background:#0d1117;color:#dce3ec;padding:28px;max-width:1200px;margin:auto">
<p style="color:#e8c66a;letter-spacing:.3em;font-size:.8em">${esc(input.labelZh)} · ${glm ? "GLM 整集卡" : "parsed 段卡拼接"} · 模型字段原样渲染，无编辑层</p>
<h1 style="font-size:1.8em;margin:.2em 0">模型产出报告（${shots.length} 镜 · ${frameSource} ${tiles.length} 帧）</h1>
<h2 style="color:#e8c66a;margin-top:26px">五维分类（模型原文）</h2>${tags}${summaryCards}
<h2 style="color:#e8c66a;margin-top:30px">画面时间轴</h2><div style="display:flex;flex-wrap:wrap;gap:8px">${tiles.join("")}</div>
<details style="margin-top:30px" open><summary style="color:#e8c66a;font-size:1.2em;cursor:pointer">全镜头表 · ${shots.length} 镜 × 17 字段</summary><div style="overflow-x:auto;max-height:70vh;overflow-y:auto"><table style="border-collapse:collapse;font-size:.8em"><tr><th style="position:sticky;left:0;background:#141b24">秒位</th>${FIELDS.map((f) => `<th style="padding:4px 8px;color:#8fa3bd">${fieldLabel(f)}</th>`).join("")}</tr>${shotRows}</table></div></details>
<h2 style="color:#e8c66a;margin-top:30px">音轨解析（模型原文）</h2><div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:.85em">${audioRows}</table></div>
<details style="margin-top:30px"><summary style="color:#e8c66a;font-size:1.1em;cursor:pointer">字幕原始证据 · ${subtitles.length} 条（折叠存证，不铺开）</summary><div style="overflow-x:auto;max-height:50vh;overflow-y:auto"><table style="border-collapse:collapse;font-size:.85em">${subRows}</table></div></details>
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
