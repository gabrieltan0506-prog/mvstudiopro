/**
 * MV 高光（d31a3a49）用户人脸版 · Seedance 2.5 两段秒锁提示词（A 段格式，纯本地编译，不调用模型）。
 * 用户 1109 拍板：演唱者 = 用户本人（@图片1 只锁脸）；对口型靠歌词 {} + 逐句秒锁，不送 @音频；
 * 36.0 秒起为吟唱，不对口型；剧情：她掌掴（表演接触）→ 转身离开 → 他雨中流泪 → 伞滑落溅水。
 * 审核用词：出站不出现「打/暴力」字面，掴掌写成表演性动作。
 *   ./node_modules/.bin/tsx probes/mv-face-2p5-prompts-1109.mts > /tmp/mvface-prompts.json
 */
import { compileSegmentPromptDetailed } from "../shared/manhuaPromptCompiler";
import { tryCompileManhuaVideoPromptForOutbound } from "../shared/manhuaOutboundPrompt";
import type { ShotIR } from "../shared/manhuaShotIR";

const BPM = 65;
/** 1109 用户追加：结尾蝴蝶落唇，淡出改 2.0 秒（75.5–77.5）。 */
const BEAT_MS = Math.round(60_000 / BPM);
const f2 = (n: number) => n.toFixed(2);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

type Win = { from: number; to: number; lyric?: string; action: string; camera: string; light: string; mood: string; sfx: string };
type Ref = { tag: string; zh: string };
type Seg = { id: string; songStart: number; songEnd: number; gen: number; refs: { images: Ref[]; videos: Ref[] }; people: string; wins: Win[] };

const MAN = "男歌手（用户本人）";
const COSTUME = "深炭灰羊毛大衣、黑色圆领针织衫、深色长裤；道具为一把透明雨伞";
const WOMAN = "女生（虚构人物，二十多岁，齐肩黑直发，驼色风衣配米白针织衫，不打伞）";

const SEG1: Seg = {
  id: "P1", songStart: 18.2, songEnd: 47.8, gen: 30,
  people: `本段两位人物：${MAN}与${WOMAN}；不新增第三位清晰人物，远处行人只作模糊剪影。`,
  refs: {
    images: [
      { tag: "@图片1", zh: `${MAN}身份参考：只锁脸部骨相、五官、肤色、年龄与短黑侧分发型；不继承其灰底光带背景、闪光粒子与浅色西装，服装按本片设定（${COSTUME}）。` },
      { tag: "@图片2", zh: `${WOMAN}定妆帧：锁她的脸、发型与驼色风衣；不继承其构图与机位。` },
      { tag: "@图片3", zh: "场景图·雨夜玻璃前演唱：锁便利店雨窗、暖橙室内光、冷蓝雨夜与透明伞的光影；只作空间与色调参考。" },
      { tag: "@图片4", zh: "场景图·对峙过肩双人：锁两人相对站位（约一米）、过肩构图与人行道霓虹反光。" },
      { tag: "@图片5", zh: "场景图·情绪决堤一记耳光的瞬间：锁动作完成后的姿态（她的手掠过、他的脸偏转）与橙色轮廓光。" },
      { tag: "@图片6", zh: "场景图·她离去背影、他怔住：锁前景他侧身、远处她背影走远的纵深构图与湿路面反光。" },
    ],
    videos: [
      { tag: "@视频1", zh: "实拍站位参考片（Pexels，已裁）：只继承两人对峙站位、距离与情绪爆发的动作节拍、机位运动；不继承外观、服装与人物。" },
    ],
  },
  wins: [
    { from: 0, to: 6.05, lyric: "难胜数清 气氛清清小院 散散花理",
      action: `${MAN}站在便利店雨窗前，透明伞撑在头顶，望向街对面开口演唱，眉心微蹙、气息沉稳（按@图片3）`,
      camera: "中近景正侧45度，缓慢推近，浅景深", light: "身后橱窗暖橙光勾出轮廓，伞面雨珠映冷蓝与橙色霓虹", mood: "压抑的思念，话到嘴边", sfx: "雨点密集敲打伞面与遮雨棚，远处车流碾水" },
    { from: 6.05, to: 7.8,
      action: "他停住换气，目光越过雨幕；焦点由他拉到街对面——她出现在路口，没有打伞，雨水打湿头发",
      camera: "焦点转移，由前景他的侧脸拉到远处她的身影", light: "远处路口暖橙路灯下她的轮廓，前景冷蓝", mood: "意外与心悸", sfx: "雨声里一辆车驶过溅起水声" },
    { from: 7.8, to: 11.3, lyric: "耳边的一边微风吹着神",
      action: "他望着她继续演唱；她穿过湿漉漉的人行道一步步走近，停在他面前",
      camera: "中景缓慢横移，两人逐渐同框", light: "霓虹在湿地面拉出长倒影，冷暖交错", mood: "靠近又不安", sfx: "她踩过积水的脚步声，雨声" },
    { from: 11.3, to: 14.65, lyric: "一边比的一边变了眼",
      action: "两人相距约一米相对而立（按@图片4与@视频1站位）：他在伞下看着她唱，她仰脸望他，眼眶发红",
      camera: "过肩双人镜，越过她的右肩拍他，缓推", light: "她的湿发边缘被橙光勾亮，他的脸在伞下冷蓝柔光中", mood: "恳求与委屈交织", sfx: "雨水顺伞沿滴落成线的声音" },
    { from: 14.65, to: 17.8, lyric: "离别的朵朵 夹杂着是一半的一切",
      action: "他向她微微倾身唱完这句，伸手想靠近；她嘴唇颤抖、泪水滑落，肩膀起伏，情绪临近决堤",
      camera: "双人近景，缓慢环绕半圈到她的侧面", light: "冷蓝主调，橙色霓虹在两人脸上交替闪过", mood: "张力拉满，下一拍即将爆发", sfx: "雨声加密，远处霓虹灯管轻微电流声" },
    { from: 17.8, to: 20.0,
      action: "她情绪决堤，抬起右手，掌心快速掠过他的左脸颊（戏剧性一记耳光，单次表演接触，无伤害），他的脸随之偏向一侧，湿发甩出一串水珠，透明伞向外倾斜（按@图片5与@视频1节拍）",
      camera: "中近景，镜头随动作轻微一顿后定住，动作常速一次完成、不重复", light: "橙色轮廓光打在两人侧脸，水珠在光里闪", mood: "情绪爆发点，一瞬间的断裂", sfx: "清脆的一声掌面拍击声，紧接雨声" },
    { from: 20.0, to: 23.4,
      action: "他慢慢把脸转回来，怔住不语，伞垂到身侧，雨落在他身上；她看着他最后一秒，咬住嘴唇，转过身去",
      camera: "双人中景固定，焦点停在他的脸上", light: "伞移开后他的脸直接淋雨，冷蓝光为主", mood: "震惊、空白、心碎", sfx: "雨声变大，伞面雨滴声消失" },
    { from: 23.4, to: 26.7,
      action: "她沿着霓虹长街走远，背影越来越小；他在前景侧身站着一动不动（按@图片6）",
      camera: "纵深构图固定机位，前景他的侧影，远处她的背影在焦外", light: "长街两侧橙色招牌倒映在湿路面，雨幕在逆光中发亮", mood: "失去，挽留不了", sfx: "她的脚步声渐远，雨声" },
    { from: 26.7, to: 29.6,
      action: "她的背影没入雨幕与光斑中消失；他仍站在原地，闭口不唱，雨水顺着脸往下流",
      camera: "缓慢推近到他的侧脸近景", light: "冷蓝雨夜，背景橙色光斑虚化", mood: "怔住，情绪下沉", sfx: "只剩雨声与远处车流" },
  ],
};

const SEG2: Seg = {
  id: "P2", songStart: 47.8, songEnd: 77.5, gen: 30,
  people: `本段只有${MAN}一人；不新增第二位清晰人物，远处行人只作模糊剪影。`,
  refs: {
    images: [
      { tag: "@图片1", zh: `${MAN}身份参考：只锁脸部骨相、五官、肤色、年龄与短黑侧分发型；不继承其灰底光带背景、闪光粒子与浅色西装，服装按本片设定（${COSTUME}）。` },
      { tag: "@图片2", zh: "场景图·雨中落泪近景：锁脸上雨水与泪水、橙色轮廓光与冷蓝补光。" },
      { tag: "@图片3", zh: "场景图·透明伞落地溅起水花：锁低机位贴地构图、皇冠状水花与霓虹倒影。" },
      { tag: "@图片4", zh: "场景图·结尾起幅远景（实拍街景重绘）：锁空荡雨夜街景、他独自站立、透明伞倒扣在脚边的构图与霓虹倒影；作 W8 起幅。" },
      { tag: "@图片5", zh: "场景图·结尾落幅面部特写：锁他的脸部特写、泪痕与雨水、半透明蓝紫色蝴蝶停在唇前双翅展开遮住嘴唇的构图；作全段最后落幅。" },
    ],
    videos: [
      { tag: "@视频1", zh: "实拍运镜参考片（Pexels，已裁）：只继承蝴蝶振翅飞行、下降与落定的动作节奏；不继承其背景、颜色与品种外观（蝴蝶按@图片5为半透明蓝紫色）。" },
    ],
  },
  wins: [
    { from: 0, to: 3.7, action: "他独自站在她离开的长街上，透明伞垂在右手身侧，雨水把头发和大衣打湿", camera: "中景，缓慢环绕", light: "冷蓝雨夜，两侧橙色招牌倒影", mood: "空落，孤独", sfx: "大雨声，远处车流" },
    { from: 3.7, to: 7.4, action: "脸部近景：雨水与泪水混在一起顺脸颊流下，眼眶通红，他闭上眼，闭口轻轻哼着，嘴唇几乎不动（按@图片2）", camera: "近景，极缓推近", light: "一侧橙色霓虹轮廓光，一侧冷蓝补光，镜头前有雨丝", mood: "压抑的痛", sfx: "雨点打在脸上和大衣上的细声" },
    { from: 7.4, to: 11.1, action: "他睁开眼，眼睛与湿睫毛特写，一滴泪沿脸颊滑落，与雨水汇合", camera: "大特写，固定微推", light: "瞳孔里映出橙色光斑", mood: "情绪涌上来", sfx: "雨声，心跳般低沉的远处雷声" },
    { from: 11.1, to: 14.8, action: "他低头看向手中的伞，握着伞柄的手指一点点松开", camera: "中近景从脸摇到手", light: "伞面雨珠反射霓虹", mood: "放弃前的迟疑", sfx: "雨水顺伞骨滴落" },
    { from: 14.8, to: 16.84, action: "手部特写：指尖完全张开，伞柄离开掌心", camera: "特写，固定", light: "冷蓝为主，掌心一点橙光", mood: "蓄势，上升前一拍", sfx: "雨声渐强" },
    { from: 16.84, to: 20.94, action: "透明伞像心情一样从他身侧慢动作下落，伞面翻转，雨珠在空中被甩开", camera: "慢动作，机位随伞下落低移到地面", light: "伞面映出橙蓝霓虹，雨珠闪光", mood: "情绪上升到顶点", sfx: "风声与雨声被拉长" },
    { from: 20.94, to: 25.14, action: "伞落在湿沥青上，皇冠状水花慢动作溅起，水珠悬停后落下；背景焦外是他的双腿与空着的手（按@图片3）", camera: "贴地低机位慢动作，水花落下后缓慢上摇到他低垂的脸", light: "水花与积水里的霓虹倒影闪烁，主视觉峰值", mood: "心碎落地", sfx: "伞落地的一声闷响与水花声" },
    { from: 25.14, to: 26.9, action: "起幅远景（按@图片4）：空荡的雨夜街景里他独自低头站立，伞倒扣在脚边；一只半透明蓝紫色蝴蝶从画面上方的夜空穿过雨丝飞入", camera: "远景固定起幅，随蝴蝶入画开始缓慢下移", light: "冷蓝雨幕，蝴蝶翅膀边缘映出暖橙霓虹", mood: "寂静中出现一点微光", sfx: "雨声，极轻的翅膀扑动声" },
    { from: 26.9, to: 29.7, action: "镜头跟随蝴蝶一路下降并推近：蝴蝶穿过雨丝飞到他面前，停在唇前，双翅完全展开遮住他的嘴唇；他脸上泪痕与雨水未干，眼睛半闭不动，画面停成定格感的面部特写（落幅按@图片5），亮度缓慢降低（按@视频1蝴蝶飞行节奏）", camera: "跟随蝴蝶的连续下降推镜，由远景一镜推到面部特写后缓停，不切镜", light: "特写一侧暖橙轮廓光、一侧冷蓝，翅脉清晰透光，整体缓慢变暗", mood: "无声的告别，话被封住", sfx: "雨声渐弱，翅膀扑动声停止" },
  ],
};

function build(seg: Seg) {
  const L = r3(seg.songEnd - seg.songStart);
  const wins = seg.wins.map((w, i) => ({ ...w, label: `${seg.id}-W${i + 1}` }));
  if (Math.abs(wins[wins.length - 1]!.to - L) > 0.01) throw Error(`${seg.id} 末窗 ${wins[wins.length - 1]!.to} ≠ 目标 ${L}`);
  const irs: ShotIR[] = wins.map((w, i) => ({
    index: i + 1,
    durationSec: r3(w.to - w.from),
    sceneZh: i === 0 ? `雨夜城市霓虹街头（人物按${seg.refs.images[0]!.tag}${seg.id === "P1" ? "、@图片2" : ""}，场景按${seg.refs.images.slice(seg.id === "P1" ? 2 : 1).map(r => r.tag).join("、")}）` : "承接前窗，同一空间、同一轴线，不重演已完成的动作",
    actionZh: w.action,
    cameraZh: w.camera,
    lightingZh: w.light,
    moodZh: w.mood,
    sfxZh: w.lyric ? `${w.sfx}；不生成歌声与音乐` : `${w.sfx}；无音乐、无人声`,
    subtitleZh: "字幕关闭",
    labelZh: `${w.label}（歌曲 ${f2(seg.songStart + w.from)}–${f2(seg.songStart + w.to)} 秒${w.lyric ? "，对口型" : "，不对口型"}）`,
    ...(w.lyric ? { microExpressionZh: `对口型：本窗按{}内歌词逐字做唱歌口型，起止与本窗秒位一致，嘴型照字发出，呼吸自然` } : {}),
    ...(w.lyric ? { dialogue: { speakerZh: MAN, emotionZh: "深情演唱，逐字对口型", textZh: w.lyric } } : {}),
  }));
  if (seg.gen - L > 0.001) {
    irs.push({ index: irs.length + 1, durationSec: r3(seg.gen - L), sceneZh: "承接前窗姿态、道具与站位", actionZh: "保持末态，不开始新事件（不入片，供剪辑余量）", cameraZh: "机位缓停", lightingZh: "沿用前窗主光", moodZh: "停在前窗末态", sfxZh: "雨声；无音乐、无人声", subtitleZh: "字幕关闭", labelZh: `${seg.id}尾停（不入片）` } as ShotIR);
  }
  const lipWins = wins.filter(w => w.lyric);
  const header: string[] = [
    `MV高光段 ${seg.id}｜Seedance 2.5 参考生视频｜720p｜9:16｜目标时长 ${f2(seg.gen)} 秒（取用歌曲 ${f2(seg.songStart)}–${f2(seg.songEnd)} 秒，段内 0.00–${f2(L)} 秒入片）；单段一镜到底式连贯叙事，窗内可换景别，不变速`,
    `人物一致性锁：${seg.people}${MAN}按@图片1锁脸部骨相、五官、年龄与发型，全段同一张脸，不改骨相、不改年龄；服装固定为${COSTUME}。${seg.id === "P1" ? `${WOMAN}按@图片2锁脸与服装，全段一致。` : ""}`,
    `标记使用半角：{}只包实际演唱歌词${lipWins.length ? `（本段 ${lipWins.length} 句真歌词由${MAN}逐句对口型，嘴型照字出）` : "（本段为吟唱，无对口型歌词，演唱者闭口或轻哼）"}；<>写环境与事件音效；[]仅写字幕开关。段落标题用普通文字，不把标题当字幕。`,
    "[字幕关闭；不烧录歌词字幕、标题、Logo或水印。]",
    "<环境声：只生成环境/事件音，不生成音乐和人声旋律；事件声只在画面实际发生处触发，无动作不提前响。>",
    "参考绑定表（与提交数组同序）：",
    ...seg.refs.images.map(r => `${r.tag}＝${r.zh}`),
    ...seg.refs.videos.map(r => `${r.tag}＝${r.zh}`),
    `节拍：${BPM} BPM 抒情慢板，1拍约 ${BEAT_MS} 毫秒；按乐句与能量切窗，不逐拍硬切（窗标题括注歌曲绝对秒）。`,
    ...(lipWins.length ? ["演唱秒锁：唱句窗起止取自自动听写版歌词时间表（待确认，未经用户确认），窗界即句界；{}内为听写歌词，逐字对口型；36.00 秒后为吟唱，不对口型。"] : ["本段为吟唱段：演唱者不对口型，以表情与动作表演情绪。"]),
    "逐窗执行正文：",
  ];
  const footer = [`跨窗收束：全段常速动作（标注慢动作的窗除外）；窗与窗之间承接不重演、轴线不越；段内 ${f2(L)} 秒处动作完成${seg.gen - L > 0.001 ? "，其后尾停不入片" : ""}。`];
  const { prompt, issues } = compileSegmentPromptDetailed({ index: 1, durationSec: seg.gen, shots: irs }, "seedance-2.5", undefined, { headerLines: header, footerLines: footer, windowLayout: "block" });
  const text = prompt.replace(/@图(\d+)/g, "@图片$1");
  const out = tryCompileManhuaVideoPromptForOutbound({ prompt: text, engine: "seedance-2.5", durationSec: seg.gen, imageRefCount: seg.refs.images.length, videoRefCount: seg.refs.videos.length, audioRefCount: 0 });
  const banned = /打人|殴|暴力|伤害他|流血|血/.exec(out.text);
  return { id: seg.id, songStart: seg.songStart, songEnd: seg.songEnd, targetSec: L, gen: seg.gen, compiled: text, outbound: out.text, blocked: out.blocked, issues: [...issues, ...out.issues], bannedHit: banned?.[0] ?? null, windows: wins.map(w => ({ label: w.label, from: w.from, to: w.to, songFrom: r3(seg.songStart + w.from), songTo: r3(seg.songStart + w.to), lyric: w.lyric ?? null })) };
}

console.log(JSON.stringify({ bpm: BPM, segments: [build(SEG1), build(SEG2)] }, null, 2));
