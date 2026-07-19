/**
 * 冒烟：同源/公开域入队 manhua_assemble_final（空 clips → 应排队后失败或立即拒）
 * 用法：pnpm exec tsx scripts/smoke-manhua-assemble-enqueue.mts
 * 环境：MANHUA_ASSEMBLE_SMOKE_BASE=https://www.mvstudiopro.com
 */
import { buildManhuaAssembleJobInput } from "../shared/manhuaAssembleJobInput.ts";

const base = (process.env.MANHUA_ASSEMBLE_SMOKE_BASE || "https://www.mvstudiopro.com").replace(
  /\/+$/,
  "",
);

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
  const text = await r.text();
  console.log(JSON.stringify({ status: r.status, body: text.slice(0, 500) }, null, 2));
  if (r.status === 200) {
    const json = JSON.parse(text) as { jobId?: string };
    if (json.jobId) {
      console.log("queued", json.jobId, "· poll", `${base}/api/jobs/${json.jobId}`);
    }
  } else if (r.status === 400 && /no_clips|至少需要/i.test(text)) {
    console.log("ok: rejected empty clips as expected");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
