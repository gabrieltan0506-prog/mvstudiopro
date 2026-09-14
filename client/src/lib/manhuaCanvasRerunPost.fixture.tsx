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
import { buildManhuaProjectBible } from "@shared/manhuaProjectBible";
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

const WRITER_PACK = {
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
};

/**
 * 试片审核闸要求**已确认的项目圣经**（useManhuaPilotReview 读 confirmedAt 算
 * projectVersion；缺了就抛「请先确认当前剧本并等待审核记录加载」）。
 * 这里用产品自己的 buildManhuaProjectBible 建一份，不手搓结构。
 */
const PROJECT_BIBLE = buildManhuaProjectBible({
  topic: "鹤归",
  pack: WRITER_PACK,
  cast: {
    lane: "ancient",
    characterIds: [],
    ancientArchetypeIds: [],
    artStyleId: "",
    propIds: [],
    wardrobePropContinuityIds: [],
  },
  focusEpisode: 1,
  confirmedAt: "2026-09-15T00:00:00.000Z",
});

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
  writerPack: WRITER_PACK,
  projectBible: PROJECT_BIBLE,
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
  // 起始状态＝「静帧已按当前口径出过图」（真实用户跑完静帧那一步就是这个状态）。
  // 主项验的是它之后的链路：确认 → 点真实「运行」→ POST 与确认一致。
  // 注意这份回执能不能挺过本机地址迁移，正是 0915 修掉的那个缺陷所在。
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

/**
 * 全离线接管网络。**按仓库真实的任务合同**回执，不是随手编一个 ok:true：
 *   POST /api/jobs            → { jobId }
 *   GET  /api/jobs/:jobId     → { status: "succeeded", output: {...} }
 * 上一轮我给的是 { ok:true, imageUrl }，两处都不符合合同，
 * 于是 pollJobUntilTerminal 会一直轮询（默认最长 14 分钟），整条用例必然超时。
 *
 * 真实入口还会弹 window.confirm，这里一并确认（见下方 window.confirm 覆盖）。
 */
const posts: Array<{ url: string; body: unknown }> = [];
(window as never as { __posts?: typeof posts }).__posts = posts;

const TEST_IMAGE = "https://example.com/test-keyart.png";
const TEST_VIDEO = "https://example.com/test-clip.mp4";
let jobSeq = 0;
/** jobId → 该任务的产物；GET 轮询时按它回 output */
const jobOutputs = new Map<string, Record<string, unknown>>();

// 真实入口会 window.confirm（例如「只重跑第N镜静帧…继续？」）。
// 不接管的话任务根本不会启动，后面全是空等。
const confirmCalls: string[] = [];
(window as never as { __confirms?: string[] }).__confirms = confirmCalls;
window.confirm = ((message?: string) => {
  confirmCalls.push(String(message ?? ""));
  return true;
}) as typeof window.confirm;

window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === "string" ? input : (input as Request).url ?? input);
  const method = (init?.method || "GET").toUpperCase();

  // 试片审核状态：GET /api/jobs?op=manhuaPilotStatus...
  // 回「已批准」，于是段成片不按 10 秒试片跑（也就不会被试片闸拦）。
  if (method === "GET" && /[?&]op=manhuaPilotStatus/.test(url)) {
    return new Response(
      JSON.stringify({
        ok: true,
        review: {
          status: "approved",
          taskId: "fixture-pilot-task",
          outputUrl: "https://example.com/pilot.mp4",
          updatedAt: "2026-09-15T00:00:00.000Z",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  // 轮询：/api/jobs/:jobId
  const pollMatch = /\/api\/jobs\/([^/?#]+)$/.exec(url);
  if (method === "GET" && pollMatch) {
    const jobId = decodeURIComponent(pollMatch[1]!);
    const output = jobOutputs.get(jobId) ?? { imageUrl: TEST_IMAGE };
    return new Response(JSON.stringify({ status: "succeeded", output }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  // 建单：POST /api/jobs（含 ?op= 的直连成片路由）
  if (method === "POST" && url.includes("/api/jobs")) {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    posts.push({ url, body });
    // 直连成片路由（/api/jobs?op=seedanceI2V 等）是同步回结果的那一类
    if (/[?&]op=/.test(url)) {
      return new Response(JSON.stringify({ ok: true, videoUrl: TEST_VIDEO }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    jobSeq += 1;
    const jobId = `test-job-${jobSeq}`;
    const type = String((body as { type?: string } | null)?.type ?? "");
    jobOutputs.set(
      jobId,
      /video|clip|seedance|wan|hailuo|happy/i.test(type)
        ? { videoUrl: TEST_VIDEO, outputUrl: TEST_VIDEO, outputUrls: [TEST_VIDEO] }
        : { imageUrl: TEST_IMAGE, outputUrl: TEST_IMAGE, outputUrls: [TEST_IMAGE], images: [TEST_IMAGE] },
    );
    return new Response(JSON.stringify({ jobId }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  // 试片审核闸要求有登录用户（useManhuaPilotReview 的 input.userId），
  // 没有就抛「请先确认当前剧本并等待审核记录加载」，段成片根本走不到出站。
  // useAuth 读的是 /api/me（不是 /api/auth/me），回包就是用户对象本身。
  if (/\/api\/me(\?|$)/.test(url)) {
    return new Response(
      JSON.stringify({
        id: 90001,
        email: "fixture@test.invalid",
        role: "admin",
        credits: 999999,
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
