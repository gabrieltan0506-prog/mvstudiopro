/**
 * 1109 场景连续性锁（MV）：同一地点的镜头共用一张「母版场景图」，后续场景图一律以母版为底图走现有
 * Sunburst edit（只改天气、光线、机位/景别、人物），不换底图、不纯生成；出视频前做同地点一致性预检（软提示）。
 *
 * 纯函数：地点解析、母版挑选、场景图出图约束、手动换底图提示、图像签名与一致性打分。不调用模型、不碰计费。
 */

/** 中文锁定句：镜头提示词场景行与改图指令共用。 */
export const MV_SCENE_LOCK_RULE_ZH = "保持同一地点：建筑、店面、街道布局、招牌位置与母版一致，只改天气与光线";
/** 改图指令（英文）：底图即该地点母版。 */
export function mvSceneLockEditLineEn(locationZh: string): string {
  return `SAME LOCATION LOCK (HARD): image 1 is the MASTER PLATE of the location "${locationZh}". Keep the same buildings, storefronts, street layout, sign positions and landmarks exactly as in image 1 (${MV_SCENE_LOCK_RULE_ZH}). Only weather, light, camera position/framing and the people may change; never move to a different street or architecture style.`;
}

/** 全片没有任何可识别地点时的默认地点名。 */
export const MV_SCENE_DEFAULT_LOCATION_ZH = "全片同一地点";

type ShotLike = { id: string; visualPrompt?: string; beats?: ReadonlyArray<{ actionZh?: string; cameraZh?: string }> };
type SceneImageLike = { gcsUri: string; assetId?: string; label?: string };
type ShotRefsLike = { sceneImages?: ReadonlyArray<SceneImageLike> };

export type MvSceneLocation = { id: string; nameZh: string; shotIds: string[] };
export type MvSceneLockPlan = { locations: MvSceneLocation[]; byShot: Record<string, string> };

const PLACE_SUFFIX = "门口|门前|店门口|店前|店内|店里|橱窗前|街角|街头|街口|街道|大街|小巷|巷口|巷子|路口|路边|站台|车站|地铁站|天台|屋顶|楼顶|楼道|公园|广场|海边|沙滩|桥上|桥下|咖啡馆|咖啡店|便利店|商店|酒吧|餐厅|教室|操场|房间|卧室|客厅|厨房|阳台|车内|车里|雨夜街头";
/** 长的在前（正则分支取先匹配者）；「+」把相邻后缀并成一个地点（商店+门口 → 商店门口）。 */
const PLACE_RE = new RegExp(`(?:${PLACE_SUFFIX.split("|").sort((a, b) => b.length - a.length).join("|")})+`, "g");
/** 地点前最多取 4 个字的修饰（如「街角的」「红色」），遇到动词/介词/标点截断。 */
const PREFIX_CUT = /[在到的，。、；,.\s向于进入是和与从回往朝着]/;
const LEAD_STRIP = /^(?:他们|她们|两人|二人|他|她|我|你|并肩|一起|独自|仍|还|又|再|就|正|都|也|站|坐|走|跑|停|躲|位|身处|置身|转|切|换|冲|离开)+/;
/** 明确换景：只有出现这些措辞且解析出的地点与当前不同，才另起地点。 */
const CHANGE_RE = /换景|转场|场景切换|切换到|换到|切到|来到|走到|回到|跑到|进入|走进|冲进|跑进|离开|另一(?:条街|处|个地方|个场景)|新场景|场景[二三四五2-5]/;
/** 沿用当前地点。 */
const SAME_RE = /同一(?:条街|地点|个地方|处|场景)|原地|还是在|仍在|依旧在|回到原处/;

function shotText(shot: ShotLike): string {
  return [shot.visualPrompt || "", ...(shot.beats || []).map(b => `${b.actionZh || ""} ${b.cameraZh || ""}`)].join("。");
}

/** 从一段中文里抽出地点名（去掉主语/动词前缀），按出现顺序去重。 */
export function extractMvSceneLocations(text: string): string[] {
  const src = String(text || "");
  const out: string[] = [];
  for (const m of Array.from(src.matchAll(PLACE_RE))) {
    let prefix = src.slice(Math.max(0, m.index! - 4), m.index!);
    for (let i = prefix.length - 1; i >= 0; i--) if (PREFIX_CUT.test(prefix[i]!)) { prefix = prefix.slice(i + 1); break; }
    if (!/^[\u4e00-\u9fa5A-Za-z]*$/.test(prefix)) prefix = "";
    const name = (prefix.replace(LEAD_STRIP, "") + m[0]).trim();
    if (name.length < 2 || /^(?:同一|另一)/.test(name)) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

const sameLoc = (a: string, b: string) => a === b || a.includes(b) || b.includes(a);

/**
 * 地点表：首镜（或创作说明）定第一个地点；之后只有「明确换景措辞 + 不同地点名」才另起地点，
 * 「同一条街 / 原地」或无地点描述一律沿用当前地点。无任何地点描述 → 全片同一地点。
 */
export function parseMvSceneLocations(shots: ReadonlyArray<ShotLike>, creativePrompt?: string): MvSceneLockPlan {
  const locations: MvSceneLocation[] = [];
  const byShot: Record<string, string> = {};
  let current: MvSceneLocation | undefined;
  const open = (nameZh: string) => {
    const existing = locations.find(l => sameLoc(l.nameZh, nameZh));
    if (existing) return existing;
    const loc = { id: `loc${locations.length + 1}`, nameZh, shotIds: [] as string[] };
    locations.push(loc);
    return loc;
  };
  shots.forEach((shot, i) => {
    const text = shotText(shot);
    const names = extractMvSceneLocations(text);
    if (!current) {
      const first = names[0] ?? extractMvSceneLocations(creativePrompt || "")[0] ?? MV_SCENE_DEFAULT_LOCATION_ZH;
      current = open(first);
    } else if (i > 0 && !SAME_RE.test(text) && CHANGE_RE.test(text)) {
      const next = names.find(n => !sameLoc(n, current!.nameZh));
      if (next) current = open(next);
    }
    current.shotIds.push(shot.id);
    byShot[shot.id] = current.id;
  });
  return { locations, byShot };
}

export type MvSceneMaster = { locationId: string; shotId: string; image: SceneImageLike };

/** 母版：该地点按镜头顺序第一张已选场景图（用户选的图库照片或首张生成图）。 */
export function pickMvSceneMaster(location: MvSceneLocation, shotReferences: Readonly<Record<string, ShotRefsLike | undefined>>): MvSceneMaster | undefined {
  for (const shotId of location.shotIds) {
    const image = shotReferences[shotId]?.sceneImages?.[0];
    if (image?.gcsUri) return { locationId: location.id, shotId, image };
  }
  return undefined;
}

/** 改图底图参数：图库照片用 baseAssetId（服务端按采用回执取图），生成图用 baseSource（服务端核对归属）。 */
export function mvSceneMasterEditBase(master: MvSceneMaster): { baseAssetId: string } | { baseSource: string } {
  const assetId = master.image.assetId;
  return assetId && /^sf_[0-9a-f]{48}$/.test(assetId) ? { baseAssetId: assetId } : { baseSource: master.image.gcsUri };
}

export type MvSceneImagePlan =
  | { mode: "set_master"; locationZh: string; reasonZh: string }
  | { mode: "master_edit"; locationZh: string; master: MvSceneMaster; base: { baseAssetId: string } | { baseSource: string }; sceneLockZh: string };

/**
 * 本镜场景图怎么出：该地点还没母版（或本镜就是母版镜）→ 本镜自由选/生成，结果即母版；
 * 否则一律以母版为底图走改图（只改天气、光线、机位/景别、人物），不换底图、不纯生成。
 */
export function planMvSceneImage(shotId: string, plan: MvSceneLockPlan, shotReferences: Readonly<Record<string, ShotRefsLike | undefined>>): MvSceneImagePlan {
  const loc = plan.locations.find(l => l.id === plan.byShot[shotId]);
  if (!loc) throw new Error("镜头不在地点表里");
  const master = pickMvSceneMaster(loc, shotReferences);
  if (!master || master.shotId === shotId)
    return { mode: "set_master", locationZh: loc.nameZh, reasonZh: `「${loc.nameZh}」还没有母版场景图：本镜所选或首张生成的场景图将作为母版` };
  return { mode: "master_edit", locationZh: loc.nameZh, master, base: mvSceneMasterEditBase(master), sceneLockZh: MV_SCENE_LOCK_RULE_ZH };
}

/** 用户在某镜手动选了别的底图：与母版不同则需确认（返回提示文案）；母版镜或同图不提示。 */
export function mvSceneManualBaseWarning(shotId: string, picked: { gcsUri: string; assetId?: string }, plan: MvSceneLockPlan, shotReferences: Readonly<Record<string, ShotRefsLike | undefined>>): string | undefined {
  const p = planMvSceneImage(shotId, plan, shotReferences);
  if (p.mode !== "master_edit") return undefined;
  const m = p.master.image;
  if (picked.gcsUri === m.gcsUri || (picked.assetId && picked.assetId === m.assetId)) return undefined;
  return `与母版地点不一致：本镜属于「${p.locationZh}」，母版取自镜头 ${p.master.shotId}。换用别的底图可能让同一地点在镜头间漂移，建议改用「按母版重绘」。确定仍用这张吗？`;
}

/* ---------------- 一致性预检：缩略图签名与打分（纯计算） ---------------- */

export const MV_SCENE_SIGNATURE_SIZE = 32;
/** 低于此分视为「明显不一致」（软提示）。结构权重高于直方图：同地点换天气/光线会动直方图，不动结构。 */
export const MV_SCENE_CONSISTENCY_THRESHOLD = 0.6;

export type MvSceneSignature = { hist: number[]; dhash: string; grid: number[] };

/** 灰度像素（宽×高，0–255）→ 16 档直方图 + 64 位差值哈希 + 8×8 均值网格。 */
export function mvSceneSignatureFromGray(gray: ArrayLike<number>, width: number, height: number): MvSceneSignature {
  if (gray.length < width * height || width < 9 || height < 8) throw new Error("缩略图尺寸不足");
  const hist = new Array(16).fill(0);
  for (let i = 0; i < width * height; i++) hist[Math.min(15, Math.floor(gray[i]! / 16))]++;
  const n = width * height;
  const block = (cols: number, rows: number) => {
    const out: number[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x0 = Math.floor((c * width) / cols), x1 = Math.max(x0 + 1, Math.floor(((c + 1) * width) / cols));
        const y0 = Math.floor((r * height) / rows), y1 = Math.max(y0 + 1, Math.floor(((r + 1) * height) / rows));
        let s = 0, k = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += gray[y * width + x]!; k++; }
        out.push(s / k);
      }
    return out;
  };
  const d = block(9, 8);
  let bits = "";
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) bits += d[r * 9 + c + 1]! > d[r * 9 + c]! ? "1" : "0";
  return { hist: hist.map(v => v / n), dhash: bits, grid: block(8, 8) };
}

/** 网格的结构相似度（零均值、单位方差后的相关系数，映射到 0–1；亮度/对比整体变化不影响）。 */
function gridStructure(a: number[], b: number[]): number {
  const norm = (v: number[]) => {
    const m = v.reduce((s, x) => s + x, 0) / v.length;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) || 1;
    return v.map(x => (x - m) / sd);
  };
  const x = norm(a), y = norm(b);
  const r = x.reduce((s, xi, i) => s + xi * y[i]!, 0) / x.length;
  return Math.max(0, Math.min(1, (r + 1) / 2));
}

export function mvSceneSimilarity(a: MvSceneSignature, b: MvSceneSignature): number {
  const histInter = a.hist.reduce((s, v, i) => s + Math.min(v, b.hist[i] ?? 0), 0);
  let same = 0;
  for (let i = 0; i < 64; i++) if (a.dhash[i] === b.dhash[i]) same++;
  const hash = same / 64;
  const structure = gridStructure(a.grid, b.grid);
  return Math.round((0.2 * histInter + 0.4 * hash + 0.4 * structure) * 1000) / 1000;
}

export type MvSceneConsistencyItem = { shotId: string; gcsUri: string; score: number; ok: boolean };
export type MvSceneConsistencyReport = { locationZh: string; masterGcsUri: string; items: MvSceneConsistencyItem[]; warningsZh: string[] };

export function judgeMvSceneConsistency(
  locationZh: string,
  masterGcsUri: string,
  master: MvSceneSignature,
  others: ReadonlyArray<{ shotId: string; shotLabel?: string; gcsUri: string; signature: MvSceneSignature }>,
  threshold = MV_SCENE_CONSISTENCY_THRESHOLD,
): MvSceneConsistencyReport {
  const items = others.map(o => {
    const score = mvSceneSimilarity(master, o.signature);
    return { shotId: o.shotId, gcsUri: o.gcsUri, score, ok: score >= threshold };
  });
  const warningsZh = others
    .filter((_, i) => !items[i]!.ok)
    .map(o => `${o.shotLabel || o.shotId} 的场景图与「${locationZh}」母版差异明显，可能不是同一地点`);
  return { locationZh, masterGcsUri, items, warningsZh };
}

/** 出视频前预检要比对的图：每个地点 母版 vs 同地点其余镜头的全部场景图。 */
export function mvSceneConsistencyPairs(plan: MvSceneLockPlan, shotReferences: Readonly<Record<string, ShotRefsLike | undefined>>) {
  type Item = { shotId: string; gcsUri: string; assetId?: string };
  const groups: Array<{ locationZh: string; masterGcsUri: string; masterAssetId?: string; items: Item[] }> = [];
  const sf = (id?: string) => (id && /^sf_[0-9a-f]{48}$/.test(id) ? { assetId: id } : {});
  for (const loc of plan.locations) {
    const master = pickMvSceneMaster(loc, shotReferences);
    if (!master) continue;
    const items: Item[] = [];
    for (const shotId of loc.shotIds)
      for (const img of shotReferences[shotId]?.sceneImages || [])
        if (img.gcsUri !== master.image.gcsUri) items.push({ shotId, gcsUri: img.gcsUri, ...sf(img.assetId) });
    const m = sf(master.image.assetId);
    if (items.length) groups.push({ locationZh: loc.nameZh, masterGcsUri: master.image.gcsUri, ...(m.assetId ? { masterAssetId: m.assetId } : {}), items });
  }
  return groups;
}
