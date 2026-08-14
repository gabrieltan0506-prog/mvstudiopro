/**
 * 视频号双窗口会话与进程内协调器。
 *
 * 每个 UI 会话永久绑定 pid/windowId；历史去重由两个会话共享，截图、
 * 搜索标签与失败状态按窗口隔离。双窗口下不得自动补选或交换窗口。
 */

export const WEIXIN_CHANNELS_MAX_CONCURRENT_WINDOWS = 2;
// 两个窗口共享一套鼠标与键盘焦点，窗口可并存，但 UI 动作必须全局串行。
export const WEIXIN_CHANNELS_MAX_CONCURRENT_UI_ACTIONS = 1;
export const WEIXIN_CHANNELS_SHARED_DEDUP_NAMESPACE = "weixin-channels-global-dedup-v1";
// 左右窗口各自最多一个脚本搜索标签，禁止任一侧不断新增搜索页。
export const WEIXIN_CHANNELS_MAX_SEARCH_TABS_PER_WINDOW = 1;
export const WEIXIN_CHANNELS_MAX_TOTAL_SEARCH_TABS = 2;

export type WeixinChannelsWindowInfo = {
  windowId: number;
  pid: number;
  owner: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WeixinChannelsWindowSession = {
  sessionKey: string;
  slot: 1 | 2;
  windowId: number;
  pid: number;
  bounds: Pick<WeixinChannelsWindowInfo, "x" | "y" | "width" | "height">;
  // 评论、pending、重试、截图与标签属于单窗口状态。
  stateNamespace: string;
  maxSearchTabs: typeof WEIXIN_CHANNELS_MAX_SEARCH_TABS_PER_WINDOW;
  // videoIdentity 与 observationId 必须跨窗口共享，防止同一视频不同进度双抓。
  sharedDedupNamespace: typeof WEIXIN_CHANNELS_SHARED_DEDUP_NAMESPACE;
};

export type WeixinChannelsWindowCoordinator = {
  sessions: WeixinChannelsWindowSession[];
  maxConcurrentUiActions: typeof WEIXIN_CHANNELS_MAX_CONCURRENT_UI_ACTIONS;
  sharedDedupNamespace: typeof WEIXIN_CHANNELS_SHARED_DEDUP_NAMESPACE;
};

export type SearchPlaybackRoute = {
  searchWindowId: number;
  playbackWindowId: number;
};

export type PlaybackClaim = {
  playbackWindowId: number;
  ownerSessionKey: string;
  videoIdentity?: string;
  observationId?: string;
  acquiredAt: number;
};

export type PlaybackLease = {
  claim: PlaybackClaim;
  release(): void;
};

export type PlaybackClaimCoordinator = {
  acquire(playbackWindowId: number, ownerSessionKey: string): Promise<PlaybackLease>;
  current(playbackWindowId: number): PlaybackClaim | undefined;
};

export type DedupClaim = Required<Pick<PlaybackClaim, "ownerSessionKey" | "videoIdentity" | "observationId" | "acquiredAt">>;

export type DedupClaimRegistry = {
  tryAcquire(videoIdentity: string, observationId: string, ownerSessionKey: string):
    | { acquired: true; claim: DedupClaim }
    | { acquired: false; claim: DedupClaim };
  current(videoIdentity: string, observationId: string): DedupClaim | undefined;
  release(claim: DedupClaim): void;
};

export type AsyncSerialGate = {
  run<T>(operation: () => Promise<T>): Promise<T>;
};

/** 同一 Node 进程内严格 FIFO；失败也会释放下一位，不能造成永久死锁。 */
export function createAsyncSerialGate(): AsyncSerialGate {
  let tail: Promise<void> = Promise.resolve();
  return {
    async run<T>(operation: () => Promise<T>) {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await operation();
      } finally {
        release();
      }
    },
  };
}

/** 同一播放窗口的处理权按申请顺序交接，避免两个搜索会话互相覆盖右窗。 */
export function createPlaybackClaimCoordinator(): PlaybackClaimCoordinator {
  const tails = new Map<number, Promise<void>>();
  const currentClaims = new Map<number, PlaybackClaim>();
  return {
    async acquire(playbackWindowId, ownerSessionKey) {
      if (!isFiniteInteger(playbackWindowId) || !ownerSessionKey) {
        throw new Error("weixin_channels_playback_claim_invalid");
      }
      const previous = tails.get(playbackWindowId) || Promise.resolve();
      let releaseNext!: () => void;
      const next = new Promise<void>((resolve) => { releaseNext = resolve; });
      tails.set(playbackWindowId, next);
      await previous;
      const claim: PlaybackClaim = {
        playbackWindowId,
        ownerSessionKey,
        acquiredAt: Date.now(),
      };
      currentClaims.set(playbackWindowId, claim);
      let released = false;
      return {
        claim,
        release() {
          if (released) return;
          released = true;
          if (currentClaims.get(playbackWindowId) === claim) currentClaims.delete(playbackWindowId);
          releaseNext();
          if (tails.get(playbackWindowId) === next) tails.delete(playbackWindowId);
        },
      };
    },
    current(playbackWindowId) {
      return currentClaims.get(playbackWindowId);
    },
  };
}

/** videoIdentity 与 observationId 任一冲突都只能由原 owner 继续。 */
export function createDedupClaimRegistry(): DedupClaimRegistry {
  const byVideoIdentity = new Map<string, DedupClaim>();
  const byObservationId = new Map<string, DedupClaim>();
  return {
    tryAcquire(videoIdentity, observationId, ownerSessionKey) {
      if (!videoIdentity || !observationId || !ownerSessionKey) {
        throw new Error("weixin_channels_dedup_claim_invalid");
      }
      const existing = byVideoIdentity.get(videoIdentity) || byObservationId.get(observationId);
      if (existing) return { acquired: false, claim: existing };
      const claim = { videoIdentity, observationId, ownerSessionKey, acquiredAt: Date.now() };
      byVideoIdentity.set(videoIdentity, claim);
      byObservationId.set(observationId, claim);
      return { acquired: true, claim };
    },
    current(videoIdentity, observationId) {
      return byVideoIdentity.get(videoIdentity) || byObservationId.get(observationId);
    },
    release(claim) {
      if (byVideoIdentity.get(claim.videoIdentity) === claim) byVideoIdentity.delete(claim.videoIdentity);
      if (byObservationId.get(claim.observationId) === claim) byObservationId.delete(claim.observationId);
    },
  };
}

function isFiniteInteger(value: number) {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

export function isEligibleWeixinChannelsWindow(window: WeixinChannelsWindowInfo, explicitlyBound = false) {
  return isFiniteInteger(window.windowId)
    && isFiniteInteger(window.pid)
    && window.width >= 360
    && window.height >= 500
    && window.height >= window.width * 1.25
    && (/(?:视频号|視頻號)/.test(window.title) || (explicitlyBound && window.title === "WeChat (視窗)"))
    && [window.x, window.y, window.width, window.height].every(Number.isFinite);
}

/** 双窗必须给出完整 ID；单窗仅在唯一候选时允许兼容自动绑定。 */
export function selectStableWeixinChannelsWindows(
  windows: WeixinChannelsWindowInfo[],
  requiredWindowIds: number[] = [],
) {
  const requiredIds = new Set(requiredWindowIds);
  const eligible = windows.filter((window) => isEligibleWeixinChannelsWindow(window, requiredIds.has(window.windowId)));
  if (new Set(requiredWindowIds).size !== requiredWindowIds.length
    || requiredWindowIds.some((windowId) => !isFiniteInteger(windowId))
    || requiredWindowIds.length > WEIXIN_CHANNELS_MAX_CONCURRENT_WINDOWS) {
    throw new Error("weixin_channels_window_ids_invalid");
  }
  const byId = new Map(eligible.map((window) => [window.windowId, window]));
  if (requiredWindowIds.length) {
    const selected = requiredWindowIds.map((windowId) => byId.get(windowId));
    if (selected.some((window) => !window)) throw new Error("weixin_channels_required_window_not_found");
    const exact = selected as WeixinChannelsWindowInfo[];
    if (new Set(exact.map((window) => window.pid)).size !== 1) {
      throw new Error("weixin_channels_windows_pid_mismatch");
    }
    return exact;
  }
  if (eligible.length > 1) {
    throw new Error("weixin_channels_window_id_required_for_multiple_windows");
  }
  return eligible;
}

export function createWeixinChannelsWindowSessions(
  windows: WeixinChannelsWindowInfo[],
  requiredWindowIds: number[] = [],
): WeixinChannelsWindowSession[] {
  return selectStableWeixinChannelsWindows(windows, requiredWindowIds)
    .sort((left, right) => left.x - right.x || left.windowId - right.windowId)
    .map((window, index) => ({
    sessionKey: `weixin-channels:${window.pid}:${window.windowId}`,
    slot: (index + 1) as 1 | 2,
    windowId: window.windowId,
    pid: window.pid,
    bounds: { x: window.x, y: window.y, width: window.width, height: window.height },
    stateNamespace: `weixin-channels-window-${window.pid}-${window.windowId}`,
    maxSearchTabs: WEIXIN_CHANNELS_MAX_SEARCH_TABS_PER_WINDOW,
    sharedDedupNamespace: WEIXIN_CHANNELS_SHARED_DEDUP_NAMESPACE,
  }));
}

export function createWeixinChannelsWindowCoordinator(
  windows: WeixinChannelsWindowInfo[],
  requiredWindowIds: number[] = [],
): WeixinChannelsWindowCoordinator {
  return {
    sessions: createWeixinChannelsWindowSessions(windows, requiredWindowIds),
    maxConcurrentUiActions: WEIXIN_CHANNELS_MAX_CONCURRENT_UI_ACTIONS,
    sharedDedupNamespace: WEIXIN_CHANNELS_SHARED_DEDUP_NAMESPACE,
  };
}

/**
 * 双窗现行策略：左窗只跑推荐流；只有最右窗可以搜索，且结果仍在右窗播放。
 * 这样避开“左窗搜索覆盖右窗播放器”的微信固有路由，不让两个搜索会话争抢同一播放器。
 */
export function buildSearchPlaybackRoutes(
  sessions: WeixinChannelsWindowSession[],
): SearchPlaybackRoute[] {
  if (!sessions.length) return [];
  const playback = [...sessions].sort((left, right) => right.bounds.x - left.bounds.x || right.windowId - left.windowId)[0]!;
  return [{
    searchWindowId: playback.windowId,
    playbackWindowId: playback.windowId,
  }];
}

/**
 * 未来 Swift 控制器接线后的唯一参数入口。窗口选择参数必须放在动作之前，
 * 让 click/drag/key/type/capture 全部在底层校验同一个 windowId。
 */
export function buildWindowScopedControlArgs(session: WeixinChannelsWindowSession, actionArgs: string[]) {
  if (!isFiniteInteger(session.windowId) || !isFiniteInteger(session.pid) || actionArgs.length === 0) {
    throw new Error("weixin_channels_window_session_invalid");
  }
  return [
    "--window-id",
    String(session.windowId),
    "--window-pid",
    String(session.pid),
    ...actionArgs,
  ];
}
