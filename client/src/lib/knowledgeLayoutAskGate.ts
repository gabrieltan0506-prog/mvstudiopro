/**
 * 图文知识手册「图片出完后再问要不要排版成册」闸门（站长 2026-11-21）。
 *
 * 状态机（每份手册稿一份）：
 *   等待图片（pending，图片未齐不显示询问）
 *     → 询问（pending 且本次图片全部成功：主面板总体进度旁显示〔排版成册〕〔只要图片〕，不超时、不自动选）
 *       → layout：放行排版面板原有自动流程（逐章整理 → 统稿 → 整册排版 → 版面审查与 PDF），
 *                 请求身份、预授权额与扣费语义与原来完全一致，只是开始时间推迟到用户点击之后；
 *       → images_only：自动流程根本不启动（零模型请求、零内文扣费、不进忙碌态、不锁面板），
 *                 之后仍可在排版面板点「恢复整册自动排版（沿用原请求）」手动开始。
 *
 * 为什么把闸放在「自动开始」而不是每批的 waitForImages 里：
 * 若在 waitForImages 里挂起，审校 run() 已经进入忙碌态、写过并发字段、锁住工作室（补图要等锁），
 * 选「只要图片」时还得在批次调度里吞掉一个人造错误；闸在 autoStart 之前则审校调度与回执逻辑一行不动，
 * 用户选择前什么都没发生，选「排版成册」后 run() 原样执行（届时图片已齐，按批等待立即通过）。
 *
 * 选择只记本机（localStorage，按稿件 id），不写云稿：避免改动云稿结构与服务端转移校验。
 * 换浏览器/清缓存后最多再问一次，不会自动开始任何收费流程。
 */
export type KnowledgeLayoutChoice = "layout" | "images_only";

const KEY_PREFIX = "mvsp:knowledge-layout-choice:";

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
export function readKnowledgeLayoutChoice(documentId: string): KnowledgeLayoutChoice | null {
  const v = storage()?.getItem(KEY_PREFIX + documentId);
  return v === "layout" || v === "images_only" ? v : null;
}
export function writeKnowledgeLayoutChoice(documentId: string, choice: KnowledgeLayoutChoice) {
  try { storage()?.setItem(KEY_PREFIX + documentId, choice); } catch { /* 本机存不下只影响刷新后是否再问一次 */ }
}

/** 单份稿的决定闸：wait() 在用户选择前一直挂起；choose() 只认第一次。 */
export function createKnowledgeLayoutGate(initial: KnowledgeLayoutChoice | null = null) {
  let choice: KnowledgeLayoutChoice | null = initial;
  const waiters: Array<(c: KnowledgeLayoutChoice) => void> = [];
  return {
    get choice() { return choice; },
    wait(): Promise<KnowledgeLayoutChoice> {
      return choice ? Promise.resolve(choice) : new Promise(resolve => waiters.push(resolve));
    },
    choose(next: KnowledgeLayoutChoice) {
      if (choice) return choice;
      choice = next;
      waiters.splice(0).forEach(resolve => resolve(next));
      return next;
    },
  };
}
export type KnowledgeLayoutGate = ReturnType<typeof createKnowledgeLayoutGate>;

/**
 * 排版面板自动开始的唯一入口：有闸先等决定，只有 layout 才调用 run；
 * images_only 或面板已离开（alive=false）时不调用、不报错。返回是否已开始。
 */
export async function runAfterKnowledgeLayoutDecision(
  decide: (() => Promise<KnowledgeLayoutChoice>) | undefined,
  run: () => unknown,
  alive: () => boolean = () => true,
): Promise<boolean> {
  if (decide) {
    const choice = await decide();
    if (choice !== "layout" || !alive()) return false;
  }
  void run();
  return true;
}

/**
 * 主面板是否显示询问：本稿非「只出卡片」、整理尚未开始、没有记录过选择、
 * 本次图片全部成功（无空页、无在途页、不在出图中）。失败/停派时不问，沿用原失败提示与补出入口。
 */
export function knowledgeLayoutAskVisible(input: {
  cardsOnly: boolean;
  reviewStarted: boolean;
  choice: KnowledgeLayoutChoice | null;
  images: readonly string[];
  rendering: boolean;
  inflight: number;
}) {
  return !input.cardsOnly && !input.reviewStarted && !input.choice && !input.rendering && input.inflight === 0
    && input.images.length > 0 && input.images.every(Boolean);
}
