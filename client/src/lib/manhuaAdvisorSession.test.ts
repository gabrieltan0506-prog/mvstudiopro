import { describe, expect, it } from "vitest";
import { advisorRecentHistory, loadAdvisorMessages, loadAdvisorPendingRecovery, makeAdvisorPendingRecovery, mergeAdvisorCompletedExchange, parseAdvisorPendingRecovery, manhuaAdvisorSessionKey, manhuaAdvisorMountKey, parseAdvisorMessages, persistAdvisorCompletedExchange } from "./manhuaAdvisorSession";
import { readFileSync } from "node:fs";

describe("顾问会话隔离与追问", () => {
  it("账号和已确认版本各自隔离，不再用同名剧本共用 v1 记录", () => {
    const first = "2026-09-05T00:00:00.000Z";
    const second = "2026-09-05T00:01:00.000Z";
    expect(new Set([manhuaAdvisorSessionKey("1", first), manhuaAdvisorSessionKey("2", first), manhuaAdvisorSessionKey("1", second), manhuaAdvisorSessionKey("1:2", "a"), manhuaAdvisorSessionKey("1", "2:a")]).size).toBe(5);
    expect(manhuaAdvisorSessionKey("1", first)).toContain(":v2:");
    expect(() => manhuaAdvisorSessionKey("1", "")).toThrow("不能持久化");
  });
  it("确认版本刷新可复用，未确认同名稿内容改变必须隔离在途回包", () => {
    const pack = { seriesTitle: "墨菁传", episodes: [{ body: "阿菁入城" }] };
    const edited = { ...pack, episodes: [{ body: "阿菁出城" }] };
    expect(manhuaAdvisorMountKey("1", "confirmed-1", pack))
      .toBe(manhuaAdvisorMountKey("1", "confirmed-1", JSON.parse(JSON.stringify(edited))));
    expect(manhuaAdvisorMountKey("1", undefined, pack))
      .not.toBe(manhuaAdvisorMountKey("1", undefined, edited));
    expect(manhuaAdvisorMountKey("1", "confirmed-1", pack))
      .not.toBe(manhuaAdvisorMountKey("2", "confirmed-1", pack));
  });
  it("完整本机历史不裁剪，送模型的节选明确标记且不改原文", () => {
    const turns = Array.from({ length: 12 }, (_, index) => ({ id: String(index), role: "advisor" as const, text: "证据".repeat(1200) }));
    const restored = parseAdvisorMessages(JSON.stringify(turns));
    const recent = advisorRecentHistory(restored);
    expect(restored).toEqual(turns);
    expect(recent).toHaveLength(8);
    expect(recent[0]?.content).toContain("[历史节选]");
    expect(recent[0]!.content.length).toBeLessThanOrEqual(1500);
  });
  it("坏记录显式失败，不伪装空历史并覆盖原数据", () => {
    expect(parseAdvisorMessages(null)).toEqual([]);
    expect(() => parseAdvisorMessages('{"role":"user"}')).toThrow();
    expect(() => parseAdvisorMessages('[{"id":"a","role":"system","text":"越权"}]')).toThrow();
  });
  it("坏历史先原样隔离再开放新会话，隔离失败则保护原文并关闭写入", () => {
    const values = new Map<string, string>([["session", '{"bad":"原始历史"}']]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const loaded = loadAdvisorMessages(storage, "session", 456);
    expect(loaded).toMatchObject({ turns: [], writable: true, quarantineKey: "session:invalid:456" });
    expect(values.get("session:invalid:456")).toContain("原始历史");
    expect(values.has("session")).toBe(false);
    const request = { requestId: "11111111-1111-4111-8111-111111111111", rawQuestion: "检查本集", label: "第 1 集 · 分镜" };
    persistAdvisorCompletedExchange(storage, "session", request, "新答复");
    expect(parseAdvisorMessages(values.get("session")!)).toHaveLength(2);

    const blockedValues = new Map<string, string>([["session", '{"bad":"必须保留"}']]);
    const blocked = loadAdvisorMessages({
      getItem: (key) => blockedValues.get(key) ?? null,
      setItem: () => { throw new Error("quota"); },
      removeItem: (key) => { blockedValues.delete(key); },
    }, "session", 789);
    expect(blocked.writable).toBe(false);
    expect(blockedValues.get("session")).toContain("必须保留");
    expect(blocked.error).toContain("停止新的问答与扣点");
  });
  it("刷新恢复保留同一个请求编号、问题快照和此前确认，不自动新建请求", () => {
    const request = { requestId: "11111111-1111-4111-8111-111111111111", question: "【问题】检查本集", rawQuestion: "检查本集", label: "第 1 集 · 分镜" };
    const pending = makeAdvisorPendingRecovery(request, true);
    expect(parseAdvisorPendingRecovery(JSON.stringify(pending))).toEqual(pending);
    expect(parseAdvisorPendingRecovery(null)).toBeNull();
    expect(() => parseAdvisorPendingRecovery(JSON.stringify({ ...pending, request: { ...request, requestId: "另一个不合法编号" } }))).toThrow();
    expect(() => parseAdvisorPendingRecovery(JSON.stringify({ ...pending, confirmPaid: "true" }))).toThrow();
    const panel = readFileSync(new URL("../components/canvas/ManhuaCreativeAdvisorPanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain("requestId: request.requestId");
    expect(panel).toContain("makeAdvisorPendingRecovery(request, confirmPaid)");
    expect(panel).toContain("useMutation({ retry: false })");
    expect(panel).toContain("persistAdvisorCompletedExchange(localStorage, capturedSessionKey, request, answer)");
    expect(panel).toContain("mergeAdvisorCompletedExchange(prev, request, answer)");
    expect(panel).toContain("if (confirmPaid && !capturedSessionKey)");
    expect(panel).toContain("if (confirmPaid && !recoveryWritten)");
    expect(panel.indexOf("if (confirmPaid && !recoveryWritten)")).toBeLessThan(panel.indexOf("askMutation.mutateAsync"));
    expect(panel).toContain("先确认项目后再付费咨询，避免改稿丢回执");
    expect(panel).not.toContain("capturedRecoveryKey && !initialRecovery.error");
    expect(panel).toContain("failed.newAttempt ? false : failed.confirmPaid");
  });

  it("坏 pending 原文先隔离再释放活动槽，新请求不再被旧错误永久阻断", () => {
    const values = new Map<string, string>([["pending", '{"format":"bad","secret":"原始坏记录"}']]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const loaded = loadAdvisorPendingRecovery(storage, "pending", 123);
    expect(loaded.value).toBeNull();
    expect(loaded.quarantineKey).toBe("pending:invalid:123");
    expect(values.get("pending:invalid:123")).toContain("原始坏记录");
    expect(values.has("pending")).toBe(false);
    expect(loaded.error).toContain("本次可以继续提问");
    const request = { requestId: "11111111-1111-4111-8111-111111111111", question: "【问题】继续检查", rawQuestion: "继续检查", label: "第 2 集 · 成片" };
    values.set("pending", JSON.stringify(makeAdvisorPendingRecovery(request, false)));
    expect(loadAdvisorPendingRecovery(storage, "pending").value?.request).toEqual(request);
  });

  it("回包按 requestId 幂等合并，并可直接写回发起时捕获的旧会话", () => {
    const request = { requestId: "11111111-1111-4111-8111-111111111111", rawQuestion: "检查第一集", label: "第 1 集 · 分镜" };
    const once = mergeAdvisorCompletedExchange([], request, "建议一");
    const twice = mergeAdvisorCompletedExchange(once, request, "重复回执不应再加一条");
    expect(twice).toEqual(once);
    expect(twice.map((turn) => turn.id)).toEqual([
      `${request.requestId}:question`,
      `${request.requestId}:answer`,
    ]);

    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const restored = persistAdvisorCompletedExchange(storage, "captured-session", request, "建议一");
    expect(parseAdvisorMessages(values.get("captured-session")!)).toEqual(restored);
    expect(values.has("another-session")).toBe(false);
  });
});
