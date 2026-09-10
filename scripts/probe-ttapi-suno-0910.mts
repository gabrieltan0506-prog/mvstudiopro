/** 0910 探针：TTAPI Suno v6 真生成一首，落到 /tmp/probe-ttapi-0910/ */
import { mkdirSync, writeFileSync } from "node:fs";
import { createTtapiSunoTask, getTtapiSunoTask } from "../server/services/ttapiSunoMusic.js";

const t0 = Date.now();
const log = (m: string) => console.log(`[ttapi-probe ${Math.round((Date.now() - t0) / 1000)}s] ${m}`);
const outDir = "/tmp/probe-ttapi-0910d";
mkdirSync(outDir, { recursive: true });

const lyrics = `[Verse]
你把晚风留在窗外
把话藏进一杯没喝完的茶
路灯替你照亮了沉默
我数着影子等一句真话

[Pre-Chorus]
是不是换了季节
心就会学会转弯
是不是过了今天
我们就不再一样

[Chorus]
别爱我又不想说
让我在你眼里猜来猜去
别抱我又不肯留
把承诺说成一句再看看

[Verse 2]
琴弦还记得你的名字
鼓点却跟不上你的脚步
我把整座城市都走完
只找到你没寄出的信

[Chorus]
别爱我又不想说
让我在你眼里猜来猜去
别抱我又不肯留
把承诺说成一句再看看

[Outro]
如果爱是不敢说的那一句
我替你说出口`;

const style = "王力宏30%與汪蘇瀧70% 風格的中式男聲流行情歌，有傳統樂器二胡，琵琶，與當代管弦樂伴奏的結合，65bpm，男声抒情、七分清新校园感，三分华丽 R&B";

log("submit suno-v6");
const created = await createTtapiSunoTask({ model: "suno-v6", prompt: lyrics, style, title: "别爱我又不想说", instrumental: false, negative_tags: "rap, edm", duration: 250, vocal_gender: "Male" });
log(`taskId=${created.taskId} mv=${created.mv}`);
for (;;) {
  await new Promise((r) => setTimeout(r, 10_000));
  const state = await getTtapiSunoTask(created.taskId);
  if (state.status === "pending") { log(`pending progress=${state.progress}%`); continue; }
  if (state.status === "failed") { log(`FAILED ${state.reason}`); process.exit(1); }
  log(`SUCCESS musics=${state.musics.length} urls=${state.audioUrls.length} missing=${state.missing}`);
  let i = 0;
  for (const url of state.audioUrls) {
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    const file = `${outDir}/别爱我又不想说-v6-${++i}.mp3`;
    writeFileSync(file, buf);
    log(`saved ${file} ${buf.length} bytes content-type=${res.headers.get("content-type")} duration=${state.musics[i - 1]?.duration}`);
  }
  writeFileSync(`${outDir}/summary.json`, JSON.stringify({ taskId: created.taskId, musics: state.musics, elapsedMs: Date.now() - t0 }, null, 2));
  log("DONE");
  break;
}
