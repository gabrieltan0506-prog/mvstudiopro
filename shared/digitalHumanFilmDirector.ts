import { z } from "zod";

export const digitalHumanFilmModelSchema = z.enum(["seedance-2.5", "seedance-2.0-mini", "wan-3.0"]);
export type DigitalHumanFilmModel = z.infer<typeof digitalHumanFilmModelSchema>;
export const DIGITAL_HUMAN_FILM_MODELS = {
  "seedance-2.5": { label: "Seedance 2.5 · 720p", resolution: "720p", maxAudioSec: 30, maxImages: 30 },
  "seedance-2.0-mini": { label: "Seedance 2.0 Mini · 480p", resolution: "480p", maxAudioSec: 15, maxImages: 9 },
  "wan-3.0": { label: "Wan 3.0 · 720p", resolution: "720p", maxAudioSec: 15, maxImages: 10 },
} as const;
const text = z.string().max(1200);
export const digitalHumanFilmTargetSchema = z.object({
  id: z.string().uuid(), revision: z.string().min(1).max(100),
  model: digitalHumanFilmModelSchema, aspectRatio: z.enum(["9:16", "16:9"]),
  script: z.string().trim().min(1).max(4000), direction: z.string().max(1500),
  durationSec: z.number().positive().max(1800),
  segments: z.array(z.object({ startSec: z.number().min(0), endSec: z.number().positive() }).strict()).min(1).max(120),
}).strict();
export const digitalHumanFilmPlanSchema = z.object({
  kind: z.literal("digital-human-film"), targetId: z.string().uuid(), revision: z.string().min(1).max(100),
  summary: text,
  shots: z.array(z.object({
    startSec: z.number().min(0), endSec: z.number().positive(), dialogue: z.string().max(4000),
    voiceMode: z.enum(["onscreen", "narration", "silent"]),
    expression: text, performance: text, action: text, camera: text, lighting: text, atmosphere: text,
    soundEffect: text,
  }).strict()).min(1).max(120),
  bgm: z.literal("post"), subtitles: z.literal("off"),
}).strict();
export type DigitalHumanFilmTarget = z.infer<typeof digitalHumanFilmTargetSchema>;
export type DigitalHumanFilmPlan = z.infer<typeof digitalHumanFilmPlanSchema>;
export const digitalHumanFilmStateSchema = z.object({
  target: digitalHumanFilmTargetSchema, plan: digitalHumanFilmPlanSchema, adopted: z.boolean(),
}).strict();

/** 输入修订号只用于过期检测，不作为鉴权或付费幂等键。 */
export function digitalHumanFilmRevision(value: unknown): string {
  const s = JSON.stringify(value); let hash = 2166136261;
  for (let i = 0; i < s.length; i++) hash = Math.imul(hash ^ s.charCodeAt(i), 16777619);
  return `${s.length}-${(hash >>> 0).toString(16)}`;
}
const spoken = (s: string) => s.replace(new RegExp("[\\s\\p{P}\\p{S}]", "gu"), "");
export function parseDigitalHumanFilmPlan(raw: string, target: DigitalHumanFilmTarget): DigitalHumanFilmPlan {
  const plan = digitalHumanFilmPlanSchema.parse(JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")));
  if (plan.targetId !== target.id || plan.revision !== target.revision) throw new Error("导演方案不属于当前制作稿版本");
  if (plan.summary.trim().length < 2) throw new Error("导演方案缺少整体意图");
  let end = 0;
  for (const shot of plan.shots) {
    if (Math.abs(shot.startSec - end) > 0.051 || shot.endSec <= shot.startSec || shot.endSec > target.durationSec + 0.051)
      throw new Error("导演镜头须连续覆盖实际音轨，不得重叠、漏段或超时");
    if (!target.segments.some(s => shot.startSec >= s.startSec - 0.001 && shot.endSec <= s.endSec + 0.001))
      throw new Error("镜头跨越音频分段边界，请在该边界拆镜并保持台词顺序");
    if ((shot.voiceMode === "silent") !== !shot.dialogue.trim()) throw new Error("对白与无声镜头标记不一致");
    if ([shot.expression, shot.performance, shot.action, shot.camera, shot.lighting, shot.atmosphere, shot.soundEffect].some(v => v.trim().length < 2 || /^(待定|待补|TODO|同上)$/i.test(v.trim())))
      throw new Error("导演方案不能用待定或同上代替实际演法");
    for (const detail of [shot.expression, shot.performance, shot.action, shot.camera, shot.lighting, shot.atmosphere, shot.soundEffect]) {
      const times = /(\d+(?:\.\d+)?)\s*(?:[–—~～-]|至|到)\s*(\d+(?:\.\d+)?)\s*秒|(\d+(?:\.\d+)?)\s*秒/g;
      let match: RegExpExecArray | null;
      while ((match = times.exec(detail))) {
        const from = Number(match[1] ?? match[3]), to = Number(match[2] ?? match[3]);
        if (from > to || to > shot.endSec - shot.startSec + 0.051)
          throw new Error("镜内演法时点必须从本镜0秒起算，不能倒序或超出本镜时长");
      }
    }
    end = shot.endSec;
  }
  if (Math.abs(end - target.durationSec) > 0.051) throw new Error("导演方案没有保留音轨尾部");
  if (spoken(plan.shots.map(s => s.dialogue).join("")) !== spoken(target.script)) throw new Error("导演方案删改、遗漏或重复了原文台词");
  return plan;
}

export const DIGITAL_HUMAN_FILM_INSTRUCTIONS = `你是数字人工作台的成片导演，复用漫剧工厂的导演手法，输出可采用的完整逐镜方案。返回JSON对象，answer为以下对象的JSON字符串，不能用说明文字冒充方案：
{kind:"digital-human-film",targetId:目标id,revision:目标revision,summary:"整体导演意图",bgm:"post",subtitles:"off",shots:[{startSec:0,endSec:实际秒数,dialogue:"逐字原文",voiceMode:"onscreen或narration或silent",expression:"眉眼、嘴角、头部朝向及其变化",performance:"意图、情绪、重音词、停顿、声量与克制程度",action:"具体人物和手脚动作、起势接触卸力与收势",camera:"景别、机位、轴线、运动与观看中心",lighting:"主光方位、软硬、肤色与特效局部受光",atmosphere:"空间与情绪氛围如何变化",soundEffect:"触发者、事件、时点与结束；无音效时明确写不加音效"}]}。
镜头startSec/endSec使用整条音轨的绝对时间；表情、演技、动作、运镜、灯光、氛围和音效文字中的秒数全部从该镜开始的0秒起算，不超过该镜时长，禁止混用绝对时间。所有镜头连续覆盖目标实际音轨，不能跨目标segments边界；dialogue拼接必须完整保留script原文，不删句、不编对白。音轨时长是真实数据，逐句时间只是待用户试听核对的建议，不宣称已听过音频。没有音轨不伪造锁秒方案。
对白、BGM、音效、字幕是提示词四标记合同，不是四个API字段。程序按所选引擎编译：Seedance用{对白}、(BGM)、<音效>、[字幕]；Wan用自然语言。BGM本流程后期混音，不送为参考音频、不让视频模型作曲；字幕关闭。旁白期间不强制人物开口，不能把嘴型同步当面部表演。
多段成片须按每段正文任务设计不同的动作逻辑与情绪推进，不得只换颜色重复接弹、挥手或同一机位。以用户当前direction为准；若要求仅第一段接光弹，则其他段用归类、展开、比较等不同动作，不擅自加回接弹。演法必须逐句落实语气、重音、停顿、表情与动作，灯光氛围和运镜服务该段信息；配音演法和画面指令分别描述。
仅在用户本次明确要求光弹的镜头中安排：可多发、各任务颜色一致、透明音波环随光弹传播；逐发交代来源、攻击目标、飞行、接触与去向。接住前短时慢动作，接触后恢复常速，原声音轨不随画面变速。不把用户未要求的光弹强加到其他项目。动作和运镜各自描述，不把全片慢放当戏剧节奏。所有参考、模型与渲染结果未验时不得称通过。`;

/** 四标记编译到实际视频输入，BGM仍仅用于后期，不把素材地址写进正文。 */
export function compileDigitalHumanFilm(plan: DigitalHumanFilmPlan, model: DigitalHumanFilmModel, start = 0, end = Infinity): string {
  const shots = plan.shots.filter(s => s.endSec > start + 0.001 && s.startSec < end - 0.001);
  if (!shots.length || shots.some(s => s.startSec < start - 0.001 || s.endSec > end + 0.001)) throw new Error("导演方案与本段音轨边界不一致，请重新核对方案");
  const wan = model === "wan-3.0";
  return shots.map((s, i) => `镜${i + 1} ${(s.startSec-start).toFixed(1)}–${(s.endSec-start).toFixed(1)}秒（以下细节时点均从本镜0秒起算）\n表情：${s.expression}\n演技：${s.performance}\n动作：${s.action}\n运镜：${s.camera}\n灯光：${s.lighting}\n氛围：${s.atmosphere}\n${s.voiceMode === "silent" ? "无对白，保持闭口。" : `${s.voiceMode === "onscreen" ? "讲述者画内对白，按本段@音频1对口型" : "讲述者旁白，画内人物不随音轨机械张嘴"}：${wan ? `“${s.dialogue}”` : `{${s.dialogue}}`}`}\n${wan ? `音效：${s.soundEffect}` : `<${s.soundEffect}>`}`).join("\n\n") + (wan ? "\n背景音乐：本次不生成，后期添加已选BGM。\n字幕：关闭，不生成文字。" : "\n(BGM：本次不生成，后期添加已选配乐)\n[字幕关闭，不生成文字]");
}
