/**
 * 漫剧工作流自动验收（C1/C2 只用于定义流程，不作为本站完成证据）。
 *
 * 零扣点 UI 契约（默认，用本地 fixture 驱动真实 /canvas UI）：
 *   pnpm run manhua:accept
 *
 * 登录态线上实测（不触发生成）：
 *   MANHUA_ACCEPTANCE_MODE=live \
 *   MANHUA_ACCEPTANCE_COOKIES_JSON='[{"name":"...","value":"...","domain":".mvstudiopro.com"}]' \
 *   pnpm run manhua:accept
 *
 * 登录态真实重出静帧（会扣点，必须显式开启）：
 *   MANHUA_ACCEPTANCE_MODE=live MANHUA_ACCEPTANCE_ALLOW_GENERATION=1 \
 *   MANHUA_ACCEPTANCE_COOKIES_JSON='[...]' pnpm run manhua:accept
 *
 * 可选继续生成成片（额外扣点）：
 *   MANHUA_ACCEPTANCE_ALLOW_CLIP=1
 */
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import puppeteer, { type CookieData, type Page } from "puppeteer";
import {
  expandManhuaShotKeyartsAfterReverse,
  spawnManhuaDramaStudio,
} from "../client/src/lib/canvasDramaStudio.ts";
import { getManhuaDemoAssetPublicUrl } from "../shared/manhuaScenePropDemoCatalog.ts";
import { buildManhuaProjectBible } from "../shared/manhuaProjectBible.ts";
import {
  buildManhuaWriterSession,
  MANHUA_WRITER_SESSION_LS_KEY,
} from "../shared/manhuaWriterSession.ts";

config({ path: ".env.local" });
config({ path: ".env" });

const BASE = String(process.env.MANHUA_ACCEPTANCE_BASE_URL || "https://www.mvstudiopro.com")
  .trim()
  .replace(/\/$/, "");
const MODE = process.env.MANHUA_ACCEPTANCE_MODE === "live" ? "live" : "fixture";
const ALLOW_GENERATION = /^(1|true|yes)$/i.test(
  String(process.env.MANHUA_ACCEPTANCE_ALLOW_GENERATION || ""),
);
const ALLOW_CLIP = /^(1|true|yes)$/i.test(String(process.env.MANHUA_ACCEPTANCE_ALLOW_CLIP || ""));
const TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.MANHUA_ACCEPTANCE_TIMEOUT_MS || 12 * 60_000),
);
const VIEWPORT_WIDTH = Math.max(
  320,
  Number(process.env.MANHUA_ACCEPTANCE_VIEWPORT_WIDTH || 1440),
);
const VIEWPORT_HEIGHT = Math.max(
  480,
  Number(process.env.MANHUA_ACCEPTANCE_VIEWPORT_HEIGHT || 900),
);
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDate = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const OUT_DIR =
  process.env.MANHUA_ACCEPTANCE_OUT_DIR ||
  path.join(os.homedir(), "Downloads", `manhua-acceptance-${runDate}`, `run-${runStamp}`);
const RUN_MODE =
  MODE === "fixture"
    ? "fixture-ui"
    : ALLOW_CLIP
      ? "live-full"
      : ALLOW_GENERATION
        ? "live-keyframes"
        : "live-readonly";

type Check = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  evidence?: string;
};

const checks: Check[] = [];

function check(id: string, label: string, ok: boolean, detail: string, evidence?: string) {
  checks.push({ id, label, ok, detail, evidence });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${id} ${label} · ${detail}`);
}

function assertCheck(id: string, label: string, ok: boolean, detail: string, evidence?: string) {
  check(id, label, ok, detail, evidence);
  if (!ok) throw new Error(`${id} ${label}: ${detail}`);
}

function shellJson(command: string, args: string[]) {
  return JSON.parse(
    execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  ) as unknown;
}

async function verifyDeployGate() {
  if (MODE !== "live") return;
  const file = path.join(OUT_DIR, "00-deploy.json");
  try {
    const runs = shellJson("gh", [
      "run",
      "list",
      "--branch",
      "main",
      "--workflow",
      "Fly Deploy",
      "--limit",
      "1",
      "--json",
      "conclusion,status,headSha,url,displayTitle",
    ]) as Array<{
      conclusion?: string;
      status?: string;
      headSha?: string;
      url?: string;
      displayTitle?: string;
    }>;
    const latest = runs[0];
    const expectedSha = String(process.env.MANHUA_ACCEPTANCE_EXPECTED_SHA || "").trim();
    await fs.writeFile(
      file,
      JSON.stringify({ checkedAt: new Date().toISOString(), expectedSha, latest }, null, 2),
    );
    const success =
      latest?.status === "completed" &&
      latest?.conclusion === "success" &&
      Boolean(latest?.headSha) &&
      (!expectedSha || latest?.headSha?.startsWith(expectedSha));
    assertCheck(
      "DEPLOY-01",
      "生产部署门禁",
      success,
      `status=${latest?.status || "none"} conclusion=${latest?.conclusion || "none"} headSha=${
        latest?.headSha || "none"
      } expected=${expectedSha || "latest-success"}`,
      "00-deploy.json",
    );
  } catch (error) {
    await fs.writeFile(file, String(error));
    assertCheck(
      "DEPLOY-01",
      "生产部署门禁",
      false,
      `无法核对 Fly Deploy：${error instanceof Error ? error.message : String(error)}`,
      "00-deploy.json",
    );
  }
}

function fixtureState() {
  const pack = {
    seriesTitle: "刀下认妻·自动验收样本",
    logline: "旧盟仇杀中，夫妻在刀锋下互相护住对方。",
    charactersMd: "顾青棠｜古风宫装｜主动闯入刀锋\n沈照野｜交领外袍｜横鞘架刀",
    propsMd: "传家玉佩｜金步摇｜旧密令",
    locationsMd: "废弃盟誓堂｜朝堂大殿",
    episodeCount: 3,
    episodes: [
      { index: 1, title: "刀下认妻", body: "夫妻刀下相认。", endHook: "旧密令弹出" },
      { index: 2, title: "死人的毒", body: "追查旧毒。", endHook: "毒源指向朝堂" },
      { index: 3, title: "旧盟再并肩", body: "联手查真凶。", endHook: "幕后人现身" },
    ],
    rawMarkdown: "# 刀下认妻\n\n三集古风权谋漫剧。",
  };
  const bible = buildManhuaProjectBible({
    topic: "古风权谋，夫妻在父辈刀锋下相认",
    pack,
    cast: {
      lane: "ancient",
      characterIds: [],
      ancientArchetypeIds: ["arch_rain_jianghu_dao"],
      artStyleId: "cg_drama",
      sceneId: "scene_06",
      propIds: ["demo_prop_ancient_jade", "demo_prop_ancient_hairpin"],
      wardrobePropContinuityIds: ["wpc_02_jianghu_dao"],
      identityLockZh: "古代中式服饰；禁止现代西装、T恤、牛仔与都市街景。",
    },
    focusEpisode: 1,
    confirmedAt: "2026-07-20T00:00:00.000Z",
  });
  const spawned = spawnManhuaDramaStudio({
    topic: bible.topic,
    episodeIndex: 1,
    episodeTitle: "刀下认妻",
    genreId: "ancient",
    sceneId: "scene_06",
    propIds: bible.cast.propIds,
    ancientArchetypeIds: bible.cast.ancientArchetypeIds,
    wardrobePropContinuityIds: bible.cast.wardrobePropContinuityIds,
    artStyleId: bible.cast.artStyleId,
    writerContext: [
      "【本集】刀下认妻",
      "【人物】顾青棠主动闯入刀锋；沈照野横鞘护妻",
      "【场景】废弃盟誓堂与朝堂大殿",
      "【道具】传家玉佩、金步摇、旧密令",
    ].join("\n"),
  });
  const shotText = [
    "1. 5s｜全景，缓慢推近｜双刀向内压，顾青棠主动站进刀锋。",
    "2. 5s｜中景，固定机位｜沈照野横鞘架住双刀，玉佩从衣襟滑出。",
    "3. 5s｜中近景，轻微横移｜供案裂开，暗红封蜡旧密令弹出。",
  ].join("\n");
  const reverse = spawned.blocks.find((block) => block.id.startsWith("reverse-"))!;
  const primed = spawned.blocks.map((block) => {
    if (block.id.startsWith("story-")) {
      return { ...block, status: "done" as const, outputText: pack.episodes[0]!.body };
    }
    if (block.id.startsWith("bible-")) {
      return { ...block, status: "done" as const, outputText: pack.charactersMd };
    }
    if (block.id.startsWith("beats-") || block.id === reverse.id) {
      return { ...block, status: "done" as const, outputText: shotText };
    }
    return block;
  });
  const expanded = expandManhuaShotKeyartsAfterReverse(primed, spawned.edges, reverse.id);
  const fixtureUrls = [
    getManhuaDemoAssetPublicUrl("demo_scene_intrigue_court"),
    getManhuaDemoAssetPublicUrl("demo_scene_intrigue_court_empty_front"),
    getManhuaDemoAssetPublicUrl("demo_scene_intrigue_court_aisle_low"),
  ];
  let keyartIndex = 0;
  const blocks = expanded.blocks.map((block) => {
    if (!block.id.startsWith("keyart-")) return block;
    const outputUrl = fixtureUrls[keyartIndex % fixtureUrls.length]!;
    keyartIndex += 1;
    return {
      ...block,
      status: "done" as const,
      outputUrl,
      outputUrls: [outputUrl],
    };
  });
  return {
    canvas: { blocks, edges: expanded.edges },
    writer: buildManhuaWriterSession({
      topic: bible.topic,
      brief: "三集古风权谋；每集三镜。",
      episodeCount: 3,
      focusEpisode: 1,
      writerPack: pack,
      writerConfirmed: true,
      directorUnlocked: true,
      projectBible: bible,
      manhuaUiMode: "workbench",
    }),
  };
}

async function installCookies(page: Page) {
  const raw = String(process.env.MANHUA_ACCEPTANCE_COOKIES_JSON || "").trim();
  if (!raw) return;
  const cookies = JSON.parse(raw) as CookieData[];
  await page.setCookie(...cookies);
}

async function seedFixture(page: Page) {
  const fixture = fixtureState();
  await page.evaluateOnNewDocument(
    (payload, writerKey) => {
      localStorage.setItem("mv-canvas-workspace-mode-v1", "manhua");
      localStorage.setItem("mv-freeform-canvas-v1", JSON.stringify(payload.canvas));
      localStorage.setItem(writerKey, JSON.stringify(payload.writer));
      localStorage.setItem(
        "mv-manhua-factory-character-prefs-v1",
        JSON.stringify({ topic: payload.writer.topic, artStyleId: "cg_drama" }),
      );
    },
    fixture,
    MANHUA_WRITER_SESSION_LS_KEY,
  );
}

async function screenshot(page: Page, name: string, selector?: string) {
  const file = path.join(OUT_DIR, name);
  if (selector) {
    const element = await page.$(selector);
    if (!element) throw new Error(`截图元素不存在：${selector}`);
    await element.screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: false });
  }
  return file;
}

async function ensureWorkbench(page: Page) {
  await page.goto(`${BASE}/canvas`, { waitUntil: "networkidle2", timeout: 120_000 });
  const shell = await page.$("#manhua-workbench-shell");
  if (shell) return;
  const clicked = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const button = buttons.find((item) => /剧本工作台/.test(item.textContent || ""));
    button?.click();
    return Boolean(button);
  });
  if (!clicked) {
    throw new Error("未找到剧本工作台；可能未进入漫剧模式或登录态不可用");
  }
  await page.waitForSelector("#manhua-workbench-shell", { timeout: 30_000 });
}

async function inspectShell(page: Page) {
  return page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>("#manhua-workbench-shell");
    const columns = [...document.querySelectorAll<HTMLElement>("[data-manhua-column]")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        name: el.dataset.manhuaColumn || "",
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    });
    const shellText = shell?.innerText || "";
    const shots = [...document.querySelectorAll<HTMLElement>("[data-manhua-shot]")].map((el) => ({
      index: Number(el.dataset.manhuaShot || 0),
      active: el.dataset.manhuaActive === "true",
      keyartUrl: el.dataset.manhuaKeyartUrl || "",
    }));
    const filmstrip = document.querySelector<HTMLElement>("[data-manhua-filmstrip]");
    const preview = document.querySelector<HTMLElement>("[data-manhua-column='preview']");
    return {
      exists: Boolean(shell),
      layout: shell?.dataset.manhuaLayout || "",
      columns,
      shots,
      shellText,
      hasGuidedPath: /引导路径|下一步[·・]/.test(shellText),
      hasRerun: Boolean(shell?.querySelector("[data-manhua-action='rerun-keyarts']")),
      hasGenerate: Boolean(shell?.querySelector("[data-manhua-action='generate']")),
      readyKeyarts: Number(filmstrip?.dataset.manhuaKeyartReady || 0),
      shotCount: Number(filmstrip?.dataset.manhuaShotCount || 0),
      previewKind: preview?.dataset.manhuaPreviewKind || "",
      previewUrl: preview?.dataset.manhuaPreviewUrl || "",
      viewportWidth: window.innerWidth,
      assetImages: [
        ...document.querySelectorAll<HTMLImageElement>("[data-manhua-column='assets'] img"),
      ].map((image) => ({
        src: image.currentSrc || image.src,
        loaded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
        width: image.naturalWidth,
        height: image.naturalHeight,
      })),
    };
  });
}

async function runUiChecks(page: Page) {
  const first = await inspectShell(page);
  check("UI-01", "剧本工作室存在", first.exists, `layout=${first.layout}`);
  check(
    "UI-02",
    "沉浸三栏",
    first.layout === "immersive-3col",
    `layout=${first.layout}`,
  );
  const [assets, script, preview] = ["assets", "script", "preview"].map((name) =>
    first.columns.find((item) => item.name === name),
  );
  const horizontal = Boolean(
    assets &&
      script &&
      preview &&
      assets.left < script.left &&
      script.left < preview.left &&
      assets.left >= 0 &&
      preview.right <= first.viewportWidth + 1 &&
      Math.min(assets.bottom, script.bottom, preview.bottom) >
        Math.max(assets.top, script.top, preview.top) + 200,
  );
  check(
    "UI-03",
    "左资产｜中脚本｜右预览同屏横排",
    horizontal,
    JSON.stringify(first.columns),
  );
  check("UI-04", "无引导大海报抢屏", !first.hasGuidedPath, "工作台壳内无引导路径/下一步");
  check(
    "UI-05",
    "本集资产分类",
    /本集资产/.test(first.shellText) &&
      /角色/.test(first.shellText) &&
      /场景/.test(first.shellText) &&
      /道具/.test(first.shellText),
    "角色/场景/道具均可见",
  );
  check(
    "UI-06",
    "分镜与片段胶片",
    first.shots.length >= 2 && first.shotCount >= 2,
    `shots=${first.shots.length} filmstrip=${first.shotCount}`,
  );
  check(
    "UI-07",
    "生成与重出静帧入口",
    first.hasGenerate && first.hasRerun,
    `generate=${first.hasGenerate} rerun=${first.hasRerun}`,
  );

  if (first.shots.length >= 2) {
    await page.click(`[data-manhua-shot="${first.shots[1]!.index}"]`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const switched = await inspectShell(page);
    check(
      "UI-08",
      "切换分镜更新选中态",
      switched.shots.some((shot) => shot.index === first.shots[1]!.index && shot.active),
      `active=${switched.shots.find((shot) => shot.active)?.index || "none"}`,
    );
  }
  const brokenAssets = first.assetImages.filter((image) => !image.loaded);
  check(
    "UI-09",
    "资产图片可加载",
    first.assetImages.length > 0 && brokenAssets.length === 0,
    `loaded=${first.assetImages.length - brokenAssets.length}/${first.assetImages.length}`,
  );
  return first;
}

async function hashMediaUrls(urls: string[]) {
  const entries: Array<{ url: string; sha256: string; bytes: number; ok: boolean; error?: string }> = [];
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      entries.push({
        url,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
        ok: true,
      });
    } catch (error) {
      entries.push({
        url,
        sha256: "",
        bytes: 0,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await fs.writeFile(path.join(OUT_DIR, "04-keyart-hashes.json"), JSON.stringify(entries, null, 2));
  return entries;
}

async function waitForGeneratedKeyarts(page: Page) {
  page.once("dialog", async (dialog) => dialog.accept());
  await page.click("[data-manhua-action='rerun-keyarts']");
  await page
    .waitForSelector("[data-manhua-status='running']", { timeout: 30_000 })
    .catch(() => undefined);
  await page.waitForFunction(
    () => {
      const strip = document.querySelector<HTMLElement>("[data-manhua-filmstrip]");
      return Number(strip?.dataset.manhuaKeyartReady || 0) >= 2;
    },
    { timeout: TIMEOUT_MS, polling: 2_000 },
  );
  const result = await inspectShell(page);
  const urls = result.shots.map((shot) => shot.keyartUrl).filter(Boolean);
  const uniqueUrls = [...new Set(urls)];
  check(
    "FN-01",
    "真实多镜静帧",
    result.readyKeyarts >= 2 && uniqueUrls.length >= 2,
    `ready=${result.readyKeyarts} distinctUrls=${uniqueUrls.length}`,
  );
  for (const [i, shot] of result.shots.filter((item) => item.keyartUrl).entries()) {
    await page.click(`[data-manhua-shot="${shot.index}"]`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await screenshot(page, `04-keyart-${i + 1}.png`, "[data-manhua-column='preview']");
  }
  const hashes = await hashMediaUrls(uniqueUrls);
  const distinctHashes = new Set(hashes.filter((entry) => entry.ok).map((entry) => entry.sha256));
  check(
    "FN-01B",
    "静帧文件内容不同",
    hashes.length >= 2 && hashes.every((entry) => entry.ok) && distinctHashes.size >= 2,
    `downloaded=${hashes.filter((entry) => entry.ok).length}/${hashes.length} distinctHashes=${distinctHashes.size}`,
    "04-keyart-hashes.json",
  );
  if (uniqueUrls.length < 2) throw new Error("真实静帧不足 2 张，无法继续视觉复核");
  return uniqueUrls;
}

async function visionReview(urls: string[]) {
  const response = await fetch(`${BASE}/api/google?op=canvasVisionMarkdown`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: [
        "你是严格的漫剧静帧验收员。逐张检查后只输出以下四行，不要解释：",
        "ANCIENT_COSTUME=YES或NO（所有人物均为古代中式服饰）",
        "SCENE_CONTEXT=YES或NO（可读出宫殿/盟誓堂等完整场景，不是纯脸）",
        "PLOT_PROP=YES或NO（至少一张有玉佩/发簪/密令/兵器等剧情道具）",
        "NO_MODERN_POSTER=YES或NO（没有现代服装、都市背景、鸡汤大字海报）",
      ].join("\n"),
      images: urls.map((url) => ({ url, mimeType: "image/jpeg" })),
    }),
  });
  const json = (await response.json()) as { ok?: boolean; markdown?: string; error?: string };
  const markdown = String(json.markdown || "");
  await fs.writeFile(path.join(OUT_DIR, "04-vision-review.md"), markdown || json.error || "empty");
  const expected = ["ANCIENT_COSTUME", "SCENE_CONTEXT", "PLOT_PROP", "NO_MODERN_POSTER"];
  const passed = response.ok && expected.every((key) => new RegExp(`${key}\\s*=\\s*YES`, "i").test(markdown));
  check(
    "FN-02",
    "静帧古装/场景/道具机器复核",
    passed,
    markdown.replace(/\s+/g, " ").slice(0, 280) || json.error || `http=${response.status}`,
    "04-vision-review.md",
  );
}

async function waitForClip(page: Page) {
  await page.click("[data-manhua-action='generate']");
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLElement>("[data-manhua-column='preview']")?.dataset
        .manhuaPreviewKind === "video",
    { timeout: TIMEOUT_MS, polling: 2_000 },
  );
  const video = await page.evaluate(async () => {
    const el = document.querySelector<HTMLVideoElement>("[data-manhua-column='preview'] video");
    if (!el) return { exists: false, readyState: 0, duration: 0, src: "" };
    el.muted = true;
    await el.play().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    return { exists: true, readyState: el.readyState, duration: el.duration, src: el.currentSrc || el.src };
  });
  assertCheck(
    "FN-03",
    "本集成片可播",
    video.exists && video.readyState >= 2 && Number.isFinite(video.duration) && video.duration > 0,
    `readyState=${video.readyState} duration=${video.duration} src=${video.src.slice(0, 100)}`,
  );
  await screenshot(page, "05-clip.png", "[data-manhua-column='preview']");
  const canvasState = await page.evaluate(() => {
    const parsed = JSON.parse(localStorage.getItem("mv-freeform-canvas-v1") || "{}");
    const clip = (parsed.blocks || []).find((block: { id?: string }) =>
      String(block.id || "").startsWith("clip-"),
    );
    return { videoModel: clip?.videoModel || "", outputUrl: clip?.outputUrl || "" };
  });
  assertCheck(
    "FN-04",
    "成片主路径配置",
    canvasState.videoModel === "gemini-omni-flash" && Boolean(canvasState.outputUrl),
    `videoModel=${canvasState.videoModel} output=${Boolean(canvasState.outputUrl)}`,
  );
}

async function writeResult(error?: unknown) {
  const rows = checks
    .map(
      (item) =>
        `| ${item.id} | ${item.label} | ${item.ok ? "PASS" : "FAIL"} | ${item.detail.replace(/\|/g, "\\|")} | ${
          item.evidence || ""
        } |`,
    )
    .join("\n");
  const failures = checks.filter((item) => !item.ok);
  const total = checks.length;
  const generated = MODE === "live" && ALLOW_GENERATION;
  const result = [
    `# 漫剧工作流自动验收 · ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    "",
    `- 模式：${RUN_MODE}`,
    `- 覆盖结论：${
      RUN_MODE === "fixture-ui"
        ? "仅 UI 契约；不代表线上或生成能力"
        : RUN_MODE === "live-readonly"
          ? "仅线上 UI；生成链未验"
          : RUN_MODE === "live-keyframes"
            ? "线上 UI + 真实静帧；成片未验"
            : "线上 UI + 真实静帧 + 成片"
    }`,
    `- 真实生成：${generated ? "已显式开启" : "未开启"}`,
    `- 基准：C1/C2 仅用于定义步骤，证据全部来自本站 ${BASE}/canvas`,
    "",
    "| ID | 验收项 | 结果 | 详情 | 证据 |",
    "|---|---|---|---|---|",
    rows,
    "",
    `**本模式结果：${failures.length || error ? "FAIL" : "PASS"}（${total - failures.length}/${total}）**`,
    error ? `\n运行错误：${error instanceof Error ? error.message : String(error)}` : "",
    "",
  ].join("\n");
  await fs.writeFile(path.join(OUT_DIR, "RESULT.md"), result);
}

async function main() {
  if (ALLOW_GENERATION && MODE !== "live") {
    throw new Error("真实生成只允许 MANHUA_ACCEPTANCE_MODE=live");
  }
  if (ALLOW_CLIP && !ALLOW_GENERATION) {
    throw new Error("MANHUA_ACCEPTANCE_ALLOW_CLIP=1 必须同时开启 ALLOW_GENERATION");
  }
  await fs.mkdir(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: process.env.MANHUA_ACCEPTANCE_HEADFUL === "1" ? false : true,
    userDataDir: process.env.MANHUA_ACCEPTANCE_USER_DATA_DIR || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    deviceScaleFactor: 1,
  });
  try {
    await installCookies(page);
    if (MODE === "fixture") await seedFixture(page);
    await verifyDeployGate();
    await ensureWorkbench(page);
    await screenshot(page, "01-first-viewport.png");
    await runUiChecks(page);
    await screenshot(page, "03-shell.png", "#manhua-workbench-shell");

    if (MODE === "fixture") {
      check(
        "MODE",
        "真实产物边界",
        true,
        "fixture 截图只验证 UI 契约，不作为本站生成效果图或功能完成证据",
      );
    } else if (ALLOW_GENERATION) {
      const urls = await waitForGeneratedKeyarts(page);
      await visionReview(urls);
      if (ALLOW_CLIP) await waitForClip(page);
    }
    await writeResult();
    const failures = checks.filter((item) => !item.ok);
    console.log(`\n结果：${checks.length - failures.length}/${checks.length} PASS`);
    console.log(`证据：${OUT_DIR}`);
    if (failures.length) process.exitCode = 1;
  } catch (error) {
    console.error(error);
    await writeResult(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

void main();
