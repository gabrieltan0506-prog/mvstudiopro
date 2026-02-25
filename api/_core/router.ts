import type { Express } from "express";
import { createContext } from "./context.js";
import { createJob, getJobById, type JobType } from "./jobs.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function registerCoreRoutes(app: Express): void {
  app.post("/api/jobs", async (req, res) => {
    try {
      const { type, input, userId } = (req.body ?? {}) as {
        type?: JobType;
        input?: unknown;
        userId?: string;
      };

      if (type !== "video" && type !== "image" && type !== "audio") {
        return res.status(400).json({ error: "Invalid job type" });
      }
      if (typeof userId !== "string" || userId.trim().length === 0) {
        return res.status(400).json({ error: "userId is required" });
      }
      if (!isRecord(input)) {
        return res.status(400).json({ error: "input is required" });
      }

      const ctx = createContext(req, res);
      const job = createJob({
        type,
        userId: userId.trim(),
        input,
      });

      return res.status(200).json({
        jobId: job.id,
        status: job.status,
        requestId: ctx.requestId,
      });
    } catch (error) {
      console.error("[Jobs] POST /api/jobs failed:", error);
      return res.status(500).json({ error: "Failed to create job" });
    }
  });

  app.get("/api/jobs/:id", async (req, res) => {
    try {
      const jobId = req.params.id;
      if (!jobId) {
        return res.status(400).json({ error: "Job id is required" });
      }

      const job = getJobById(jobId);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      return res.status(200).json({
        status: job.status,
        output: job.output,
        error: job.error,
      });
    } catch (error) {
      console.error("[Jobs] GET /api/jobs/:id failed:", error);
      return res.status(500).json({ error: "Failed to fetch job" });
    }
  });

  app.get("/api/diag/smoke", (_req, res) => {
    return res.status(200).json({
      status: "ok",
      checks: {
        health: true,
        jobsRoute: true,
      },
    });
  });
}
