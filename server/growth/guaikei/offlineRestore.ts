import fs from "node:fs/promises";
import path from "node:path";

/** 还原包中的隔离标记禁止触发任何新的供应商请求，原台账和配置保持原样。 */
export async function assertGuaikeiLiveStore(root: string) {
  try {
    await fs.lstat(path.join(root, ".growth-offline-restore"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("离线还原数据只供核验，禁止提交或轮询采集任务");
}
