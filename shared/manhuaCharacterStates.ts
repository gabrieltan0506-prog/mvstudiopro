/**
 * 角色状态变体（PR-13）：常态 / 肩伤 / 虚弱 / 完全体……
 *
 * 问题：一个角色只有一张锁脸图，剧本里的「肩头炸开血口」「前腿蜷起」没有落点，
 * 出图模型一律往干净标准像收敛（0916 墨屠常态重绘把伤和眼罩都"治好了"）。
 *
 * 做法：
 *   - 人物表行可写「状态：肩伤=肩头血口；虚弱=眼罩下眼眯成缝、腿打颤」（状态之间用 ；分隔，差异里可以用 、）→ anchor.statesZh
 *   - 可拍表「角色：墨屠（肩伤）；阿菁」→ 段级状态需求
 *   - 每个状态一张锁脸图（primaryBindings.stateId），由常态图编辑派生（只加 X 其余不动）
 *   - 门禁：受伤后的段又引用常态图 → 告警（不自动改）
 */

export type ManhuaCharacterState = {
  /** 稳定 id：st_<slug> */
  id: string;
  nameZh: string;
  /** 与常态的差异（只写要加/改的） */
  deltaZh: string;
};

export const MANHUA_CHARACTER_BASE_STATE_ID = "base";

function slugZh(name: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `st_${h.toString(16).padStart(8, "0")}`;
}

export function makeManhuaCharacterStateId(nameZh: string): string {
  return slugZh(String(nameZh || "").trim());
}

/**
 * 从人物表行的字段里解析「状态：…」（任意位置；多个状态用 ；/、 分开；名=差异 或 名：差异）。
 * 「常态」保留字不算状态。
 */
export function parseManhuaCharacterStates(fields: readonly string[]): ManhuaCharacterState[] {
  const out: ManhuaCharacterState[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    const m = String(f || "").match(/^\s*(?:状态|状态变体|变体)\s*[:：]\s*([\s\S]+)$/);
    if (!m) continue;
    for (const part of m[1]!.split(/[；;]/)) {
      const kv = part.split(/[=＝:：]/);
      const nameZh = String(kv[0] || "").trim().slice(0, 16);
      const deltaZh = kv.slice(1).join("：").trim().slice(0, 160);
      if (!nameZh || nameZh === "常态" || seen.has(nameZh)) continue;
      seen.add(nameZh);
      out.push({ id: makeManhuaCharacterStateId(nameZh), nameZh, deltaZh });
    }
  }
  return out.slice(0, 8);
}

export type ManhuaCastStateRequest = { nameZh: string; stateZh: string | null };

/** 可拍表「角色：」→ [{nameZh, stateZh}]；括注即状态（「墨屠（肩伤）」），无括注为常态 */
export function parseManhuaCastZhWithStates(castZh: string | null | undefined): ManhuaCastStateRequest[] {
  const raw = String(castZh || "").trim();
  if (!raw) return [];
  const out: ManhuaCastStateRequest[] = [];
  const seen = new Set<string>();
  for (const piece of raw.split(/[；;、，,/|\n]+|\s与\s|\s和\s/)) {
    const t = piece.trim();
    if (!t) continue;
    const m = t.match(/^([^（(]+?)\s*(?:[（(]([^）)]{1,16})[）)])?\s*$/);
    if (!m) continue;
    const nameZh = m[1]!.trim().slice(0, 24);
    const stateZh = m[2] ? m[2].trim() : null;
    if (!nameZh || seen.has(`${nameZh}|${stateZh || ""}`)) continue;
    seen.add(`${nameZh}|${stateZh || ""}`);
    out.push({ nameZh, stateZh });
  }
  return out;
}

export type ManhuaStateAnchorLike = { id: string; nameZh: string; aliasZh?: string; lookZh?: string; statesZh?: ManhuaCharacterState[] };

function anchorByName(anchors: readonly ManhuaStateAnchorLike[], nameZh: string): ManhuaStateAnchorLike | undefined {
  const n = nameZh.trim();
  return anchors.find((a) => a.nameZh === n || a.aliasZh === n) || anchors.find((a) => n.includes(a.nameZh) || a.nameZh.includes(n));
}

export type ManhuaCastStateResolution = {
  nameZh: string;
  anchorId: string | null;
  stateZh: string | null;
  /** 状态在人物表里定义了 → 有 id；请求了但没定义 → null 且 undefinedState=true */
  stateId: string | null;
  undefinedState: boolean;
  deltaZh: string;
};

/** 段级角色状态请求 ↔ 人物表状态定义 对齐 */
export function resolveManhuaCastStates(castZh: string | null | undefined, anchors: readonly ManhuaStateAnchorLike[]): ManhuaCastStateResolution[] {
  return parseManhuaCastZhWithStates(castZh).map((req) => {
    const anchor = anchorByName(anchors, req.nameZh);
    if (!req.stateZh) return { nameZh: req.nameZh, anchorId: anchor?.id ?? null, stateZh: null, stateId: null, undefinedState: false, deltaZh: "" };
    const st = anchor?.statesZh?.find((s) => s.nameZh === req.stateZh);
    return { nameZh: req.nameZh, anchorId: anchor?.id ?? null, stateZh: req.stateZh, stateId: st?.id ?? null, undefinedState: !st, deltaZh: st?.deltaZh ?? "" };
  });
}

/** 给静帧/成片提示词的状态句：「墨屠（肩伤）：肩头血口；阿菁：常态」——只写有状态的 */
export function formatManhuaCastStateNoteZh(castZh: string | null | undefined, anchors: readonly ManhuaStateAnchorLike[]): string {
  const rows = resolveManhuaCastStates(castZh, anchors).filter((r) => r.stateZh);
  if (!rows.length) return "";
  return rows.map((r) => `${r.nameZh}（${r.stateZh}）${r.deltaZh ? `：${r.deltaZh}` : r.undefinedState ? "：人物表未定义此状态，按字面理解" : ""}`).join("；");
}

/** 常态图 → 状态图的编辑提示：只加差异，其余不动（不整张重绘，防止被"治好"） */
export function buildManhuaStateDerivePromptZh(input: { nameZh: string; stateZh: string; deltaZh: string }): string {
  const delta = String(input.deltaZh || "").trim() || input.stateZh;
  return `在这张「${input.nameZh}」定妆图上只加「${input.stateZh}」状态：${delta}。脸、发型、体型、服装、配色、姿势、背景全部保持原样，不美化、不修复、不新增其他元素。`;
}

export type ManhuaStateContinuityIssue = { segmentIndex: number; nameZh: string; messageZh: string; code: "regress_to_base" | "undefined_state" | "no_anchor" };

const HEAL_RE = /愈合|痊愈|恢复|包扎|伤好|好了|治好|换回|复原|常态/;

/**
 * 连续性门禁：某段角色带状态（如肩伤）后，后段又以常态引用且没有可见的恢复描述 → 告警；
 * 段里请求了人物表没定义的状态 → 告警；角色名对不上人物表 → 告警。只报不改。
 */
export function evaluateManhuaStateContinuity(
  segments: ReadonlyArray<{ index: number; castZh?: string; performanceZh?: string; dialogueZh?: string }>,
  anchors: readonly ManhuaStateAnchorLike[],
): ManhuaStateContinuityIssue[] {
  const issues: ManhuaStateContinuityIssue[] = [];
  const active = new Map<string, string>(); // nameZh -> stateZh
  const ordered = [...segments].sort((a, b) => a.index - b.index);
  for (const seg of ordered) {
    const rows = resolveManhuaCastStates(seg.castZh, anchors);
    const text = `${seg.performanceZh || ""}${seg.dialogueZh || ""}`;
    for (const r of rows) {
      if (!r.anchorId) {
        issues.push({ segmentIndex: seg.index, nameZh: r.nameZh, code: "no_anchor", messageZh: `段${String(seg.index).padStart(2, "0")}「${r.nameZh}」不在人物表` });
        continue;
      }
      if (r.stateZh) {
        if (r.undefinedState) issues.push({ segmentIndex: seg.index, nameZh: r.nameZh, code: "undefined_state", messageZh: `段${String(seg.index).padStart(2, "0")}「${r.nameZh}（${r.stateZh}）」人物表没有这个状态，请在人物表加「状态：${r.stateZh}=…」` });
        active.set(r.nameZh, r.stateZh);
        continue;
      }
      const prev = active.get(r.nameZh);
      if (prev && !HEAL_RE.test(text)) {
        issues.push({ segmentIndex: seg.index, nameZh: r.nameZh, code: "regress_to_base", messageZh: `段${String(seg.index).padStart(2, "0")}「${r.nameZh}」上一段还是「${prev}」，本段回到常态但没写恢复过程；要么写「${r.nameZh}（${prev}）」，要么在表演里写清怎么好的` });
      } else if (prev) {
        active.delete(r.nameZh);
      }
    }
  }
  return issues;
}


/** 段级消费只选本段状态；候选库仍保留其它状态与常态，不删除资产。 */
export function resolveManhuaStateExcludedRefIds(castZh: string, anchors: readonly ManhuaStateAnchorLike[], refs: readonly { id: string; primaryBindings?: Array<{ anchorId: string; duty: string; stateId?: string }> }[]): Set<string> {
  const excluded = new Set<string>();
  for (const req of resolveManhuaCastStates(castZh, anchors)) {
    if (!req.anchorId) continue;
    if (req.undefinedState) throw new Error(`${req.nameZh}的${req.stateZh}状态尚未定义，不能使用常态替代`);
    const bound = refs.filter(r => r.primaryBindings?.some(b => b.anchorId === req.anchorId && (b.duty === "identity" || b.duty === "look")));
    if (req.stateId && !bound.some(r => r.primaryBindings?.some(b => b.anchorId === req.anchorId && b.stateId === req.stateId))) throw new Error(`${req.nameZh}的${req.stateZh}状态缺少当前参考图`);
    for (const ref of bound) {
      if (!ref.primaryBindings?.some(b => b.anchorId === req.anchorId && (b.stateId || null) === req.stateId)) excluded.add(ref.id);
    }
  }
  return excluded;
}
