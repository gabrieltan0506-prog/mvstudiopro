/**
 * 场景/道具示范库 · 每日分批生成（纯文生，不覆盖人物库）
 *
 * 默认 GRID2X2=1：一次文生 2×2 拼图 → 裁成 4 张封面（约省 4× 积分）。
 * 不足 4 张的余数仍走单张。GRID2X2=0 可关。
 *
 * 权重见 shared/manhuaScenePropDemoCatalog.ts
 *
 * 用法：
 *   pnpm run manhua:scene-prop-daily
 *   LIMIT=4 FORCE=1 LANE=intrigue,business pnpm run manhua:scene-prop-daily
 *   IDS=demo_scene_a,demo_scene_b,demo_scene_c,demo_scene_d pnpm run manhua:scene-prop-daily
 *   GRID2X2=0 DRY_RUN=1 pnpm run manhua:scene-prop-daily
 *
 * 输出：
 *   ~/Downloads/2026Jul18/scene-prop-review/{scenes,props}/
 *   client/public/manhua-scenes|manhua-props/（COPY_PUBLIC=1 时同步）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANHUA_CONTENT_LANE_LABEL_ZH,
  MANHUA_DAILY_DEMO_QUOTA,
  getManhuaDemoAsset,
  listManhuaDemoAssets,
  pickDailyManhuaDemoBatch,
  type ManhuaContentLane,
  type ManhuaDemoAsset,
} from "../shared/manhuaScenePropDemoCatalog.js";
import {
  buildDemoSheet2x2Prompt,
  chunkDemoAssetsFor2x2,
  cropImage2x2ToFiles,
} from "../shared/manhuaDemoSheet2x2.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FLY_ORIGIN = String(process.env.FLY_ORIGIN || "https://api.mvstudiopro.com").replace(/\/$/, "");
const OUT_ROOT = path.join(os.homedir(), "Downloads", "2026Jul18", "scene-prop-review");
const SCENES_DIR = path.join(OUT_ROOT, "scenes");
const PROPS_DIR = path.join(OUT_ROOT, "props");
const MANIFEST = path.join(OUT_ROOT, "manifest.json");
const PUBLIC_SCENES = path.join(ROOT, "client/public/manhua-scenes");
const PUBLIC_PROPS = path.join(ROOT, "client/public/manhua-props");
const TIMEOUT_MS = Math.min(Math.max(Number(process.env.GEN_TIMEOUT_MS) || 540_000, 120_000), 900_000);
/** 开跑前探测 Fly；连不上立刻退出，避免本地空挂重试 */
const PREFLIGHT_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.PREFLIGHT_TIMEOUT_MS) || 20_000, 5_000),
  60_000,
);
const FORCE = /^(1|true|yes)$/i.test(String(process.env.FORCE || ""));
const DRY_RUN = /^(1|true|yes)$/i.test(String(process.env.DRY_RUN || ""));
const COPY_PUBLIC = /^(1|true|yes)$/i.test(String(process.env.COPY_PUBLIC || "1"));
/** 默认开：2×2 拼图裁四张；设 GRID2X2=0 关闭 */
const GRID2X2 = !/^(0|false|no|off)$/i.test(String(process.env.GRID2X2 || "1"));
const LIMIT = Math.max(0, Number(process.env.LIMIT || 0) || 0);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function destDir(a: ManhuaDemoAsset) {
  return a.kind === "scene" ? SCENES_DIR : PROPS_DIR;
}

function destPath(a: ManhuaDemoAsset) {
  return path.join(destDir(a), `${a.id}.jpg`);
}

function publicPath(a: ManhuaDemoAsset) {
  return path.join(a.kind === "scene" ? PUBLIC_SCENES : PUBLIC_PROPS, `${a.id}.jpg`);
}

function alreadyOk(a: ManhuaDemoAsset): boolean {
  if (FORCE) return false;
  // 以 public 落盘为准（UI 只认 public）；无 COPY_PUBLIC 时回退审阅目录
  if (COPY_PUBLIC && fs.existsSync(publicPath(a))) return true;
  return fs.existsSync(destPath(a));
}

function loadDoneIds(): Set<string> {
  const done = new Set<string>();
  for (const a of listManhuaDemoAssets()) {
    const ok = COPY_PUBLIC ? fs.existsSync(publicPath(a)) : fs.existsSync(destPath(a));
    if (ok) done.add(a.id);
  }
  return done;
}

/** 优先补齐挂了 scene_XX 且尚未落盘的封面（资产墙缺口） */
function pickSceneTemplateGaps(done: Set<string>, limit: number): ManhuaDemoAsset[] {
  if (limit <= 0) return [];
  const out: ManhuaDemoAsset[] = [];
  const scenes = listManhuaDemoAssets({ kind: "scene" }).filter((a) => a.sceneTemplateId);
  // scene_01…20 顺序；同模板取第一条未完成
  const byTemplate = new Map<string, ManhuaDemoAsset[]>();
  for (const a of scenes) {
    const t = String(a.sceneTemplateId);
    const arr = byTemplate.get(t) || [];
    arr.push(a);
    byTemplate.set(t, arr);
  }
  const templateIds = [...byTemplate.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const tid of templateIds) {
    if (out.length >= limit) break;
    const gap = (byTemplate.get(tid) || []).find((a) => !done.has(a.id));
    if (gap) out.push(gap);
  }
  return out;
}

function buildPrompt(a: ManhuaDemoAsset): string {
  const lane = MANHUA_CONTENT_LANE_LABEL_ZH[a.lane];
  const kind = a.kind === "scene" ? "场景空镜示范" : "道具特写示范";
  return [
    `【AI漫剧${kind}】题材赛道：${lane} · ${a.nameZh}`,
    a.overseasHintZh ? `【海外向】${a.overseasHintZh}` : "",
    a.promptZh,
    "",
    "硬规则：原创示范资产，禁止名人/可识别真人脸特写、禁止可读文字/水印/Logo/二维码；",
    a.kind === "scene"
      ? "场景以环境层次与电影光影为主，角色最多远景剪影。"
      : "道具居中棚拍，材质清晰，无手无模特脸。",
    "竖屏 9:16，超清细节。",
  ]
    .filter(Boolean)
    .join("\n");
}

async function preflightFly(): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PREFLIGHT_TIMEOUT_MS);
  try {
    const res = await fetch(`${FLY_ORIGIN}/api/health`, {
      method: "GET",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`  · preflight ok · ${FLY_ORIGIN} · ${PREFLIGHT_TIMEOUT_MS}ms budget`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Fly 预检失败（${PREFLIGHT_TIMEOUT_MS}ms）：${msg} → ${FLY_ORIGIN}。本机网络不可达时勿空挂补图。`,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function flyGenerateOnce(prompt: string): Promise<string> {
  const body = {
    prompt,
    aspectRatio: "9:16" as const,
    imageMode: "generate",
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    console.log(`  · POST canvasGptImage2 t=${new Date().toISOString()}`);
    const res = await fetch(`${FLY_ORIGIN}/api/jobs?op=canvasGptImage2`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: { ok?: boolean; imageUrl?: string; error?: string } = {};
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      throw new Error(`非 JSON 响应 HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.ok || !json.ok || !json.imageUrl) throw new Error(json.error || `HTTP ${res.status}`);
    return String(json.imageUrl);
  } finally {
    clearTimeout(timer);
  }
}

async function flyGenerate(prompt: string): Promise<string> {
  const retries = Math.max(1, Number(process.env.GEN_RETRIES || 5) || 5);
  let lastErr: unknown;
  for (let i = 1; i <= retries; i++) {
    try {
      return await flyGenerateOnce(prompt);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const transient = /fetch failed|aborted|ECONNRESET|ETIMEDOUT|socket|503|502|429/i.test(msg);
      const waitMs = transient ? Math.min(45_000, 4000 * i * i) : 2000 * i;
      console.warn(`  · gen fail attempt ${i}/${retries}: ${msg} · sleep ${waitMs}ms`);
      await sleep(waitMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function downloadToJpg(url: string, destBaseNoExt: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const pngPath = `${destBaseNoExt}.png`;
  const jpgPath = `${destBaseNoExt}.jpg`;
  fs.mkdirSync(path.dirname(destBaseNoExt), { recursive: true });
  fs.writeFileSync(pngPath, buf);
  const r = spawnSync(
    "sips",
    ["-s", "format", "jpeg", "-s", "formatOptions", "90", pngPath, "--out", jpgPath],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || !fs.existsSync(jpgPath)) fs.copyFileSync(pngPath, jpgPath);
  try {
    fs.unlinkSync(pngPath);
  } catch {
    /* keep */
  }
}

function parseLaneFilter(): ManhuaContentLane[] | null {
  const raw = String(process.env.LANE || "").trim();
  if (!raw) return null;
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean) as ManhuaContentLane[];
}

function quotaFromEnv() {
  const num = (k: string, fallback: number) => {
    const v = Number(process.env[k]);
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
  };
  return {
    highScenes: num("HIGH_SCENES", MANHUA_DAILY_DEMO_QUOTA.highScenes),
    highProps: num("HIGH_PROPS", MANHUA_DAILY_DEMO_QUOTA.highProps),
    mediumScenes: num("MEDIUM_SCENES", MANHUA_DAILY_DEMO_QUOTA.mediumScenes),
    mediumProps: num("MEDIUM_PROPS", MANHUA_DAILY_DEMO_QUOTA.mediumProps),
  };
}

function pickBatch(): ManhuaDemoAsset[] {
  const idsRaw = String(process.env.IDS || "").trim();
  if (idsRaw) {
    const ids = idsRaw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    const list: ManhuaDemoAsset[] = [];
    for (const id of ids) {
      const a = getManhuaDemoAsset(id);
      if (a) list.push(a);
      else console.warn(`  · IDS skip unknown ${id}`);
    }
    return LIMIT > 0 ? list.slice(0, LIMIT) : list;
  }
  const lanes = parseLaneFilter();
  if (lanes?.length) {
    const done = loadDoneIds();
    let list = listManhuaDemoAssets({ lane: lanes }).filter((a) => FORCE || !done.has(a.id));
    if (LIMIT > 0) list = list.slice(0, LIMIT);
    return list;
  }
  const done = FORCE ? new Set<string>() : loadDoneIds();
  const quota = quotaFromEnv();
  // 2×2 模式尽量凑满 4 的倍数，优先补场景模板缺口
  const baseGap = Math.max(quota.highScenes + quota.mediumScenes, LIMIT > 0 ? LIMIT : 8);
  const sceneGapBudget = GRID2X2 ? Math.max(4, Math.ceil(baseGap / 4) * 4) : baseGap;
  const gaps = pickSceneTemplateGaps(done, sceneGapBudget);
  const gapIds = new Set(gaps.map((a) => a.id));
  const restDone = new Set([...done, ...gapIds]);
  let rest = pickDailyManhuaDemoBatch(restDone, {
    ...quota,
    highScenes: Math.max(0, quota.highScenes - gaps.filter((a) => a.weight === "high").length),
    mediumScenes: Math.max(0, quota.mediumScenes - gaps.filter((a) => a.weight === "medium").length),
  });
  let batch = [...gaps, ...rest];
  // 去重保序
  const seen = new Set<string>();
  batch = batch.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
  if (LIMIT > 0) batch = batch.slice(0, LIMIT);
  return batch;
}

type ManifestRow = {
  id: string;
  kind: string;
  lane: string;
  nameZh: string;
  ok: boolean;
  error?: string;
  path?: string;
  at: string;
};

function writeManifest(rows: ManifestRow[]) {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  const prev = fs.existsSync(MANIFEST)
    ? (JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as { items?: ManifestRow[] })
    : { items: [] };
  const byId = new Map<string, ManifestRow>();
  for (const r of prev.items || []) byId.set(r.id, r);
  for (const r of rows) byId.set(r.id, r);
  const items = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        policy:
          "daily demo batch · no comedy · high: ancient/xianxia/xuanhuan/revenge/romance/intrigue/business · medium: novel_shell/suspense/scifi",
        quota: MANHUA_DAILY_DEMO_QUOTA,
        updatedAt: new Date().toISOString(),
        items,
      },
      null,
      2,
    ),
  );
}

function saveAssetJpg(a: ManhuaDemoAsset, jpgPath: string) {
  fs.copyFileSync(jpgPath, destPath(a));
  if (COPY_PUBLIC) fs.copyFileSync(jpgPath, publicPath(a));
}

function okRow(a: ManhuaDemoAsset): ManifestRow {
  return {
    id: a.id,
    kind: a.kind,
    lane: a.lane,
    nameZh: a.nameZh,
    ok: true,
    path: destPath(a),
    at: new Date().toISOString(),
  };
}

function failRow(a: ManhuaDemoAsset, error: string): ManifestRow {
  return {
    id: a.id,
    kind: a.kind,
    lane: a.lane,
    nameZh: a.nameZh,
    ok: false,
    error,
    at: new Date().toISOString(),
  };
}

async function generateOne(a: ManhuaDemoAsset): Promise<void> {
  const url = await flyGenerate(buildPrompt(a));
  const tmp = path.join(os.tmpdir(), `scene-prop-${a.id}`);
  await downloadToJpg(url, tmp);
  saveAssetJpg(a, `${tmp}.jpg`);
}

async function generateSheet2x2(cells: ManhuaDemoAsset[]): Promise<void> {
  const prompt = buildDemoSheet2x2Prompt(cells);
  const url = await flyGenerate(prompt);
  const sheetBase = path.join(os.tmpdir(), `scene-prop-sheet-${cells.map((c) => c.id).join("_").slice(0, 80)}`);
  await downloadToJpg(url, sheetBase);
  const sheetJpg = `${sheetBase}.jpg`;
  const outs: [string, string, string, string] = [
    `${sheetBase}-tl.jpg`,
    `${sheetBase}-tr.jpg`,
    `${sheetBase}-bl.jpg`,
    `${sheetBase}-br.jpg`,
  ];
  cropImage2x2ToFiles(sheetJpg, outs);
  for (let i = 0; i < 4; i++) {
    saveAssetJpg(cells[i]!, outs[i]!);
  }
}

async function main() {
  fs.mkdirSync(SCENES_DIR, { recursive: true });
  fs.mkdirSync(PROPS_DIR, { recursive: true });
  if (COPY_PUBLIC) {
    fs.mkdirSync(PUBLIC_SCENES, { recursive: true });
    fs.mkdirSync(PUBLIC_PROPS, { recursive: true });
  }

  const batch = pickBatch().filter((a) => FORCE || !alreadyOk(a));
  const { sheets, singles } = GRID2X2
    ? chunkDemoAssetsFor2x2(batch)
    : { sheets: [] as ManhuaDemoAsset[][], singles: batch };

  console.log(
    `🚀 scene/prop daily · ${FLY_ORIGIN} · n=${batch.length} · grid2x2=${GRID2X2 ? "on" : "off"} · sheets=${sheets.length} · singles=${singles.length} · dry=${DRY_RUN ? "on" : "off"}`,
  );
  for (const sheet of sheets) {
    console.log(`  · sheet2x2 ${sheet.map((a) => a.id).join(" + ")}`);
  }
  for (const a of singles) {
    console.log(`  · single ${a.weight}/${a.lane}/${a.kind} ${a.id} ${a.nameZh}`);
  }
  if (!batch.length) {
    console.log("今日无缺口（目录已齐或 LIMIT/LANE 筛空）。可 FORCE=1 重跑或追加 catalog。");
    return;
  }
  if (DRY_RUN) {
    if (sheets[0]) {
      console.log("\n--- sample 2x2 prompt ---\n");
      console.log(buildDemoSheet2x2Prompt(sheets[0]));
    }
    return;
  }

  await preflightFly();

  const rows: ManifestRow[] = [];

  for (const sheet of sheets) {
    console.log(`\n━━ 2×2 sheet · ${sheet.map((a) => a.id).join(" · ")} ━━`);
    try {
      await generateSheet2x2(sheet);
      for (const a of sheet) {
        console.log(`  ok → ${destPath(a)}`);
        rows.push(okRow(a));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`❌ sheet failed: ${msg}`);
      console.warn("  · fallback: 逐张单生（仍可能耗积分）");
      for (const a of sheet) {
        try {
          await generateOne(a);
          console.log(`  ok(single) → ${destPath(a)}`);
          rows.push(okRow(a));
        } catch (e2) {
          const msg2 = e2 instanceof Error ? e2.message : String(e2);
          console.error(`❌ ${a.id}: ${msg2}`);
          rows.push(failRow(a, msg2));
        }
        await sleep(800);
      }
    }
    writeManifest(rows);
    await sleep(1200);
  }

  for (const a of singles) {
    console.log(`\n━━ ${a.kind} · ${a.lane} · ${a.id} ${a.nameZh} ━━`);
    try {
      await generateOne(a);
      console.log(`  ok → ${destPath(a)}`);
      rows.push(okRow(a));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`❌ ${a.id}: ${msg}`);
      rows.push(failRow(a, msg));
    }
    writeManifest(rows);
    await sleep(1200);
  }

  const ok = rows.filter((r) => r.ok).length;
  const apiCalls = sheets.length + singles.length;
  console.log(`\n完成：ok=${ok}/${rows.length} · API 约 ${apiCalls} 次（2×2 模式下 4 张≈1 次）`);
  console.log(`审阅：${OUT_ROOT}`);
  if (COPY_PUBLIC) {
    const sync = spawnSync("pnpm", ["exec", "tsx", "scripts/sync-manhua-demo-public-ready.mts"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (sync.stdout) process.stdout.write(sync.stdout);
    if (sync.stderr) process.stderr.write(sync.stderr);
    if (sync.status !== 0) console.warn("sync-manhua-demo-public-ready failed");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
