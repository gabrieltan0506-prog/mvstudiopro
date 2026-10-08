// 只读探针：在工作机独立源码目录运行，不创建学习任务、不调用模型、不生成媒体。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fetchManhua0996EpisodePlayback } from "../server/services/manhuaLearn0996Source";
import { probeNativeDeepReadDurationSec } from "../server/services/manhuaNativeDeepReadPlan";
import { heavyMediaCallbackCommand, withHeavyMediaContext } from "../server/jobs/heavyMediaContext";
import { executeHeavyMedia } from "../server/jobs/heavyMediaWorker";
import type { HeavyCommandResult } from "../server/jobs/heavyMediaQueue";
import { uploadBufferToGcsIfAbsent } from "../server/services/gcs";

assert.equal(process.env.FLY_MACHINE_ID, "7812595b294778", "只允许指定工作机运行");
const sourceUrl = "https://0996zp.com/vod/play/146259/sid/1313645";
const signal = AbortSignal.timeout(120_000);
const sequence: string[] = [];
// 仅本探针进程模拟网站机派发；实际来源解析和ffprobe仍在本工作机执行。
process.env.JOB_WORKER_ROLE = "app";
process.env.MANHUA_HEAVY_WORKER_SPLIT = "1";
const result = await withHeavyMediaContext({ userId: "1", executionId: "source-affinity-readonly" }, () =>
  heavyMediaCallbackCommand.run(async request => {
    sequence.push(request.kind);
    if (request.kind === "learn_source") {
      assert.deepEqual(Object.keys(request).sort(), ["kind", "refreshId", "sourceUrl"]);
    }
    return await executeHeavyMedia(request, signal, async () => {}) as HeavyCommandResult;
  }, async () => {
    const playback = await fetchManhua0996EpisodePlayback(sourceUrl, signal);
    const durationSec = await probeNativeDeepReadDurationSec(playback.playbackUrl, signal, undefined, playback.referer);
    assert.ok(Math.abs(durationSec - 2858.750066) < 1, "同一来源时长不匹配");
    assert.deepEqual(sequence, ["learn_source", "learn_command"]);
    return { sourceUrl, candidates: playback.playbackUrls.length, host: new URL(playback.playbackUrl).hostname, durationSec, sequence };
  })
);
const sourceSha256: Record<string, string> = {};
for (const file of ["server/jobs/heavyMediaContext.ts", "server/jobs/heavyMediaQueue.ts", "server/jobs/heavyMediaWorker.ts", "server/services/heavyLearnMedia.ts", "server/services/manhuaLearn0996Source.ts"]) {
  sourceSha256[file] = createHash("sha256").update(await readFile(file)).digest("hex");
}
const receipt = { at: new Date().toISOString(), machine: process.env.FLY_MACHINE_ID, ...result, sourceSha256,
  boundary: "工作机独立源码目录；正式函数与真实源站、ffprobe；回调传输为进程内适配，未执行持久队列/完整学习/截图/模型" };
const text = JSON.stringify(receipt, null, 2);
await writeFile("receipt.json", text);
const saved = await uploadBufferToGcsIfAbsent({ objectName: `post-prod/1/isolated-probes/learning-source-affinity-1009-${Date.now()}/receipt.json`, buffer: Buffer.from(text), contentType: "application/json" });
console.log(JSON.stringify({ ...receipt, saved }));
