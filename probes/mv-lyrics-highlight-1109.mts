/**
 * 整首歌词识别（Gemini 两跳 Vertex→EvoLink，待确认版）+ 推荐高光（只取有歌词的部分）· 工作机隔离目录运行。
 *   FLY_PROCESS_GROUP=rig ./node_modules/.bin/tsx scripts/with-worker-probe-lease.mts ./node_modules/.bin/tsx probes/mv-lyrics-highlight-1109.mts <runId> <reuseRunIdFor01-02>
 * 结果写 probes/mv-formal/<runId>/checkpoints/00-lyrics-highlight.json（正式探针 03 步复用）。
 */
import { randomUUID } from "node:crypto";
import { downloadGcsObject, uploadBufferToGcs } from "../server/services/gcs";
import { recognizeMusicMvLyricTable } from "../server/services/musicMvLyricTable";
import { recommendMusicMvHighlight } from "../shared/musicMvHighlight";
const BUCKET = "mv-studio-pro-vertex-video-temp";
const [runId, reuse] = process.argv.slice(2);
const get = async (n: string) => JSON.parse((await downloadGcsObject({ gcsUri: `gs://${BUCKET}/probes/mv-formal/${reuse}/checkpoints/${n}.json` })).buffer.toString("utf8"));
const s1 = await get("01-project");
const s2 = await get("02-audiomap");
const song = (await downloadGcsObject({ gcsUri: s1.audio.gcsUri })).buffer;
const table = await recognizeMusicMvLyricTable(999999001, { requestId: randomUUID(), audio: s1.audio, range: { startSec: 0, endSec: s1.audio.durationSec }, lyricsHint: s1.lyrics }, { readSong: async () => song });
const rec = recommendMusicMvHighlight(table.lines, s1.audio.durationSec, s2.grid.segments || []);
const out = { table, recommendation: rec, linesInHighlight: rec ? table.lines.filter((l: any) => l.endSec > rec.startSec && l.startSec < rec.endSec) : [] };
await uploadBufferToGcs({ bucket: BUCKET, objectName: `probes/mv-formal/${runId}/checkpoints/00-lyrics-highlight.json`, buffer: Buffer.from(JSON.stringify(out, null, 2)), contentType: "application/json" });
console.log("RESULT", JSON.stringify({ by: table.recognizedBy, total: table.lines.length, rec, inHighlight: out.linesInHighlight.length, evidence: table.evidencePrefix }));
