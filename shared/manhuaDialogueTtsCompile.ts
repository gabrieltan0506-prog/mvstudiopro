/**
 * 对白配音编译器：导戏卡秒轴 → Qwen TTS 带情绪标签的逐句合成计划。
 *
 * 为什么逐句：30s 段里常有多个说话人，两个系统音色（女 lingxin / 男 lufeng）
 * 必须按句切开各自合成，再由调用方按秒位拼轨；情绪从导戏卡的微表情/动作词
 * 自动推标签（[sad]/[whispers]…），不用人工标注。
 *
 * 标签规则（Qwen-Audio-3.0-TTS-Plus）：控制标签影响后续文本直到下一个标签；
 * 音效标签（[gasp] 等）只在当前位置插入声音——本编译器只产控制标签，
 * 音效留给剪辑备注显式书写（原样透传）。
 *
 * 已知解析限制（第一刀口径，接真实导戏卡前拆内层匹配）：
 * - 每行仅取第一段「说『…』」对白，行内第二段静默丢；
 * - 「说」出现在 @角色N 之前的行不匹配；
 * - 台词内嵌套「」会在内层引号处截断。
 */

export type ManhuaDialogueTtsLine = {
  startSec: number;
  endSec: number;
  /** @角色N */
  speakerTag: string;
  /** 建议音色 id（可被调用方的 voiceByTag 覆盖） */
  voice: string;
  /** 台词原文（一字不差，不带标签） */
  dialogueZh: string;
  /** 推出的情绪标签（0–2 个） */
  emotionTags: string[];
  /** 喂给 TTS 的最终 input：情绪标签 + 台词 */
  input: string;
};

/** 情绪关键词 → Qwen 控制标签（按优先级从上到下，最多取 2 个） */
const EMOTION_RULES: Array<{ re: RegExp; tag: string }> = [
  { re: /哭|泪|眼眶|哽咽/, tag: "[crying]" },
  { re: /悲|伤心|难过|黯然/, tag: "[sad]" },
  { re: /怒|吼|咬牙|狠/, tag: "[angry]" },
  { re: /喊|嘶|大声/, tag: "[shouting]" },
  { re: /惊|愕|瞪|倒吸/, tag: "[amazed]" },
  { re: /慌|急促|失措/, tag: "[panicked]" },
  { re: /颤|发抖|哆嗦/, tag: "[trembling]" },
  { re: /耳语|低声|悄声|贴耳/, tag: "[whispers]" },
  { re: /兴奋|雀跃|欢呼/, tag: "[excited]" },
  { re: /冷笑|讥|讽/, tag: "[sarcastic]" },
  { re: /轻蔑|不屑/, tag: "[scornful]" },
  { re: /好奇|探头|打量/, tag: "[curious]" },
  { re: /疲惫|倦|叹/, tag: "[tired]" },
  { re: /调皮|狡黠|眨眼/, tag: "[mischievously]" },
  { re: /温柔|柔声|安抚/, tag: "[empathetic]" },
  { re: /不情愿|勉强/, tag: "[reluctantly]" },
  { re: /严肃|沉声|正色|郑重/, tag: "[serious]" },
  { re: /缓缓|一字一顿/, tag: "[very slowly]" },
  { re: /连珠|飞快/, tag: "[very fast]" },
];

/** 默认音色轮换：奇数号女声、偶数号男声（正式接入由角色卡性别/voiceByTag 决定） */
const DEFAULT_VOICES = ["longanlingxin", "longanlufeng"] as const;

/** `0–5s：@角色2 抬头，眼眶发红，说「台词」。近景微推。` */
const DIALOGUE_LINE_RE =
  /(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)s[：:｜|]\s*([^\n]*?(@角色\d+)[^\n]*?说\s*「([^」]{1,120})」[^\n]*)/g;

export function inferQwenEmotionTags(contextZh: string): string[] {
  const out: string[] = [];
  for (const rule of EMOTION_RULES) {
    if (rule.re.test(contextZh)) {
      out.push(rule.tag);
      if (out.length >= 2) break;
    }
  }
  return out;
}

export function defaultVoiceForSpeakerTag(speakerTag: string): string {
  const n = Number(speakerTag.match(/\d+/)?.[0] || "1");
  return DEFAULT_VOICES[(n + 1) % DEFAULT_VOICES.length]!;
}

/**
 * 从段成片/导戏 prompt 编译逐句合成计划。
 * 没有对白行时返回空数组（纯动作段不配音）。
 */
export function compileManhuaDialogueTtsPlan(
  prompt: string | null | undefined,
  opts?: { voiceByTag?: Record<string, string> },
): ManhuaDialogueTtsLine[] {
  const raw = String(prompt || "");
  const lines: ManhuaDialogueTtsLine[] = [];
  DIALOGUE_LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DIALOGUE_LINE_RE.exec(raw)) && lines.length < 12) {
    const startSec = Number(m[1]);
    const endSec = Number(m[2]);
    const context = String(m[3] || "");
    const speakerTag = String(m[4] || "");
    const dialogueZh = String(m[5] || "").trim();
    if (!dialogueZh || !Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;
    const emotionTags = inferQwenEmotionTags(context);
    const voice =
      opts?.voiceByTag?.[speakerTag] || defaultVoiceForSpeakerTag(speakerTag);
    lines.push({
      startSec,
      endSec,
      speakerTag,
      voice,
      dialogueZh,
      emotionTags,
      input: `${emotionTags.join("")}${dialogueZh}`,
    });
  }
  return lines;
}

/**
 * 同音色连续句合并成一次调用（省调用次数；跨音色必须分开）。
 *
 * Qwen 控制标签管到下一个标签为止，所以**无标签句不能并进带标签的组**——
 * 否则前句的 [crying] 会一路管到后句。并组条件：后句自带标签（自带即重置），
 * 或该组至今全程无标签。串接时补句号分隔，避免两句被连读成一句。
 */
export function mergeManhuaDialogueTtsLinesByVoice(
  lines: ReadonlyArray<ManhuaDialogueTtsLine>,
): Array<{ voice: string; input: string; startSec: number; endSec: number; speakerTags: string[] }> {
  const out: Array<{ voice: string; input: string; startSec: number; endSec: number; speakerTags: string[] }> = [];
  let lastTags: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const canInherit = line.emotionTags.length > 0 || lastTags.length === 0;
    if (prev && prev.voice === line.voice && canInherit) {
      const needsStop = !/[。！？…—”」]$/.test(prev.input);
      prev.input += (needsStop ? "。" : "") + line.input;
      prev.endSec = line.endSec;
      if (!prev.speakerTags.includes(line.speakerTag)) prev.speakerTags.push(line.speakerTag);
    } else {
      out.push({
        voice: line.voice,
        input: line.input,
        startSec: line.startSec,
        endSec: line.endSec,
        speakerTags: [line.speakerTag],
      });
      lastTags = [];
    }
    if (line.emotionTags.length) lastTags = line.emotionTags;
  }
  return out;
}
