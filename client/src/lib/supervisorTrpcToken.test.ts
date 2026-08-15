import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureSupervisorTokenFromUrl,
  clearSupervisorSession,
  exchangeSupervisorSecret,
  hasSupervisorSessionHint,
} from "./supervisorTrpcToken";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values,
  };
}

describe("supervisorTrpcToken HttpOnly 换会话", () => {
  const session = storage();
  const local = storage();
  const replaceState = vi.fn();

  beforeEach(() => {
    session.values.clear();
    local.values.clear();
    replaceState.mockReset();
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("window", {
      location: {
        search: "?supervisor=1&supervisorToken=raw-secret",
        pathname: "/platform",
        hash: "#panel",
      },
      history: { replaceState },
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POST 换会话后只存有效期提示，不存原始密钥", async () => {
    const expiresAt = Date.now() + 60_000;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, expiresAt }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await captureSupervisorTokenFromUrl()).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/platform?supervisor=1#panel");
    expect(hasSupervisorSessionHint()).toBe(true);
    expect(JSON.stringify([
      ...Array.from(session.values.entries()),
      ...Array.from(local.values.entries()),
    ]))
      .not.toContain("raw-secret");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/supervisor-session",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("登出清本地监管提示并 DELETE HttpOnly 会话", async () => {
    session.setItem("mvs-supervisor-session-ready", String(Date.now() + 60_000));
    local.setItem("mvs-supervisor-access", "1");
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await clearSupervisorSession();
    expect(hasSupervisorSessionHint()).toBe(false);
    expect(local.getItem("mvs-supervisor-access")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/supervisor-session",
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    );
  });

  it("会话有效期异常时拒绝写入 hint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ expiresAt: Date.now() - 1 }),
    })));
    await expect(exchangeSupervisorSecret("raw-secret")).rejects.toThrow("有效期异常");
    expect(hasSupervisorSessionHint()).toBe(false);
  });
});
