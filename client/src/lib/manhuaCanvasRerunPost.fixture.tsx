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
  // 会话引擎必须声明成 2.5：页面会把会话档套到段节点上，
  // 不声明就会把预置的 2.5 编辑段降级成默认档并清掉 2.5 专属字段
  // （这是实测出来的产品行为，不是缺陷）。
  videoModel: "seedance-2.5",
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
    videoModel: "seedance-2.5",
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
    videoModel: "seedance-2.5",
  });
  return laid;
}

if (localStorage.getItem("mv-manhua-writer-session-v1") === null) {
  localStorage.setItem("mv-manhua-writer-session-v1", JSON.stringify(session));
  const laid = buildSeededCanvas();
  // 把**种进去的原样**留一份，供测试比较挂载前后的同一个节点。
  // 上一轮我拿 id 里有没有 -auto- 当证据，那其实是夹具自己产的后缀，结论是错的。
  (window as never as { __seeded?: unknown }).__seeded = JSON.parse(
    JSON.stringify({ blocks: laid.blocks, edges: laid.edges }),
  );
  trySaveLocalCanvas(laid.blocks, laid.edges);
}

/** 全离线：tRPC 回空；成片提交记录下来并回一个成功回执，绝不连生产 */
const posts: Array<{ url: string; body: unknown }> = [];
(window as never as { __posts?: typeof posts }).__posts = posts;
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === "string" ? input : (input as Request).url ?? input);
  if (init?.method === "POST" && url.includes("/api/jobs")) {
    posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    // 固定测试回执：图片与视频各给一份，页面据此自行登记「已按当前口径出过图」。
    // 全离线，不联网、不付费。
    const IMG = "https://example.com/test-keyart.png";
    return new Response(
      JSON.stringify({
        ok: true,
        videoUrl: "https://example.com/result.mp4",
        imageUrl: IMG,
        url: IMG,
        outputUrl: IMG,
        outputUrls: [IMG],
        images: [IMG],
        data: [{ url: IMG }],
      }),
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
