/**
 * 编剧室探针：结构解析 +（可选）线上扩写一轮。
 *   pnpm run manhua:writer-probe
 *   CANVAS_PROBE_WRITER_LIVE=1 pnpm run manhua:writer-probe
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import {
  buildManhuaWriterExpandPrompt,
  parseManhuaWriterPack,
  writerPackLooksReady,
} from "../shared/manhuaWriterRoom.ts";

const SAMPLE = `## 系列标题
测题
## 一句话系列梗概
测
## 人物表
- A
## 道具表
- B
## 场景表
- C
## 第1集
### 集标题
一
### 本集剧情
剧情一
### 片尾钩子
钩子一未揭
## 第2集
### 集标题
二
### 本集剧情
剧情二
### 片尾钩子
钩子二未揭
`;

let failed = 0;
const pack = parseManhuaWriterPack(SAMPLE, 2);
const parseOk = writerPackLooksReady(pack) && pack.episodes.every((e) => e.endHook);
console.log(`[${parseOk ? "PASS" : "FAIL"}] 本地解析 2 集+钩子`);
if (!parseOk) failed += 1;

const prompt = buildManhuaWriterExpandPrompt({
  topic: "女主翻盘情感连载",
  brief: "对手是旧日盟友\n每集结尾留悬念",
  episodeCount: 3,
});
const leak = /GPT-Image|OpenAI|EvoLink|藏海传|Claude|model_name/i.test(prompt);
console.log(`[${!leak ? "PASS" : "FAIL"}] 扩写 prompt 无前台技术泄漏词`);
if (leak) failed += 1;

if (String(process.env.CANVAS_PROBE_WRITER_LIVE || "").trim() === "1") {
  const BASE = String(process.env.CANVAS_PROBE_BASE_URL || "https://www.mvstudiopro.com")
    .trim()
    .replace(/\/$/, "");
  const resp = await fetch(`${BASE}/api/google?op=geminiScript`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model: "gemini-3.1-pro-preview" }),
  });
  const json = (await resp.json()) as any;
  const text = String(
    json?.raw?.candidates?.[0]?.content?.parts?.[0]?.text || json?.text || "",
  ).trim();
  const livePack = parseManhuaWriterPack(text, 3);
  const liveOk = resp.ok && json?.ok && writerPackLooksReady(livePack);
  console.log(
    `[${liveOk ? "PASS" : "FAIL"}] 线上扩写 (${resp.status}) hooks=${livePack.episodes.filter((e) => e.endHook).length}`,
  );
  if (!liveOk) failed += 1;
} else {
  console.log("[SKIP] 线上扩写（设 CANVAS_PROBE_WRITER_LIVE=1 开启）");
}

if (failed) {
  console.error(`[manhua-writer-probe] FAILED ${failed}`);
  process.exit(1);
}
console.log("[manhua-writer-probe] OK");
