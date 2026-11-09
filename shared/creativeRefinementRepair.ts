import { creativeEvidenceReviewSchema } from "./creativeEvidenceReview";
import { repairJsonShape, type ShapeFix } from "./creativeProposalRepair";

/**
 * 联合创作（refine）回包 {proposal,review,changesZh} 在合同校验前的确定性修复。
 * 依据 2026-11-09 PR#1766 探针 6 次 refine 原始输出（GLM×4、DeepSeek×2）的四类写坏：
 *  (a) 模型把 proposal.sections 改回 sourceEvidence 原文（emotion.visualZh 去掉了初稿的「画面建议」）→ 回填初稿 sections 并记录差异；
 *  (b) 重写时只回了 review 根对象（verdict/findings/…）没有 proposal/changesZh 包裹 → 以初稿为 proposal 包成 envelope；
 *  (c) changesZh / review.limitationsZh 缺失或写成字符串 → 字符串包数组、缺失补确定性默认值；
 *  (d) evidencePaths 漏中间层（/candidate/sections/0/visualZh）或引用不存在的键（/candidate/unsections）→ 归一到真实路径或最近合法祖先。
 * 只动形状、包裹与路径，不编造审阅观点；每处修复都返回记录，由调用方落永久证据。
 */

export type RefinementFix = {
  path: string;
  code: string;
  before: unknown;
  after: unknown;
  reasonZh: string;
};

export const REFINE_DEFAULT_LIMITATION_ZH = "本次为创作结果审阅，依据已保存的音画分析；尚未人工验收";
export const REFINE_CHANGES_KEPT_ZH = "原稿保留（模型未给出修改说明，服务端比对确认 proposal 与初稿一致）";
export const REFINE_CHANGES_UNEXPLAINED_ZH = "模型修改了方案但未给出修改说明（服务端比对发现 proposal 与初稿不同，差异见 proposal 本身）";

const REVIEW_KEYS = ["verdict", "summaryZh", "findings", "mediaReview", "inspirationZh", "limitationsZh"] as const;
const PROPOSAL_ALIASES = ["revisedProposal", "finalProposal", "candidate", "draft", "result"] as const;
const CHANGES_ALIASES = ["changes", "changesZH", "revisionsZh", "revisions", "changeLogZh", "changeLog", "modificationsZh"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const stableStringify = (value: unknown) => JSON.stringify(value);

function looksLikeReview(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return "verdict" in value && ("findings" in value || "summaryZh" in value) && !("proposal" in value);
}

/**
 * 根对象修复：review-only 根对象包成 envelope；proposal / changesZh 别名改名；changesZh 字符串包数组、缺失补默认值。
 * 不修 review 内部（见 repairReviewObject）。
 */
export function repairRefinementEnvelope(decoded: unknown, candidate: unknown): { value: unknown; fixes: RefinementFix[] } {
  const fixes: RefinementFix[] = [];
  if (!isRecord(decoded)) return { value: decoded, fixes };
  let root: Record<string, unknown> = structuredClone(decoded);
  if (looksLikeReview(root)) {
    const review: Record<string, unknown> = {};
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(root)) {
      if ((REVIEW_KEYS as readonly string[]).includes(key)) review[key] = value;
      else rest[key] = value;
    }
    const changes = pickChanges(rest);
    root = { proposal: structuredClone(candidate), review, ...(changes ? { changesZh: changes.value } : {}) };
    fixes.push({ path: "$", code: "review_only_root", before: Object.keys(decoded), after: Object.keys(root), reasonZh: "模型只回传审阅根对象，未包 proposal；以初稿为 proposal 包成 {proposal,review,changesZh}" });
  }
  if (!("proposal" in root)) {
    for (const alias of PROPOSAL_ALIASES) {
      if (alias in root && isRecord(root[alias])) {
        root.proposal = root[alias];
        delete root[alias];
        fixes.push({ path: `$.${alias}`, code: "proposal_alias", before: alias, after: "proposal", reasonZh: `方案键 ${alias} 改名为 proposal` });
        break;
      }
    }
  }
  if (!("changesZh" in root)) {
    const picked = pickChanges(root);
    if (picked) {
      root.changesZh = picked.value;
      delete root[picked.key];
      fixes.push({ path: `$.${picked.key}`, code: "changes_alias", before: picked.key, after: "changesZh", reasonZh: `修改说明键 ${picked.key} 改名为 changesZh` });
    }
  }
  if (typeof root.changesZh === "string") {
    const text = root.changesZh.trim();
    fixes.push({ path: "$.changesZh", code: "changes_string", before: root.changesZh, after: text ? [text] : undefined, reasonZh: "修改说明字符串包成单元素数组" });
    root.changesZh = text ? [text] : undefined;
  }
  if (Array.isArray(root.changesZh)) {
    const cleaned = root.changesZh.filter((row): row is string => typeof row === "string" && row.trim().length > 0).map(row => row.trim());
    if (cleaned.length !== root.changesZh.length) {
      fixes.push({ path: "$.changesZh", code: "changes_filtered", before: root.changesZh, after: cleaned, reasonZh: "修改说明中的空项/非文本项已去除" });
      root.changesZh = cleaned;
    }
  }
  if (!Array.isArray(root.changesZh) || !root.changesZh.length) {
    const same = stableStringify(root.proposal) === stableStringify(candidate);
    const after = [same ? REFINE_CHANGES_KEPT_ZH : REFINE_CHANGES_UNEXPLAINED_ZH];
    fixes.push({ path: "$.changesZh", code: "changes_missing", before: root.changesZh, after, reasonZh: same ? "修改说明缺失，比对初稿一致，补「原稿保留」" : "修改说明缺失，比对初稿不一致，补「未说明的修改」" });
    root.changesZh = after;
  }
  return { value: root, fixes };
}

function pickChanges(root: Record<string, unknown>): { key: string; value: unknown } | undefined {
  for (const alias of CHANGES_ALIASES) if (alias in root) return { key: alias, value: root[alias] };
  return undefined;
}

/**
 * review 对象修复：先走 zod 驱动的形状修复（字符串→数组、别名键），再补 limitationsZh 默认值，最后归一 evidencePaths。
 * `pointerRoot` 是审阅路径的解析根（{...input, candidate: proposal}）。
 */
export function repairReviewObject(review: unknown, pointerRoot: unknown): { value: unknown; fixes: RefinementFix[] } {
  const fixes: RefinementFix[] = [];
  if (!isRecord(review)) return { value: review, fixes };
  let current: Record<string, unknown> = structuredClone(review);
  if (typeof current.limitationsZh === "string" && current.limitationsZh.trim()) {
    fixes.push({ path: "review.limitationsZh", code: "string_to_array", before: current.limitationsZh, after: [current.limitationsZh.trim()], reasonZh: "局限字符串包成单元素数组" });
    current.limitationsZh = [current.limitationsZh.trim()];
  }
  if (!Array.isArray(current.limitationsZh) || !current.limitationsZh.filter(row => typeof row === "string" && row.trim()).length) {
    fixes.push({ path: "review.limitationsZh", code: "limitations_missing", before: current.limitationsZh, after: [REFINE_DEFAULT_LIMITATION_ZH], reasonZh: "局限缺失或为空，补合同默认局限说明" });
    current.limitationsZh = [REFINE_DEFAULT_LIMITATION_ZH];
  }
  if (typeof current.inspirationZh === "string" && current.inspirationZh.trim()) {
    fixes.push({ path: "review.inspirationZh", code: "string_to_array", before: current.inspirationZh, after: [current.inspirationZh.trim()], reasonZh: "灵感字符串包成单元素数组" });
    current.inspirationZh = [current.inspirationZh.trim()];
  }
  if (!("mediaReview" in current) || current.mediaReview === null) {
    fixes.push({ path: "review.mediaReview", code: "media_review_missing", before: current.mediaReview, after: [], reasonZh: "复听项缺失补为空数组" });
    current.mediaReview = [];
  }
  if (!("findings" in current) || current.findings === null) {
    fixes.push({ path: "review.findings", code: "findings_missing", before: current.findings, after: [], reasonZh: "发现项缺失补为空数组" });
    current.findings = [];
  }
  const shape = repairJsonShape(current, creativeEvidenceReviewSchema);
  for (const fix of shape.fixes) fixes.push(toRefinementFix(fix));
  if (isRecord(shape.value)) current = shape.value as Record<string, unknown>;
  if (Array.isArray(current.findings)) {
    const kept: unknown[] = [];
    current.findings.forEach((finding, index) => {
      if (!isRecord(finding)) {
        kept.push(finding);
        return;
      }
      const paths = Array.isArray(finding.evidencePaths) ? finding.evidencePaths : typeof finding.evidencePaths === "string" ? [finding.evidencePaths] : [];
      if (typeof finding.evidencePaths === "string") fixes.push({ path: `review.findings[${index}].evidencePaths`, code: "string_to_array", before: finding.evidencePaths, after: paths, reasonZh: "证据路径字符串包成数组" });
      const normalized: string[] = [];
      for (const raw of paths) {
        if (typeof raw !== "string") continue;
        const fixed = normalizeEvidencePath(raw, pointerRoot);
        if (fixed.path === undefined) {
          fixes.push({ path: `review.findings[${index}].evidencePaths`, code: "evidence_path_dropped", before: raw, after: undefined, reasonZh: `证据路径 ${raw} 无任何合法前缀，已去除` });
          continue;
        }
        if (fixed.path !== raw) fixes.push({ path: `review.findings[${index}].evidencePaths`, code: "evidence_path_normalized", before: raw, after: fixed.path, reasonZh: fixed.reasonZh });
        if (!normalized.includes(fixed.path)) normalized.push(fixed.path);
      }
      if (!normalized.length) {
        fixes.push({ path: `review.findings[${index}]`, code: "finding_dropped", before: finding, after: undefined, reasonZh: "该发现没有任何可解析的证据路径，整条去除" });
        return;
      }
      kept.push({ ...finding, evidencePaths: normalized });
    });
    current.findings = kept;
  }
  return { value: current, fixes };
}

function toRefinementFix(fix: ShapeFix): RefinementFix {
  return { path: `review.${fix.path}`, code: fix.code, before: fix.before, after: fix.after, reasonZh: fix.reasonZh };
}

const unescapePointer = (segment: string) => segment.replace(/~1/g, "/").replace(/~0/g, "~");
const escapePointer = (segment: string) => segment.replace(/~/g, "~0").replace(/\//g, "~1");

function childOf(node: unknown, key: string): { ok: boolean; value: unknown } {
  if (Array.isArray(node)) {
    if (!/^\d+$/.test(key)) return { ok: false, value: undefined };
    const index = Number(key);
    return index < node.length ? { ok: true, value: node[index] } : { ok: false, value: undefined };
  }
  if (node && typeof node === "object" && Object.hasOwn(node, key)) return { ok: true, value: (node as Record<string, unknown>)[key] };
  return { ok: false, value: undefined };
}

/** 在 node 下深度 ≤ maxDepth 范围内找唯一名为 key 的字段，返回相对路径段；找到多个或没找到返回 undefined。 */
function findUniqueKey(node: unknown, key: string, maxDepth: number): string[] | undefined {
  const hits: string[][] = [];
  const walk = (cursor: unknown, trail: string[], depth: number) => {
    if (hits.length > 1 || depth > maxDepth || !cursor || typeof cursor !== "object") return;
    if (Array.isArray(cursor)) {
      cursor.forEach((row, index) => walk(row, [...trail, String(index)], depth + 1));
      return;
    }
    for (const [k, v] of Object.entries(cursor as Record<string, unknown>)) {
      if (k === key) hits.push([...trail, k]);
      walk(v, [...trail, k], depth + 1);
    }
  };
  walk(node, [], 1);
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * 证据路径归一：
 * 1. 原样可解析 → 不动；
 * 2. 逐层解析到第一个不存在的段；若该段之后还有段，尝试「漏中间层」：在当前节点下深度 ≤2 唯一找到下一段的键名则插入缺失层继续；
 * 3. 否则截到最长合法前缀（至少保留首段，如 /candidate）；首段都不合法 → undefined（由调用方去除）。
 */
export function normalizeEvidencePath(path: string, root: unknown): { path: string | undefined; reasonZh: string } {
  if (typeof path !== "string" || !path.startsWith("/")) return { path: undefined, reasonZh: "不是 JSON Pointer" };
  const segments = path.slice(1).split("/").map(unescapePointer);
  const resolved: string[] = [];
  let cursor: unknown = root;
  let reasonZh = "";
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const direct = childOf(cursor, segment);
    if (direct.ok) {
      resolved.push(segment);
      cursor = direct.value;
      continue;
    }
    // 漏中间层：当前节点下唯一找到该键 → 插入缺失层
    const relative = cursor && typeof cursor === "object" ? findUniqueKey(cursor, segment, 2) : undefined;
    if (relative) {
      let probe: unknown = cursor;
      for (const step of relative) probe = childOf(probe, step).value;
      resolved.push(...relative);
      cursor = probe;
      reasonZh = reasonZh || `证据路径漏了中间层，已补为真实路径`;
      continue;
    }
    reasonZh = `证据路径从「${segment}」起不存在，已截到最近合法祖先`;
    break;
  }
  if (!resolved.length) return { path: undefined, reasonZh: "证据路径首段不存在" };
  const normalized = "/" + resolved.map(escapePointer).join("/");
  return { path: normalized, reasonZh: normalized === path ? "" : reasonZh || "证据路径已归一" };
}

export type SectionRestoreFix = {
  index: number;
  field: string;
  before: unknown;
  after: unknown;
  reasonZh?: string;
};

/**
 * 联合创作不得改写媒体观察：proposal.sections 与初稿不一致时整体回填初稿 sections，并逐字段记录模型改了什么。
 * sections 是服务端已校验的证据定位，不是 refine 的创作对象；回填后仍由 validateRefined 的逐字比对兜底。
 */
export function restoreDraftSections(proposal: unknown, draftSections: unknown): { value: unknown; fixes: SectionRestoreFix[]; replaced: boolean } {
  if (!isRecord(proposal) || !Array.isArray(draftSections)) return { value: proposal, fixes: [], replaced: false };
  const current = proposal.sections;
  if (stableStringify(current) === stableStringify(draftSections)) return { value: proposal, fixes: [], replaced: false };
  const fixes: SectionRestoreFix[] = [];
  const rows = Array.isArray(current) ? current : [];
  const max = Math.max(rows.length, draftSections.length);
  for (let index = 0; index < max; index += 1) {
    const got = rows[index];
    const want = draftSections[index];
    if (got === undefined) {
      fixes.push({ index, field: "section", before: undefined, after: want, reasonZh: "模型漏掉该段，已回填" });
      continue;
    }
    if (want === undefined) {
      fixes.push({ index, field: "section", before: got, after: undefined, reasonZh: "模型多出该段，已去除" });
      continue;
    }
    if (!isRecord(got) || !isRecord(want)) {
      if (stableStringify(got) !== stableStringify(want)) fixes.push({ index, field: "section", before: got, after: want });
      continue;
    }
    for (const key of Array.from(new Set([...Object.keys(got), ...Object.keys(want)]))) {
      if (stableStringify(got[key]) === stableStringify(want[key])) continue;
      if (key === "emotion" && isRecord(got.emotion) && isRecord(want.emotion)) {
        for (const sub of Array.from(new Set([...Object.keys(got.emotion), ...Object.keys(want.emotion)]))) {
          if (stableStringify(got.emotion[sub]) !== stableStringify(want.emotion[sub])) fixes.push({ index, field: `emotion.${sub}`, before: got.emotion[sub], after: want.emotion[sub] });
        }
        continue;
      }
      fixes.push({ index, field: key, before: got[key], after: want[key] });
    }
  }
  if (!Array.isArray(current)) fixes.push({ index: -1, field: "sections", before: current, after: draftSections });
  return { value: { ...proposal, sections: structuredClone(draftSections) }, fixes, replaced: true };
}
