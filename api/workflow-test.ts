import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { startWorkflow } from "../server/workflow/engine";
import type { WorkflowTask } from "../server/workflow/types/workflow";

function parseBody(body: unknown): Record<string, any> {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      throw new Error("invalid_json_body");
    }
  }
  if (typeof body === "object") {
    return body as Record<string, any>;
  }
  return {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = parseBody(req.body);
    const sourceType = body.sourceType;
    const inputType = body.inputType;
    const payload = body.payload ?? {};

    if (sourceType !== "direct" && sourceType !== "remix" && sourceType !== "showcase") {
      return res.status(400).json({ ok: false, error: "sourceType must be direct/remix/showcase" });
    }

    if (inputType !== "script" && inputType !== "image") {
      return res.status(400).json({ ok: false, error: "inputType must be script or image" });
    }

    const now = Date.now();

    const task: WorkflowTask = {
      workflowId: randomUUID(),
      sourceType,
      inputType,
      currentStep: "input",
      status: "pending",
      payload,
      outputs: {},
      createdAt: now,
      updatedAt: now,
    };

    const workflow = await startWorkflow(task);

    return res.status(200).json({
      ok: true,
      workflow,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: "workflow_test_failed",
      message: error?.message || String(error),
    });
  }
}
