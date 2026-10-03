import { hostname } from "node:os";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { completePostProdJob, getJobByIdStrict, markJobFailed } from "./repository";

type Owner = { machineId: string; bootId: string; pid: number; startTicks: string };
type Receipt = { version: 1; jobId: string; userId: string; owner: Owner; result?: { output: unknown; provider: string } };
const root = () => process.env.POST_PROD_RECOVERY_DIR || (process.env.FLY_MACHINE_ID
  ? "/data/post-prod-recovery" : path.join(process.cwd(), ".cache", "post-prod-recovery"));
const file = (id: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("后期任务ID格式错误");
  return path.join(root(), `${id}.json`);
};
async function startTicks(pid: number) {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/)[19];
}
export async function postProdOwner(): Promise<Owner> {
  return { machineId: process.env.FLY_MACHINE_ID || hostname(), pid: process.pid,
    bootId: await readFile("/proc/sys/kernel/random/boot_id", "utf8").then(s => s.trim()).catch(() => ""),
    startTicks: await startTicks(process.pid).catch(() => "") };
}
export async function savePostProdReceipt(receipt: Receipt) {
  await mkdir(root(), { recursive: true });
  const target = file(receipt.jobId);
  const next = `${target}.${process.pid}.next`;
  await writeFile(next, JSON.stringify(receipt), { mode: 0o600 });
  await rename(next, target);
}
export async function removePostProdReceipt(id: string) { await rm(file(id), { force: true }); }

export async function isPostProdOwnerGone(owner: Owner, current: Owner): Promise<boolean> {
  if (owner.machineId !== current.machineId) return false;
  if (owner.bootId && current.bootId && owner.bootId !== current.bootId) return true;
  if (!owner.startTicks) return false; // 无法证明时交给失联回收，不猜 PID 归属。
  try { return await startTicks(owner.pid) !== owner.startTicks; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
}

/** 只恢复同机已消失进程的状态/已上传产物；不重新执行媒体或调用供应商。 */
export async function recoverPostProdReceipts(): Promise<{ recovered: number; interrupted: number }> {
  const current = await postProdOwner();
  const files = await readdir(root()).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  let recovered = 0;
  let interrupted = 0;
  for (const name of files.filter(name => /^[a-zA-Z0-9_-]+\.json$/.test(name))) {
    const receipt = JSON.parse(await readFile(path.join(root(), name), "utf8")) as Receipt;
    if (receipt.version !== 1 || name !== `${receipt.jobId}.json` || !receipt.owner) continue;
    if (!(await isPostProdOwnerGone(receipt.owner, current))) continue;
    const job = await getJobByIdStrict(receipt.jobId);
    if (!job || job.type !== "post_prod" || String(job.userId) !== receipt.userId) continue;
    if (job.status === "succeeded") { await removePostProdReceipt(job.id); continue; }
    if (job.status !== "running") continue;
    if (receipt.result) {
      if (await completePostProdJob(job.id, receipt.result.output, receipt.result.provider)) {
        recovered++;
        await removePostProdReceipt(job.id);
      }
    } else {
      await markJobFailed(job.id, "后期执行进程已中断，原素材和任务回执保留；未自动重做，请先核对原任务");
      interrupted++;
      // 失败回执仍保留，后续可对照事故时的进程归属。
    }
  }
  return { recovered, interrupted };
}
