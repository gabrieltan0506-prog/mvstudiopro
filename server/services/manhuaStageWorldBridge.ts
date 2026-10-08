import express, { type Express } from "express";
import { z } from "zod";
import {
  artEvidenceSignature,
  validArtEvidenceSignature,
} from "./artMotionEvidence";
import { artMotionTaskId } from "./artMotionTask";
import { getJobByIdStrict } from "../jobs/repository";
import { artMotionJobSchema } from "../../shared/artMotion";
import {
  getManhuaWorldTask,
  type ManhuaWorldTaskView,
} from "./manhuaWorldTask";
import { readStageWorldSnapshot } from "./manhuaStageWorldSnapshot";
import { listFlyMachines, resolveFlyMachinesConfig } from "./flyMachines";
import { ArtMotionArchiveUnavailable } from "./artMotionArchive";
const route = "/api/internal/manhua-stage-world";
const schema = z
  .object({
    userId: z.string().regex(/^[1-9]\d*$/),
    requestId: z.string().uuid(),
    worldTaskId: z.string().min(1).max(200),
  })
  .strict();
export function registerManhuaStageWorldBridge(app: Express) {
  app.post(
    route,
    express.raw({ type: "application/octet-stream", limit: "4kb" }),
    async (req, res) => {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (
        !validArtEvidenceSignature(
          process.env.JWT_SECRET || "",
          String(req.headers["x-art-evidence-time"] || ""),
          String(req.headers["x-art-evidence-signature"] || ""),
          body
        )
      )
        return res.status(403).json({ error: "forbidden" });
      try {
        if (process.env.FLY_MACHINE_ID === process.env.MANHUA_HEAVY_MACHINE_ID)
          return res.status(503).json({ error: "website required" });
        const input = schema.parse(JSON.parse(body.toString()));
        const job = await getJobByIdStrict(
          artMotionTaskId(input.userId, input.requestId)
        );
        const parsed = artMotionJobSchema.safeParse(job?.input);
        if (
          !job ||
          job.userId !== input.userId ||
          job.type !== "post_prod" ||
          !parsed.success ||
          parsed.data.requestId !== input.requestId ||
          parsed.data.params.stageAnimation?.worldTaskId !== input.worldTaskId
        )
          return res.status(403).json({ error: "forbidden" });
        const world = await readStageWorldSnapshot(
          input.userId,
          parsed.data,
          true
        ).catch(async error => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          // GCS 正常写入时没有额外网站副本；仅在读取故障后使用原任务持久记录。
          return getManhuaWorldTask(input.worldTaskId, Number(input.userId));
        });
        return world
          ? res.json(world)
          : res.status(404).json({ error: "world unavailable" });
      } catch {
        return res.status(503).json({ error: "world lookup unavailable" });
      }
    }
  );
}
export async function readStageWorld(
  userId: string,
  requestId: string | undefined,
  worldTaskId: string
): Promise<ManhuaWorldTaskView | null> {
  if (
    !process.env.FLY_MACHINE_ID ||
    process.env.FLY_MACHINE_ID !== process.env.MANHUA_HEAVY_MACHINE_ID
  )
    return getManhuaWorldTask(worldTaskId, Number(userId));
  if (!requestId) throw new Error("场景动画缺少原请求编号");
  const job = await getJobByIdStrict(artMotionTaskId(userId, requestId));
  const input = artMotionJobSchema.safeParse(job?.input);
  if (
    !job ||
    job.userId !== userId ||
    job.type !== "post_prod" ||
    !input.success ||
    input.data.requestId !== requestId ||
    input.data.params.stageAnimation?.worldTaskId !== worldTaskId
  )
    throw new Error("场景动画任务归属不一致");
  // 仅消费入队前服务端封存的同一版本；网站离线不影响工作机读取。
  try {
    return await readStageWorldSnapshot(userId, input.data);
  } catch (error) {
    if (!(error instanceof ArtMotionArchiveUnavailable)) throw error;
    // 只有 GCS 读取失败才启用原网站桥；不启动网站，不写工作机 /data。
    const config = resolveFlyMachinesConfig(),
      secret = process.env.JWT_SECRET || "";
    if (!config || secret.length < 24)
      throw new Error("GCS 读取失败，网站回退未配置");
    const sites = (await listFlyMachines(config)).filter(
      m =>
        m.state === "started" &&
        m.id !== process.env.MANHUA_HEAVY_MACHINE_ID &&
        m.processGroup === "app"
    );
    if (sites.length !== 1) throw new Error("GCS 读取失败，网站回退不可用");
    const body = Buffer.from(
        JSON.stringify(schema.parse({ userId, requestId, worldTaskId }))
      ),
      timestamp = String(Date.now());
    const response = await fetch(`https://${config.appName}.fly.dev${route}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Fly-Force-Instance-Id": sites[0].id,
        "X-Art-Evidence-Time": timestamp,
        "X-Art-Evidence-Signature": artEvidenceSignature(
          secret,
          timestamp,
          body
        ),
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("GCS 与网站场景回退均不可用，未重新生成");
    const world = (await response.json()) as ManhuaWorldTaskView;
    if (world.taskId !== worldTaskId) throw new Error("网站场景回退身份不一致");
    return world;
  }
}
