import { describe, expect, it } from "vitest";
import {
  buildSearchPlaybackRoutes,
  buildWindowScopedControlArgs,
  createAsyncSerialGate,
  createDedupClaimRegistry,
  createPlaybackClaimCoordinator,
  createWeixinChannelsWindowCoordinator,
  isEligibleWeixinChannelsWindow,
} from "../../scripts/weixin-channels-window-session.mts";
import { parseCollectorWindowIds } from "../../scripts/weixin-channels-capture.mts";

const window = (windowId: number, x: number, pid = 900) => ({
  windowId, pid, owner: "WeChat", title: "WeChat (視窗)", x, y: 20, width: 484, height: 768,
});

describe("视频号双窗口协调器", () => {
  it("双窗口必须显式绑定，且只接受同 pid 的独立视频号窗", () => {
    // CG 的通用 WeChat 标题无 ID 时完全不进入候选；显式 ID 才能按几何绑定。
    expect(createWeixinChannelsWindowCoordinator([window(56885, 0), window(56915, 500)]).sessions)
      .toEqual([]);
    const coordinator = createWeixinChannelsWindowCoordinator(
      [window(56915, 500), window(56885, 0)],
      [56885, 56915],
    );
    expect(coordinator.sessions.map((session) => session.windowId)).toEqual([56885, 56915]);
    expect(() => createWeixinChannelsWindowCoordinator(
      [window(56885, 0), window(56915, 500, 901)], [56885, 56915],
    )).toThrow("weixin_channels_windows_pid_mismatch");
    expect(isEligibleWeixinChannelsWindow(window(1, 0))).toBe(false);
    expect(isEligibleWeixinChannelsWindow(window(1, 0), true)).toBe(true);
    expect(isEligibleWeixinChannelsWindow({ ...window(1, 0), title: "微信" }, true)).toBe(false);
  });

  it("显式自动绑定只接受同 PID 的恰好两窗，并按屏幕位置固定左右槽位", () => {
    const coordinator = createWeixinChannelsWindowCoordinator(
      [window(56915, 500), window(56885, 0)],
      [],
      { allowExactTwoAutoBinding: true },
    );
    expect(coordinator.sessions.map((session) => ({
      windowId: session.windowId,
      pid: session.pid,
      slot: session.slot,
    }))).toEqual([
      { windowId: 56885, pid: 900, slot: 1 },
      { windowId: 56915, pid: 900, slot: 2 },
    ]);
  });

  it("显式自动绑定遇到非两窗或跨 PID 时失败关闭", () => {
    const options = { allowExactTwoAutoBinding: true };
    expect(() => createWeixinChannelsWindowCoordinator(
      [window(56885, 0)], [], options,
    )).toThrow("weixin_channels_exact_two_windows_required");
    expect(() => createWeixinChannelsWindowCoordinator(
      [window(56885, 0), window(56915, 500), window(57000, 1_000)], [], options,
    )).toThrow("weixin_channels_exact_two_windows_required");
    expect(() => createWeixinChannelsWindowCoordinator(
      [window(56885, 0), window(56915, 500, 901)], [], options,
    )).toThrow("weixin_channels_windows_pid_mismatch");
    expect(() => createWeixinChannelsWindowCoordinator(
      [window(56885, 0), window(56915, 500)], [56885, 56915], options,
    )).toThrow("weixin_channels_window_binding_mode_conflict");
  });

  it("每个控制命令携带绑定 windowId，CLI 拒绝重复或第三个窗口", () => {
    const session = createWeixinChannelsWindowCoordinator([window(56885, 0)], [56885]).sessions[0]!;
    expect(buildWindowScopedControlArgs(session, ["key", "escape"]))
      .toEqual(["--window-id", "56885", "--window-pid", "900", "key", "escape"]);
    expect(parseCollectorWindowIds(["--window-id=56885", "--window-id=56915"]))
      .toEqual([56885, 56915]);
    expect(() => parseCollectorWindowIds(["--window-id=56885", "--window-id=56885"]))
      .toThrow("weixin_channels_window_ids_invalid");
    expect(() => parseCollectorWindowIds(["--window-id=1", "--window-id=2", "--window-id=3"]))
      .toThrow("weixin_channels_window_ids_invalid");
  });

  it("左窗只跑推荐，只有右窗搜索并在右窗播放", () => {
    const sessions = createWeixinChannelsWindowCoordinator(
      [window(56915, 500), window(56885, 0)],
      [56885, 56915],
    ).sessions;
    expect(buildSearchPlaybackRoutes(sessions)).toEqual([
      { searchWindowId: 56915, playbackWindowId: 56915 },
    ]);
  });

  it("同一播放窗 FIFO 交接，双 ID 去重申领为原子操作", async () => {
    const playback = createPlaybackClaimCoordinator();
    const first = await playback.acquire(56915, "left");
    let secondAcquired = false;
    const secondPromise = playback.acquire(56915, "right").then((lease) => {
      secondAcquired = true;
      lease.release();
    });
    await Promise.resolve();
    expect(secondAcquired).toBe(false);
    first.release();
    await secondPromise;

    const dedup = createDedupClaimRegistry();
    const claim = dedup.tryAcquire("video-a", "observation-a", "left");
    expect(claim.acquired).toBe(true);
    expect(dedup.tryAcquire("video-a", "observation-b", "right").acquired).toBe(false);
    expect(dedup.tryAcquire("video-b", "observation-a", "right").acquired).toBe(false);
    if (claim.acquired) dedup.release(claim.claim);
    expect(dedup.tryAcquire("video-a", "observation-a", "right").acquired).toBe(true);
  });

  it("全局 UI 门严格串行，前一动作失败后仍释放下一动作", async () => {
    const gate = createAsyncSerialGate();
    const order: string[] = [];
    const first = gate.run(async () => {
      order.push("a:start");
      await Promise.resolve();
      order.push("a:end");
      throw new Error("expected");
    }).catch(() => undefined);
    const second = gate.run(async () => { order.push("b"); });
    await Promise.all([first, second]);
    expect(order).toEqual(["a:start", "a:end", "b"]);
  });
});
