/**
 * 匿名合成安全探针：只验证 401 且没有任务号，不代表合成质量验收。
 * 不携带 Cookie／密钥，不入队、不轮询、不调用生成模型。
 * 用法：pnpm manhua:assemble-smoke
 * 环境：MANHUA_ASSEMBLE_SMOKE_BASE=https://www.mvstudiopro.com
 */
import { buildManhuaAssembleJobInput } from "../shared/manhuaAssembleJobInput.ts";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const base = (process.env.MANHUA_ASSEMBLE_SMOKE_BASE || "https://www.mvstudiopro.com").replace(
  /\/+$/,
  "",
);

export function assertAnonymousAssembleRejected(status: number, body: unknown): void {
  if (status !== 401 || !body || typeof body !== "object" || Array.isArray(body) ||
    Object.hasOwn(body, "jobId") || (body as { ok?: unknown }).ok === true) {
    throw new Error("匿名合成门禁不符合预期：必须返回 401 且不创建任务");
  }
}

async function main() {
  const body = {
    type: "video" as const,
    userId: "",
    input: buildManhuaAssembleJobInput({ clips: [] }),
  };
  const r = await fetch(`${base}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assertAnonymousAssembleRejected(r.status, await r.json());
  console.log("通过：匿名合成返回 401，无任务号；仅验证拒绝门禁，未验证合成质量。");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "安全探针失败"); process.exitCode = 1; });
}
