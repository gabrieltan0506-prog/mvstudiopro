// 1109 用户人脸版 MV 高光：工作机 /app/isolated/mvface 实际执行的原样存档（绝对路径 import 仅在工作机有效；edit 探针用的是 shared/stockPhotoPersonEdit 的首版指令，生产版见同名 shared 文件）。
/** 阶段 A2：Pexels 实拍底图 → GPT Image 2.6 Sunburst edit 放入人物（与纯生成版并排供选）。原始响应先落盘。 */
import { createHash } from "node:crypto";
import { downloadGcsObject, signGsUriV4ReadUrl, uploadBufferToGcs } from "/app/server/services/gcs";
import { postOpenAiGptImage2AndUpload } from "/app/server/services/openaiGptImage2";
import { buildStockPhotoPersonEditPrompt, stockPhotoPersonEditReferenceOrder, type StockPhotoPersonEditInput } from "/app/isolated/mvface/stockPhotoPersonEdit";
const BUCKET = "mv-studio-pro-vertex-video-temp";
const [runId] = process.argv.slice(2);
const base = `probes/mv-formal/${runId}`;
const putJson = async (name: string, value: unknown) => uploadBufferToGcs({ bucket: BUCKET, objectName: `${base}/${name}`, buffer: Buffer.from(JSON.stringify(value, null, 2)), contentType: "application/json" });
const getJson = async <T>(name: string): Promise<T | null> => { try { return JSON.parse((await downloadGcsObject({ gcsUri: `gs://${BUCKET}/${base}/${name}` })).buffer.toString("utf8")) as T; } catch { return null; } };
const identity = (await getJson<any>("checkpoints/a1-identity.json"))!;
const px = (await getJson<Record<string, any>>("checkpoints/a2-pexels.json"))!;
const imgs = (await getJson<Record<string, any>>("checkpoints/a3-images.json"))!;
const MAN = { source: identity.face.gcsUri, roleEn: "THE MAN (lead singer)", identityPhoto: true, wardrobeEn: "dark charcoal wool overcoat over a black crew-neck knit, dark trousers, rain-soaked" };
const WOMAN = { source: imgs.W.gcsUri, roleEn: "THE WOMAN (fictional)", identityPhoto: false };
const NIGHT = "Make it a rainy night: heavy visible rain streaks, wet ground with long neon reflections, cold steel-blue ambience with warm amber/orange practical lights; photoreal, vertical 9:16 crop of the same viewpoint.";
const FIT: Record<string, { fit: boolean; reasonZh: string; input?: Omit<StockPhotoPersonEditInput, "requestId" | "baseImage" | "aspectRatio"> }> = {
  K1: { fit: true, reasonZh: "夜间亮灯橱窗+撑伞人物，构图与演唱镜一致", input: { cast: "lead", people: [MAN], actionText: "Replace the person with THE MAN: he stands in front of the lit shop window under a clear transparent umbrella, singing a sad ballad line, mouth naturally open mid-word, eyebrows slightly knitted, looking just off camera toward someone across the street. Medium shot.", relightText: NIGHT } },
  K2: { fit: true, reasonZh: "雨夜路口+伞下两人，适合改成对峙站位", input: { cast: "both", people: [MAN, WOMAN], actionText: "Replace the couple: THE WOMAN, no umbrella and with wet hair, stands with her back three-quarters to the camera facing THE MAN about one meter away; THE MAN holds a clear transparent umbrella and sings to her with a pleading, aching expression, mouth open on a word. Her eyes are red-rimmed. Exactly two people.", relightText: NIGHT } },
  K3: { fit: false, reasonZh: "黑白照、两人怒吼贴脸，色调与情绪都不符，保留纯生成版" },
  K4: { fit: true, reasonZh: "女生背影沿湿路面走远，纵深构图正好；黄昏需改雨夜", input: { cast: "both", people: [MAN, WOMAN], actionText: "THE WOMAN walks away down the street, seen from behind in the middle distance, no umbrella, camel trench coat. Add THE MAN in the right foreground in profile, frozen and stunned, his clear transparent umbrella lowered at his side so rain falls on him. Exactly two people.", relightText: "Turn the dusk into a rainy night: dark sky, street lamps and shop windows lit, heavy rain, wet cobblestones reflecting amber and blue light." } },
  K5: { fit: false, reasonZh: "玻璃涂鸦无人物空间，不适合人脸近景，保留纯生成版" },
  K6: { fit: false, reasonZh: "红伞路人中景，无法得到贴地伞落水花构图，保留纯生成版" },
  K7: { fit: true, reasonZh: "空荡雨夜站台+霓虹倒影，适合结尾远景", input: { cast: "lead", people: [MAN], actionText: "Add THE MAN standing alone on the wet ground near the platform, small in frame, head bowed; a clear transparent umbrella lies upside down on the wet ground beside him. Only one person.", relightText: "Keep the night; add heavier visible rain falling through the lights." } },
};
const edits: Record<string, any> = (await getJson("checkpoints/a5-edits.json")) || {};
await putJson("checkpoints/a5-fit.json", Object.fromEntries(Object.entries(FIT).map(([k, v]) => [k, { fit: v.fit, reasonZh: v.reasonZh, pexelsId: px[k].providerAssetId, label: px[k].label }])));
await Promise.all(Object.entries(FIT).filter(([k, v]) => v.fit && !edits[`${k}e`]).map(async ([k, v]) => {
  const id = `${k}e`;
  const input = { ...v.input!, requestId: `${runId}-${id}`, baseImage: { source: px[k].gcsUri, providerAssetId: px[k].providerAssetId, label: px[k].label }, aspectRatio: "9:16" as const };
  const prompt = buildStockPhotoPersonEditPrompt(input);
  const refs = stockPhotoPersonEditReferenceOrder(input);
  const t = Date.now();
  await putJson(`raw/edit-${id}-${t}-request.json`, { id, model: "gpt-image-2.6-sunburst", quality: "high", lane: "asset", size: "1024x1536", prompt, references: refs, input });
  let raw: { status: number; body: string } | undefined;
  const flowLog: string[] = []; const captureError: { message?: string } = {};
  const url = await postOpenAiGptImage2AndUpload(prompt, `${base}/images`, { exactModel: "gpt-image-2.6-sunburst", strictRequest: true, lane: "asset", variant: "sunburst", quality: "high", aspectRatio: "9:16", flowLog, captureError, imageUrls: refs.map(u => signGsUriV4ReadUrl(u, 3 * 3600)), persistResponse: async r => { raw = r; await putJson(`raw/edit-${id}-${t}-response-raw.json`, r); } });
  let parsed: any = {}; try { parsed = JSON.parse(raw?.body || "{}"); } catch { parsed = { invalidJson: true }; }
  const { data: _d, ...meta } = parsed || {};
  await putJson(`raw/edit-${id}-${t}-response-parsed.json`, { ...meta, dataCount: Array.isArray(parsed?.data) ? parsed.data.length : 0, flowLog, captureError });
  if (!url) { console.log("FAIL", id, captureError.message); return; }
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const objectName = `${base}/scenes/${id}.png`;
  await uploadBufferToGcs({ bucket: BUCKET, objectName, buffer: buf, contentType: "image/png" });
  edits[id] = { id, gcsUri: `gs://${BUCKET}/${objectName}`, basePexelsId: px[k].providerAssetId, baseLabel: px[k].label, baseGcsUri: px[k].gcsUri, prompt, references: refs, usage: meta.usage, sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
  await putJson("checkpoints/a5-edits.json", edits);
  console.log(new Date().toISOString(), "EDIT", id, JSON.stringify(meta.usage || null));
}));
console.log("DONE", Object.keys(edits).join(","));
