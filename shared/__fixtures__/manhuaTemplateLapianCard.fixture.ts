/**
 * 脱敏学习卡夹具：按真实整集卡的结构与规模手工构造（参照第 29 集逐帧审片手记：
 * 41:19 片长、8 个学习分片、527 镜、镜长分布 58/211/165/72/13/6/2、39 段音轨、60 个重点时刻、
 * 1 个广告区间已整行剔除）。人物、台词、剧名全部替换为中性描述；字段形状严格按 ManhuaViralTemplateCard。
 * 确定性生成（固定种子），不依赖网络与 GCS。
 */
import type { ManhuaViralTemplateBeat, ManhuaViralTemplateCard } from "../manhuaViralTemplateBank";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const SIZES = ["特写", "近景", "中景", "全景", "大远景", "极特写"];
const ANGLES = ["平视", "仰拍", "俯拍", "过肩", "主观"];
const MOVES = ["固定机位", "缓慢推近", "横摇跟随", "后拉揭示", "手持跟拍", "环摇"];
const LIGHTS = ["侧面暖烛映照半边面颊", "冷蓝月光与火把暖光对冲", "高反差顶光", "逆光剪影", "低照度暖烛光"];
const COMPS = ["人物居画面右三分线，前景烛火虚化", "对称大殿纵深构图", "门框作前景的框式构图", "浅景深聚焦面部", "群像横向排开"];
/** 镜长分布（与审片手记一致），每档取档内一个代表时长。 */
const BUCKETS: Array<[count: number, minLen: number, maxLen: number]> = [
  [58, 0.8, 1.9], [211, 2, 3.9], [165, 4, 5.9], [72, 6, 9.9], [13, 10, 14.9], [6, 15, 29], [2, 30, 40],
];

export const LAPIAN_FIXTURE_DURATION_SEC = 2479;
export const LAPIAN_FIXTURE_SPANS = Array.from({ length: 8 }, (_, i) => ({ startSec: i * 310, endSec: Math.min(LAPIAN_FIXTURE_DURATION_SEC, (i + 1) * 310) }));
/** 已剔除的广告区间（片内绝对秒）。 */
export const LAPIAN_FIXTURE_AD = { startSec: 1240, endSec: 1252 };

export function buildLapianFixtureCard(): ManhuaViralTemplateCard {
  const rand = rng(29);
  const lengths: number[] = [];
  for (const [count, min, max] of BUCKETS) for (let i = 0; i < count; i++) lengths.push(Math.round((min + (max - min) * rand()) * 10) / 10);
  // 打乱顺序（Fisher–Yates，固定种子）
  for (let i = lengths.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [lengths[i], lengths[j]] = [lengths[j]!, lengths[i]!]; }
  const total = lengths.reduce((a, b) => a + b, 0);
  const scale = (LAPIAN_FIXTURE_DURATION_SEC - (LAPIAN_FIXTURE_AD.endSec - LAPIAN_FIXTURE_AD.startSec)) / total;
  const beats: ManhuaViralTemplateBeat[] = [];
  let t = 0;
  lengths.forEach((raw, i) => {
    if (t >= LAPIAN_FIXTURE_AD.startSec && t < LAPIAN_FIXTURE_AD.endSec) t = LAPIAN_FIXTURE_AD.endSec;
    const len = Math.max(0.6, Math.round(raw * scale * 10) / 10);
    const start = Math.round(t * 10) / 10;
    const end = Math.min(LAPIAN_FIXTURE_DURATION_SEC, Math.round((t + len) * 10) / 10);
    const span = Math.min(7, Math.floor(start / 310));
    const brief = i % 3 === 2; // 每三镜一镜是 brief（只有 5 个简写字段）
    const beat: ManhuaViralTemplateBeat = {
      atSec: start,
      endSec: end > start ? end : undefined,
      conflictZh: `第${span + 1}段：权谋对峙→危机升级→情绪爆发`,
      visualZh: `第${i + 1}镜：人物在殿内对峙后转身离去`,
      hintZh: `第${i + 1}镜环境：宫殿内景，烛台与屏风`,
      unitTypeZh: "剪辑镜头",
    };
    if (!brief) Object.assign(beat, {
      shotSizeZh: SIZES[i % SIZES.length], angleZh: ANGLES[i % ANGLES.length],
      compositionZh: COMPS[i % COMPS.length], cameraMoveZh: MOVES[i % MOVES.length],
      blockingZh: "甲居前景背对镜头，乙在纵深处缓步逼近",
      bodyActionZh: "上身前倾，肩颈绷紧", limbPropActionZh: "右手扣住案沿", microExpressionZh: "眉心微蹙，嘴角紧抿",
      gazeBreathZh: "目光锁定对手，呼吸粗重", relationshipReactionZh: "对方冷笑回应", lightingZh: LIGHTS[i % LIGHTS.length],
      transitionInZh: i % 11 === 0 ? "叠化" : "硬切",
    });
    beats.push(beat);
    t = end;
  });
  const audioTrack = Array.from({ length: 39 }, (_, i) => {
    const fromSec = Math.round((i * LAPIAN_FIXTURE_DURATION_SEC) / 39);
    const toSec = Math.round(((i + 1) * LAPIAN_FIXTURE_DURATION_SEC) / 39);
    return {
      fromSec, toSec, emotionArcZh: "压抑转为爆发", toneZh: "低沉冷峻", sfxZh: "脚步、衣袍声", bgmZh: "低频弦乐长音",
      atmosphereZh: "肃杀", silenceZh: i % 4 === 0 ? "关键台词前短暂停顿" : "",
      cues: [{ atSec: fromSec + 5, kind: "sfx" as const, detailZh: "器物落地声" }, { atSec: fromSec + 30, kind: "bgm_in" as const, detailZh: "弦乐进入" }],
    };
  });
  const kinds = ["切镜", "情绪", "灯光", "剧情", "音轨"];
  const evidenceFrames = Array.from({ length: 60 }, (_, i) => ({
    atSec: Math.round(((i + 0.5) * LAPIAN_FIXTURE_DURATION_SEC) / 60),
    kindZh: kinds[i % kinds.length]!, noteZh: `第${i + 1}个重点时刻：人物神情骤变`,
    objectName: `manhua-template-learn/native-frames/fixture/ep029/${i}-${"a".repeat(24)}.jpg`,
    mimeType: "image/jpeg" as const, bytes: 1000 + i, sha256: (i.toString(16).padStart(2, "0")).repeat(32),
  }));
  return {
    id: "tpl_native_fixture29_ep029",
    nameZh: "权谋宫斗·双线反转型",
    laneZh: "悬疑权谋",
    summaryZh: "宫廷权谋与战场双线推进的整集模板",
    hook3sZh: "开篇工笔刺绣片头定下宿命基调",
    beatGrid: beats,
    evidenceFrames,
    reusableZh: "以近景低光与道具推移递进心理博弈；以红黑视觉对照承载心理蜕变。",
    genPromptHintZh: "古装宫廷夜戏，暖烛侧光与冷月对比，浅景深特写微表情。",
    classification: {
      emotionTagsZh: ["肃杀"], narrativeFeatureTagsZh: ["双线并行"], performanceTagsZh: ["冷峻对峙"],
      audiovisualTagsZh: ["明暗光影反差", "框架式构图"], audienceExperienceTagsZh: ["紧张窒息"],
    },
    audioStory: {
      model: "fixture", resolverModel: "fixture", resolverRoute: "fixture", sourceVariants: [] as never,
      hasAudio: true, alignmentMethod: "fixture" as never, durationSec: LAPIAN_FIXTURE_DURATION_SEC, chunkCount: 8,
      audioTrack, mixNotesZh: "对白居中，配乐托底", usage: {} as never,
    } as unknown as ManhuaViralTemplateCard["audioStory"],
    scenePoolHints: ["宫殿"],
    castShape: { leadDesireZh: "夺回主动", pressureZh: "宫廷围困" },
    densityHints: { minBodyChars: 280, minDialogueLines: 12, minLocationHits: 2 },
    sourceRefs: [{ url: "https://example.invalid/source", fetchedAt: "2026-11-01" }],
    status: "approved",
    provenance: {
      nativeVideoDeepRead: {
        model: "fixture", attemptedSegments: 8, successSegments: 8, shotCount: beats.length, droppedCount: 0, truncated: false,
        costCny: 0, completedSegmentIndexes: [0, 1, 2, 3, 4, 5, 6, 7], segmentSpans: LAPIAN_FIXTURE_SPANS,
        sourceDurationSec: LAPIAN_FIXTURE_DURATION_SEC, videoFps: 2, assemblyComplete: true, sourceDigest: "d".repeat(64),
      },
    },
  };
}
