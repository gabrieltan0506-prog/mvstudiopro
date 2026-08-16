import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "GROWTH_STORE_DIR",
  "DOUYIN_COOKIE",
  "DOUYIN_COOKIE_BACKUP",
  "DOUYIN_CREATOR_CENTER_COOKIE",
  "DOUYIN_CREATOR_CENTER_ENABLED",
  "DOUYIN_CREATOR_INDEX_COOKIE",
  "DOUYIN_CREATOR_INDEX_CSRF_TOKEN",
  "DOUYIN_CREATOR_INDEX_ENABLED",
] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function configureValidCredentials() {
  process.env.DOUYIN_COOKIE = "sessionid=feed-primary-secret";
  process.env.DOUYIN_COOKIE_BACKUP = "sessionid=feed-backup-secret";
  process.env.DOUYIN_CREATOR_CENTER_COOKIE = "sessionid=center-secret";
  process.env.DOUYIN_CREATOR_INDEX_COOKIE = "sessionid=index-secret";
  process.env.DOUYIN_CREATOR_INDEX_CSRF_TOKEN = "csrf-secret";
  process.env.DOUYIN_CREATOR_CENTER_ENABLED = "0";
  process.env.DOUYIN_CREATOR_INDEX_ENABLED = "1";
}

describe("Douyin credential daily health probe", () => {
  let tempRoot = "";

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "douyin-credential-health-"));
    process.env.GROWTH_STORE_DIR = tempRoot;
    configureValidCredentials();
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      const value = ORIGINAL_ENV[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("停用的创作者中心不发请求，并且落盘报告不含任何密钥", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("/api/v2/index/get_hot_trend_word")) {
        return jsonResponse({ status: 0, data: "encrypted" });
      }
      return jsonResponse({ status_code: 0, aweme_list: [{ aweme_id: "1" }] });
    });
    const { maybeCheckDouyinCredentialHealth } = await import("./douyinCredentialHealth");

    const report = await maybeCheckDouyinCredentialHealth({ force: true, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(requestedUrls.some((url) => url.includes("/material/center/billboard"))).toBe(false);
    expect(report.entries.find((entry) => entry.key === "creator-center")).toMatchObject({
      enabled: false,
      status: "disabled",
    });
    const persisted = await fs.readFile(path.join(tempRoot, "runtime-douyin-credential-health.json"), "utf8");
    expect(persisted).not.toContain("feed-primary-secret");
    expect(persisted).not.toContain("feed-backup-secret");
    expect(persisted).not.toContain("center-secret");
    expect(persisted).not.toContain("index-secret");
    expect(persisted).not.toContain("csrf-secret");
  });

  it("启用项按业务状态判定失效，并持久化供 Debug 读取", async () => {
    process.env.DOUYIN_CREATOR_CENTER_ENABLED = "1";
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/material/center/billboard")) {
        return jsonResponse({ status_code: 8, status_msg: "用户未登录" });
      }
      if (url.includes("/api/v2/index/get_hot_trend_word")) {
        return jsonResponse({ status: 8, data: null });
      }
      return jsonResponse({ status_code: 0, aweme_list: [] });
    });
    const { maybeCheckDouyinCredentialHealth, readDouyinCredentialHealthReport } = await import(
      "./douyinCredentialHealth"
    );

    const report = await maybeCheckDouyinCredentialHealth({ force: true, fetchImpl });
    expect(report.entries.find((entry) => entry.key === "feed-primary")?.status).toBe("valid");
    expect(report.entries.find((entry) => entry.key === "creator-center")).toMatchObject({
      status: "invalid",
      businessCode: "8",
      reason: "用户未登录",
    });
    expect(report.entries.find((entry) => entry.key === "creator-index")).toMatchObject({
      status: "invalid",
      businessCode: "8",
    });
    expect(await readDouyinCredentialHealthReport()).toEqual(report);
  });

  it("24 小时内复用持久化结果，到期后才重新探测", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => (
      String(input).includes("/api/v2/index/get_hot_trend_word")
        ? jsonResponse({ status: 0, data: "encrypted" })
        : jsonResponse({ status_code: 0, aweme_list: [] })
    ));
    const { maybeCheckDouyinCredentialHealth } = await import("./douyinCredentialHealth");
    const start = Date.parse("2026-08-16T00:00:00.000Z");

    await maybeCheckDouyinCredentialHealth({ nowMs: start, fetchImpl });
    await maybeCheckDouyinCredentialHealth({ nowMs: start + 60 * 60 * 1000, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    const refreshed = await maybeCheckDouyinCredentialHealth({ nowMs: start + 24 * 60 * 60 * 1000, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(refreshed.checkedAt).toBe("2026-08-17T00:00:00.000Z");
  });

  it("启用配置变化会立即刷新，刚停用的项不再发探针请求", async () => {
    process.env.DOUYIN_CREATOR_CENTER_ENABLED = "1";
    const requestedUrls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("/api/v2/index/get_hot_trend_word")) {
        return jsonResponse({ status: 0, data: "encrypted" });
      }
      if (url.includes("/material/center/billboard")) {
        return jsonResponse({ status_code: 0 });
      }
      return jsonResponse({ status_code: 0, aweme_list: [] });
    });
    const { maybeCheckDouyinCredentialHealth } = await import("./douyinCredentialHealth");
    const start = Date.parse("2026-08-16T00:00:00.000Z");

    await maybeCheckDouyinCredentialHealth({ nowMs: start, fetchImpl });
    process.env.DOUYIN_CREATOR_CENTER_ENABLED = "0";
    const refreshed = await maybeCheckDouyinCredentialHealth({ nowMs: start + 60_000, fetchImpl });

    expect(requestedUrls.filter((url) => url.includes("/material/center/billboard"))).toHaveLength(1);
    expect(refreshed.entries.find((entry) => entry.key === "creator-center")).toMatchObject({
      enabled: false,
      status: "disabled",
    });
  });

  it("网络失败标记为探针失败，不误判 Cookie 已失效", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network unavailable");
    });
    const { maybeCheckDouyinCredentialHealth } = await import("./douyinCredentialHealth");
    const report = await maybeCheckDouyinCredentialHealth({ force: true, fetchImpl });
    expect(report.entries.find((entry) => entry.key === "feed-primary")?.status).toBe("probe_error");
    expect(report.entries.find((entry) => entry.key === "creator-index")?.status).toBe("probe_error");
  });
});
