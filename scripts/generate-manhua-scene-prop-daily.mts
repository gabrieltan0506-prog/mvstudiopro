/**
 * 场景/道具示范库 · 每日分批生成（纯文生，不覆盖人物库）
 *
 * 权重见 shared/manhuaScenePropDemoCatalog.ts
 *   多生：古风/仙侠/玄幻/逆袭/甜宠/权谋/商战
 *   适量：小说改编壳/悬疑/科幻
 *   不生：沙雕搞笑
 *
 * 用法：
 *   pnpm run manhua:scene-prop-daily
 *   LIMIT=4 FORCE=1 LANE=intrigue,business pnpm run manhua:scene-prop-daily
 *   DRY_RUN=1 pnpm run manhua:scene-prop-daily
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
  listManhuaDemoAssets,
  pickDailyManhuaDemoBatch,
  type ManhuaContentLane,
  type ManhuaDemoAsset,
} from "../shared/manhuaScenePropDemoCatalog.js";

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
const FORCE = /^(1|true|yes)$/i.test(String(process.env.FORCE || ""));
const DRY_RUN = /^(1|true|yes)$/i.test(String(process.env.DRY_RUN || ""));
const COPY_PUBLIC = /^(1|true|yes)$/i.test(String(process.env.COPY_PUBLIC || "1"));
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
  return fs.existsSync(destPath(a));
}

function loadDoneIds(): Set<string> {
  const done = new Set<string>();
  for (const a of listManhuaDemoAssets()) {
    if (fs.existsSync(destPath(a))) done.add(a.id);
  }
  return done;
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
  const lanes = parseLaneFilter();
  if (lanes?.length) {
    const done = loadDoneIds();
    let list = listManhuaDemoAssets({ lane: lanes }).filter((a) => FORCE || !done.has(a.id));
    if (LIMIT > 0) list = list.slice(0, LIMIT);
    return list;
  }
  const done = FORCE ? new Set<string>() : loadDoneIds();
  let batch = pickDailyManhuaDemoBatch(done, quotaFromEnv());
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

async function main() {
  fs.mkdirSync(SCENES_DIR, { recursive: true });
  fs.mkdirSync(PROPS_DIR, { recursive: true });
  if (COPY_PUBLIC) {
    fs.mkdirSync(PUBLIC_SCENES, { recursive: true });
    fs.mkdirSync(PUBLIC_PROPS, { recursive: true });
  }

  const batch = pickBatch();
  console.log(
    `🚀 scene/prop daily · ${FLY_ORIGIN} · n=${batch.length} · force=${FORCE ? "on" : "off"} · dry=${DRY_RUN ? "on" : "off"}`,
  );
  for (const a of batch) {
    console.log(`  · queued ${a.weight}/${a.lane}/${a.kind} ${a.id} ${a.nameZh}`);
  }
  if (!batch.length) {
    console.log("今日无缺口（目录已齐或 LIMIT/LANE 筛空）。可 FORCE=1 重跑或追加 catalog。");
    return;
  }
  if (DRY_RUN) return;

  const rows: ManifestRow[] = [];
  for (const a of batch) {
    if (alreadyOk(a)) {
      console.log(`⏭ skip ${a.id}`);
      rows.push({
        id: a.id,
        kind: a.kind,
        lane: a.lane,
        nameZh: a.nameZh,
        ok: true,
        path: destPath(a),
        at: new Date().toISOString(),
      });
      continue;
    }
    console.log(`\n━━ ${a.kind} · ${a.lane} · ${a.id} ${a.nameZh} ━━`);
    try {
      const url = await flyGenerate(buildPrompt(a));
      const tmp = path.join(os.tmpdir(), `scene-prop-${a.id}`);
      await downloadToJpg(url, tmp);
      const jpg = `${tmp}.jpg`;
      fs.copyFileSync(jpg, destPath(a));
      if (COPY_PUBLIC) fs.copyFileSync(jpg, publicPath(a));
      console.log(`  ok → ${destPath(a)}`);
      rows.push({
        id: a.id,
        kind: a.kind,
        lane: a.lane,
        nameZh: a.nameZh,
        ok: true,
        path: destPath(a),
        at: new Date().toISOString(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`❌ ${a.id}: ${msg}`);
      rows.push({
        id: a.id,
        kind: a.kind,
        lane: a.lane,
        nameZh: a.nameZh,
        ok: false,
        error: msg,
        at: new Date().toISOString(),
      });
    }
    writeManifest(rows);
    await sleep(1200);
  }

  const ok = rows.filter((r) => r.ok).length;
  console.log(`\n完成：ok=${ok}/${rows.length}`);
  console.log(`审阅：${OUT_ROOT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
