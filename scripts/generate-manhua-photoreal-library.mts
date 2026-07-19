/**
 * 方案 C · 仿真人库批量生成（打 Fly 站内 Evolink gpt-image-2，无需本地 EVOLINK_API_KEY）
 *
 *   FLY_ORIGIN=https://mvstudiopro.fly.dev pnpm run manhua:photoreal-library
 *   SKIP_IDS=char_f_01 IDS=char_f_02,char_m_02  # 可选过滤
 *   LIMIT=4
 *
 * 输出：
 *   - client/public/manhua-characters/photoreal/{id}_{hero|sheet}.jpg
 *   - ~/Downloads/2026Jul18/photoreal-library/
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANHUA_CHARACTER_ASSET_LIBRARY,
  MANHUA_PHOTOREAL_NAME_ZH,
  getManhuaArtStylePreset,
  getManhuaCharacterLifeStage,
  type ManhuaCharacterTemplate,
} from "../shared/manhuaCharacterAssetLibrary.js";
import {
  PHOTOREAL_ANTI_AI_LOCK_ZH,
  PHOTOREAL_ANTI_BEAUTY_FILTER_ZH,
  PHOTOREAL_LOCK_FACE_NOT_WARDROBE_ZH,
  PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
  formatPhotorealFaceShapeBlock,
} from "../shared/photorealCharacterPrompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FLY_ORIGIN = String(process.env.FLY_ORIGIN || "https://mvstudiopro.fly.dev").replace(/\/$/, "");
const OUT_PUBLIC = path.join(ROOT, "client/public/manhua-characters/photoreal");
const OUT_DOWNLOADS = path.join(os.homedir(), "Downloads", "2026Jul18", "photoreal-library");
const MANIFEST_PATH = path.join(OUT_DOWNLOADS, "manifest.json");
const TIMEOUT_MS = Math.min(Math.max(Number(process.env.GEN_TIMEOUT_MS) || 540_000, 120_000), 900_000);

type ManifestItem = {
  id: string;
  photorealNameZh: string;
  cgNameZh: string;
  ok: boolean;
  hero?: string;
  sheet?: string;
  error?: string;
  at?: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickTargets(): ManhuaCharacterTemplate[] {
  const skip = new Set(
    String(process.env.SKIP_IDS || "char_f_01")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const idFilter = String(process.env.IDS || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const limit = Math.max(0, Number(process.env.LIMIT || 0) || 0);
  // 老人/儿童走 manhua:photoreal-age-slots
  let list = [...MANHUA_CHARACTER_ASSET_LIBRARY].filter(
    (c) => !skip.has(c.id) && getManhuaCharacterLifeStage(c) === "adult",
  );
  if (idFilter.length) list = list.filter((c) => idFilter.includes(c.id));
  if (limit > 0) list = list.slice(0, limit);
  return list;
}

function loadManifest(): ManifestItem[] {
  try {
    const j = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as { items?: ManifestItem[] };
    return Array.isArray(j.items) ? j.items : [];
  } catch {
    return [];
  }
}

function saveManifest(items: ManifestItem[]) {
  fs.mkdirSync(OUT_DOWNLOADS, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    via: `${FLY_ORIGIN}/api/jobs?op=canvasGptImage2`,
    items,
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(payload, null, 2));
  fs.mkdirSync(OUT_PUBLIC, { recursive: true });
  fs.writeFileSync(path.join(OUT_PUBLIC, "manifest.json"), JSON.stringify(payload, null, 2));
}

function refUrlFor(id: string): string {
  return `${FLY_ORIGIN}/manhua-characters/${id}.jpg`;
}

/** 纯文生图（过审）：不喂任何参考图，避免真人演员脸入库。TEXT_ONLY=1 或 TEXT_ONLY_IDS=char_f_16 */
function textOnlyIds(): Set<string> {
  if (String(process.env.TEXT_ONLY || "").trim() === "1") return new Set(["*"]);
  return new Set(
    String(process.env.TEXT_ONLY_IDS || "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function shouldTextOnly(id: string): boolean {
  const set = textOnlyIds();
  return set.has("*") || set.has(id);
}

function clothingOverrideBlock(c: ManhuaCharacterTemplate): string {
  const env = String(process.env.PHOTOREAL_CLOTHING_OVERRIDE || "").trim();
  if (env) {
    return `【服装硬改·过审】忽略原外形里的吊带/开叉/深V/露肤描述，改为：${env}`;
  }
  if (String(process.env.PHOTOREAL_FORCE_MODEST || "").trim() === "1" || c.id === "char_f_11") {
    return "【服装硬改·过审】黑色高领丝绒长裙，肩臂完全覆盖，无吊带无开叉无深V，晚宴得体，露肤极少。全身三视图同样锁此服装。";
  }
  return "";
}

function buildHeroPrompt(c: ManhuaCharacterTemplate): string {
  const name = MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh;
  const style = getManhuaArtStylePreset("photoreal");
  const role = c.gender === "female" ? "女主" : "男主";
  const modest = clothingOverrideBlock(c);
  const pureText = shouldTextOnly(c.id);
  return [
    `竖屏9:16半身胸像写真，东亚成年${role}「${name}」${c.age ? `${c.age}岁` : ""}，${c.jobZh}，气质${c.temperamentTags.join("·")}。`,
    "",
    PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
    PHOTOREAL_ANTI_BEAUTY_FILTER_ZH,
    formatPhotorealFaceShapeBlock(c.id, c.gender),
    PHOTOREAL_LOCK_FACE_NOT_WARDROBE_ZH,
    "",
    `外形锚点（转写实，去除二次元/厚涂表述）：${c.promptZh}`,
    modest,
    pureText
      ? "【过审·纯文生图】禁止参考任何真人演员/可识别名人脸；仅按妆造·场景·道具描述原创面孔。无文字无水印。"
      : "构图：胸像偏上，电影柔光，浅景深干净背景。若有参考图：严格锁同一张脸五官比例与发际线，禁止换人、禁止名人脸、无文字无水印。",
    pureText ? "构图：胸像偏上，电影柔光，浅景深喜堂烛光或干净背景。" : "",
    "",
    `【画风】${style.labelZh}`,
    style.promptZh,
    "",
    PHOTOREAL_ANTI_AI_LOCK_ZH,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSheetPrompt(c: ManhuaCharacterTemplate): string {
  const name = MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh;
  const style = getManhuaArtStylePreset("photoreal");
  const role = c.gender === "female" ? "女主" : "男主";
  const modest = clothingOverrideBlock(c);
  return [
    "生成一张竖版【漫剧角色设定卡】单图（白底或浅灰干净背景，印刷清晰）：",
    "版式硬约束：",
    "1) 上半：半身/胸像人像 + 姓名占位 + 气质标签条 + 妆造短句；",
    "2) 下半：同一人物全身 FRONT / SIDE / BACK 三视图并排，比例一致、服装一致、锁脸；",
    "3) 三视图下方可有极简英文标注 FRONT SIDE BACK；禁止水印、禁止真实名人脸。",
    "",
    `角色：${role}「${name}」·${c.jobZh}·气质 ${c.temperamentTags.join("·")}`,
    `外形锚点：${c.promptZh}`,
    formatPhotorealFaceShapeBlock(c.id, c.gender),
    modest,
    PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
    PHOTOREAL_ANTI_BEAUTY_FILTER_ZH,
    PHOTOREAL_LOCK_FACE_NOT_WARDROBE_ZH,
    "若有参考图：上半与三视图必须是同一张脸，锁五官与发型轮廓。",
    "",
    `【画风】${style.labelZh}`,
    style.promptZh,
    "",
    PHOTOREAL_ANTI_AI_LOCK_ZH,
  ]
    .filter(Boolean)
    .join("\n");
}

async function flyGenerateOnce(prompt: string, imageUrls: string[]): Promise<string> {
  const refs = imageUrls.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 16);
  const body = {
    prompt,
    aspectRatio: "9:16" as const,
    referenceImageUrl: refs[0] || undefined,
    referenceImageUrls: refs.length ? refs : undefined,
    imageMode: refs.length ? "edit" : "generate",
    generalImageEdit: refs.length > 0,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    console.log(`  · POST canvasGptImage2 refs=${refs.length} t=${new Date().toISOString()}`);
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
    if (!res.ok || !json.ok || !json.imageUrl) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    return String(json.imageUrl);
  } finally {
    clearTimeout(timer);
  }
}

async function flyGenerate(prompt: string, imageUrls: string[]): Promise<string> {
  const retries = Math.max(1, Number(process.env.GEN_RETRIES || 5) || 5);
  let lastErr: unknown;
  for (let i = 1; i <= retries; i++) {
    try {
      return await flyGenerateOnce(prompt, imageUrls);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // fetch failed / abort：拉长退避，避免打满 Fly 瞬时断连
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
  // sips → jpg（macOS）；失败则保留 png 并复制为 .jpg 兜底
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(
    "sips",
    ["-s", "format", "jpeg", "-s", "formatOptions", "90", pngPath, "--out", jpgPath],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || !fs.existsSync(jpgPath)) {
    fs.copyFileSync(pngPath, jpgPath);
  }
  try {
    fs.unlinkSync(pngPath);
  } catch {
    /* keep */
  }
}

function alreadyOk(items: ManifestItem[], id: string): boolean {
  const hit = items.find((x) => x.id === id && x.ok);
  if (!hit) return false;
  const hero = path.join(OUT_PUBLIC, `${id}_hero.jpg`);
  const sheet = path.join(OUT_PUBLIC, `${id}_sheet.jpg`);
  return fs.existsSync(hero) && fs.existsSync(sheet);
}

async function processOne(c: ManhuaCharacterTemplate): Promise<ManifestItem> {
  const name = MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh;
  const pureText = shouldTextOnly(c.id);
  const ref = pureText ? "" : refUrlFor(c.id);
  console.log(`\n━━ ${c.id} ${name}（CG:${c.nameZh}）${pureText ? "·TEXT_ONLY过审" : ""}━━`);

  const heroUrl = await flyGenerate(buildHeroPrompt(c), ref ? [ref] : []);
  console.log("  hero ok");
  const heroBasePub = path.join(OUT_PUBLIC, `${c.id}_hero`);
  const heroBaseDl = path.join(OUT_DOWNLOADS, `${c.id}_hero`);
  await downloadToJpg(heroUrl, heroBasePub);
  fs.copyFileSync(`${heroBasePub}.jpg`, `${heroBaseDl}.jpg`);

  // 三视图：主图锁脸；非纯文时再带 CG 设定卡。纯文只锁刚生成的 hero（新人脸）。
  const sheetRefs = pureText ? [heroUrl] : [heroUrl, ref].filter(Boolean);
  const sheetUrl = await flyGenerate(buildSheetPrompt(c), sheetRefs);
  console.log("  sheet ok");
  const sheetBasePub = path.join(OUT_PUBLIC, `${c.id}_sheet`);
  const sheetBaseDl = path.join(OUT_DOWNLOADS, `${c.id}_sheet`);
  await downloadToJpg(sheetUrl, sheetBasePub);
  fs.copyFileSync(`${sheetBasePub}.jpg`, `${sheetBaseDl}.jpg`);

  return {
    id: c.id,
    photorealNameZh: name,
    cgNameZh: c.nameZh,
    ok: true,
    hero: `${c.id}_hero.jpg`,
    sheet: `${c.id}_sheet.jpg`,
    at: new Date().toISOString(),
  };
}

process.on("uncaughtException", (e) => {
  console.error("uncaughtException", e);
});
process.on("unhandledRejection", (e) => {
  console.error("unhandledRejection", e);
});

async function main() {
  fs.mkdirSync(OUT_PUBLIC, { recursive: true });
  fs.mkdirSync(OUT_DOWNLOADS, { recursive: true });

  // 确保 char_f_01 验收版写入 manifest
  let items = loadManifest();
  if (!items.find((x) => x.id === "char_f_01" && x.ok)) {
    if (
      fs.existsSync(path.join(OUT_PUBLIC, "char_f_01_hero.jpg")) &&
      fs.existsSync(path.join(OUT_PUBLIC, "char_f_01_sheet.jpg"))
    ) {
      items.push({
        id: "char_f_01",
        photorealNameZh: "岑停云",
        cgNameZh: "沈清辞",
        ok: true,
        hero: "char_f_01_hero.jpg",
        sheet: "char_f_01_sheet.jpg",
        at: new Date().toISOString(),
      });
      saveManifest(items);
    }
  }

  const targets = pickTargets();
  console.log(`🚀 Fly 批量仿真人 · ${FLY_ORIGIN} · 待处理 ${targets.length}（跳过已完成）`);

  for (const c of targets) {
    if (alreadyOk(items, c.id)) {
      console.log(`⏭ skip ${c.id}（已有 hero+sheet）`);
      continue;
    }
    try {
      const row = await processOne(c);
      items = items.filter((x) => x.id !== c.id).concat(row);
      saveManifest(items);
      await sleep(1500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`❌ ${c.id}: ${msg}`);
      items = items.filter((x) => x.id !== c.id).concat({
        id: c.id,
        photorealNameZh: MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh,
        cgNameZh: c.nameZh,
        ok: false,
        error: msg,
        at: new Date().toISOString(),
      });
      saveManifest(items);
      await sleep(3000);
    }
  }

  const ok = items.filter((x) => x.ok).length;
  console.log(`\n完成清单：ok=${ok} / total_tracked=${items.length} · ${MANIFEST_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
