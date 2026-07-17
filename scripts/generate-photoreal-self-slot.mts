/**
 * 用本人实拍 refs（me / t1–t3）作「软参考」重做指定男主槽。
 *
 * 口径（硬）：
 * - 过审槽不动；只补失败/未完成槽
 * - 本人脸是族裔/年龄段/皮肤质感先验，NOT 1:1 同一张脸
 * - 每个角色名必须长出可区分的五官差异（眉眼宽窄、下颌、发型、年龄微调）
 *
 *   FLY_ORIGIN=https://mvstudiopro.fly.dev IDS=char_m_14 pnpm run manhua:photoreal-self
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANHUA_CHARACTER_ASSET_LIBRARY,
  MANHUA_PHOTOREAL_NAME_ZH,
  getManhuaArtStylePreset,
} from "../shared/manhuaCharacterAssetLibrary.js";
import {
  PHOTOREAL_ANTI_AI_LOCK_ZH,
  PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
} from "../shared/photorealCharacterPrompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FLY_ORIGIN = String(process.env.FLY_ORIGIN || "https://mvstudiopro.fly.dev").replace(/\/$/, "");
const OUT_PUBLIC = path.join(ROOT, "client/public/manhua-characters/photoreal");
const OUT_DOWNLOADS = path.join(os.homedir(), "Downloads", "2026Jul18", "photoreal-library");
const REFS_DIR = path.join(OUT_DOWNLOADS, "refs");
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
  selfRef?: boolean;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

async function trpcUploadSignedUrl(fileName: string, mimeType: string) {
  const url = `${FLY_ORIGIN}/api/trpc/mvAnalysis.getVideoUploadSignedUrl?batch=1`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ "0": { json: { fileName, mimeType } } }),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`signedUrl 非 JSON: ${text.slice(0, 200)}`);
  }
  const row = Array.isArray(json) ? json[0] : json;
  const data =
    (row as { result?: { data?: { json?: Record<string, string> } } })?.result?.data?.json ||
    (row as { result?: { data?: Record<string, string> } })?.result?.data ||
    (row as Record<string, string>);
  const uploadUrl = String((data as { uploadUrl?: string })?.uploadUrl || "");
  const gcsUri = String((data as { gcsUri?: string })?.gcsUri || "");
  if (!uploadUrl || !gcsUri) throw new Error(`signedUrl 失败: ${text.slice(0, 300)}`);
  return { uploadUrl, gcsUri, requiredHeaders: (data as { requiredHeaders?: Record<string, string> }).requiredHeaders };
}

async function resolveReadUrl(gcsUri: string): Promise<string> {
  const res = await fetch(
    `${FLY_ORIGIN}/api/google?op=omniMaterialUrl&gcsUri=${encodeURIComponent(gcsUri)}`,
  );
  const json = (await res.json()) as { ok?: boolean; url?: string; error?: string };
  if (!res.ok || !json.ok || !json.url) throw new Error(json.error || "omniMaterialUrl 失败");
  return String(json.url);
}

async function uploadLocalJpg(localPath: string, objectHint: string): Promise<string> {
  const buf = fs.readFileSync(localPath);
  const fileName = path.basename(localPath);
  const signed = await trpcUploadSignedUrl(`photoreal-self/${objectHint}-${fileName}`, "image/jpeg");
  const headers: Record<string, string> = {
    "Content-Type": "image/jpeg",
    ...(signed.requiredHeaders || {}),
  };
  const put = await fetch(signed.uploadUrl, { method: "PUT", headers, body: buf });
  if (!put.ok) throw new Error(`GCS PUT HTTP ${put.status}`);
  return resolveReadUrl(signed.gcsUri);
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
    if (!res.ok || !json.ok || !json.imageUrl) throw new Error(json.error || `HTTP ${res.status}`);
    return String(json.imageUrl);
  } finally {
    clearTimeout(timer);
  }
}

async function flyGenerate(prompt: string, imageUrls: string[]): Promise<string> {
  const retries = Math.max(1, Number(process.env.GEN_RETRIES || 4) || 4);
  let lastErr: unknown;
  for (let i = 1; i <= retries; i++) {
    try {
      return await flyGenerateOnce(prompt, imageUrls);
    } catch (e) {
      lastErr = e;
      console.warn(`  · gen fail attempt ${i}/${retries}: ${e instanceof Error ? e.message : e}`);
      await sleep(2500 * i);
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
  if (r.status !== 0 || !fs.existsSync(jpgPath)) fs.copyFileSync(pngPath, jpgPath);
  try {
    fs.unlinkSync(pngPath);
  } catch {
    /* keep */
  }
}

/** 按槽位稳定偏移，避免不同人名撞成同一张脸 */
function faceDiversityBlock(id: string, name: string): string {
  const n = Number((id.match(/(\d+)$/) || [])[1] || 0);
  const variants = [
    "眉骨略高、眼距中等、下颌偏方、短发侧分略后移发际",
    "眉形更平、眼尾微下垂、鼻梁偏直、圆钝下颌、碎盖刘海感短发",
    "剑眉、眼裂偏长、颧骨略收、尖圆下巴、背头利落",
    "粗眉、眼袋轻、鼻翼略宽、方圆脸、自然中分短发",
    "细眉、眼距略宽、薄唇、鹅蛋偏长脸、短发纹理感",
    "浓眉、目光沉、法令纹轻、宽下颌、板寸过渡短发",
  ];
  const v = variants[n % variants.length]!;
  return [
    "【软参考·禁止同脸复制】参考图只提供：东亚中年男性、皮肤质感、成熟气场；禁止复制同一五官比例与发际线。",
    `【本角色分异·${name}】必须长成可辨认的另一张脸：${v}。`,
    "与参考图可以像「同一族裔年龄段」，但并排放一起必须一眼能分出不是同一个人。",
    "禁止名人脸；禁止所有男主槽共用一张脸。",
  ].join("\n");
}

function buildHeroPrompt(c: {
  id: string;
  nameZh: string;
  age?: number;
  jobZh: string;
  temperamentTags: string[];
  promptZh: string;
}, displayName: string): string {
  const style = getManhuaArtStylePreset("photoreal");
  const age = c.age && c.age >= 35 ? c.age : Math.max(38, Math.min(52, (c.age || 28) + 18));
  return [
    `竖屏9:16半身胸像写真，东亚成年男主「${displayName}」约${age}岁，职业${c.jobZh}，气质${c.temperamentTags.join("·")}。`,
    "",
    PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
    "",
    faceDiversityBlock(c.id, displayName),
    `外形/人设锚点（转写实，可改服装妆发以契合角色，勿照搬参考图西装）：${c.promptZh}`,
    "构图：胸像偏上，电影柔光，浅景深干净背景；无文字无水印无海报角标。",
    "",
    `【画风】${style.labelZh}`,
    style.promptZh,
    "",
    PHOTOREAL_ANTI_AI_LOCK_ZH,
  ].join("\n");
}

function buildSheetPrompt(c: {
  id: string;
  nameZh: string;
  age?: number;
  jobZh: string;
  temperamentTags: string[];
  promptZh: string;
}, displayName: string): string {
  const style = getManhuaArtStylePreset("photoreal");
  const age = c.age && c.age >= 35 ? c.age : Math.max(38, Math.min(52, (c.age || 28) + 18));
  return [
    "生成一张竖版【漫剧角色设定卡】单图（白底或浅灰干净背景，印刷清晰）：",
    "版式硬约束：",
    "1) 上半：半身/胸像人像 + 姓名占位 + 气质标签条 + 妆造短句；",
    "2) 下半：同一人物全身 FRONT / SIDE / BACK 三视图并排，比例一致、服装一致、锁本角色脸；",
    "3) 三视图下方可有极简英文标注 FRONT SIDE BACK；禁止水印、禁止真实名人脸、禁止海报大字。",
    "",
    `角色：男主「${displayName}」·${c.jobZh}·约${age}岁·气质 ${c.temperamentTags.join("·")}`,
    faceDiversityBlock(c.id, displayName),
    `服装与造型跟本角色人设，勿让所有槽位都穿同一套亚麻西装：${c.promptZh}`,
    PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
    "",
    `【画风】${style.labelZh}`,
    style.promptZh,
    "",
    PHOTOREAL_ANTI_AI_LOCK_ZH,
  ].join("\n");
}

async function main() {
  const ids = String(process.env.IDS || "char_m_14")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const meJpg = path.join(REFS_DIR, "me.jpg");
  const t1Jpg = path.join(REFS_DIR, "t1.jpg");
  if (!fs.existsSync(meJpg)) throw new Error(`缺少 ${meJpg}`);
  if (!fs.existsSync(t1Jpg)) console.warn(`⚠ 缺少 t1.jpg，仅用 me.jpg`);

  console.log("↑ 上传本人 refs 到 GCS…");
  const meUrl = await uploadLocalJpg(meJpg, "me");
  console.log("  meUrl ok");
  const t1Url = fs.existsSync(t1Jpg) ? await uploadLocalJpg(t1Jpg, "t1") : "";
  if (t1Url) console.log("  t1Url ok");
  const faceRefs = [meUrl, t1Url].filter(Boolean);

  let items = loadManifest();
  fs.mkdirSync(OUT_PUBLIC, { recursive: true });
  fs.mkdirSync(OUT_DOWNLOADS, { recursive: true });

  for (const id of ids) {
    const c = MANHUA_CHARACTER_ASSET_LIBRARY.find((x) => x.id === id);
    if (!c || c.gender !== "male") throw new Error(`${id} 不是男主槽`);
    const passed = items.find((x) => x.id === id && x.ok);
    if (passed && String(process.env.FORCE || "").trim() !== "1") {
      console.log(`⏭ skip ${id}（已过审入库，不动）`);
      continue;
    }
    const name = MANHUA_PHOTOREAL_NAME_ZH[id] || c.nameZh;
    console.log(`\n━━ 软参考补槽 ${id} ${name}（CG:${c.nameZh} · 分异脸）━━`);
    // 主参考用 me；辅参考最多再挂一张，降低「粘成同一张脸」
    const refsForHero = faceRefs.slice(0, 1);
    const heroUrl = await flyGenerate(buildHeroPrompt(c, name), refsForHero);
    console.log("  hero ok");
    const heroBasePub = path.join(OUT_PUBLIC, `${id}_hero`);
    const heroBaseDl = path.join(OUT_DOWNLOADS, `${id}_hero`);
    await downloadToJpg(heroUrl, heroBasePub);
    fs.copyFileSync(`${heroBasePub}.jpg`, `${heroBaseDl}.jpg`);

    // sheet 以 hero 锁本角色脸为主，本人 ref 权重降低（仅作质感）
    const sheetUrl = await flyGenerate(buildSheetPrompt(c, name), [heroUrl, ...refsForHero]);
    console.log("  sheet ok");
    const sheetBasePub = path.join(OUT_PUBLIC, `${id}_sheet`);
    const sheetBaseDl = path.join(OUT_DOWNLOADS, `${id}_sheet`);
    await downloadToJpg(sheetUrl, sheetBasePub);
    fs.copyFileSync(`${sheetBasePub}.jpg`, `${sheetBaseDl}.jpg`);

    items = items.filter((x) => x.id !== id).concat({
      id,
      photorealNameZh: name,
      cgNameZh: c.nameZh,
      ok: true,
      hero: `${id}_hero.jpg`,
      sheet: `${id}_sheet.jpg`,
      selfRef: true,
      at: new Date().toISOString(),
    });
    saveManifest(items);
  }

  console.log("\n本人槽完成 ·", MANIFEST_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
