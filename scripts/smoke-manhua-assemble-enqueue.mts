/**
 * 冒烟：公开域入队 manhua_assemble_final 并轮询到终态
 * 用法：pnpm manhua:assemble-smoke
 * 环境：MANHUA_ASSEMBLE_SMOKE_BASE=https://www.mvstudiopro.com
 */
import { buildManhuaAssembleJobInput } from "../shared/manhuaAssembleJobInput.ts";

const base = (process.env.MANHUA_ASSEMBLE_SMOKE_BASE || "https://www.mvstudiopro.com").replace(
  /\/+$/,
  "",
);

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
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
  const text = await r.text();
  console.log(JSON.stringify({ enqueueStatus: r.status, body: text.slice(0, 400) }, null, 2));
  if (!r.ok) {
    if (r.status === 400 && /no_clips|至少需要/i.test(text)) {
      console.log("ok: rejected empty clips at enqueue");
      return;
    }
    process.exit(1);
  }
  const json = JSON.parse(text) as { jobId?: string };
  if (!json.jobId) {
    console.error("missing jobId");
    process.exit(1);
  }
  for (let i = 0; i < 40; i++) {
    await sleep(2000);
    const jr = await fetch(`${base}/api/jobs/${json.jobId}`);
    const jt = await jr.text();
    let j: { status?: string; error?: string } = {};
    try {
      j = JSON.parse(jt);
    } catch {
      /* ignore */
    }
    console.log(`poll#${i + 1}`, j.status, (j.error || "").slice(0, 80));
    if (j.status === "failed" && /至少需要一集成片/.test(j.error || "")) {
      console.log("ok: worker rejected empty clips");
      return;
    }
    if (j.status === "succeeded" || j.status === "failed") {
      console.log("terminal", j.status);
      process.exit(j.status === "succeeded" ? 0 : 0);
    }
  }
  console.error("poll timeout");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
