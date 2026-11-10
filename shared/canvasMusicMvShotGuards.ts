/**
 * MV 镜头付费出片前的两道硬闸（#1769 审查 #3 / #5），客户端出片路径与服务端两条 Seedance 路线共用：
 *
 * 1. 角色表 × 多人互动：人物锁按镜头节点 castZh 生成（ced07acd），≤1 人时退回单人锁
 *    「不新增第二位清晰人物」——逐窗写了耳光/拥抱等两人戏时模型会把对手删掉，付费成片静默丢关键事件。
 *    检测到多人互动而角色表 ≤1 人即拦截（正则 + 关键词，宁可多拦），不提交、不扣费。
 * 2. 参考要求：MV 镜头必须 reference_to_video，至少 1 张图（主锚/场景）且参考总数 ≥2（覆盖场景/动作/卡点）。
 */
import {
  MV_KEY_EVENT_WINDOW_RULE_ZH,
  MV_LIGHT_CONTINUITY_RULE_ZH,
  MV_LIP_SYNC_WINDOW_RULE_ZH,
} from "./canvasMusicMvShotPrompt";

export const MV_SHOT_CAST_CONFLICT_ERROR_ZH =
  "检测到多人互动但角色表只有一人，请在创作说明里写『角色表：…』或重建镜头节点。本次未提交、未扣费。";

/** 编译器自带的固定句（规则、字段标题），不代表剧情，检测前剔除，免得规则原文自己触发。 */
const MV_SHOT_BOILERPLATE_ZH = [
  MV_KEY_EVENT_WINDOW_RULE_ZH,
  MV_LIP_SYNC_WINDOW_RULE_ZH,
  MV_LIGHT_CONTINUITY_RULE_ZH,
  "人物外观只按人物一致性锁",
  "承接前窗，同一空间、同一轴线，不重演已完成的动作",
  "本窗不切镜，正脸或微侧对镜，禁止背身与大侧脸",
  "人物、视线与动作",
];

/** 「其他/吉他/其它」里的「他」不是人称。 */
const NON_PERSON_TA_RE = /其他|其它|吉他|他乡|他处|他日|他方/g;
const FEMALE_RE = /她(?!们)|女主|女孩|女生|女人|少女|姑娘|女友|女朋友|妻子|老婆|母亲|妈妈|姐姐|妹妹|奶奶|外婆/;
const MALE_RE = /他(?!们)|男主|男孩|男生|男人|少年|小伙|男友|男朋友|丈夫|老公|父亲|爸爸|哥哥|弟弟|爷爷|外公/;
/** 复数/相互指代：本身即两人以上。 */
const PLURAL_RE = /她们|他们|两人|二人|双人|俩人|两个人|三人|几人|众人|彼此|对方|互相|相互|双方|一同|面对面|四目相对|并肩|肩并肩|手牵手/;
/** 接触/对手戏动词（打/掌/抱/拉/推/对视等，取复合词避开「推近/拉远/打伞/推开门」这类单人或运镜用法）。 */
const CONTACT_RE =
  /耳光|巴掌|掌掴|扇[她他人脸耳]|一掌|打[她他人脸]|殴打|厮打|扭打|打斗|对打|搏斗|拥抱|相拥|抱住(?!自己|膝|双膝|吉他|双臂|胳膊)|抱紧(?!自己|膝|双膝|吉他|双臂)|抱起[她他]|搂|亲吻|接吻|吻[她他住上]|拉住|拉起[她他]|拉着[她他]|拽住|拉[她他]|牵[手她他起着住]|推[她他]|推倒|推搡|推开(?![门窗帘柜抽箱])|对视|相视|握手|掐住|揪住|抓住[她他]|扶[住起她他]|搀|踢[她他]|撞[她他]|依偎|靠在[她他]|喂[她他]|递给[她他]|拦住[她他]|追[她他]|追赶|扑向|扑进|跪向|吵架|争吵|对峙|对骂/;
/** 剧情里第二个角色的称谓（关系词本身就是另一个人）。 */
const SECOND_ROLE_RE =
  /男友|女友|男朋友|女朋友|丈夫|妻子|老公|老婆|恋人|爱人|前任|情敌|闺蜜|对手|反派|配角|另一人|另一个人|陌生人|路人甲|母亲|父亲|妈妈|爸爸|角色[二三四五六七八九2-9]/;

function stripBoilerplate(text: string): string {
  let out = String(text || "");
  for (const b of MV_SHOT_BOILERPLATE_ZH) out = out.split(b).join(" ");
  return out.replace(NON_PERSON_TA_RE, " ");
}

/** 返回命中的多人互动线索（空数组＝未检出）。 */
export function mvShotMultiPersonCues(texts: ReadonlyArray<string | undefined | null>): string[] {
  const text = stripBoilerplate(texts.filter(Boolean).join("\n"));
  const cues: string[] = [];
  const contact = CONTACT_RE.exec(text);
  if (contact) cues.push(`接触/对手戏：${contact[0]}`);
  const plural = PLURAL_RE.exec(text);
  if (plural) cues.push(`多人指代：${plural[0]}`);
  const female = FEMALE_RE.exec(text);
  const male = MALE_RE.exec(text);
  if (female && male) cues.push(`男女同现：${female[0]}/${male[0]}`);
  const role = SECOND_ROLE_RE.exec(text);
  if (role) cues.push(`第二角色：${role[0]}`);
  return cues;
}

export type MvShotGuardResult = { ok: true } | { ok: false; error: string; cues?: string[] };

/**
 * 客户端出片前：叙事镜（非演唱镜）逐窗节拍/剧情文字检出多人互动而 castZh ≤1 人 → 拦截。
 * 演唱镜人物锁固定为演唱者单人（不按角色表），不在此闸范围。
 */
export function checkMvShotCastInteraction(input: {
  kind?: string;
  castZh?: ReadonlyArray<string> | null;
  texts: ReadonlyArray<string | undefined | null>;
}): MvShotGuardResult {
  if (input.kind === "singing") return { ok: true };
  const cast = (input.castZh || []).map(c => String(c || "").trim()).filter(Boolean);
  if (cast.length >= 2) return { ok: true };
  const cues = mvShotMultiPersonCues(input.texts);
  return cues.length ? { ok: false, error: MV_SHOT_CAST_CONFLICT_ERROR_ZH, cues } : { ok: true };
}

/** 秒锁编译产出的单人锁 / 角色表锁 / 演唱者锁标记（见 compileMvShotTimedPrompt 人物一致性锁）。 */
const SINGLE_LOCK_RE = /人物一致性锁：本镜只有同一位主角/;
const CAST_LOCK_RE = /人物一致性锁（按角色表）/;
const SINGER_LOCK_RE = /人物一致性锁：本镜是演唱者镜/;

/**
 * 服务端收到 mvShot 时：从实际出站提示词判断人物锁人数，再对正文查多人互动。
 * - 角色表锁（≥2 人）或演唱者锁：放行；
 * - 单人锁，或提示词里找不到人物锁（无法确认角色表，宁可多拦）：正文检出多人互动即拦截。
 * 正文取「执行正文」之后、「跨窗收束」之前；找不到正文标记时查整段去掉人物锁那一行后的内容。
 */
export function checkMvShotPromptCastInteraction(prompt: string): MvShotGuardResult {
  const text = String(prompt || "");
  if (CAST_LOCK_RE.test(text) || SINGER_LOCK_RE.test(text)) return { ok: true };
  const bodyAt = text.lastIndexOf("执行正文");
  let body = bodyAt >= 0 ? text.slice(bodyAt) : text;
  const footerAt = body.indexOf("跨窗收束");
  if (footerAt >= 0) body = body.slice(0, footerAt);
  if (bodyAt < 0) body = body.replace(/人物一致性锁[^\n]*/g, " ");
  const cues = mvShotMultiPersonCues([body]);
  return cues.length ? { ok: false, error: MV_SHOT_CAST_CONFLICT_ERROR_ZH, cues } : { ok: true };
}

export const MV_SHOT_MODE_ERROR_ZH = "MV 镜头必须以参考素材生成（多参考生视频），本次未提交、未扣费";
export const MV_SHOT_REFERENCE_ERROR_ZH =
  "MV 镜头参考不足：至少需要 1 张主锚图或场景图，且参考总数不少于 2（覆盖场景、动作与卡点）。请先为本镜选主锚图、场景图/参考片与歌曲切片，本次未提交、未扣费";

/** 两条 Seedance 路线共用的 MV 镜头参考要求：reference_to_video + ≥1 张图 + 总参考 ≥2。 */
export function checkMvShotReferenceRequirement(input: {
  mode: string | undefined | null;
  imageCount: number;
  videoCount: number;
  audioCount: number;
}): MvShotGuardResult {
  if (input.mode !== "reference_to_video") return { ok: false, error: MV_SHOT_MODE_ERROR_ZH };
  const n = (x: number) => (Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
  const image = n(input.imageCount);
  const total = image + n(input.videoCount) + n(input.audioCount);
  if (image < 1 || total < 2) return { ok: false, error: MV_SHOT_REFERENCE_ERROR_ZH };
  return { ok: true };
}
