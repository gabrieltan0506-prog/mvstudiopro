/**
 * 仅供 manhuaCanvasRerunPost.browser.test.ts。
 *
 * 预置一份**已铺段、静帧就绪**的离线画布（纯本地计算，不跑反推、不生成、不付费），
 * 写进 localStorage 后挂真的 OmniCanvas。
 * FreeformCanvas 与 ManhuaScriptWorkbench 都被 esbuild alias 换成 probe 壳。
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";
import { buildManhuaWriterSession } from "@shared/manhuaWriterSession";
import { buildManhuaEpisodeSegmentPlanFixtureMarkdown } from "@shared/manhuaEpisodeSegmentPlan";
import { recordManhuaKeyartLookOutput } from "@shared/manhuaKeyartLookState";
import { trySaveLocalCanvas } from "@/lib/manhuaCloudDraftSync";
import {
  ensureManhuaFragmentClips,
  expandManhuaShotKeyartsAfterReverse,
  spawnManhuaDramaStudio,
} from "@/lib/canvasDramaStudio";
import OmniCanvas from "@/pages/OmniCanvas";

const CHARACTERS_MD = `
- 沈砚舟/沈少主｜二十出头·玄色鹤氅玉冠｜寻鹤归宗｜与云疏冷相峙｜不夺旁人之命
- 云疏冷｜银白长发·青衫执剑｜守山神旧约｜与沈砚舟亦敌亦友｜不卖宗门秘辛
`.trim();
const PROPS_MD = `- 双鹤玉扣｜信物｜白玉双鹤对扣·暗纹温润`;
const LOCATIONS_MD = `
- 山神破庙｜阴冷破败｜断梁神像·雨痕青苔
- 鹤影湖｜雾气弥漫｜石桥残荷·倒影如墨
`.trim();
const denseBody = (a: string, b: string) =>
  [
    `${a}内，沈砚舟立于断梁下，青苔湿冷。`,
    `${a}香火早断，神像半脸崩裂。`,
    `${a}外雨声如鼓，门板吱呀。`,
    "「鹤归之日，宗门必开。」他压低嗓音。",
    "云疏冷执剑立于神像侧：「少主莫要再提旧约。」",
    "「旧约未完，鹤影不散。」沈砚舟抬手亮出双鹤玉扣。",
    `二人转往${b}，雾气压得极低。`,
    `${b}石桥残荷，倒影如墨。`,
    "「你若执意，便先过我这一剑。」云疏冷剑尖轻震。",
    "沈砚舟不退：「那便试试。」",
    `${b}水面骤裂，剑气横扫残荷。`,
    "两人各退半步，谁都没有下杀手。",
  ].join("\n");

const episodeBody = `${denseBody("山神破庙", "鹤影湖")}\n\n${buildManhuaEpisodeSegmentPlanFixtureMarkdown()}`;
const episodeBody2 = `${denseBody("鹤影湖", "山神破庙")}\n\n${buildManhuaEpisodeSegmentPlanFixtureMarkdown()}`;

const session = buildManhuaWriterSession({
  topic: "鹤归",
  brief: "少主寻鹤归宗",
  episodeCount: 2,
  focusEpisode: 1,
  writerConfirmed: true,
  writerPack: {
    seriesTitle: "鹤归",
    logline: "少主寻鹤归宗，与守约者相峙。",
    charactersMd: CHARACTERS_MD,
    propsMd: PROPS_MD,
    locationsMd: LOCATIONS_MD,
    episodes: [
      { index: 1, title: "破庙对峙", body: episodeBody, endHook: "神像眼缝渗出金光。" },
      { index: 2, title: "湖上问剑", body: episodeBody2, endHook: "湖心浮起第二枚玉扣。" },
    ],
    rawMarkdown: `# 鹤归\n\n少主寻鹤归宗，与守约者相峙。\n\n### 第1集 · 破庙对峙\n片尾钩子：神像眼缝渗出金光。\n\n${episodeBody}\n\n### 第2集 · 湖上问剑\n片尾钩子：湖心浮起第二枚玉扣。\n\n${episodeBody2}`,
    episodeCount: 2,
  },
});

/** 纯本地算出「已铺段 + 静帧就绪」的画布，不发任何请求 */
function buildSeededCanvas() {
  const spawned = spawnManhuaDramaStudio({
    topic: "鹤归",
    episodeIndex: 1,
    videoModel: "seedance-2.0-mini",
  });
  const reverse = spawned.blocks.find((b) => b.id.startsWith("reverse-"))!;
  const outputText = Array.from(
    { length: 18 },
    (_, i) => `${i + 1}. 第 ${i + 1} 镜：沈砚舟与云疏冷在破庙相峙`,
  ).join("\n");
  const expanded = expandManhuaShotKeyartsAfterReverse(
    spawned.blocks.map((b) =>
      b.id === reverse.id ? { ...b, status: "done" as const, outputText } : b,
    ),
    spawned.edges,
    reverse.id,
  );
  // 关键静帧标记为「已出图」。页面挂载后会用它自己的口径重算 required，
  // 所以这里把 look/source 状态先按产出登记一次，具体是否算「当前」由页面判定；
  // 测试会先读页面判定结果，判定为不当前就明确失败，不假装验过。
  const ready = expanded.blocks.map((b) => {
    if (!b.id.startsWith("keyart-")) return b;
    const outputUrl = `https://example.com/${b.id}.jpg`;
    return {
      ...b,
      status: "done" as const,
      outputUrl,
      manhuaKeyartLookState: recordManhuaKeyartLookOutput(b, outputUrl),
      manhuaKeyartSourceState: recordManhuaKeyartLookOutput(
        { manhuaKeyartLookState: b.manhuaKeyartSourceState },
        outputUrl,
      ),
    };
  });
  const laid = ensureManhuaFragmentClips(ready, expanded.edges, 1, {
    videoModel: "seedance-2.0-mini",
  });
  // 第一段预置成「原片编辑」：已有原片 + 明确编辑指令。
  // 编辑/延长不走通用重编译，正是审查最担心被改写成普通生成的那条路。
  let patched = false;
  const blocks: typeof laid.blocks = laid.blocks.map((b) => {
    if (patched || !b.id.startsWith("clip-")) return b;
    patched = true;
    return {
      ...b,
      videoModel: "seedance-2.5" as const,
      seedance25WorkMode: "video_edit" as const,
      refVideoUrl: "https://example.com/original.mp4",
      seedance25RefVideoUrls: ["https://example.com/original.mp4"],
      prompt: `${b.prompt}\n【视频编辑指令】把第 3 秒的剑光调暗`,
      status: "done" as const,
      outputUrl: "https://example.com/original.mp4",
      outputUrls: ["https://example.com/original.mp4"],
    };
  });
  return { ...laid, blocks };
}

if (localStorage.getItem("mv-manhua-writer-session-v1") === null) {
  localStorage.setItem("mv-manhua-writer-session-v1", JSON.stringify(session));
  const laid = buildSeededCanvas();
  trySaveLocalCanvas(laid.blocks, laid.edges);
}

/** 全离线：tRPC 回空；成片提交记录下来并回一个成功回执，绝不连生产 */
const posts: Array<{ url: string; body: unknown }> = [];
(window as never as { __posts?: typeof posts }).__posts = posts;
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === "string" ? input : (input as Request).url ?? input);
  if (init?.method === "POST" && url.includes("/api/jobs")) {
    posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(
      JSON.stringify({ ok: true, videoUrl: "https://example.com/result.mp4" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  return new Response(JSON.stringify([{ result: { data: null } }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const trpcClient = trpc.createClient({ links: [httpBatchLink({ url: "/api/trpc", transformer: superjson })] });

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <OmniCanvas />
    </QueryClientProvider>
  </trpc.Provider>,
);
