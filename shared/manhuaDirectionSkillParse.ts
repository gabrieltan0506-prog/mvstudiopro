/**
 * 从蒸馏产物 SKILL.md 解析导演卡（导演包接线 P1）。
 * 八位导演的 SKILL.md 格式不完全一致（Nolan 用 `#### ID｜标题` + **规律一句**；吴宇森用 `**ID｜标题。**` + 规律：），
 * 这里只认「编号｜标题」＋ 规律/失效条件 两类标签，认不出的整段跳过，不猜。
 * 标题带【单片观察】【案例比较】【观察候选】【待深蒸】【非正式规律】的一律 research_only。
 */
import type { ManhuaDirectionCard, ManhuaDirectionRule, ManhuaDirectionRuleStatus } from "./manhuaDirectionCanon.js";
import type { ManhuaDirectorStrategyStage } from "./manhuaDirectorStrategy.js";

const NON_FORMAL_RE = /【[^】]*(单片观察|案例比较|观察候选|待深蒸|非正式规律)[^】]*】/;
/** `#### CN-DM-02｜标题` / `**HSCS-001｜标题。**` / `### AB-C-01｜标题` / `**AAD-001＋AAD-002｜标题**` */
const RULE_HEAD_RE = /^(?:#{3,4}\s*|\*\*)([A-Z]{2,6}-(?:[A-Z]{1,2}-)?\d{2,3}(?:\s*[＋+]\s*[A-Z]{2,6}-\d{2,3})?)\s*[｜|]\s*(.+?)\*{0,2}\s*$/;
/** 林诣彬式：`**规律 \`KE-01-character-pov-before-scale\`**：正文` / `**规律 \`KE-03-…\` 的调度应用**：正文` */
const RULE_INLINE_RE = /^\*\*规律\s*`([A-Z]{1,6}-\d{2}[a-z0-9-]*)`\s*([^*]*)\*\*\s*[：:]\s*(.+)$/;
const LABEL_RE = /^-?\s*\**\s*(规律一句|一句规律|规律|收窄规则|为什么|预测句|预测|可预测新选择|失效条件|失败条件|内部溯源|证据编号|证据|内部依据|稳定替代|模型不能做|原手法|状态)\s*\**\s*[：:]\s*(.+)$/;

function stripName(s: string): string {
  return s.replace(/\*\*/g, "").trim();
}

/** 卡内编号前缀 → 阶段：DM 决策模型进剧本+分镜；PT 手法卡按主题；AI 转译进关键帧/视频 */
function stagesFor(id: string, titleZh: string): ManhuaDirectorStrategyStage[] {
  const t = titleZh;
  if (/-AI-/.test(id)) return /关键帧|构图终态/.test(t) ? ["keyframe"] : ["clip"];
  if (/-PT-/.test(id)) {
    if (/构图/.test(t)) return ["storyboard", "keyframe"];
    if (/景别|机位/.test(t)) return ["storyboard"];
    if (/运镜|剪辑|节奏/.test(t)) return ["clip"];
    if (/灯光|色调|材质/.test(t)) return ["keyframe"];
    if (/表演|群像|调度/.test(t)) return ["clip", "storyboard"];
    if (/声音|静默/.test(t)) return ["clip"];
    if (/适用场景/.test(t)) return ["story"];
    return ["storyboard"];
  }
  // 真人片场流程（排练/协作/工作过程/演员沟通）对 AI 生成没有可执行含义：不投影到任何阶段
  if (/排练|协作|工作过程|按演员|演员所需|沟通/.test(t)) return [];
  // 决策模型（DM / 三位数编号）：戏核/信息策略→剧本；调度/切与停→分镜+视频；取舍→剧本
  if (/切点|切与停|剪辑|并行|覆盖|节奏|伸缩时间|慢动作|运镜|微动作/.test(t)) return ["storyboard", "clip"];
  if (/调度|排练|表演|演员|群像/.test(t)) return ["storyboard", "clip"];
  if (/信息|戏核|情感|关系|代价|目标|感知位置|发现|人物任务|人物/.test(t)) return ["story", "storyboard"];
  if (/机位|布景|空间|世界/.test(t)) return ["storyboard", "keyframe"];
  return ["story", "storyboard"];
}

function splitIds(s: string): string[] {
  return s
    .replace(/`/g, "")
    .replace(/[。]+$/g, "")
    .split(/[；;、，,。\s]+/)
    .map((x) => x.trim())
    .filter((x) => /^[A-Z0-9][A-Z0-9/.,–-]{1,}$/i.test(x));
}

export type ParsedDirectionSkill = { card: ManhuaDirectionCard; skipped: string[] };

export function parseManhuaDirectionSkillMarkdown(md: string, opts?: { slug?: string; version?: string }): ParsedDirectionSkill {
  const lines = String(md || "").replace(/\r/g, "").split("\n");
  const skipped: string[] = [];
  const cardIdRaw = (md.match(/卡片\s*ID\**\s*[：:]\s*`?([a-z0-9_]+)`?/i)?.[1] || "").trim();
  const personName = (md.match(/^#\s+(.+?)\s*[·・]\s*决策模型/m)?.[1] || md.match(/^name:\s*(.+)$/m)?.[1] || "").trim();
  const tier: ManhuaDirectionCard["tier"] = /蒸馏档位[：:]\s*深度/.test(md) ? "deep" : "standard";
  const rules: ManhuaDirectionRule[] = [];
  const avoidZh: string[] = [];

  let cur: (Partial<ManhuaDirectionRule> & { id: string; titleZh: string; nonFormal: boolean }) | null = null;
  let inAvoid = false;
  const seenIds = new Map<string, number>();
  const uniqueId = (id: string) => {
    const clean = id.replace(/\s+/g, "");
    const n = (seenIds.get(clean) || 0) + 1;
    seenIds.set(clean, n);
    return n === 1 ? clean : `${clean}#${n}`;
  };
  const flush = () => {
    if (!cur) return;
    const ruleZh = String(cur.ruleZh || "").trim();
    if (!ruleZh) {
      skipped.push(`${cur.id}（无规律句）`);
    } else {
      const status: ManhuaDirectionRuleStatus = cur.nonFormal ? "research_only" : cur.failZh ? "verified" : "conditional";
      rules.push({
        id: cur.id,
        titleZh: cur.titleZh,
        ruleZh,
        whyZh: cur.whyZh,
        predictZh: cur.predictZh,
        failZh: cur.failZh,
        status,
        stages: stagesFor(cur.id, cur.titleZh),
        sourceIds: cur.sourceIds,
      });
    }
    cur = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^##\s/.test(line)) {
      flush();
      inAvoid = /明确反对|反对的拍法/.test(line);
      if (/待深蒸清单|运行检查/.test(line)) break;
      continue;
    }
    const head = line.match(RULE_HEAD_RE);
    if (head) {
      flush();
      inAvoid = false;
      const titleRaw = stripName(head[2]).replace(/[。.]\s*$/, "");
      cur = { id: uniqueId(head[1]), titleZh: titleRaw.replace(NON_FORMAL_RE, "").trim(), nonFormal: NON_FORMAL_RE.test(titleRaw) };
      continue;
    }
    const inline = line.match(RULE_INLINE_RE);
    if (inline) {
      flush();
      inAvoid = false;
      const suffix = inline[2].trim();
      // 林诣彬式规律没有中文标题：用「的调度应用」这类后缀，否则取规律首句（≤30 字）当标题，不让英文 id 直出到 UI/提示词
      const ruleText = stripName(inline[3]);
      // 先按句号再按逗号/顿号切子句，取第一子句当标题，不在半句中间硬截
      const firstClause = (ruleText.split(/[。；;]/)[0] || "").split(/[，、,]/)[0]?.trim() || "";
      const title = firstClause.length > 30 ? `${firstClause.slice(0, 30)}…` : firstClause;
      cur = { id: uniqueId(inline[1]), titleZh: suffix ? `${title}${suffix.replace(/^的/, "·")}` : title || inline[1], nonFormal: false, ruleZh: ruleText };
      continue;
    }
    if (/^###\s/.test(line)) {
      // 分节标题（如 ### 6. 明确反对的拍法）
      flush();
      inAvoid = /明确反对|反对的拍法/.test(line);
      continue;
    }
    if (inAvoid && /^-\s+/.test(line)) {
      avoidZh.push(stripName(line.replace(/^-\s+/, "")).replace(/内部溯源.*$/, "").trim());
      continue;
    }
    // 手法卡行：- **构图语法｜CN-PT-01**：正文 内部依据：CN-DM-02
    const pt = line.match(/^-\s*\*\*(.+?)\s*[｜|]\s*([A-Z]{2,6}-PT-\d{2})\*\*\s*[：:]\s*(.+)$/);
    if (pt) {
      flush();
      const body = pt[3].trim();
      const nonFormal = NON_FORMAL_RE.test(body);
      const src = body.match(/内部依据[：:]\s*(.+)$/)?.[1];
      cur = { id: uniqueId(pt[2]), titleZh: pt[1].trim(), nonFormal, ruleZh: body.replace(/内部依据[：:].*$/, "").replace(NON_FORMAL_RE, "").trim(), sourceIds: src ? splitIds(src) : undefined };
      flush();
      continue;
    }
    if (!cur) continue;
    const lab = line.match(LABEL_RE);
    if (lab) {
      const v = stripName(lab[2]);
      switch (lab[1]) {
        case "规律一句":
        case "一句规律":
        case "规律":
        case "收窄规则":
          cur.ruleZh = v; break;
        case "可预测新选择":
          cur.predictZh = v; break;
        case "失败条件":
          cur.failZh = v; break;
        case "证据":
          cur.sourceIds = splitIds(v); break;
        case "状态":
          if (/pending|待深蒸|fail/i.test(v)) cur.nonFormal = true;
          break;
        case "稳定替代":
          cur.ruleZh = cur.ruleZh || v; break;
        case "为什么":
          cur.whyZh = v; break;
        case "预测句":
        case "预测":
          cur.predictZh = v; break;
        case "失效条件":
          cur.failZh = v; break;
        case "内部溯源":
        case "证据编号":
        case "内部依据":
          cur.sourceIds = splitIds(v); break;
        default:
          break;
      }
      continue;
    }
    // 正文里出现降级标记（如「独立审计结论：降级为【待深蒸】」）→ 整条 research_only
    if (NON_FORMAL_RE.test(line)) cur.nonFormal = true;
    // 无标签的正文行：非正式规律的说明段
    if (cur.nonFormal && !cur.ruleZh) cur.ruleZh = stripName(line.replace(/^-\s+/, ""));
  }
  flush();

  const cardId = cardIdRaw || (opts?.slug || "card").replace(/-/g, "_");
  const labelZh = rules.find((r) => r.status !== "research_only")?.titleZh || cardId;
  return {
    card: {
      id: cardId,
      labelZh,
      tier,
      version: opts?.version || `${tier}-1`,
      internal: { personName: personName || undefined, slug: opts?.slug },
      rules,
      avoidZh: avoidZh.length ? avoidZh : undefined,
    },
    skipped,
  };
}
