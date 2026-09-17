/**
 * 0917 PR-D：「服务端连续查不到原编号 → 允许放弃这个编号」的判据（唯一真源）。
 *
 * 为什么单独抽出来：面板里这套判断要在三处用（重挂载时续算、轮询查不到时推进、渲染放弃按钮），
 * 判据写三遍就是知识库《判据收口》那条雷。抽成纯函数之后阈值只有一个地方，
 * 而且能在 shared/ 下被 vitest 直接测——客户端组件这边没有 jsdom 测试设施。
 *
 * 严格方向：只有「服务端明确回了『没有这条记录』」才算数。查询本身失败（断网、网关抖动）
 * 必须清零，否则一次外网抖动就把放弃按钮点亮，用户放弃掉一单真实在跑的任务再重提＝重复建单。
 */

/** 连续查不到原编号多久之后允许放弃（毫秒）。入队成功的任务几秒内即可查到。 */
export const PREVIS_ABANDON_AFTER_MS = 10 * 60_000;

/** 从「第一次查不到」的时间戳判断现在能不能放弃。null＝当前并非连续查不到。 */
export function previsAbandonable(firstMissingAt: number | null, now: number): boolean {
  if (firstMissingAt === null) return false;
  return now - firstMissingAt >= PREVIS_ABANDON_AFTER_MS;
}

/**
 * 解析持久化下来的「第一次查不到」时间戳（sessionStorage 里是字符串）。
 * 拒绝空值、非数字、非正数，以及**未来**时间戳——机器改过时钟时未来值会让放弃按钮立刻点亮。
 */
export function parsePrevisMissingSince(raw: string | null | undefined, now: number): number | null {
  if (!raw) return null;
  const at = Number(raw);
  if (!Number.isFinite(at) || at <= 0 || at > now) return null;
  return at;
}

/**
 * 0917 第五轮之后补：存取也收进来，好让探针/单测驱动**真代码**而不是抄一份。
 * 传入的 storage 就是浏览器的 sessionStorage；隐私模式/禁用站点数据时它会抛，
 * 所以三个函数全部吞异常——存不下就退回本次会话内计时，不影响主流程。
 */
export type PrevisMissingStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** 只按 requestId 存：换了编号读不到旧值，不会把上一单的等待算到新单头上。 */
export const previsMissingKey = (requestId: string) => `manhua-previs-missing-since:${requestId}`;

export function readPrevisMissingSince(
  store: PrevisMissingStore | null | undefined,
  requestId: string,
  now: number,
): number | null {
  try {
    return parsePrevisMissingSince(store?.getItem(previsMissingKey(requestId)), now);
  } catch {
    return null;
  }
}

export function writePrevisMissingSince(
  store: PrevisMissingStore | null | undefined,
  requestId: string,
  at: number,
): void {
  try {
    store?.setItem(previsMissingKey(requestId), String(at));
  } catch {
    /* 存不了就退回内存计时 */
  }
}

export function clearPrevisMissingSince(
  store: PrevisMissingStore | null | undefined,
  requestId: string,
): void {
  try {
    store?.removeItem(previsMissingKey(requestId));
  } catch {
    /* 同上 */
  }
}
