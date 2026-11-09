/**
 * MV 镜头「秒锁」提示词编译器（1109，用户标准格式 = 知识库《ABC带参数成片提示词》A 段结构）。
 *
 * 内容真源 = MV 创作顾问输出的逐窗节拍（shot.beats：每窗 表情/视线与动作、景别与运镜、灯光与氛围、
 * 情绪与转折、<环境/事件音效>，演唱镜另带对口型与歌词句）。本编译器**只排版**：
 *   头部（模型｜分辨率｜画幅｜目标时长；人物一致性锁；标记约定；[字幕关闭]；<环境声>）
 *   → 参考绑定表（按所选模型的参考标记，与提交数组同序）→ 节拍说明
 *   → 逐窗正文（复用漫剧 compileSegmentPromptDetailed：seedance 方言用 A 段块状版式，H3/Wan 用各自单行方言）
 *   → 尾停窗（生成时长超出分镜时长的部分，不入片）→ 跨窗收束。
 * 旧方案没有逐窗节拍 → 整镜一窗降级（原句原样放入，不做正则拆分），并标 degraded。
 * 纯函数、确定性：同输入同输出；不调用模型。
 */
import type { MvShotReferences } from "./canvasMusicMvReferences";
import { MV_SHOT_SINGING_SOUND_RULE_ZH, MV_SHOT_SOUND_RULE_ZH } from "./canvasMusicMvReferences";
import type { MusicMvBeatGrid, MusicMvLyricLine, MusicMvShotBeat } from "./canvasMusicMv";
import { singingWindowsFromLyricLines } from "./canvasMusicMvBeats";
import { compileSegmentPromptDetailed } from "./manhuaPromptCompiler";
// 叶子模块：不经 ./canvasMusicMvPrevis（其经 guards 绕回本文件会形成 ESM 循环）
import { MV_PREVIS_PROMPT_RULE_ZH, mvPrevisWindowRuleZh } from "./canvasMusicMvPrevisRule";
import { COMPILER_ENGINE_LIMITS, type CompilerEngineId, type ShotIR } from "./manhuaShotIR";
import type { FormatIssue } from "./promptFormatLayer";
import { CANVAS_VIDEO_MODEL_HAILUO_H3, HAILUO_OPENROUTER_DURATION_CHOICES } from "./hailuoOpenRouterModels";

export type MvShotScript = {
  shotId: string;
  /** 歌曲绝对秒。 */
  startSec: number;
  endSec: number;
  visualPrompt: string;
  cameraPrompt: string;
  lyricQuote?: string;
  kind?: "generated" | "singing" | "footage";
  beats?: MusicMvShotBeat[];
  /** 演唱段：歌词时间表里落在本镜的唱句（歌曲绝对秒）；正式出片只收用户确认版。 */
  lyricLines?: MusicMvLyricLine[];
  lyricTiming?: "confirmed" | "unconfirmed";
  /** 尾帧接龙：本镜以上一镜尾帧作起幅（参考图槽 2）。 */
  chainFromPrevious?: boolean;
};

export type MvShotPromptContext = {
  engine: CompilerEngineId;
  /** 头部展示用，如「Seedance 2.0 mini（草稿档）」。 */
  modelLabel: string;
  resolution: string;
  aspectRatio: "9:16" | "16:9";
  /** 实际提交时长（秒，已按所选模型钳制，≥ 分镜时长时超出部分写尾停窗）。 */
  generateDurationSec: number;
  creativePrompt?: string;
  beatGrid?: Pick<MusicMvBeatGrid, "bpm" | "beatSec">;
  references: MvShotReferences;
  /** 演唱者（演唱镜对口型的人，与叙事主角分开锁），如「男歌手」。 */
  performerZh?: string;
  /** 1110 角色表（「名称：外形」逐项）；缺省从 creativePrompt 解析。≥2 人时人物锁放行角色表内多人同框。 */
  castZh?: string[];
  /** 1110 主锚图性质：identity＝身份照（只锁脸，不锁服装与场景）；缺省按 anchorImage.hasRealPerson / 图注判断。 */
  anchorKind?: "identity" | "keyframe";
};

export type MvShotPromptWindow = { fromSec: number; toSec: number; role: "beat" | "whole" | "tail"; label: string; lipSync?: boolean };

export type MvShotTimedPrompt = { text: string; windows: MvShotPromptWindow[]; degraded: boolean; issues: FormatIssue[] };

const f2 = (n: number) => n.toFixed(2);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function protagonistOf(creative?: string) {
  const m = /主角[：:]\s*([^。\n]+)/.exec(creative || "");
  return m ? m[1]!.trim() : "同一位主角";
}

/**
 * 1110 角色表：创作说明里的「角色表：A；B」一行，或逐行「主角/女主/男主/配角/对手/角色N：外形」。
 * 返回「名称：外形」逐项（去重、保序）；没有角色表返回空数组（人物锁按单主角）。
 */
export function mvCastFromCreative(creative?: string): string[] {
  const text = String(creative || "");
  const table = /角色表[：:]\s*([^\n]+)/.exec(text);
  const rows = table
    ? table[1]!.split(/[；;]/).map(x => x.trim())
    : Array.from(text.matchAll(/(?:^|[\n。；;])\s*((?:主角|女主|男主|配角|对手|角色[一二三四五六七八九\d]+)[^：:\n。；;]{0,8}[：:][^。\n；;]+)/g), m => m[1]!.trim());
  const seen = new Set<string>();
  return rows.filter(r => r && !seen.has(r) && (seen.add(r), true)).slice(0, 8);
}

/** 1110 关键事件（身体接触/道具落地/倒地等）：一窗一事件、≥1.5 秒起势、写结束状态。 */
export const MV_KEY_EVENT_RE = /耳光|巴掌|扇[她他人脸]|推倒|推开|推搡|摔[倒碎落]|落地|掉落|掉在|倒地|跌倒|拥抱|抱住|亲吻|吻[她他]|撞[到上倒]|抢过|夺过|泼[水酒]/;
export const MV_KEY_EVENT_WINDOW_RULE_ZH = "关键事件窗：本窗只发生这一件事，不并列其他动作；前至少1.5秒起势（靠近、抬手、蓄力），事件真实发生在画面中，不省略、不提前、不只做准备；末尾停在结束状态并保持到窗尾";
export const MV_LIP_SYNC_WINDOW_RULE_ZH = "对口型窗：本窗一镜到底，不切镜、不跳轴、不换景别；演唱者正脸或微侧（不超过30度）面向镜头，嘴部始终清晰可见；禁止背身、大侧脸、低头遮脸或物体遮挡嘴部";
export const MV_LIGHT_CONTINUITY_RULE_ZH = "光色与天气贯穿：每窗光色/天气承接前窗、只向下一状态渐变（如晴→阴→雨→转亮按顺序推进），不跳变、不回退、不凭空换天气或色温";
/** 1110 白模不削弱既有规则：只定站位与动作时序，对口型正脸、一窗一事件、光色贯穿、人物锁照旧。 */
export const MV_PREVIS_KEEP_RULES_ZH = "白模只定站位、走位与动作时序，不覆盖以下规则：对口型窗仍正脸或微侧对镜、一镜到底不切镜（白模朝向与之冲突时以正脸对镜为准）；关键事件仍一窗一事件；光色与天气仍逐窗贯穿；人物仍只取自人物一致性锁";
/** 关键接触事件：接触瞬间以白模接触帧为准。 */
export const mvPrevisContactRuleZh = (video: string) => `接触瞬间以${video}白模接触帧为准，不提前、不延后`;

/**
 * 白模参考片（@视频N 自身时间轴）与镜内秒的换算：白模按本镜逐窗节拍生成、时长等于本镜，源片第 t 秒＝镜内第 t 秒；
 * 被裁切（trimmedFrom）后，派生片第 q 秒＝源片第 q+入点 秒 → 镜内 t 对应派生片 t−入点；再夹到取用区间 inSec–outSec。
 * 返回 undefined＝本窗不在白模覆盖内。
 */
export function mvPrevisClipRange(v: Pick<MvShotReferences["motionVideos"][number], "inSec" | "outSec" | "trimmedFrom">, fromSec: number, toSec: number) {
  const offset = v.trimmedFrom?.inSec ?? 0;
  const a = r3(Math.max(v.inSec, fromSec - offset));
  const b = r3(Math.min(v.outSec, toSec - offset));
  return b - a > 0.001 ? { fromSec: a, toSec: b } : undefined;
}

/** 各方言的参考标记（seedance 中文标记由出站层转 @imageN；H3/Wan 用各自写法）。 */
function markers(engine: CompilerEngineId) {
  const dialect = COMPILER_ENGINE_LIMITS[engine].dialect;
  if (dialect === "h3") return { image: (n: number) => `Image ${n}`, video: (n: number) => `Video ${n}`, audio: (n: number) => `Audio ${n}` };
  if (dialect === "wan") return { image: (n: number) => `Reference image ${n}`, video: (n: number) => `Reference video ${n}`, audio: (n: number) => `Reference audio ${n}` };
  return { image: (n: number) => `@图片${n}`, video: (n: number) => `@视频${n}`, audio: (n: number) => `@音频${n}` };
}

export function compileMvShotTimedPrompt(shot: MvShotScript, ctx: MvShotPromptContext): MvShotTimedPrompt {
  const L = r3(shot.endSec - shot.startSec);
  if (!(L > 0)) throw new Error("镜头时长无效");
  const gen = ctx.generateDurationSec;
  if (gen + 1e-6 < L) throw new Error(`生成时长 ${gen} 秒短于分镜 ${f2(L)} 秒，请换支持更长时长的模型或拆镜`);
  const profile = COMPILER_ENGINE_LIMITS[ctx.engine];
  const dialect = profile.dialect;
  const mk = markers(ctx.engine);
  const r = ctx.references;
  const singing = shot.kind === "singing";
  const cast = ctx.castZh?.map(c => c.trim()).filter(Boolean).length ? ctx.castZh!.map(c => c.trim()).filter(Boolean) : mvCastFromCreative(ctx.creativePrompt);
  const multiCast = cast.length >= 2;
  const identityAnchor = ctx.anchorKind ? ctx.anchorKind === "identity" : Boolean(r.anchorImage?.hasRealPerson || /身份照|证件照|本人照|真人照|人像照/.test(r.anchorImage?.label || ""));
  // 演唱段不做降级：没有逐窗节拍或没有歌词时间表就不出片
  if (singing && !shot.beats?.length) throw new Error(`演唱镜 ${shot.shotId} 缺少逐窗节拍，请重新出分镜`);
  if (singing && !shot.lyricLines?.length) throw new Error(`演唱镜 ${shot.shotId}：先确认本段歌词，再生成演唱段`);
  const beats = singing ? singingWindowsFromLyricLines({ id: shot.shotId, startSec: shot.startSec, endSec: shot.endSec, kind: "singing" }, shot.beats!, shot.lyricLines!) : shot.beats;
  const degraded = !beats?.length;
  const anchorTag = mk.image(1);
  // 尾帧接龙占图片 2，场景图顺延
  const chainTag = shot.chainFromPrevious ? mk.image(2) : undefined;
  const sceneBase = shot.chainFromPrevious ? 3 : 2;
  const sceneTags = r.sceneImages.map((_, i) => mk.image(i + sceneBase));
  // 1110 白模动作参考：@视频N 的 N = 第一个白模在提交数组中的序号；没有白模时以下全部不写（输出逐字节不变）
  const previsIdx = r.motionVideos.findIndex(v => v.source === "previs");
  const previs = previsIdx >= 0 ? r.motionVideos[previsIdx]! : undefined;
  const previsTag = previs ? mk.video(previsIdx + 1) : undefined;
  const previsOffset = previs?.trimmedFrom?.inSec ?? 0;
  const previsWindowZh = (from: number, to: number) => {
    if (!previs || !previsTag) return "";
    const c = mvPrevisClipRange(previs, from, to);
    return c ? mvPrevisWindowRuleZh(previsTag, c.fromSec, c.toSec) : `本窗超出${previsTag}覆盖范围：站位承接前窗末态，不新增走位`;
  };

  // ── 窗表（镜内相对秒）──
  type Win = MvShotPromptWindow & { ir: Omit<ShotIR, "index" | "durationSec"> };
  const wins: Win[] = [];
  const sceneLine = (first: boolean) =>
    first
      ? `${shot.visualPrompt}（主角按${anchorTag}${chainTag ? `，起幅承接${chainTag}上一镜尾帧` : ""}${sceneTags.length ? `，场景按${sceneTags.join("、")}` : ""}）`
      : "承接前窗，同一空间、同一轴线，不重演已完成的动作";
  // 1110 逐窗版首窗场景行只写空间：人物与动作由人物锁与逐窗动作承担，不把分镜原句（含人物/服装/动作）塞进场景行
  const beatSceneLine = (first: boolean) =>
    first
      ? `空间：${sceneTags.length ? `按${sceneTags.join("、")}的场景空间、地标、光源方向与材质` : `按本镜分镜所在空间（${shot.visualPrompt}）`}${chainTag ? `；起幅承接${chainTag}上一镜尾帧` : ""}；人物外观只按人物一致性锁`
      : sceneLine(false);
  if (degraded) {
    wins.push({
      fromSec: 0, toSec: L, role: "whole", label: `${shot.shotId}整镜`,
      ir: {
        sceneZh: sceneLine(true),
        actionZh: "按本镜分镜一次完成动作，常速、不重演（旧方案未出逐窗节拍，整镜一窗）",
        ...(previsTag ? { microExpressionZh: previsWindowZh(0, L) } : {}),
        cameraZh: shot.cameraPrompt,
        lightingZh: `沿用${anchorTag}${sceneTags[0] ? `与${sceneTags[0]}` : ""}的主光方向与色调，亮度随动作缓变不闪`,
        sfxZh: singing ? `环境声随画面触发；唱段按${mk.audio(1)}原唱复现，不另配伴奏` : "环境声随画面实际发生处触发；无音乐、无人声",
        subtitleZh: "字幕关闭",
        labelZh: `${shot.shotId}整镜（歌曲 ${f2(shot.startSec)}–${f2(shot.endSec)} 秒）`,
        ...(singing ? { microExpressionZh: `对口型：按${mk.audio(1)}本镜唱段逐字对口型，口型、呼吸与原唱同步${previsTag ? `；${previsWindowZh(0, L)}` : ""}` } : {}),
        ...(singing && shot.lyricQuote?.trim() ? { dialogue: { speakerZh: "主角", emotionZh: `对口型演唱，按${mk.audio(1)}原唱逐字`, textZh: shot.lyricQuote.trim() } } : {}),
      },
    });
  } else {
    beats!.forEach((w, i) => {
      const from = r3(w.startSec - shot.startSec);
      const to = r3(w.endSec - shot.startSec);
      const lip = singing && w.lipSync === true;
      const keyEvent = MV_KEY_EVENT_RE.test(w.actionZh);
      const micro = [
        lip ? `对口型：按${mk.audio(1)}本窗唱句逐字对口型，口型、呼吸与原唱同步；${MV_LIP_SYNC_WINDOW_RULE_ZH}` : "",
        keyEvent ? MV_KEY_EVENT_WINDOW_RULE_ZH : "",
        previsTag ? previsWindowZh(from, to) : "",
        previsTag && keyEvent ? mvPrevisContactRuleZh(previsTag) : "",
        dialect === "seedance" ? "" : `灯光与氛围：${w.lightingZh}`,
        dialect === "seedance" ? "" : `情绪与转折：${w.moodZh}`,
      ].filter(Boolean).join("；");
      wins.push({
        fromSec: from, toSec: to, role: "beat", label: `${shot.shotId}-W${i + 1}`, lipSync: lip || undefined,
        ir: {
          sceneZh: beatSceneLine(i === 0),
          actionZh: w.actionZh,
          cameraZh: lip ? `${w.cameraZh}；本窗不切镜，正脸或微侧对镜，禁止背身与大侧脸` : w.cameraZh,
          lightingZh: w.lightingZh,
          moodZh: w.moodZh,
          sfxZh: lip ? `${w.sfxZh}；唱句按${mk.audio(1)}原唱复现，不另配伴奏` : `${w.sfxZh}；无音乐、无人声`,
          subtitleZh: "字幕关闭",
          labelZh: `${shot.shotId}-W${i + 1}（歌曲 ${f2(w.startSec)}–${f2(w.endSec)} 秒${lip ? "，对口型" : ""}）`,
          ...(micro ? { microExpressionZh: micro } : {}),
          // 演唱段歌词按「对白」参数处理：{} 台词语法 + 本窗秒锁（窗即唱句起止）
          ...(lip && w.lyricZh?.trim() ? { dialogue: { speakerZh: "主角", emotionZh: `对口型演唱，按${mk.audio(1)}原唱逐字`, textZh: w.lyricZh.trim() } } : {}),
        },
      });
    });
  }
  if (gen - L > 0.001) {
    wins.push({
      fromSec: L, toSec: gen, role: "tail", label: `${shot.shotId}尾停`,
      ir: {
        sceneZh: "承接前窗姿态、道具与站位，保持轴线与空间地标",
        actionZh: "自然呼吸，不重演刚完成的动作，不开始新事件（不入片，供剪辑余量）",
        cameraZh: "机位缓停",
        lightingZh: "沿用本镜已确认主光，不凭空变色或加特效",
        moodZh: "情绪停在前窗末态",
        sfxZh: "上一事件尾响自然衰减；无音乐、无人声",
        subtitleZh: "字幕关闭",
        labelZh: `${shot.shotId}尾停（不入片）`,
      },
    });
  }
  // 时长精确求和：每窗取相邻边界差，末窗补齐到生成时长
  const irs: ShotIR[] = wins.map((w, i) => {
    const end = i === wins.length - 1 ? gen : wins[i + 1]!.fromSec;
    return { ...w.ir, index: i + 1, durationSec: r3(end - w.fromSec) } as ShotIR;
  });
  const sum = irs.reduce((a, s) => a + s.durationSec, 0);
  irs[irs.length - 1]!.durationSec = r3(irs[irs.length - 1]!.durationSec + (gen - sum));

  // ── 头部 ──
  const header: string[] = [];
  header.push(
    `MV镜头 ${shot.shotId}｜${ctx.modelLabel}｜${ctx.resolution}｜${ctx.aspectRatio}｜目标时长 ${f2(gen)} 秒（取用歌曲 ${f2(shot.startSec)}–${f2(shot.endSec)} 秒，镜内 0.00–${f2(L)} 秒入片）；单镜单段，不拆视频，不变速`,
  );
  header.push(
    singing
      ? `人物一致性锁：本镜是演唱者镜，画面主体是演唱者（${ctx.performerZh || "演唱者"}），只有他/她对口型。按${anchorTag}锁演唱者脸部骨相、年龄、体型与发型；叙事主角不在本镜出现，不让叙事主角对口型；不新增第二位清晰人物。`
      : multiCast
        ? `人物一致性锁（按角色表）：${cast.join("；")}。本镜人物只取自角色表，角色表内人物可按逐窗正文同框、对手戏与肢体接触，不得删去任何一方；${identityAnchor ? `按${anchorTag}只锁${cast[0]!.split(/[：:]/)[0]}的脸部骨相、年龄与发型（身份照：不锁服装、背景与场景）` : `按${anchorTag}锁${cast[0]!.split(/[：:]/)[0]}的脸部骨相、年龄、体型与发型`}，其余角色按角色表外形描述全片一致，彼此不串脸；角色表之外不新增清晰人物，远处人影只作模糊剪影。`
        : identityAnchor
          ? `人物一致性锁：本镜只有同一位主角（${cast[0] ?? protagonistOf(ctx.creativePrompt)}）。按${anchorTag}只锁脸部骨相、年龄与发型（身份照：不锁服装、背景与场景，服装按本镜分镜与场景图）；不新增第二位清晰人物，远处人影只作模糊剪影。`
          : `人物一致性锁：本镜只有同一位主角（${cast[0] ?? protagonistOf(ctx.creativePrompt)}）。按${anchorTag}锁脸部骨相、年龄、体型与发型，不改骨相、不改年龄、不改体型，服装与全片一致；不新增第二位清晰人物，远处人影只作模糊剪影。`,
  );
  header.push(`标记使用半角：{}只包实际台词${singing ? "（本镜演唱歌词按台词处理，逐句对口型）" : "（本镜无台词）"}；<>写环境与事件音效；[]仅写字幕开关。段落标题用普通文字，不把标题当字幕。`);
  header.push("[字幕关闭；不烧录歌词字幕、标题、Logo或水印。]");
  header.push(`<环境声：${(singing ? MV_SHOT_SINGING_SOUND_RULE_ZH.replace(/@音频1/g, mk.audio(1)) : MV_SHOT_SOUND_RULE_ZH)}事件声只在画面实际发生处触发，无动作不提前响。>`);
  header.push("参考绑定表（与提交数组同序）：");
  const lab = (s?: string) => (s ? `（${s}）` : "");
  if (r.anchorImage)
    header.push(
      identityAnchor
        ? `${anchorTag}＝主角身份照${lab(r.anchorImage.label)}，只锁脸部骨相、年龄与发型；不继承其服装、背景、场景、光线、构图与手持物。`
        : `${anchorTag}＝全片主锚图${lab(r.anchorImage.label)}，仅锁主角脸、年龄、体型、服装与全片色调；不继承其构图、背景、机位与手持物。`,
    );
  if (chainTag) header.push(`${chainTag}＝上一镜成片尾帧，作本镜首帧/起幅：开场构图、人物姿态、光线与之无缝衔接，然后按逐窗正文推进；不回放上一镜动作。`);
  r.sceneImages.forEach((img, i) =>
    header.push(`${mk.image(i + sceneBase)}＝本镜场景图${lab(img.label)}，仅锁场景空间、光源方向、材质与色调；不继承其中人物，不从空景生成额外人物。`),
  );
  r.motionVideos.forEach((v, i) =>
    header.push(
      `${mk.video(i + 1)}＝${v.source === "previs" ? "白模站位片" : "运镜参考片"}${lab(v.label)}，取 ${f2(v.inSec)}–${f2(v.outSec)} 秒；只继承站位、景别、机位运动与动作节拍，不继承外观、材质、服装与人物。`,
    ),
  );
  if (previsTag) {
    const lookTags = [r.anchorImage ? anchorTag : "", ...sceneTags].filter(Boolean).join("、") || "人物一致性锁与本镜分镜";
    const rule = MV_PREVIS_PROMPT_RULE_ZH(previsTag, lookTags);
    const same = `${previsTag}第 t 秒＝本镜镜内第 t 秒`;
    // 白模被裁切：派生片第 t 秒＝镜内第 t+入点 秒（逐窗秒点已换算到派生片自身时间轴）
    const cropped = `${previsTag}第 t 秒＝本镜镜内第 t+${f2(previsOffset)} 秒（白模已裁切，入点 ${f2(previsOffset)} 秒，逐窗秒点已换算）`;
    header.push(`${previsOffset > 0.001 ? (rule.includes(same) ? rule.replace(same, cropped) : `${rule}；${cropped}`) : rule}。`);
    header.push(`${MV_PREVIS_KEEP_RULES_ZH}。`);
  }
  if (r.songSlice)
    header.push(
      singing
        ? `${mk.audio(1)}＝本镜歌曲唱段（原歌 ${f2(r.songSlice.startSec)}–${f2(r.songSlice.endSec)} 秒精确时窗；原混音，未做人声分离，只按其中人声对口型）：口型、呼吸与其逐句同步；不进成片音轨，不跟唱、不生成伴奏。`
        : `${mk.audio(1)}＝本镜歌曲切片（原歌 ${f2(r.songSlice.startSec)}–${f2(r.songSlice.endSec)} 秒），仅作节拍卡点参考；不进成片音轨，不跟唱、不生成伴奏或旋律。`,
    );
  if (ctx.beatGrid)
    header.push(
      `节拍：${ctx.beatGrid.bpm} BPM，1拍约 ${Math.round(ctx.beatGrid.beatSec * 1000)} 毫秒；${singing ? "演唱窗按唱句落位，不吸附拍点" : `窗界已落在${mk.audio(1)}拍点上`}（窗标题括注歌曲绝对秒）。`,
    );
  if (!degraded && beats!.some(w => singing && w.lipSync === true)) header.push(`${MV_LIP_SYNC_WINDOW_RULE_ZH}。`);
  if (!degraded && beats!.some(w => MV_KEY_EVENT_RE.test(w.actionZh))) header.push(`${MV_KEY_EVENT_WINDOW_RULE_ZH}。`);
  if (singing) header.push(`演唱秒锁：唱句窗起止取自${shot.lyricTiming === "confirmed" ? "用户确认版" : "自动识别待确认版（未经用户确认）"}本段歌词时间表；{}内为原唱词，逐字对口型。`);
  header.push(degraded ? "整镜执行正文（旧方案未出逐窗节拍）：" : "逐窗执行正文：");

  const footer = [
    `跨窗收束：全镜常速动作；窗与窗之间承接不重演、轴线不越；镜内 ${f2(L)} 秒处动作完成，交给下一镜${gen - L > 0.001 ? "，其后尾停不入片" : ""}。`,
    `${MV_LIGHT_CONTINUITY_RULE_ZH}。`,
  ];
  const { prompt, issues } = compileSegmentPromptDetailed(
    { index: 1, durationSec: gen, shots: irs },
    ctx.engine,
    undefined,
    { headerLines: header, footerLines: footer, windowLayout: dialect === "seedance" ? "block" : "line" },
  );
  return {
    // 与出站编译出口同口径：格式层内部 @图N 还原成官方标记 @图片N（秒位按漫剧口径规范到 0.1 秒）
    text: dialect === "seedance" ? prompt.replace(/@图(\d+)/g, "@图片$1") : prompt,
    windows: wins.map(({ ir: _ir, ...w }) => w),
    degraded,
    issues,
  };
}

/** 模型实出时长有随机短缺（请求 15 秒可能出 14.5/13.5 秒）：请求时长 = 分镜 + 余量，出片后实测再裁回目标，不变速。 */
export const MV_SHOT_DURATION_MARGIN_SEC = 1;

/** MV 镜头请求时长：分镜时长 + 余量向上取整，按所选模型最短/最长秒数钳制（复用漫剧引擎表 COMPILER_ENGINE_LIMITS）。 */
export function mvShotGenerateDurationSec(engine: CompilerEngineId, shotDurationSec: number): number {
  const p = COMPILER_ENGINE_LIMITS[engine];
  const need = Math.ceil(shotDurationSec - 1e-6);
  if (need > p.maxSegmentSec) throw new Error(`本镜 ${shotDurationSec.toFixed(2)} 秒超过所选模型单段上限 ${p.maxSegmentSec} 秒，请换模型或拆镜`);
  const withMargin = Math.ceil(shotDurationSec + MV_SHOT_DURATION_MARGIN_SEC - 1e-6);
  const clamped = Math.max(p.minSegmentSec, Math.min(p.maxSegmentSec, withMargin));
  // H3 画布只开放 5/10/15 秒档（clampHailuoOpenRouterDuration 取最近档）：向上取到不短于需求的档位
  if (engine === CANVAS_VIDEO_MODEL_HAILUO_H3) {
    const choice = HAILUO_OPENROUTER_DURATION_CHOICES.find(c => c >= clamped) ?? HAILUO_OPENROUTER_DURATION_CHOICES[HAILUO_OPENROUTER_DURATION_CHOICES.length - 1]!;
    if (choice < need) throw new Error(`本镜 ${shotDurationSec.toFixed(2)} 秒超过所选模型可用档位，请换模型或拆镜`);
    return choice;
  }
  return clamped;
}
