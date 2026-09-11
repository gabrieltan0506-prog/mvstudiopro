// 在 Fly 内只读检查已部署恢复端；避免工作流先更新、旧服务仍无法读取分仓分片。
import { growthColdStoreReleaseTag } from "../shared/growthColdStoreRelease.mjs";
if (
  growthColdStoreReleaseTag("platform-current-douyin.batch-123-1.part-0000") !==
    "growth-current-batch-123-1" ||
  growthColdStoreReleaseTag("archive-2026-09-11-00.tar.gz") !==
    "growth-archive-2026-09-11"
)
  throw new Error("服务端冷备分仓读取版本不匹配");
console.log("冷备分仓读取版本已就绪");
