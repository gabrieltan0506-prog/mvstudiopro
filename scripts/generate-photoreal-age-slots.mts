/**
 * 仿真人库 · 老人 / 剧用儿童槽批量生成（文生，不挂男主实拍脸）
 *
 *   FLY_ORIGIN=https://mvstudiopro.fly.dev pnpm run manhua:photoreal-age-slots
 *   IDS=char_elder_m_01,char_boy_01 LIMIT=2 FORCE=1
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
  PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
  formatPhotorealFaceShapeBlock,
  photorealLifeStagePromptBlock,
} from "../shared/photorealCharacterPrompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FLY_ORIGIN = String(process.env.FLY_ORIGIN || "https://mvstudiopro.fly.dev").replace(/\/$/, "");
const OUT_PUBLIC = path.join(ROOT, "client/public/manhua-characters/photoreal");
const OUT_DOWNLOADS = path.join(os.homedir(), "Downloads", "2026Jul18", "photoreal-library");
const MANIFEST_PATH = path.join(OUT_DOWNLOADS, "age-slots-manifest.json");
const TIMEOUT_MS = Math.min(Math.max(Number(process.env.GEN_TIMEOUT_MS) || 540_000, 120_000), 900_000);
const FORCE = /^(1|true|yes)$/i.test(String(process.env.FORCE || ""));

type ManifestItem = {
  id: string;
  photorealNameZh: string;
  lifeStage: string;
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
  const idFilter = String(process.env.IDS || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const skip = new Set(
    String(process.env.SKIP_IDS || "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const limit = Math.max(0, Number(process.env.LIMIT || 0) || 0);
  let list = MANHUA_CHARACTER_ASSET_LIBRARY.filter((c) => {
    if (skip.has(c.id)) return false;
    const stage = getManhuaCharacterLifeStage(c);
    return stage === "elder" || stage === "child";
  });
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
    policy: "age slots text-to-image · no male face-lock",
    items,
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(payload, null, 2));
  fs.mkdirSync(OUT_PUBLIC, { recursive: true });
  fs.writeFileSync(path.join(OUT_PUBLIC, "age-slots-manifest.json"), JSON.stringify(payload, null, 2));
}

function roleLabel(c: ManhuaCharacterTemplate): string {
  const stage = getManhuaCharacterLifeStage(c);
  if (stage === "elder") return c.gender === "female" ? "老年女配" : "老年男配";
  return c.gender === "female" ? "小学女生配角" : "小学男生配角";
}

function buildHeroPrompt(c: ManhuaCharacterTemplate): string {
  const name = MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh;
  const style = getManhuaArtStylePreset("photoreal");
  const stage = getManhuaCharacterLifeStage(c);
  const isChild = stage === "child";
  return [
    isChild
      ? `竖屏9:16学校年册式半身肖像，东亚${roleLabel(c)}「${name}」${c.age ? `约${c.age}岁` : ""}，${c.jobZh}，气质${c.temperamentTags.join("·")}。`
      : `竖屏9:16半身肖像写真，东亚${roleLabel(c)}「${name}」${c.age ? `约${c.age}岁` : ""}，${c.jobZh}，气质${c.temperamentTags.join("·")}。`,
    "",
    photorealLifeStagePromptBlock(stage),
    isChild ? "" : PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
    isChild ? "自然皮肤，生活感普通长相，禁止网红修图脸。" : PHOTOREAL_ANTI_BEAUTY_FILTER_ZH,
    isChild ? "" : formatPhotorealFaceShapeBlock(c.id, c.gender),
    "",
    `外形锚点：${c.promptZh}`,
    isChild
      ? "构图：半身偏上，柔和白天光线，浅景深干净教室/白墙背景；校服完整；无文字无水印；G 级全家宜。"
      : "构图：半身偏上，自然光，浅景深干净背景；禁止名人脸、无文字无水印。",
    "纯文生角色卡，不使用任何真人照片参考。",
    "",
    `【画风】${style.labelZh}`,
    isChild
      ? "写实摄影感，自然日系校园短剧配角肖像，干净通透，非广告模特。"
      : style.promptZh,
    "",
    isChild ? "禁止名人脸、禁止水印字幕。" : PHOTOREAL_ANTI_AI_LOCK_ZH,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSheetPrompt(c: ManhuaCharacterTemplate): string {
  const name = MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh;
  const style = getManhuaArtStylePreset("photoreal");
  const stage = getManhuaCharacterLifeStage(c);
  const isChild = stage === "child";
  return [
    "生成一张竖版【漫剧角色设定卡】单图（白底或浅灰干净背景，印刷清晰）：",
    "版式硬约束：",
    "1) 上半：半身人像 + 姓名占位 + 气质标签条 + 妆造短句；",
    "2) 下半：同一人物全身 FRONT / SIDE / BACK 三视图并排，比例一致、服装一致、锁脸；",
    "3) 三视图下方可有极简英文标注 FRONT SIDE BACK；禁止水印、禁止真实名人脸。",
    "",
    `角色：${roleLabel(c)}「${name}」·${c.jobZh}·气质 ${c.temperamentTags.join("·")}`,
    `外形锚点：${c.promptZh}`,
    photorealLifeStagePromptBlock(stage),
    isChild ? "" : formatPhotorealFaceShapeBlock(c.id, c.gender),
    isChild ? "自然皮肤；完整校服或冬装外套长裤；G 级全家宜。" : PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
    isChild ? "" : PHOTOREAL_ANTI_BEAUTY_FILTER_ZH,
    "上半与三视图必须是同一张脸；服装完整日常覆盖。",
    "",
    `【画风】${style.labelZh}`,
    isChild
      ? "写实摄影感，自然校园短剧配角设定卡，干净通透。"
      : style.promptZh,
    "",
    isChild ? "禁止名人脸、禁止水印字幕。" : PHOTOREAL_ANTI_AI_LOCK_ZH,
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

async function flyGenerate(prompt: string, imageUrls: string[] = []): Promise<string> {
  const retries = Math.max(1, Number(process.env.GEN_RETRIES || 5) || 5);
  let lastErr: unknown;
  for (let i = 1; i <= retries; i++) {
    try {
      return await flyGenerateOnce(prompt, imageUrls);
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
  if (FORCE) return false;
  const hit = items.find((x) => x.id === id && x.ok);
  if (!hit) return false;
  const hero = path.join(OUT_PUBLIC, `${id}_hero.jpg`);
  const sheet = path.join(OUT_PUBLIC, `${id}_sheet.jpg`);
  return fs.existsSync(hero) && fs.existsSync(sheet);
}

async function processOne(c: ManhuaCharacterTemplate): Promise<ManifestItem> {
  const name = MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh;
  const stage = getManhuaCharacterLifeStage(c);
  console.log(`\n━━ ${c.id} ${name} · ${stage} ━━`);

  // 文生：不挂参考图（尤其不挂男主实拍）
  const heroUrl = await flyGenerate(buildHeroPrompt(c), []);
  console.log("  hero ok");
  const heroBasePub = path.join(OUT_PUBLIC, `${c.id}_hero`);
  const heroBaseDl = path.join(OUT_DOWNLOADS, `${c.id}_hero`);
  await downloadToJpg(heroUrl, heroBasePub);
  fs.copyFileSync(`${heroBasePub}.jpg`, `${heroBaseDl}.jpg`);

  // 儿童：sheet 也纯文生（挂 hero 易被当成「真人脸参考」误杀）
  const sheetRefs = getManhuaCharacterLifeStage(c) === "child" ? [] : [heroUrl];
  const sheetUrl = await flyGenerate(buildSheetPrompt(c), sheetRefs);
  console.log("  sheet ok");
  const sheetBasePub = path.join(OUT_PUBLIC, `${c.id}_sheet`);
  const sheetBaseDl = path.join(OUT_DOWNLOADS, `${c.id}_sheet`);
  await downloadToJpg(sheetUrl, sheetBasePub);
  fs.copyFileSync(`${sheetBasePub}.jpg`, `${sheetBaseDl}.jpg`);

  return {
    id: c.id,
    photorealNameZh: name,
    lifeStage: stage,
    ok: true,
    hero: `${c.id}_hero.jpg`,
    sheet: `${c.id}_sheet.jpg`,
    at: new Date().toISOString(),
  };
}

async function main() {
  fs.mkdirSync(OUT_PUBLIC, { recursive: true });
  fs.mkdirSync(OUT_DOWNLOADS, { recursive: true });

  let items = loadManifest();
  const targets = pickTargets();
  console.log(
    `🚀 age slots · ${FLY_ORIGIN} · ${targets.length} to run · force=${FORCE ? "on" : "off"}`,
  );

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
        lifeStage: getManhuaCharacterLifeStage(c),
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
