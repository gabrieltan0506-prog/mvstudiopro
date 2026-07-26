/**
 * 成片提示词消毒：旧规则墙 / 古风板 / 导戏长文一律剥掉，只留秒轴短指令与 Image 对照。
 */

const LEGACY_FAT_RE =
  /节拍防火墙|视频生成导戏单|按秒导戏单|成片预演硬锁|跨镜连续硬锁|古风服化参考|路径运镜配方|动作运镜配方|点选道具锚点|成片有声与导戏硬锁|人物表演·成片台词|第\s*\d+\s*段·成片|有参考图时写完整/;

/** 旧肥提示（不可直接喂成片引擎） */
export function isManhuaClipPromptLegacyFat(text: string | null | undefined): boolean {
  return LEGACY_FAT_RE.test(String(text || ""));
}

/**
 * 发给成片引擎前剥掉节点里存的【资产·Image对照】与【出片Image硬绑】。
 *
 * 出片时会按真正送进 API 的那几张图重算一份 @Image 硬绑放在提示词最前面；
 * 节点里存的两块是「审阅那一刻」的快照，图有增减（上传失败、名额被挤）就会
 * 和实算结果对不上。模型同时收到两套 @Image 映射只会挑错脸。
 * 审阅面保留原样——那两块正是用来看清楚绑了谁的。
 */
export function stripManhuaStaleAssetBindForModel(text: string | null | undefined): string {
  return String(text || "")
    .replace(/(^|\n)【资产·Image对照】[\s\S]*?(?=\n【|$)/g, "$1")
    .replace(/(^|\n)【出片Image硬绑】[\s\S]*?(?=\n【|$)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 发给成片引擎前把符号换成官方约定。
 *
 * 火山引擎给 Seedance 定了一张符号表：（）音乐、<>音效、{}台词、【】字幕。
 * 我们一直拿【】当段落标题，可它在引擎眼里的意思是「把这行烧进画面」——
 * 和我们自己那条「画面禁止烧字幕」的硬锁正好打架。台词同理，官方要 {}。
 *
 * 只在出片这一步换：审阅面、节点存稿、以及一大批靠【】断段的解析正则
 * （stripManhuaClipForbiddenBoards、声线锁的说「」抽取等）全部照旧，
 * 历史节点也不会因为改口径而解析不动。
 */
export function renderManhuaClipPromptForSeedance(text: string | null | undefined): string {
  return String(text || "")
    .replace(/【([^】\n]{1,40})】/g, "[$1]")
    .replace(/「([^」\n]{1,200})」/g, "{$1}")
    .trim();
}

const FORBIDDEN_SECTION_PREFIXES = [
  "【节拍防火墙】",
  "【视频生成导戏单",
  "【按秒导戏单",
  "【人物表演·成片台词",
  "【成片有声与导戏硬锁】",
  "【跨镜连续硬锁",
  "【成片预演硬锁】",
  "【参考静帧】",
  "【古风服化参考】",
  "【古风原型",
  "【身份与时代",
  "【古风角色公式】",
  "【服装道具连续性】",
  "【点选道具锚点】",
  "【路径运镜配方】",
  "【动作运镜配方】",
  "【成片画风】",
  "【画风硬锁】",
  "【角色库锚点】",
  "【古风原型锚点】",
  "【参考职责】",
  "【镜头连续性】",
  "【跨段转场】",
  "【资产锁·编号对照",
  "【包装动效手法】",
  // 剪辑手法是出片那一刻现拼的隐藏层，本不该落进节点；万一绕回来了，别糊在审阅面上
  "【剪辑手法】",
  "【运镜词库",
  "【电影级可拍词表】",
  "【叙事灯光",
  "【手法条目库",
  "【男生微表情库】",
  "【男发预设库】",
  "【朝代服饰锚点",
  "【编剧剧种模板",
  "【漫剧场景资产库",
  "【场景示范图锚点】",
  "【已确认五至六段可拍表",
  "【已确认十至十二段可拍表",
  "【本段意图】",
  "【段",
];

function stripSectionByPrefix(text: string, prefix: string): string {
  const raw = String(text || "");
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const hit = raw.indexOf(prefix, i);
    if (hit < 0) {
      out += raw.slice(i);
      break;
    }
    out += raw.slice(i, hit);
    const after = raw.slice(hit + prefix.length);
    // 下一段以换行+【 开头且不是本段续行时结束；否则吃到文末
    const next = after.search(/\n【/);
    i = hit + prefix.length + (next >= 0 ? next : after.length);
  }
  return out;
}

/**
 * 剥成片禁用板。对旧肥稿只留秒轴 / 垫图 / Image对照 / 造型 / 连续。
 * 画风跟垫图走，成片提示词禁止再写「画风：…」。
 */
export function stripManhuaClipForbiddenBoards(text: string): string {
  let t = String(text || "");
  // 旧「【第 1 段·成片】」整块（含空格），勿误伤新「【第1段·15s】」
  t = t.replace(/\n*【第\s*\d+\s*段·成片】[\s\S]*?(?=\n【|$)/g, "");
  // 开场说明墙（无【】包裹的旧导语）
  t = t.replace(
    /^[\s\S]*?(?=【第\d+段·[\d.]+s】|【垫图|【资产·Image对照】|【成片占位】|$)/,
    (head) => {
      if (/节拍防火墙|有参考图时|导戏单|古风服化/.test(head)) return "";
      return head;
    },
  );
  for (const prefix of FORBIDDEN_SECTION_PREFIXES) {
    t = stripSectionByPrefix(t, prefix);
  }
  t = t
    .replace(/\barch_[a-z0-9_]+\b/gi, "")
    .replace(/\/manhua-[^\s|】"'<>]+/gi, "")
    .replace(/\n*【引擎光学】[^\n]*/g, "")
    .replace(/(^|\n)画风：[^\n]*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!isManhuaClipPromptLegacyFat(t)) return t;

  // 仍肥：只拼可保留碎片（不要画风行）
  const timeline = t.match(
    /【第\d+段·[\d.]+s】[\s\S]*?(?=\n【(?!第\d+段·[\d.]+s)|$)/,
  )?.[0];
  const pad = t.match(/【垫图[^\n]*/)?.[0] || "";
  const asset = t.match(/【资产·Image对照】[\s\S]*?(?=\n【(?!资产·Image对照)|$)/)?.[0] || "";
  const bind = t.match(/【出片Image硬绑】[\s\S]*?(?=\n【|$)/)?.[0] || "";
  const look = t.match(/【本段造型】[^\n]*/)?.[0] || "";
  const cont = t.match(/【连续】[^\n]*/)?.[0] || "";
  const slimTimeline =
    timeline && !isManhuaClipPromptLegacyFat(timeline) ? timeline.trim() : "";
  if (slimTimeline) {
    return [slimTimeline, pad, asset, bind, look, cont].filter(Boolean).join("\n");
  }
  return [
    "【成片占位】旧规则墙已清除；请再点「审阅成片提示词」重写秒轴短指令与人物/场景 Image 锁。",
    pad,
    asset,
    bind,
  ]
    .filter(Boolean)
    .join("\n");
}
