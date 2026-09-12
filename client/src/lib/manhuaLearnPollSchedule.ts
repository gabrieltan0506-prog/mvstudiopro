/**
 * 漫剧学习面板的轮询节奏（纯函数，可直接测）。
 *
 * 0912 事故：`/api/jobs/manhua-learn` 一天打出 1.7k 次，是 Vercel 防火墙 Top Request Paths
 * 第一名、比第二名高近二十倍。同一路径、高频、规律，正是自动 DDoS 缓解眼里的机器流量特征——
 * 整站被发 JS 质询，接口返回 HTML，前端 `JSON.parse` 失败报「算力紧张或请求超时」。
 *
 * 病根不在通用轮询器：那条路径在 PlatformPage 的一个 useEffect 里自己递归 setTimeout，
 * 有活跃任务 3 秒、空闲 15 秒，都是恒定值。面板开着不关一天，光空闲档就是 5760 次。
 *
 * 本模块只服务那一个 effect 与同面板的快照查询，不做成共享默认值——上一版把手伸到
 * 通用轮询器与 react-query 默认值上，顺手改掉了二十多个没评估过的链路。
 */

/** 有任务在跑：起始 3 秒，退到 30 秒封顶 */
export const MANHUA_LEARN_ACTIVE_BASE_MS = 3_000;
export const MANHUA_LEARN_ACTIVE_MAX_MS = 30_000;
/** 没有任务在跑：起始 15 秒，退到 60 秒封顶 */
export const MANHUA_LEARN_IDLE_BASE_MS = 15_000;
export const MANHUA_LEARN_IDLE_MAX_MS = 60_000;
/** 页面切到后台时的下限：没人看的面板不该继续按前台节奏打接口 */
export const MANHUA_LEARN_HIDDEN_ACTIVE_MS = 60_000;
export const MANHUA_LEARN_HIDDEN_IDLE_MS = 120_000;

const GROWTH = 1.4;
/** 抖动只向上，0~25%：多标签页不会挤在同一刻齐发，且永不低于名义间隔 */
const JITTER_MAX = 0.25;

export type ManhuaLearnSyncTier = "active" | "idle";
export type ManhuaLearnSyncState = { tier: ManhuaLearnSyncTier; rounds: number };

/**
 * 冻结：它是模块级共享对象，却被当作每个组件实例的初值。
 * 现在所有写法都是整体替换新对象，安全；但只要有人写 `state.rounds = x`
 * 就会就地改掉这份共享初值，污染此后所有实例。冻上让这种写法当场抛错，而不是静默串档。
 */
export const MANHUA_LEARN_SYNC_INITIAL: ManhuaLearnSyncState = Object.freeze({
  tier: "idle",
  rounds: 0,
});

/** 页面是否在后台（SSR / 测试环境按前台处理） */
export function isPageHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * 下一次同步该等多久。
 *
 * `rounds` 是**本档位**内已经连续跑过的轮数：0 表示刚进这个档位的第一轮，
 * 此时不抖动——否则 3 秒会被抖成 2.x 秒，比改前还密。
 */
export function manhuaLearnSyncDelayMs(params: {
  tier: ManhuaLearnSyncTier;
  rounds: number;
  hidden: boolean;
  /** 仅测试注入 */
  random?: () => number;
}): number {
  const active = params.tier === "active";
  const base = active ? MANHUA_LEARN_ACTIVE_BASE_MS : MANHUA_LEARN_IDLE_BASE_MS;
  const cap = active ? MANHUA_LEARN_ACTIVE_MAX_MS : MANHUA_LEARN_IDLE_MAX_MS;
  const rounds = Math.max(0, Math.floor(params.rounds));
  const grown = Math.min(cap, Math.round(base * GROWTH ** rounds));
  const spacing =
    rounds === 0
      ? grown
      : Math.round(grown * (1 + (params.random ?? Math.random)() * JITTER_MAX));
  if (!params.hidden) return spacing;
  const floor = active ? MANHUA_LEARN_HIDDEN_ACTIVE_MS : MANHUA_LEARN_HIDDEN_IDLE_MS;
  return Math.max(spacing, floor);
}

/**
 * 一轮同步之后的档位与轮次。
 *
 * **请求失败不清零轮次**：被质询时列表接口回的是 HTML、`json()` 必然抛错，
 * 那正是最该退让的时刻；旧写法会退回最密的节奏继续撞墙。
 */
export function nextManhuaLearnSyncState(
  prev: ManhuaLearnSyncState,
  outcome: { ok: boolean; hasActive?: boolean },
): ManhuaLearnSyncState {
  if (!outcome.ok) return { tier: prev.tier, rounds: prev.rounds + 1 };
  const tier: ManhuaLearnSyncTier = outcome.hasActive ? "active" : "idle";
  return tier === prev.tier
    ? { tier, rounds: prev.rounds + 1 }
    : { tier, rounds: 0 };
}

/**
 * 同面板的系列快照查询（react-query）的刷新间隔。
 *
 * 必须对同一状态返回稳定值：含 `Math.random()` 会让 react-query 每 render 重建定时器，
 * 该查询第 4 次更新后静默停更——请求量是降了，靠把功能弄坏降的（0912 审查抓到）。
 * 所以这里拿 `dataUpdateCount` 当轮次，不抖动。
 */
export type ManhuaLearnSnapshotBaseline = { seriesKey: string; baseline: number };
/** 冻结理由同 {@link MANHUA_LEARN_SYNC_INITIAL}：共享对象当 useRef 初值，就地改会污染所有实例。 */
export const MANHUA_LEARN_SNAPSHOT_BASELINE_INITIAL: ManhuaLearnSnapshotBaseline = Object.freeze({
  seriesKey: "",
  baseline: 0,
});
/** 唤醒时用的哨兵：下一次回调会把它收敛成当前计数，等于「从 15 秒重新起退」 */
export const MANHUA_LEARN_SNAPSHOT_WAKE_SENTINEL = Number.MAX_SAFE_INTEGER;

/**
 * 快照查询的退避基线与间隔（纯函数）。
 *
 * `dataUpdateCount` 是**每个 seriesKey 各自**缓存条目的累计成功次数，而基线只有一份。
 * 切剧时必须跟着换归属，否则拿 A 剧的基线去减 B 剧的计数，轮次虚高、直接跳到 60 秒封顶。
 *
 * 返回值必须对同一组入参稳定：react-query 会在每次 setOptions 时重算，
 * 值一变就重建定时器；第一次返 A、第二次返 B 会让它反复重建。
 * 所以这里的收敛都发生在**算 rounds 之前**，同一次调用内就已经稳定。
 */
export function resolveManhuaLearnSnapshotSchedule(params: {
  prev: ManhuaLearnSnapshotBaseline;
  seriesKey: string;
  dataUpdateCount: number;
  active: boolean;
  hidden: boolean;
}): { next: ManhuaLearnSnapshotBaseline; intervalMs: number | false } {
  const { prev, seriesKey, dataUpdateCount, active, hidden } = params;
  const rebased: ManhuaLearnSnapshotBaseline = { seriesKey, baseline: dataUpdateCount };
  // 换剧、没有活跃任务、或基线被唤醒顶成哨兵，三种情况都重新以当前计数为基线
  if (prev.seriesKey !== seriesKey || !active || prev.baseline > dataUpdateCount) {
    return { next: rebased, intervalMs: active ? manhuaLearnSnapshotIntervalMs(0, hidden) : false };
  }
  const rounds = dataUpdateCount - prev.baseline;
  return { next: prev, intervalMs: manhuaLearnSnapshotIntervalMs(rounds, hidden) };
}

export function manhuaLearnSnapshotIntervalMs(dataUpdateCount: number, hidden = false): number {
  const rounds = Math.max(0, Math.floor(dataUpdateCount));
  const grown = Math.min(
    MANHUA_LEARN_IDLE_MAX_MS,
    Math.round(MANHUA_LEARN_IDLE_BASE_MS * GROWTH ** rounds),
  );
  return hidden ? Math.max(grown, MANHUA_LEARN_HIDDEN_IDLE_MS) : grown;
}
