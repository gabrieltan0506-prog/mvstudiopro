import fs from "node:fs/promises";
import path from "node:path";

export type DouyinCredentialHealthStatus = "valid" | "invalid" | "missing" | "disabled" | "probe_error";

export type DouyinCredentialHealthEntry = {
  key: "feed-primary" | "feed-backup" | "creator-center" | "creator-index";
  label: string;
  enabled: boolean;
  configured: boolean;
  status: DouyinCredentialHealthStatus;
  checkedAt?: string;
  reason: string;
  httpStatus?: number;
  businessCode?: string;
};

export type DouyinCredentialHealthReport = {
  version: 1;
  checkedAt: string;
  nextCheckAt: string;
  /** 只包含 enabled/configured 布尔值，不包含任何密钥内容。 */
  configSignature?: string;
  entries: DouyinCredentialHealthEntry[];
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const DAY_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const STORE_DIR = path.resolve(
  process.env.GROWTH_STORE_DIR || path.join(path.resolve(process.cwd(), ".cache"), "growth"),
);
const REPORT_FILE = path.join(STORE_DIR, "runtime-douyin-credential-health.json");
let healthCheckInFlight: Promise<DouyinCredentialHealthReport> | null = null;

function isEnabled(name: string) {
  return String(process.env[name] || "1").trim() !== "0";
}

function getCredentialConfigSignature() {
  const creatorIndexCookie = String(process.env.DOUYIN_CREATOR_INDEX_COOKIE || "").trim();
  const creatorIndexCsrf = String(
    process.env.DOUYIN_CREATOR_INDEX_CSRF_TOKEN
    || process.env.DOUYIN_CREATOR_CENTER_CSRF_TOKEN
    || "",
  ).trim();
  return JSON.stringify({
    feedPrimary: { enabled: true, configured: Boolean(String(process.env.DOUYIN_COOKIE || "").trim()) },
    feedBackup: { enabled: true, configured: Boolean(String(process.env.DOUYIN_COOKIE_BACKUP || "").trim()) },
    creatorCenter: {
      enabled: isEnabled("DOUYIN_CREATOR_CENTER_ENABLED"),
      configured: Boolean(String(process.env.DOUYIN_CREATOR_CENTER_COOKIE || "").trim()),
    },
    creatorIndex: {
      enabled: isEnabled("DOUYIN_CREATOR_INDEX_ENABLED"),
      configured: Boolean(creatorIndexCookie && creatorIndexCsrf),
    },
  });
}

function safeBusinessCode(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value).slice(0, 80);
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) return {} as Record<string, unknown>;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { parseError: true } as Record<string, unknown>;
  }
}

async function fetchJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    return { response, payload: await readJsonResponse(response) };
  } finally {
    clearTimeout(timer);
  }
}

function disabledEntry(
  key: DouyinCredentialHealthEntry["key"],
  label: string,
  configured: boolean,
): DouyinCredentialHealthEntry {
  return {
    key,
    label,
    enabled: false,
    configured,
    status: "disabled",
    reason: "已停用，不参与每日自检。",
  };
}

function missingEntry(
  key: DouyinCredentialHealthEntry["key"],
  label: string,
  checkedAt: string,
): DouyinCredentialHealthEntry {
  return {
    key,
    label,
    enabled: true,
    configured: false,
    status: "missing",
    checkedAt,
    reason: "已启用但未配置凭证。",
  };
}

async function probeFeedCookie(
  key: "feed-primary" | "feed-backup",
  label: string,
  cookie: string,
  checkedAt: string,
  fetchImpl: FetchLike,
): Promise<DouyinCredentialHealthEntry> {
  if (!cookie) return missingEntry(key, label, checkedAt);
  try {
    const { response, payload } = await fetchJson(
      fetchImpl,
      "https://www.douyin.com/aweme/v1/web/tab/feed/?publish_video_strategy_type=2&aid=6383&channel=channel_pc_web&cookie_enabled=true&count=1&max_cursor=0",
      {
        headers: {
          accept: "application/json,text/plain,*/*",
          cookie,
          referer: "https://www.douyin.com/",
          "user-agent": "Mozilla/5.0 mvstudiopro-growth-credential-probe/1.0",
        },
      },
    );
    const businessCode = safeBusinessCode(payload.status_code ?? payload.status);
    const valid = response.ok
      && Array.isArray(payload.aweme_list)
      && (businessCode === undefined || businessCode === "0");
    return {
      key,
      label,
      enabled: true,
      configured: true,
      status: valid ? "valid" : "invalid",
      checkedAt,
      reason: valid ? "Feed 凭证有效。" : "Feed 未返回有效 aweme_list。",
      httpStatus: response.status,
      businessCode,
    };
  } catch (error) {
    return {
      key,
      label,
      enabled: true,
      configured: true,
      status: "probe_error",
      checkedAt,
      reason: `探针请求失败：${error instanceof Error ? error.message : String(error)}`.slice(0, 240),
    };
  }
}

async function probeCreatorCenter(
  checkedAt: string,
  fetchImpl: FetchLike,
): Promise<DouyinCredentialHealthEntry> {
  const label = "创作者中心 Cookie";
  const cookie = String(process.env.DOUYIN_CREATOR_CENTER_COOKIE || "").trim();
  if (!isEnabled("DOUYIN_CREATOR_CENTER_ENABLED")) {
    return disabledEntry("creator-center", label, Boolean(cookie));
  }
  if (!cookie) return missingEntry("creator-center", label, checkedAt);
  try {
    const endpoint = String(
      process.env.DOUYIN_CREATOR_CENTER_ENDPOINT
      || "https://creator.douyin.com/web/api/creator/material/center/billboard/",
    ).trim();
    const url = new URL(endpoint);
    url.searchParams.set("billboard_type", "1");
    url.searchParams.set("billboard_tag", "0");
    url.searchParams.set("order_key", "1");
    url.searchParams.set("time_filter", "1");
    url.searchParams.set("limit", "1");
    url.searchParams.set("aweme_limit", "1");
    const { response, payload } = await fetchJson(fetchImpl, url.toString(), {
      headers: {
        accept: "application/json,text/plain,*/*",
        cookie,
        referer: "https://creator.douyin.com/creator-micro/home",
        "user-agent": "Mozilla/5.0 mvstudiopro-growth-credential-probe/1.0",
      },
    });
    const businessCode = safeBusinessCode(payload.status_code ?? payload.status);
    const valid = response.ok && businessCode === "0";
    return {
      key: "creator-center",
      label,
      enabled: true,
      configured: true,
      status: valid ? "valid" : "invalid",
      checkedAt,
      reason: valid
        ? "创作者中心凭证有效。"
        : String(payload.status_msg || payload.status_message || "创作者中心返回未登录或异常状态。").slice(0, 240),
      httpStatus: response.status,
      businessCode,
    };
  } catch (error) {
    return {
      key: "creator-center",
      label,
      enabled: true,
      configured: true,
      status: "probe_error",
      checkedAt,
      reason: `探针请求失败：${error instanceof Error ? error.message : String(error)}`.slice(0, 240),
    };
  }
}

async function probeCreatorIndex(
  checkedAt: string,
  fetchImpl: FetchLike,
): Promise<DouyinCredentialHealthEntry> {
  const label = "创作者指数 Cookie / CSRF";
  const cookie = String(process.env.DOUYIN_CREATOR_INDEX_COOKIE || "").trim();
  const csrfToken = String(
    process.env.DOUYIN_CREATOR_INDEX_CSRF_TOKEN
    || process.env.DOUYIN_CREATOR_CENTER_CSRF_TOKEN
    || "",
  ).trim();
  if (!isEnabled("DOUYIN_CREATOR_INDEX_ENABLED")) {
    return disabledEntry("creator-index", label, Boolean(cookie && csrfToken));
  }
  if (!cookie || !csrfToken) return missingEntry("creator-index", label, checkedAt);
  try {
    const { response, payload } = await fetchJson(
      fetchImpl,
      "https://creator.douyin.com/api/v2/index/get_hot_trend_word",
      {
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          appsource: "PC",
          "content-type": "application/json",
          cookie,
          origin: "https://creator.douyin.com",
          referer: "https://creator.douyin.com/creator-micro/creator-count/arithmetic-index",
          "user-agent": "Mozilla/5.0 mvstudiopro-growth-credential-probe/1.0",
          "x-secsdk-csrf-token": csrfToken,
        },
        body: JSON.stringify({ app: "aweme", type: 0 }),
      },
    );
    const businessCode = safeBusinessCode(payload.status ?? payload.status_code);
    const valid = response.ok && businessCode === "0" && payload.data !== undefined;
    return {
      key: "creator-index",
      label,
      enabled: true,
      configured: true,
      status: valid ? "valid" : "invalid",
      checkedAt,
      reason: valid ? "创作者指数凭证有效。" : "创作者指数返回未登录或异常状态。",
      httpStatus: response.status,
      businessCode,
    };
  } catch (error) {
    return {
      key: "creator-index",
      label,
      enabled: true,
      configured: true,
      status: "probe_error",
      checkedAt,
      reason: `探针请求失败：${error instanceof Error ? error.message : String(error)}`.slice(0, 240),
    };
  }
}

async function writeReport(report: DouyinCredentialHealthReport) {
  await fs.mkdir(STORE_DIR, { recursive: true });
  const tempPath = `${REPORT_FILE}.${process.pid}.${Date.now()}.next`;
  await fs.writeFile(tempPath, JSON.stringify(report, null, 2), "utf8");
  await fs.rename(tempPath, REPORT_FILE);
}

export async function readDouyinCredentialHealthReport(): Promise<DouyinCredentialHealthReport | null> {
  try {
    const raw = await fs.readFile(REPORT_FILE, "utf8");
    const parsed = JSON.parse(raw) as DouyinCredentialHealthReport;
    return parsed?.version === 1 && Array.isArray(parsed.entries) ? parsed : null;
  } catch {
    return null;
  }
}

export async function maybeCheckDouyinCredentialHealth(options: {
  force?: boolean;
  nowMs?: number;
  fetchImpl?: FetchLike;
} = {}): Promise<DouyinCredentialHealthReport> {
  if (healthCheckInFlight) return healthCheckInFlight;
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const configSignature = getCredentialConfigSignature();
  const existing = await readDouyinCredentialHealthReport();
  if (!options.force && existing?.configSignature === configSignature) {
    const checkedAtMs = Date.parse(existing.checkedAt);
    if (Number.isFinite(checkedAtMs) && nowMs - checkedAtMs < DAY_MS) return existing;
  }

  const fetchImpl = options.fetchImpl || fetch;
  healthCheckInFlight = (async () => {
    const checkedAt = new Date(nowMs).toISOString();
    const entries = await Promise.all([
      probeFeedCookie(
        "feed-primary",
        "抖音 Feed 主 Cookie",
        String(process.env.DOUYIN_COOKIE || "").trim(),
        checkedAt,
        fetchImpl,
      ),
      probeFeedCookie(
        "feed-backup",
        "抖音 Feed 备用 Cookie",
        String(process.env.DOUYIN_COOKIE_BACKUP || "").trim(),
        checkedAt,
        fetchImpl,
      ),
      probeCreatorCenter(checkedAt, fetchImpl),
      probeCreatorIndex(checkedAt, fetchImpl),
    ]);
    const report: DouyinCredentialHealthReport = {
      version: 1,
      checkedAt,
      nextCheckAt: new Date(nowMs + DAY_MS).toISOString(),
      configSignature,
      entries,
    };
    await writeReport(report);
    return report;
  })();

  try {
    return await healthCheckInFlight;
  } finally {
    healthCheckInFlight = null;
  }
}
