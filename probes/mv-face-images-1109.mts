// 1109 用户人脸版 MV 高光：工作机 /app/isolated/mvface 实际执行的原样存档（绝对路径 import 仅在工作机有效；edit 探针用的是 shared/stockPhotoPersonEdit 的首版指令，生产版见同名 shared 文件）。
/**
 * MV 高光（d31a3a49）用户人脸版 · 阶段 A：身份上传 + Pexels 场景参考 + 女主定妆帧 + 关键场景图。
 * 工作机：FLY_PROCESS_GROUP=rig ./node_modules/.bin/tsx scripts/with-worker-probe-lease.mts ./node_modules/.bin/tsx /app/isolated/mvface/mvface-images.mts <runId> [only=K1,K2]
 * 每步 GCS 检查点；GPT Image 原始响应（含 usage）先落盘再解析。
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { downloadGcsObject, signGsUriV4ReadUrl, uploadBufferToGcs } from "/app/server/services/gcs";
import { searchPexels } from "/app/server/services/stockFootage/pexelsClient";
import { adoptStockFootage } from "/app/server/services/stockFootage/adoption";
import { postOpenAiGptImage2AndUpload } from "/app/server/services/openaiGptImage2";
import { NO_TEXT_ON_IMAGE_BLOCK } from "/app/server/services/proxyImageService";

const BUCKET = "mv-studio-pro-vertex-video-temp";
const PROBE_USER = 999999001;
const [runId, onlyArg] = process.argv.slice(2);
if (!runId || !/^[a-z0-9-]{6,80}$/.test(runId)) throw Error("缺少 runId");
const only = onlyArg?.startsWith("only=") ? new Set(onlyArg.slice(5).split(",")) : undefined;
const base = `probes/mv-formal/${runId}`;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const putJson = async (name: string, value: unknown) => uploadBufferToGcs({ bucket: BUCKET, objectName: `${base}/${name}`, buffer: Buffer.from(JSON.stringify(value, null, 2)), contentType: "application/json" });
const getJson = async <T>(name: string): Promise<T | null> => { try { return JSON.parse((await downloadGcsObject({ gcsUri: `gs://${BUCKET}/${base}/${name}` })).buffer.toString("utf8")) as T; } catch { return null; } };
const sign = (u: string, sec = 3 * 3600) => signGsUriV4ReadUrl(u, sec);

// ── 1. 身份图上传（只锁脸；背景/服装不继承，靠提示词约束） ──────────
type Identity = { face: { gcsUri: string; bytes: number; sha256: string }; full: { gcsUri: string; bytes: number; sha256: string } };
let identity = await getJson<Identity>("checkpoints/a1-identity.json");
if (!identity) {
  const up = async (file: string, name: string) => {
    const buffer = await readFile(file);
    const objectName = `${base}/identity/${name}`;
    await uploadBufferToGcs({ bucket: BUCKET, objectName, buffer, contentType: "image/jpeg" });
    return { gcsUri: `gs://${BUCKET}/${objectName}`, bytes: buffer.length, sha256: sha(buffer) };
  };
  identity = { face: await up("/app/isolated/mvface/identity/singer-face.jpg", "singer-face.jpg"), full: await up("/app/isolated/mvface/identity/singer-full.jpg", "singer-full.jpg") };
  await putJson("checkpoints/a1-identity.json", identity);
  log("checkpoint a1-identity", identity);
}

// ── 2. 画面设定 ─────────────────────────────────────────────────────
const STYLE = [
  "Photoreal cinematic film still from a Chinese ballad music video, vertical 9:16 frame.",
  "Rainy night in a city street: heavy visible rain streaks, wet asphalt with long neon reflections, rain-streaked glass shop windows.",
  "Color grade: cold steel-blue dominant palette with warm amber/orange neon accents; shallow depth of field, anamorphic bokeh, subtle film grain, moody high-contrast lighting.",
  "Absolutely no text, no subtitles, no logos, no readable signage.",
].join(" ");
const MAN = [
  "THE MAN (lead singer) = the real person in IDENTITY REFERENCE (image 1).",
  "FACE LOCK (HARD): preserve his exact facial identity — face shape, bone structure, eyes, eyelids, nose, lips, skin tone, apparent age (same as in the photo), and his short black side-swept hair with the same hairline. He must be instantly recognizable as the same person.",
  "Use image 1 ONLY for face and hair. Do NOT copy its light-grey studio backdrop, light streaks, sparkles or its light-grey suit.",
  "Wardrobe in this film: a dark charcoal wool overcoat over a black crew-neck knit, dark trousers; he carries a clear transparent umbrella.",
].join(" ");
const WOMAN_DESC = "a fictional East Asian woman in her mid-twenties, slim, shoulder-length straight black hair, natural light makeup, wearing a muted camel trench coat over a cream knit top, no umbrella, getting wet in the rain";
const WOMAN_LOCK = "THE WOMAN = the same fictional woman as in WOMAN REFERENCE (character card): keep her exact face, hairstyle and camel trench coat. She is a fictional person.";
const ENV = (i: number) => `Image ${i} is an ENVIRONMENT / LIGHTING / COMPOSITION reference only (stock photo): borrow its location mood, lighting and color; do NOT copy any person from it.`;

type Scene = { id: string; titleZh: string; songSec: string; usesWoman: boolean; pexelsQuery: string; prompt: string };
const SCENES: Scene[] = [
  { id: "K1", titleZh: "雨夜玻璃前演唱（真歌词段，对口型）", songSec: "18.2–30", usesWoman: false, pexelsQuery: "rainy night shop window neon reflection",
    prompt: "Medium close-up, eye level. THE MAN stands under his clear transparent umbrella in front of a rain-streaked convenience-store glass window glowing warm amber from inside; he is singing a sad ballad line, mouth naturally open mid-word, eyebrows slightly knitted, eyes looking just off camera toward someone across the street. Raindrops bead on the umbrella and catch orange neon; cold blue rain behind him. Only one person in frame." },
  { id: "K2", titleZh: "对峙：她出现在对面（真歌词段尾 30–36s）", songSec: "30–36", usesWoman: true, pexelsQuery: "couple standing rain night street neon",
    prompt: "Over-the-shoulder two-shot on a wet neon sidewalk. Foreground: THE WOMAN seen from behind her right shoulder, slightly out of focus, rain-soaked hair. Background in focus: THE MAN facing her about one meter away under his clear transparent umbrella, singing to her with a pleading, aching expression, mouth open on a word. Her eyes are red-rimmed. Cold blue rain, warm amber shop light from the side. Exactly two people." },
  { id: "K3", titleZh: "情绪爆发：戏剧性一记耳光（约 36s 吟唱起）", songSec: "36–38", usesWoman: true, pexelsQuery: "couple argument rain night",
    prompt: "Dramatic medium shot, frozen instant of a staged theatrical slap in a film: THE WOMAN's open right palm has just swept past THE MAN's left cheek (follow-through, slight motion blur on her hand), his head is turned sharply to the side by the motion, wet hair flicking off a spray of raindrops, his clear umbrella tilting away. Her face shows heartbreak and tears, not cruelty. A performed acting moment, no injury, no blood, no marks. Rim light in orange neon, cold blue rain. Exactly two people." },
  { id: "K4", titleZh: "她转身离开，背影没入雨幕，他怔住", songSec: "38–47.8", usesWoman: true, pexelsQuery: "woman walking away rain night street",
    prompt: "Deep-focus composition. Foreground right: THE MAN in profile, frozen and stunned, his clear umbrella lowered at his side so rain falls on him, cheek still turned. Background center: THE WOMAN walking away down the long neon-lit rainy street, seen from behind, small and partly dissolved into the rain curtain and amber bokeh. Long reflections on the wet asphalt between them. Exactly two people." },
  { id: "K5", titleZh: "独自雨中，泪水与雨水混在脸上（近景）", songSec: "47.8–64", usesWoman: false, pexelsQuery: "man rain face close up night neon",
    prompt: "Tight close-up of THE MAN's face in heavy rain at night, umbrella no longer over his head; tears mixing with raindrops running down his cheeks, eyes glistening and red, lips pressed together, a quiet devastated expression. Warm orange neon rim light on one side of his face, cold blue fill on the other, rain streaks in front of the lens. Only one person." },
  { id: "K6", titleZh: "伞从手中滑落、慢镜落地溅起水花（主视觉峰值 64–73s）", songSec: "64–73", usesWoman: false, pexelsQuery: "umbrella on wet street rain night",
    prompt: "Ground-level low-angle close shot, slow-motion feel: a clear transparent umbrella has just hit the wet asphalt, a crown-shaped splash of water bursts up around its edge, droplets frozen mid-air catching orange and blue neon. In the soft background, THE MAN's legs and his empty open hand hanging at his side, his face partly visible above, looking down. Puddle reflections of neon signs." },
  { id: "K7", titleZh: "拉远：雨中孤身，伞倒在脚边（结尾 73–77.5s）", songSec: "73–77.5", usesWoman: false, pexelsQuery: "empty street rain night neon wide",
    prompt: "High wide shot looking down a long empty rain-soaked city street at night: THE MAN stands alone in the middle of the road, small in frame, head bowed, the clear transparent umbrella lying upside down on the wet asphalt beside him. Neon signs on both sides reflected in long streaks, heavy rain, deep blue atmosphere with warm amber pools of light. Only one person." },
  { id: "K8", titleZh: "蝴蝶停在唇前、双翅遮住嘴唇（落幅 ~75–77.5s）", songSec: "74–77.5", usesWoman: false, pexelsQuery: "blue butterfly wings spread close up",
    prompt: "Extreme close-up of THE MAN's face at night in the rain, framed from forehead to chin: wet hair, tear streaks mixing with raindrops on his cheeks, eyes half-closed and calm, gazing slightly down. A single translucent blue-violet butterfly with clearly visible fine wing veins rests in mid-air right in front of his lips, wings fully spread open and covering his mouth completely; tiny raindrops bead on the wings, which catch warm orange neon on one edge and cold blue light on the other. A quiet, still, poetic final frame. Only one person." },
  { id: "K8b", titleZh: "（无伞重出）蝴蝶停在唇前、双翅遮住嘴唇（落幅 ~75–77.5s）", songSec: "74–77.5", usesWoman: false, pexelsQuery: "blue butterfly wings spread close up",
    prompt: "Extreme close-up of THE MAN's face at night in the rain, framed from forehead to chin: wet hair, tear streaks mixing with raindrops on his cheeks, eyes half-closed and calm, gazing slightly down. A single translucent blue-violet butterfly with clearly visible fine wing veins rests in mid-air right in front of his lips, wings fully spread open and covering his mouth completely; tiny raindrops bead on the wings, which catch warm orange neon on one edge and cold blue light on the other. A quiet, still, poetic final frame. No umbrella anywhere in the frame: he has dropped it, rain falls directly on his head and face. Only one person." },
];

// ── 3. Pexels 场景参考（照片，环境/光线参考） ─────────────────────
type Ref = { query: string; assetId: string; providerAssetId: string; gcsUri: string; label: string; width?: number; height?: number };
const refs: Record<string, Ref> = (await getJson("checkpoints/a2-pexels.json")) || {};
const used = new Set(Object.values(refs).map(r => r.providerAssetId));
for (const s of SCENES) {
  if (refs[s.id] || (only && !only.has(s.id))) continue;
  const search = await searchPexels({ query: s.pexelsQuery, kind: "photo", orientation: "portrait", page: 1, perPage: 15, purpose: "manhua" } as any);
  await putJson(`raw/pexels-photo-${s.id}.json`, { query: s.pexelsQuery, result: search });
  for (const c of search.candidates) {
    if (used.has(c.providerAssetId)) continue;
    const res = await adoptStockFootage(PROBE_USER, { requestId: randomUUID(), providerAssetId: c.providerAssetId, kind: "photo", purpose: "manhua", usage: "reference", orientation: "portrait", context: { projectId: `probe-${runId}`, shotId: s.id, note: "mv face scene ref" } } as any);
    await putJson(`raw/adopt-photo-${c.providerAssetId}.json`, res);
    if (res.status === "succeeded" && res.asset) {
      used.add(c.providerAssetId);
      refs[s.id] = { query: s.pexelsQuery, assetId: res.asset.assetId, providerAssetId: c.providerAssetId, gcsUri: res.asset.gcsUri, label: `${res.asset.source.author.name} / Pexels`, width: res.asset.width, height: res.asset.height };
      break;
    }
  }
  if (!refs[s.id]) throw Error(`Pexels 无可用照片：${s.pexelsQuery}`);
  await putJson("checkpoints/a2-pexels.json", refs);
  log("pexels", s.id, refs[s.id]!.label);
}

// ── 4. 生图（GPT Image 2.6 Sunburst · 资产线 · high · 原始响应先落盘） ──
type Img = { id: string; gcsUri: string; publicUrl: string; prompt: string; references: Array<{ role: string; gcsUri: string }>; usage?: unknown; model: string; quality: string; bytes: number; sha256: string; at: string };
const images: Record<string, Img> = (await getJson("checkpoints/a3-images.json")) || {};
const gen = async (id: string, prompt: string, references: Array<{ role: string; gcsUri: string }>) => {
  if (images[id]) return images[id]!;
  const flowLog: string[] = [];
  const captureError: { message?: string } = {};
  const fullPrompt = `${prompt}\n\n${NO_TEXT_ON_IMAGE_BLOCK}`;
  const attempt = Date.now();
  await putJson(`raw/img-${id}-${attempt}-request.json`, { id, model: "gpt-image-2.6-sunburst", quality: "high", lane: "asset", size: "1024x1536", prompt: fullPrompt, references });
  let rawSaved: { status: number; body: string } | undefined;
  const url = await postOpenAiGptImage2AndUpload(fullPrompt, `${base}/images`, {
    exactModel: "gpt-image-2.6-sunburst", strictRequest: true, lane: "asset", variant: "sunburst", quality: "high", aspectRatio: "9:16", flowLog, captureError,
    imageUrls: references.map(r => sign(r.gcsUri)),
    persistResponse: async r => { rawSaved = r; await putJson(`raw/img-${id}-${attempt}-response-raw.json`, r); },
  });
  let parsed: any = {};
  try { parsed = JSON.parse(rawSaved?.body || "{}"); } catch { parsed = { invalidJson: true }; }
  const { data: _d, ...meta } = parsed || {};
  await putJson(`raw/img-${id}-${attempt}-response-parsed.json`, { ...meta, dataCount: Array.isArray(parsed?.data) ? parsed.data.length : 0, flowLog, captureError });
  if (!url) throw Error(`${id} 未出图：${captureError.message}`);
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const objectName = `${base}/scenes/${id}.png`;
  await uploadBufferToGcs({ bucket: BUCKET, objectName, buffer: buf, contentType: "image/png" });
  images[id] = { id, gcsUri: `gs://${BUCKET}/${objectName}`, publicUrl: url.split("?")[0]!, prompt: fullPrompt, references, usage: meta.usage, model: "gpt-image-2.6-sunburst", quality: "high", bytes: buf.length, sha256: sha(buf), at: new Date().toISOString() };
  await putJson("checkpoints/a3-images.json", images);
  log("IMG", id, "usage", JSON.stringify(meta.usage || null));
  return images[id]!;
};

// 女主定妆帧（虚构人物，无参考图）
const womanPrompt = `${STYLE}\nCHARACTER CARD for a film: full-body-to-knees medium shot of ${WOMAN_DESC}. She stands on a wet neon-lit sidewalk at night facing the camera at a slight three-quarter angle, neutral sorrowful expression, face clearly lit and sharp, rain on her hair and coat. Only one person.`;
if (!only || only.has("W")) await gen("W", womanPrompt, []);
const woman = images["W"];

const tasks = SCENES.filter(s => !only || only.has(s.id)).map(s => async () => {
  const references: Array<{ role: string; gcsUri: string }> = [{ role: "IDENTITY REFERENCE (image 1): the singer's real face", gcsUri: identity!.face.gcsUri }];
  if (s.usesWoman) { if (!woman) throw Error("缺女主定妆帧"); references.push({ role: `WOMAN REFERENCE (image ${references.length + 1}): fictional woman character card`, gcsUri: woman.gcsUri }); }
  references.push({ role: `ENVIRONMENT reference (image ${references.length + 1})`, gcsUri: refs[s.id]!.gcsUri });
  const lines = [STYLE, MAN, ...(s.usesWoman ? [`${WOMAN_LOCK} (image 2)`] : []), ENV(references.length), `SHOT: ${s.prompt}`];
  return gen(s.id, lines.join("\n"), references);
});
// 并发 3
const queue = [...tasks];
await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) await queue.shift()!(); }));

const out = Object.fromEntries([["W", "女主定妆帧（虚构人物）"], ...SCENES.map(s => [s.id, `${s.titleZh} · ${s.songSec}s`])].filter(([id]) => images[id!]).map(([id, t]) => [id, { title: t, url24h: sign(images[id!]!.gcsUri, 24 * 3600), gcsUri: images[id!]!.gcsUri, usage: images[id!]!.usage, envRef: refs[id!]?.label }]));
await putJson("checkpoints/a4-delivery.json", out);
console.log("DELIVERY", JSON.stringify(out));
