/**
 * MV 分镜按「确认版歌词表」修订（1109）：高光内真歌词 → 演唱段，吟唱 → 素材填充段（跨吟唱起点的镜切开），
 * 非演唱剪点按 audiomap 节奏模式吸附拍点，新切出的镜补逐窗节拍、吟唱镜补素材填充建议（同一三跳链），
 * 存为新分镜记录（原记录不动；合成入口仍按永久证据核对分镜）。
 */
import { randomUUID, createHash } from "node:crypto";
import { downloadGcsObjectVersioned, getGcsBucketName, uploadBufferToGcsIfAbsent, downloadGcsObject } from "./gcs";
import {
  canvasMusicMvDraftInputSchema,
  canvasMusicMvPlanSchema,
  musicMvLyricTableSchema,
  validateCanvasMusicMvPlan,
  type CanvasMusicMvPlan,
  type MusicMvLyricTable,
} from "../../shared/canvasMusicMv";
import { musicMvHighlightSchema } from "../../shared/musicMvHighlight";
import { partitionShotsByLyricKind } from "../../shared/canvasMusicMvLyricKinds";
import { snapShotCutsToBeats, snapSingingCutsToLyricLines } from "../../shared/canvasMusicMvBeats";
import { computeSongBeatGrid } from "./musicMvBeatGrid";
import { composeMusicMvShotBeats } from "./musicMvShotBeats";
import { composeMusicMvFillPlan } from "./musicMvFillPlan";
import { composeCreativeAtHop } from "./musicMvAdvisor";
import { CREATIVE_LLM_HOPS } from "./creativeLlmHops";
import { resolveCanvasMusicMvAudio } from "./canvasMusicMvMedia";
import { detectPerformerGender, mvShotPlanMaxSec } from "../../shared/canvasMusicMvReferences";

const prefix = (userId: number, id: string) => `canvas-music-mv/evidence/${userId}/${id}`;

export async function reviseMusicMvPlanForLyrics(
  userId: number,
  input: { basePlanRequestId: string; lyricTable: MusicMvLyricTable; highlight: { startSec: number; endSec: number }; musicJobId?: string; videoModel?: string },
) {
  const table = musicMvLyricTableSchema.parse(input.lyricTable);
  if (table.status !== "confirmed") throw new Error("请先确认歌词表，再按歌词重排镜头");
  const highlight = musicMvHighlightSchema.parse(input.highlight);
  const bucket = getGcsBucketName();
  const base = prefix(userId, input.basePlanRequestId);
  const read = async (name: string) => JSON.parse((await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${base}/${name}.json` })).buffer.toString("utf8"));
  const [saved, settled] = await Promise.all([read("result"), read("settled")]);
  if (settled?.settled !== true) throw new Error("原分镜尚未结算确认");
  const baseInput = canvasMusicMvDraftInputSchema.parse(saved.input);
  const basePlan = canvasMusicMvPlanSchema.parse(saved.plan);
  if (table.audioId !== baseInput.audio.id) throw new Error("歌词表与分镜歌曲不一致");
  const newId = randomUUID();
  const out = prefix(userId, newId);
  const save = async (name: string, value: unknown) => {
    const saved = await uploadBufferToGcsIfAbsent({ bucket, objectName: `${out}/${name}.json`, buffer: Buffer.from(JSON.stringify(value)), contentType: "application/json" });
    if (!saved.created) throw new Error("分镜修订证据已存在，未覆盖");
  };
  // 1) 句类型分工
  const parted = partitionShotsByLyricKind(basePlan.shots, table.lines, highlight);
  // 2) audiomap：方案自带的优先，否则从原歌算一次（唯一节拍分析）
  let grid = basePlan.beatGrid as (CanvasMusicMvPlan["beatGrid"] & { strongBeatsSec?: number[] }) | undefined;
  if (!grid) {
    const source = await resolveCanvasMusicMvAudio(userId, baseInput.audio, input.musicJobId);
    const song = source.startsWith("gs://") ? (await downloadGcsObject({ gcsUri: source })).buffer : Buffer.from(await (await fetch(source)).arrayBuffer());
    grid = await computeSongBeatGrid(song, baseInput.creativePrompt);
  }
  const inRange = parted.shots.filter(s => s.endSec > highlight.startSec && s.startSec < highlight.endSec);
  // 2b) 演唱镜剪点不切唱句：落在确认版唱句中间的剪点移到句间。单镜上限按所选模型（mvShotPlanMaxSec）；
  //     缺省（旧客户端/未选模型）按保守值：任一镜不得被拉长到超过 max(原长, Mini 口径单镜上限)
  const maxShotSec = mvShotPlanMaxSec(input.videoModel);
  const lyricCut = snapSingingCutsToLyricLines(inRange, table.lines, { maxShotSec });
  const changes = [...parted.changes, ...lyricCut.fixes.map(f => ({ id: f.shotId, action: f.action, detailZh: f.reasonZh }))];
  const snapped = snapShotCutsToBeats(lyricCut.shots, grid!, 0.5, maxShotSec);
  const byId = new Map(snapped.shots.map(s => [s.id, s]));
  const { strongBeatsSec: _drop, ...audioMap } = grid!;
  let plan = canvasMusicMvPlanSchema.parse({ ...basePlan, beatGrid: audioMap, shots: parted.shots.map(s => byId.get(s.id) ?? s) });
  // 3) 新/改镜补逐窗节拍（演唱按确认版唱句），吟唱镜补素材填充建议
  const highlightIds = plan.shots.filter(s => s.endSec > highlight.startSec && s.startSec < highlight.endSec && s.kind !== "footage").map(s => s.id);
  const needBeats = plan.shots.filter(s => highlightIds.includes(s.id) && !s.fillRequested && (!s.beats?.length || s.kind === "singing")).map(s => s.id);
  const beats = needBeats.length
    ? await composeMusicMvShotBeats({ plan, shotIds: needBeats, beatGrid: grid!, lyrics: baseInput.lyrics, creativePrompt: baseInput.creativePrompt, lyricLines: { source: "confirmed", lines: table.lines }, ...(detectPerformerGender(baseInput.creativePrompt) ? { performer: { genderZh: detectPerformerGender(baseInput.creativePrompt), descZh: `${detectPerformerGender(baseInput.creativePrompt)}歌手（演唱者，与叙事主角分开）` } } : {}) }, { hops: CREATIVE_LLM_HOPS, compose: composeCreativeAtHop, save: (n, v) => save(n, v) })
    : undefined;
  if (beats) plan = beats.plan;
  const fillIds = plan.shots.filter(s => highlightIds.includes(s.id) && s.fillRequested).map(s => s.id);
  const fill = fillIds.length
    ? await composeMusicMvFillPlan({ plan, shotIds: fillIds, beatGrid: grid!, creativePrompt: baseInput.creativePrompt, lyricLines: table.lines }, { hops: CREATIVE_LLM_HOPS, compose: composeCreativeAtHop, save: (n, v) => save(`fill-${n}`, v) })
    : undefined;
  if (fill) plan = fill.plan;
  // 4) 演唱镜绑定人物参考：原输入没有人物参考文字时补「全片主锚图（主角定妆帧）」
  const revisedInput = canvasMusicMvDraftInputSchema.parse({
    ...baseInput,
    requestId: newId,
    referenceSummaries: baseInput.referenceSummaries.length ? baseInput.referenceSummaries : ["全片主锚图（生成的主角定妆帧）"],
  });
  plan = validateCanvasMusicMvPlan(plan, revisedInput);
  const revision = { revisedFrom: input.basePlanRequestId, highlight, lyricTable: table, shotLimit: { videoModel: input.videoModel ?? null, maxShotSec }, changes, lyricCutFixes: lyricCut.fixes, snapFixes: snapped.fixes, beats: beats && { filled: beats.filledShotIds, failed: beats.failedShotIds, failuresZh: beats.failuresZh }, fill: fill && { filled: fill.filled, failuresZh: fill.failuresZh } };
  await save("revision", revision);
  const receipt = (name: string, value: unknown) => ({ objectName: `${out}/${name}.json`, bytes: Buffer.byteLength(JSON.stringify(value)), sha256: createHash("sha256").update(JSON.stringify(value)).digest("hex") });
  await save("result", { plan, input: revisedInput, evidence: { ...saved.evidence, revision: receipt("revision", revision) } });
  // 修订不另计费：沿用原分镜结算
  await save("settled", { settled: true, revisedFrom: input.basePlanRequestId, at: new Date().toISOString() });
  return { requestId: newId, plan, changes, beatsFailed: beats?.failedShotIds ?? [], fillFailuresZh: fill?.failuresZh ?? [] };
}
