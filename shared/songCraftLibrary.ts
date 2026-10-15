import { SONG_CRAFT_NATIVE } from "./songCraftNative";
/** 只收录可追溯的方法。访谈归纳与原生听音必须区分，音乐/MV转译是应用建议。 */
export type SongCraftReference = {
  id: string;
  title: string;
  contributor: string;
  basis: "interview" | "native_audio";
  highlights: string[];
  lyricPrompt: string;
  stylePrompt: string;
  mvPrompt: string;
  sources: Array<{ title: string; url: string }>;
  evidence?: {
    taskId: string;
    actualModel: string;
    durationSec: number;
    auditNotes: string[];
  };
};
const INTERVIEW_CRAFT: readonly SongCraftReference[] = [
  {
    id: "fang-visual-narrative",
    title: "方文山 · 画面叙事与歌者适配",
    contributor: "方文山",
    basis: "interview",
    highlights: [
      "从人物、处境和具体画面进入情绪，而非堆砌抽象形容词",
      "歌词服务歌者的身份、年龄与表达，音韵需要适合旋律",
    ],
    lyricPrompt:
      "先设定叙述者、对谁说、发生地点和一件有使用痕迹的物品。让物品在主歌、第二段与副歌承担不同关系含义；第二段推进人物行动。用可感知的动作写情绪，避免生硬古语和形容词堆砌。检查语言是否适合设定的歌者，保持唱句自然、韵脚不强扭。只借鉴方法，主题、意象、句子全部原创。",
    stylePrompt:
      "按具体歌词画面选择两种核心音色；主歌保留叙述空间，副歌加宽层次但保持吐字清晰。传统或现代配器由故事决定，不因作者姓名默认中国风。",
    mvPrompt:
      "将核心物件设为视觉母题，先展示日常用途，再通过人物行动改变它的意义；第二次副歌改变物件所在的关系或空间，结尾回收开场构图。不要逐字配图。",
    sources: [
      {
        title: "方文山访谈：歌者、音韵与创作",
        url: "https://freshmusic.sg/2022/10/24/fangwenshan/",
      },
      {
        title: "方文山谈影像与歌词创作",
        url: "https://news.bjd.com.cn/2021/11/23/10008458.shtml",
      },
    ],
  },
  {
    id: "lin-inner-turn",
    title: "林夕 · 内心转折与克制留白",
    contributor: "林夕",
    basis: "interview",
    highlights: [
      "题目需要与实际旋律的情绪贴合",
      "保留感情中的矛盾，通过修订检验语言和旋律的适配",
    ],
    lyricPrompt:
      "先写一句具有内在矛盾的命题，再选一个日常场景验证它。主歌写人物如何自我解释，第二段出现动摇这一解释的新细节，副歌让同一核心句改变理解。保留没有标准答案的感情，不强加励志结论或连续哲理金句；让关键转折由具体动作承载。定稿时修自然语序、发音与乐句衔接。",
    stylePrompt:
      "为唱词保留清晰空间；主歌用较少伴奏，情绪转折时才改变和声张力或配器密度。动态随人物认知变化，不把全曲高音或悲伤钢琴当固定公式。",
    mvPrompt:
      "表面动作与内心意义形成轻微反差；重复同一场景时改变人物选择或视点，让观众重新理解前面的细节。高潮可用一个决定代替大场面，结尾保留可理解的余地。",
    sources: [
      {
        title: "林夕专访：题目、旋律与反复修订",
        url: "https://ent.sina.com.cn/y/2013-09-25/03464014293.shtml",
      },
    ],
  },
  {
    id: "li-lived-speech",
    title: "李宗盛 · 生活经验与沟通",
    contributor: "李宗盛",
    basis: "interview",
    highlights: [
      "从经历与时间带来的认识变化进入创作",
      "创作以沟通为目的；乐器实践能改变和声与作曲选择",
    ],
    lyricPrompt:
      "选择一件当时没想明白、后来才看清的具体往事。以向某个人说话的自然语气展开，写出可辨认的地点、动作和代价；第二段加入现在的认识。避免装成熟、套用人生格言或复制现成名句。让关键句短而直接，长句留真实的呼吸位置。",
    stylePrompt:
      "以贴近说话的乐句组织旋律，伴奏给呼吸与停顿留空间。可用吉他或钢琴建立和声，但只在叙述发生变化时增加层次；音域与力度服务人物，不模仿本人音色。",
    mvPrompt:
      "过去与现在用同一生活细节关联，不用泛化怀旧滤镜代替故事。让人物在熟悉环境里做出不同选择，突出行为的代价与变化。",
    sources: [
      {
        title: "李宗盛谈经历及乐器实践",
        url: "https://www.chinanews.com/yl/2013/11-25/5544164.shtml",
      },
      {
        title: "李宗盛谈创作与沟通",
        url: "https://www.chinanews.com.cn/yl/2014/06-26/6323602.shtml",
      },
    ],
  },
  {
    id: "pattison-prosody",
    title: "Pat Pattison · 词曲共同表达",
    contributor: "Pat Pattison",
    basis: "interview",
    highlights: [
      "词、旋律、和声和节奏共同服务同一个核心情绪",
      "稳定与不稳定可以通过结构、韵脚等形成，不能套固定规则",
    ],
    lyricPrompt:
      "确定当前段落的核心情绪与稳定程度，再使句长、自然重音、韵脚和停顿共同支持它。用具体感官细节建立处境；检查重要词是否落在容易表达的位置。允许不完全押韵表达未解决的张力，避免为整齐牺牲意思。",
    stylePrompt:
      "Align melodic phrasing with natural speech stress; use harmonic tension, rhythmic space and arrangement density to support one emotional intent. Let the chorus resolve or intensify the verse deliberately, with audible breathing room and a clear vocal focus.",
    mvPrompt:
      "景别、运动、色彩和剪辑节奏围绕同一个情绪选择；未解决的段落保留空间与视点张力，情绪释放时再改变画面关系，不逢拍必切。",
    sources: [
      {
        title: "Berklee：Prosody in Music and Songwriting",
        url: "https://online.berklee.edu/takenote/prosody-in-music-and-songwriting/",
      },
      {
        title: "Pat Pattison：Perfect Match",
        url: "https://www.patpattison.com/perfect-match",
      },
    ],
  },
];
export const SONG_CRAFT_LIBRARY: readonly SongCraftReference[] = [
  ...INTERVIEW_CRAFT,
  ...SONG_CRAFT_NATIVE,
];
export function selectedSongCraft(
  ids: readonly string[] = []
): SongCraftReference[] {
  return ids.map(id => {
    const item = SONG_CRAFT_LIBRARY.find(c => c.id === id);
    if (!item) throw new Error("创作方法版本不存在，请重新选择");
    return item;
  });
}
