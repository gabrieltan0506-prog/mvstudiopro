/**
 * 段级证据量测（零成本，只读已落库的原始响应，不发起任何付费调用）。
 *
 * 0830 晚立此脚本的实证背景：手工量了一次 v28 六片，发现两件与既有假设相反的事——
 *   ① schema 的 maxLength 形同虚设：字段用满率只有 5–23%，模型从不接近上限；
 *   ② 模型在自我配额：镜头越多描述越短（72 镜时字段均长 2.7 字，18 镜时 14.4 字），
 *      shots 描述总量几乎恒定，用镜头数换描述长度。
 * 这类结论只能从真实产物读出来，配置文件里看不到。固化成脚本，免得每轮重写。
 *
 * 用法（Fly 机内）：
 *   pnpm exec tsx scripts/measure-native-evidence.mts <gcs对象名> [更多对象名...]
 * 对象名可从探针日志里取：grep -oE "segment-evidence-raw/[^ ]*\.json" <log>
 */
import { downloadGcsObject } from "../server/services/gcs.js";

const SHOT_TEXT_FIELDS = [
  "compositionZh", "cameraMoveZh", "blockingZh", "bodyActionZh", "limbPropActionZh",
  "microExpressionZh", "gazeBreathZh", "relationshipReactionZh", "lightingZh",
  "actionZh", "transitionInZh",
] as const;

/** 与 responseSchema 的 maxLength 同源；改了那边要同步这里，否则用满率算错。 */
const CAPS: Record<string, number> = {
  compositionZh: 80, cameraMoveZh: 80, blockingZh: 70, bodyActionZh: 70,
  limbPropActionZh: 70, microExpressionZh: 58, gazeBreathZh: 58,
  relationshipReactionZh: 60, lightingZh: 58, actionZh: 60, transitionInZh: 50,
};

const bucket = process.env.VERTEX_GCS_BUCKET || process.env.GCS_BUCKET_NAME
  || "mv-studio-pro-vertex-video-temp";

type Row = {
  segIndex: number; shots: number; adShots: number; avgShotSec: number; maxShotSec: number;
  keyMoments: number; subtitles: number; audioTracks: number; audioCues: number;
  fieldAvgLen: number; emptyRatio: number; decimalAtSec: number;
  outTokens: number; thoughtTokens: number; finishReason: string;
};

const rows: Row[] = [];
const fieldLens: Record<string, number[]> = {};
for (const f of SHOT_TEXT_FIELDS) fieldLens[f] = [];

for (const objectName of process.argv.slice(2)) {
  const { buffer } = await downloadGcsObject({ gcsUri: `gs://${bucket}/${objectName}` });
  const envelope = JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;
  // 取证信封把上游整包放在 responseText 里；旧格式直接就是上游响应。
  const upstream = typeof envelope.responseText === "string"
    ? JSON.parse(envelope.responseText) : envelope;
  const candidate = (upstream as { candidates?: Array<Record<string, unknown>> }).candidates?.[0];
  const usage = (upstream as { usageMetadata?: Record<string, number> }).usageMetadata || {};
  const text = ((candidate?.content as { parts?: Array<{ text?: string }> })?.parts?.[0]?.text) || "";
  let card: Record<string, any> = {};
  try { card = JSON.parse(text); } catch { /* 截断段：只报可读部分 */ }

  const shots: Array<Record<string, any>> = Array.isArray(card.shots) ? card.shots : [];
  const durs = shots.map((s) => Number(s.endSec) - Number(s.startSec)).filter((n) => n > 0);
  let sum = 0, count = 0, empty = 0;
  for (const shot of shots) {
    for (const f of SHOT_TEXT_FIELDS) {
      const v = String(shot[f] ?? "").trim();
      fieldLens[f]!.push(v.length);
      sum += v.length; count += 1;
      if (!v || v === "无" || v === "无明显变化") empty += 1;
    }
  }
  const kms: Array<Record<string, any>> = Array.isArray(card.keyMoments) ? card.keyMoments : [];
  let tracks = 0, cues = 0;
  for (const chunk of (Array.isArray(card.audioResolution) ? card.audioResolution : [])) {
    for (const t of (chunk?.analysis?.audioTrack ?? [])) {
      tracks += 1; cues += Array.isArray(t.cues) ? t.cues.length : 0;
    }
  }
  rows.push({
    segIndex: Number(envelope.segmentIndex ?? 0) + 1,
    shots: shots.length,
    adShots: shots.filter((s) => s.evidenceRole === "non_story_ad").length,
    avgShotSec: durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0,
    maxShotSec: durs.length ? Math.max(...durs) : 0,
    keyMoments: kms.length,
    subtitles: Array.isArray(card.subtitles) ? card.subtitles.length : 0,
    audioTracks: tracks, audioCues: cues,
    fieldAvgLen: count ? sum / count : 0,
    emptyRatio: count ? empty / count : 0,
    // 抓帧精度实测：atSec 放开小数后，模型到底给不给小数
    decimalAtSec: kms.filter((k) => Number(k.atSec) % 1 !== 0).length,
    outTokens: Number(usage.candidatesTokenCount) || 0,
    thoughtTokens: Number(usage.thoughtsTokenCount) || 0,
    finishReason: String(candidate?.finishReason ?? "?"),
  });
}

rows.sort((a, b) => a.segIndex - b.segIndex);
console.log("片 镜数 广告 均镜长 最长镜 重点 字幕 音轨/事件 字段均长 空占比 小数atSec  正文 思考 finish");
for (const r of rows) {
  console.log(
    `${String(r.segIndex).padStart(2)} ${String(r.shots).padStart(4)} ${String(r.adShots).padStart(4)}`
    + ` ${r.avgShotSec.toFixed(1).padStart(6)}s ${r.maxShotSec.toFixed(0).padStart(5)}s`
    + ` ${String(r.keyMoments).padStart(4)} ${String(r.subtitles).padStart(4)}`
    + ` ${String(r.audioTracks).padStart(4)}/${String(r.audioCues).padEnd(4)}`
    + ` ${r.fieldAvgLen.toFixed(1).padStart(7)}字 ${(r.emptyRatio * 100).toFixed(0).padStart(4)}%`
    + ` ${String(r.decimalAtSec).padStart(7)} ${String(r.outTokens).padStart(6)} ${String(r.thoughtTokens).padStart(6)} ${r.finishReason}`,
  );
}

console.log("\n字段用满率（均长 ÷ schema maxLength）");
for (const f of SHOT_TEXT_FIELDS) {
  const a = fieldLens[f]!;
  if (!a.length) continue;
  const avg = a.reduce((x, y) => x + y, 0) / a.length;
  const cap = CAPS[f] ?? 0;
  console.log(
    `${f.padEnd(24)} 上限${String(cap).padStart(4)} 均长${avg.toFixed(1).padStart(6)}`
    + ` 最长${String(Math.max(...a)).padStart(4)} 用满${(cap ? avg / cap * 100 : 0).toFixed(0).padStart(4)}%`,
  );
}

const totalShots = rows.reduce((s, r) => s + r.shots, 0);
const totalOut = rows.reduce((s, r) => s + r.outTokens, 0);
const totalThought = rows.reduce((s, r) => s + r.thoughtTokens, 0);
console.log(
  `\n合计 ${rows.length} 片 · ${totalShots} 镜 · 正文 ${totalOut - totalThought} · 思考 ${totalThought}`
  + ` · 思考占比 ${totalOut ? ((totalThought / totalOut) * 100).toFixed(0) : 0}%`
  + ` · 每镜正文 ${totalShots ? ((totalOut - totalThought) / totalShots).toFixed(0) : 0} token`,
);
console.log(`思考高位值 ${Math.max(0, ...rows.map((r) => r.thoughtTokens))}（配置只是预算参考，实际以此为准）`);
